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
const MAX_INLINE_EDIT_FOLLOWUP_MESSAGES = 4;

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
    return this.sendTurn(prompt, request.allowedTools, true);
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
    return this.sendTurn(prompt, allowedTools, false);
  }

  private trimConversation(turns: InlineEditTurn[]): InlineEditTurn[] {
    if (turns.length <= MAX_INLINE_EDIT_FOLLOWUP_MESSAGES + 1) return turns;
    const first = turns[0];
    let tail = turns.slice(-MAX_INLINE_EDIT_FOLLOWUP_MESSAGES);
    // Follow-up continuity is question/reply shaped. Never retain a user reply
    // after trimming if the assistant clarification it answered was just removed.
    if (tail[0]?.role === 'user') {
      tail = tail.slice(1);
    }
    return [first, ...tail];
  }

  private buildConversationPrompt(turns: InlineEditTurn[]): string {
    if (turns.length === 1) return turns[0].content;
    const transcript = turns
      .map((turn) => `${turn.role === 'user' ? 'User' : 'Assistant'}:\n${turn.content}`)
      .join('\n\n');
    return `<inline_edit_conversation>\n${transcript}\n</inline_edit_conversation>`;
  }

  private async sendTurn(
    prompt: string,
    allowedTools: string[] | undefined,
    resetConversation: boolean
  ): Promise<InlineEditResult> {
    const base = resetConversation ? [] : this.conversation;
    const candidate = this.trimConversation([
      ...base,
      { role: 'user', content: prompt },
    ]);
    return this.sendConversation(candidate, allowedTools);
  }

  private async sendConversation(
    candidate: InlineEditTurn[],
    allowedTools?: string[]
  ): Promise<InlineEditResult> {
    this.abortController = new AbortController();
    const systemPrompt = getInlineEditSystemPrompt();
    const prompt = this.buildConversationPrompt(candidate);
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
        // Inline Edit is a proposal surface: provider tools must never mutate files
        // before the user accepts the rendered diff.
        readOnly: true,
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
      if (result.success) {
        const committed = [...candidate];
        if (result.clarification) {
          committed.push({ role: 'assistant', content: result.clarification });
        }
        // Commit only after a successful provider turn. Failed/cancelled attempts must
        // not become part of the continuity SSOT or evict older valid context.
        this.conversation = this.trimConversation(committed);
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
