/**
 * InlineEditService - Inline text editing with Copilot CLI
 *
 * Uses CopilotBridgeService for single-shot text transformations.
 * Simplified from Claude SDK-based implementation.
 */

import { CopilotBridgeService } from '../../core/agent/CopilotBridgeService';
import { getInlineEditSystemPrompt } from '../../core/prompts/inlineEdit';
import type ObsidianCopilotPlugin from '../../main';
import { prependContextFiles } from '../../utils/context';
import { type CursorContext } from '../../utils/editor';

export type InlineEditMode = 'selection' | 'cursor';

interface InlineEditToolPolicy {
  allowedTools?: string[];
}

export interface InlineEditSelectionRequest extends InlineEditToolPolicy {
  mode: 'selection';
  instruction: string;
  notePath: string;
  selectedText: string;
  startLine?: number;
  lineCount?: number;
  contextFiles?: string[];
}

export interface InlineEditCursorRequest extends InlineEditToolPolicy {
  mode: 'cursor';
  instruction: string;
  notePath: string;
  cursorContext: CursorContext;
  contextFiles?: string[];
}

export type InlineEditRequest = InlineEditSelectionRequest | InlineEditCursorRequest;

export interface InlineEditResult {
  success: boolean;
  editedText?: string;
  insertedText?: string;
  clarification?: string;
  error?: string;
}

type InlineEditAgentService = Pick<CopilotBridgeService, 'streamQuery' | 'cancel'>;
type InlineEditTurn = { role: 'user' | 'assistant'; content: string };
const MAX_INLINE_EDIT_FOLLOWUP_TURNS = 4;

export class InlineEditService {
  private plugin: ObsidianCopilotPlugin;
  private abortController: AbortController | null = null;
  private readonly agentService: InlineEditAgentService;
  private conversation: InlineEditTurn[] = [];

  constructor(
    plugin: ObsidianCopilotPlugin,
    serviceFactory: () => InlineEditAgentService = () => new CopilotBridgeService(plugin)
  ) {
    this.plugin = plugin;
    // Inline Edit owns its provider process/session. It must never mutate the main
    // chat bridge's Copilot session or cancel a chat request.
    this.agentService = serviceFactory();
  }

  resetConversation(): void {
    this.conversation = [];
  }

  async editText(request: InlineEditRequest): Promise<InlineEditResult> {
    const prompt = this.buildPrompt(request);
    this.conversation = [{ role: 'user', content: prompt }];
    return this.sendConversation(request.allowedTools);
  }

  async continueConversation(
    message: string,
    contextFiles?: string[],
    allowedTools?: string[]
  ): Promise<InlineEditResult> {
    let prompt = message;
    if (contextFiles && contextFiles.length > 0) {
      prompt = prependContextFiles(message, contextFiles);
    }
    this.conversation.push({ role: 'user', content: prompt });
    this.trimConversation();
    return this.sendConversation(allowedTools);
  }

  private trimConversation(): void {
    if (this.conversation.length <= MAX_INLINE_EDIT_FOLLOWUP_TURNS + 1) return;
    const first = this.conversation[0];
    this.conversation = [first, ...this.conversation.slice(-MAX_INLINE_EDIT_FOLLOWUP_TURNS)];
  }

  private buildConversationPrompt(): string {
    if (this.conversation.length === 1) return this.conversation[0].content;
    const transcript = this.conversation
      .map((turn) => `${turn.role === 'user' ? 'User' : 'Assistant'}:\n${turn.content}`)
      .join('\n\n');
    return `<inline_edit_conversation>\n${transcript}\n</inline_edit_conversation>`;
  }

  private async sendConversation(allowedTools?: string[]): Promise<InlineEditResult> {
    this.abortController = new AbortController();
    const systemPrompt = getInlineEditSystemPrompt();
    const prompt = this.buildConversationPrompt();
    const fullPrompt = `${systemPrompt}\n\n${prompt}`;

    // The CLI child spawns with whatever permission mode was current when the stream
    // started; flipping the toggle mid-stream must not let it read "Ask" while that
    // child can still write. Same busy signal InputController's executeStream uses
    // for the chat path.
    this.plugin.setBashExpansionActive(true);
    try {
      let responseText = '';

      for await (const chunk of this.agentService.streamQuery(fullPrompt, {
        allowedTools,
        // Continuity is local and explicit above. Never let a provider-side Copilot
        // session become hidden state that disappears when the provider changes.
        skipResume: true,
      })) {
        if (this.abortController?.signal.aborted) {
          return { success: false, error: 'Cancelled' };
        }
        responseText += chunk;
      }

      const result = this.parseResponse(responseText);
      if (result.success && result.clarification) {
        this.conversation.push({ role: 'assistant', content: result.clarification });
        this.trimConversation();
      }
      return result;
    } catch (error) {
      console.error('[InlineEditService] Error:', error);
      const msg = error instanceof Error ? error.message : 'Unknown error';
      return { success: false, error: msg };
    } finally {
      this.abortController = null;
      this.plugin.setBashExpansionActive(false);
    }
  }

  private parseResponse(responseText: string): InlineEditResult {
    const replacementMatch = responseText.match(/<replacement>([\s\S]*?)<\/replacement>/);
    if (replacementMatch) {
      return { success: true, editedText: replacementMatch[1] };
    }

    const insertionMatch = responseText.match(/<insertion>([\s\S]*?)<\/insertion>/);
    if (insertionMatch) {
      return { success: true, insertedText: insertionMatch[1] };
    }

    const trimmed = responseText.trim();
    if (trimmed) {
      return { success: true, clarification: trimmed };
    }

    return { success: false, error: 'Empty response' };
  }

  private buildPrompt(request: InlineEditRequest): string {
    let prompt: string;

    if (request.mode === 'cursor') {
      prompt = this.buildCursorPrompt(request);
    } else {
      const lineAttr = request.startLine && request.lineCount
        ? ` lines="${request.startLine}-${request.startLine + request.lineCount - 1}"`
        : '';
      prompt = [
        `<editor_selection path="${request.notePath}"${lineAttr}>`,
        request.selectedText,
        '</editor_selection>',
        '',
        '<query>',
        request.instruction,
        '</query>',
      ].join('\n');
    }

    if (request.contextFiles && request.contextFiles.length > 0) {
      prompt = prependContextFiles(prompt, request.contextFiles);
    }

    return prompt;
  }

  private buildCursorPrompt(request: InlineEditCursorRequest): string {
    const ctx = request.cursorContext;
    const lineAttr = ` line="${ctx.line + 1}"`;

    let cursorContent: string;
    if (ctx.isInbetween) {
      const parts = [];
      if (ctx.beforeCursor) parts.push(ctx.beforeCursor);
      parts.push('| #inbetween');
      if (ctx.afterCursor) parts.push(ctx.afterCursor);
      cursorContent = parts.join('\n');
    } else {
      cursorContent = `${ctx.beforeCursor}|${ctx.afterCursor} #inline`;
    }

    return [
      `<editor_cursor path="${request.notePath}"${lineAttr}>`,
      cursorContent,
      '</editor_cursor>',
      '',
      '<query>',
      request.instruction,
      '</query>',
    ].join('\n');
  }

  cancel(): void {
    if (this.abortController) {
      this.abortController.abort();
    }
    // Abort the owned CLI child immediately; do not wait for another stream chunk.
    this.agentService.cancel();
  }
}
