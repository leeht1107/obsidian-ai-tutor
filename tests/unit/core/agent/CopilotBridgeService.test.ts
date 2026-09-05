import {
  detectCopilotCliCapabilities,
  resolveCopilotAllowedTools,
  sessionArgs,
  shouldUseCopilotAllowAllTools,
  translateCopilotJsonEvent,
} from '@/core/agent/CopilotBridgeService';

describe('CopilotBridgeService helpers', () => {
  describe('detectCopilotCliCapabilities', () => {
    it('detects supported flags from help text', () => {
      const capabilities = detectCopilotCliCapabilities(`
        --no-ask-user
        --no-custom-instructions
        --output-format <format>
        --stream <mode>
        --resume [sessionId]
        --session-id <id>
        --model <model>
        --deny-tool [tools...]
        --available-tools [tools...]
        --allow-all-tools
        json
      `);

      expect(capabilities).toEqual({
        noAskUser: true,
        noCustomInstructions: true,
        outputFormatJson: true,
        stream: true,
        resume: true,
        sessionId: true,
        model: true,
        denyTool: true,
        availableTools: true,
        allowAllTools: true,
        reasoningEffort: false,
      });
    });

    it('returns false for flags missing from help text', () => {
      expect(detectCopilotCliCapabilities('Usage: copilot')).toEqual({
        noAskUser: false,
        noCustomInstructions: false,
        outputFormatJson: false,
        stream: false,
        resume: false,
        sessionId: false,
        model: false,
        denyTool: false,
        availableTools: false,
        allowAllTools: false,
        reasoningEffort: false,
      });
    });
  });

  describe('resolveCopilotAllowedTools', () => {
    it('keeps agent mode unrestricted when no explicit tools are requested', () => {
      expect(resolveCopilotAllowedTools('agent')).toEqual([]);
    });

    it('applies safe guardrails in normal mode', () => {
      expect(resolveCopilotAllowedTools('normal')).toEqual([
        'view',
        'grep',
        'glob',
        'ls',
        'task',
        'agent_output',
        'report_intent',
        'webfetch',
        'websearch',
      ]);
    });

    it('filters requested tools through normal mode guardrails', () => {
      expect(resolveCopilotAllowedTools('normal', ['view', 'bash', 'task'])).toEqual(['view', 'task']);
    });

    it('falls back to plan guardrails when a plan-mode request asks for unsupported tools only', () => {
      expect(resolveCopilotAllowedTools('normal', ['bash', 'write'], true)).toEqual([
        'view',
        'grep',
        'glob',
        'ls',
        'task',
        'agent_output',
        'report_intent',
        'webfetch',
        'websearch',
      ]);
    });

    it('uses plan guardrails in agent mode when plan mode has no explicit tools', () => {
      expect(resolveCopilotAllowedTools('agent', undefined, true)).toEqual([
        'view',
        'grep',
        'glob',
        'ls',
        'task',
        'agent_output',
        'report_intent',
        'webfetch',
        'websearch',
      ]);
    });
  });

  describe('shouldUseCopilotAllowAllTools', () => {
    it('uses allow-all-tools for unrestricted agent mode without explicit tools', () => {
      expect(shouldUseCopilotAllowAllTools('agent', true, undefined)).toBe(true);
    });

    it('does not use allow-all-tools in plan mode with default tool guardrails', () => {
      expect(shouldUseCopilotAllowAllTools('agent', true, { planMode: true })).toBe(false);
    });

    it('lets explicit tool requests use available-tools instead of allow-all-tools', () => {
      expect(
        shouldUseCopilotAllowAllTools('agent', true, { allowedTools: ['view'] })
      ).toBe(false);
    });

    it('falls back when the CLI does not support allow-all-tools', () => {
      expect(shouldUseCopilotAllowAllTools('agent', false, undefined)).toBe(false);
    });
  });

  describe('translateCopilotJsonEvent', () => {
    it('translates reasoning deltas into thinking chunks', () => {
      expect(translateCopilotJsonEvent({
        type: 'assistant.reasoning_delta',
        data: { deltaContent: 'Thinking...' },
      })).toEqual([{ type: 'thinking', content: 'Thinking...' }]);
    });

    it('translates tool requests from assistant messages', () => {
      expect(translateCopilotJsonEvent({
        type: 'assistant.message',
        data: {
          toolRequests: [
            { toolRequestId: 'call-1', name: 'view', input: { file_path: 'foo.md' } },
          ],
        },
      })).toEqual([
        { type: 'tool_use', id: 'call-1', name: 'view', input: { file_path: 'foo.md' } },
      ]);
    });

    it('translates completed tool executions into tool_result chunks', () => {
      expect(translateCopilotJsonEvent({
        type: 'tool.execution_complete',
        data: {
          toolCallId: 'call-1',
          parentToolCallId: 'parent-1',
          success: true,
          result: { detailedContent: 'done' },
        },
      })).toEqual([
        { type: 'tool_result', id: 'call-1', content: 'done', isError: false, parentToolUseId: 'parent-1', toolName: null },
      ]);
    });

    it('captures session ids from result events', () => {
      let captured: string | null = null;
      expect(translateCopilotJsonEvent({
        type: 'result',
        sessionId: 'session-123',
        exitCode: 0,
      }, (sessionId) => {
        captured = sessionId;
      })).toEqual([]);
      expect(captured).toBe('session-123');
    });

    it('emits a usage chunk when result usage contains token fields', () => {
      expect(translateCopilotJsonEvent({
        type: 'result',
        sessionId: 'session-usage',
        exitCode: 0,
        usage: {
          inputTokens: 40,
          cacheCreationInputTokens: 10,
          cacheReadInputTokens: 0,
          contextWindow: 100,
        },
      })).toEqual([
        {
          type: 'usage',
          sessionId: 'session-usage',
          usage: {
            inputTokens: 40,
            cacheCreationInputTokens: 10,
            cacheReadInputTokens: 0,
            contextWindow: 100,
            contextTokens: 50,
            percentage: 50,
            premiumRequests: 0,
          },
        },
      ]);
    });

    it('emits a premium-only usage chunk when token fields are absent', () => {
      expect(translateCopilotJsonEvent({
        type: 'result',
        exitCode: 0,
        usage: {
          premiumRequests: 0.33,
        },
      })).toEqual([
        {
          type: 'usage',
          sessionId: null,
          usage: {
            inputTokens: 0,
            cacheCreationInputTokens: 0,
            cacheReadInputTokens: 0,
            contextWindow: 0,
            contextTokens: 0,
            percentage: 0,
            premiumRequests: 0.33,
          },
        },
      ]);
    });

    it('returns an error chunk for non-zero result exit codes', () => {
      expect(translateCopilotJsonEvent({
        type: 'result',
        exitCode: 2,
      })).toEqual([{ type: 'error', content: 'Copilot exited with code 2' }]);
    });
  });
});

/**
 * Session continuity with copilot.
 *
 * The plugin generates its own conversation UUID, then asked copilot to
 * `--resume` it. copilot has no such session on the first request of a
 * conversation, so every new chat opened with:
 *
 *   Error: No session, task, or name matched '<uuid>'.
 *
 * Reproduced against the real CLI on 2026-09-05, along with the fix:
 * `--session-id <uuid>` is documented as "Resume an existing session or task by
 * ID, or set the UUID for a new session", and it accepted a fresh UUID, then
 * recalled a number across a second call with the same UUID.
 */
describe('copilot session flag selection', () => {
  it('prefers --session-id, which accepts a UUID the plugin invented', () => {
    const capabilities = detectCopilotCliCapabilities('--resume[=value]  --session-id <id>');
    expect(capabilities.sessionId).toBe(true);
    expect(sessionArgs(capabilities, 'abc-123')).toEqual(['--session-id', 'abc-123']);
  });

  it('never resumes an id copilot has not confirmed, on an older CLI without --session-id', () => {
    const capabilities = detectCopilotCliCapabilities('--resume[=value]');
    expect(capabilities.sessionId).toBe(false);
    // Nothing: a locally generated id would fail, and the real id is captured
    // from copilot's own output for the next request.
    expect(sessionArgs(capabilities, 'abc-123')).toEqual([]);
  });

  it('resumes a confirmed id on an older CLI', () => {
    const capabilities = detectCopilotCliCapabilities('--resume[=value]');
    expect(sessionArgs(capabilities, 'abc-123', true)).toEqual(['--resume', 'abc-123']);
  });
});
