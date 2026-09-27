/**
 * TitleGenerationService - Generates conversation titles with Copilot CLI
 *
 * Uses CopilotBridgeService for title generation.
 * Simplified from Claude SDK-based implementation.
 */

import { CopilotBridgeService } from '../../../core/agent/CopilotBridgeService';
import { TITLE_GENERATION_SYSTEM_PROMPT } from '../../../core/prompts/titleGeneration';
import type ObsidianCopilotPlugin from '../../../main';

export type TitleGenerationResult =
  | { success: true; title: string }
  | { success: false; error: string };

export type TitleGenerationCallback = (
  conversationId: string,
  result: TitleGenerationResult
) => Promise<void>;

type TitleAgentService = Pick<CopilotBridgeService, 'streamQuery' | 'cancel'>;

export class TitleGenerationService {
  private plugin: ObsidianCopilotPlugin;
  private activeGenerations = new Map<string, {
    abortController: AbortController;
    service: TitleAgentService;
  }>();
  private readonly serviceFactory: () => TitleAgentService;

  constructor(
    plugin: ObsidianCopilotPlugin,
    serviceFactory: () => TitleAgentService = () => new CopilotBridgeService(plugin)
  ) {
    this.plugin = plugin;
    this.serviceFactory = serviceFactory;
  }

  async generateTitle(
    conversationId: string,
    userMessage: string,
    assistantResponse: string,
    callback: TitleGenerationCallback
  ): Promise<void> {
    // Defense in depth for direct callers: Agy cannot guarantee Web-off, and title
    // generation is optional. Never start a provider request in that configuration.
    if (this.plugin.settings.selectedProvider === 'agy') {
      await this.safeCallback(callback, conversationId, {
        success: false,
        error: 'Automatic title generation is unavailable with Agy because Web-off cannot be enforced.',
      });
      return;
    }

    const existingGeneration = this.activeGenerations.get(conversationId);
    if (existingGeneration) {
      existingGeneration.abortController.abort();
      existingGeneration.service.cancel();
    }

    const abortController = new AbortController();
    // Title generation must not share the chat bridge's sessionId/currentProcess.
    // A background title request can overlap the next student message, so sharing
    // one mutable bridge lets the title session replace or cancel the chat session.
    const titleAgentService = this.serviceFactory();
    const generation = { abortController, service: titleAgentService };
    this.activeGenerations.set(conversationId, generation);

    const truncatedUser = this.truncateText(userMessage, 500);
    const truncatedAssistant = this.truncateText(assistantResponse, 500);

    const prompt = `${TITLE_GENERATION_SYSTEM_PROMPT}

User's first message:
"""
${truncatedUser}
"""

AI's response:
"""
${truncatedAssistant}
"""

Generate a title for this conversation:`;

    // Same busy signal as the chat and inline-edit streams: the CLI child already
    // spawned with whatever permission mode was current, so the toggle must stay
    // locked for as long as that child can still write.
    this.plugin.setBashExpansionActive(true);
    try {
      let responseText = '';
      const titleModel = this.plugin.settings.titleGenerationModel?.trim();

      for await (const chunk of titleAgentService.streamQuery(prompt, {
        skipResume: true,
        model: titleModel && titleModel !== 'auto' ? titleModel : undefined,
        readOnly: true,
        enableWebSearch: false,
      })) {
        if (abortController.signal.aborted) {
          await this.safeCallback(callback, conversationId, {
            success: false,
            error: 'Cancelled',
          });
          return;
        }
        responseText += chunk;
      }

      const title = this.parseTitle(responseText);
      if (title) {
        await this.safeCallback(callback, conversationId, { success: true, title });
      } else {
        console.warn('[TitleGeneration] Failed to parse title from response');
        await this.safeCallback(callback, conversationId, {
          success: false,
          error: 'Failed to parse title from response',
        });
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      const isConfigError = msg.includes('not configured') || msg.includes('CLI');
      if (error instanceof Error && error.name !== 'AbortError' && !isConfigError) {
        console.error('[TitleGeneration] Error generating title:', error.message);
      }
      await this.safeCallback(callback, conversationId, { success: false, error: msg });
    } finally {
      if (this.activeGenerations.get(conversationId) === generation) {
        this.activeGenerations.delete(conversationId);
      }
      this.plugin.setBashExpansionActive(false);
    }
  }

  cancel(): void {
    for (const generation of this.activeGenerations.values()) {
      generation.abortController.abort();
      generation.service.cancel();
    }
    this.activeGenerations.clear();
  }

  private truncateText(text: string, maxLength: number): string {
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength) + '...';
  }

  private parseTitle(responseText: string): string | null {
    const trimmed = responseText.trim();
    if (!trimmed) return null;

    let title = trimmed;
    if (
      (title.startsWith('"') && title.endsWith('"')) ||
      (title.startsWith("'") && title.endsWith("'"))
    ) {
      title = title.slice(1, -1);
    }

    title = title.replace(/[.!?:;,]+$/, '');

    if (title.length > 50) {
      title = title.substring(0, 47) + '...';
    }

    return title || null;
  }

  private async safeCallback(
    callback: TitleGenerationCallback,
    conversationId: string,
    result: TitleGenerationResult
  ): Promise<void> {
    try {
      await callback(conversationId, result);
    } catch (error) {
      console.error('[TitleGeneration] Error in callback:', error instanceof Error ? error.message : error);
    }
  }
}
