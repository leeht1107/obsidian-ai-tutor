import { type ChildProcess, execFile, spawn } from 'child_process';
import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

import type ObsidianCopilotPlugin from '../../main';
import { stripCurrentNotePrefix } from '../../utils/context';
import { findCopilotCLIPath, resolveCmdShim } from '../../utils/copilotCli';
import { getEnhancedPath, parseEnvironmentVariables } from '../../utils/env';
import { normalizePathForFilesystem } from '../../utils/path';
import { buildContextFromHistory, getLastUserMessage } from '../../utils/session';
import { buildSystemPrompt } from '../prompts/mainAgent';
import {
  buildNativeProviderCommand,
  findProviderCliPath,
  getStaticProviderModels,
  parseAgyModels,
  parseCodexModels,
  type ProviderId,
  type ProviderModelOption,
  resolveNativeSelection,
  supportsReadOnlyMode,
  writesWithoutAsking,
} from '../providers/providerRegistry';
import type { RequestOutcome } from '../setup/providerConnection';
import { isWriteEditTool } from '../tools/toolNames';
import type {
  ChatMessage,
  ExitPlanModeDecision,
  ImageAttachment,
  StreamChunk,
  ToolDiffData,
  UsageInfo,
} from '../types';
import { THINKING_BUDGETS } from '../types';
import { classifyCopilotFailure, copilotRequestOutcome } from './copilotOutcome';

export interface QueryOptions {
  allowedTools?: string[];
  model?: string;
  skipResume?: boolean;
  planMode?: boolean;
  externalContextPaths?: string[];
  enableWebSearch?: boolean;
}

export type ApprovalCallback = (
  toolName: string,
  input: Record<string, unknown>,
  description: string
) => Promise<'allow' | 'allow-always' | 'deny' | 'cancel'>;

export type ExitPlanModeCallback = (planContent: string) => Promise<ExitPlanModeDecision>;
export type EnterPlanModeCallback = () => Promise<void>;

const ALLOWED_TOOLS = [
  'view',
  'grep',
  'glob',
  'ls',
  'task',
  'agent_output',
  'report_intent',
  'webfetch',
  'websearch',
] as const;

const MAX_DIFF_SIZE = 100 * 1024;
const CLI_CAPABILITY_PROBE_TIMEOUT_MS = 2500;

interface DiffContentEntry {
  filePath: string;
  content: string | null;
  skippedReason?: 'too_large' | 'unavailable';
}

export function resolveCopilotAllowedTools(
  permissionMode: string,
  requestedTools?: string[],
  planMode?: boolean,
  enableWebSearch = true
): string[] {
  const requested = requestedTools?.map((tool) => tool.trim()).filter(Boolean) ?? [];
  const guardrailTools = planMode
    ? [...ALLOWED_TOOLS]
    : permissionMode === 'agent'
      ? null
      : [...ALLOWED_TOOLS];
  const guardrailSet = guardrailTools ? new Set<string>(guardrailTools) : null;
  let effectiveTools = requested.length > 0
    ? guardrailSet
      ? requested.filter((tool) => guardrailSet.has(tool))
      : requested
    : guardrailTools ?? [];

  if (!enableWebSearch) {
    const webTools = new Set(['websearch', 'webfetch']);
    effectiveTools = effectiveTools.filter((tool) => !webTools.has(tool));
  }

  return guardrailSet && effectiveTools.length === 0
    ? guardrailTools ?? []
    : effectiveTools;
}

function hasExplicitCopilotAllowedTools(requestedTools?: string[]): boolean {
  return requestedTools?.some((tool) => tool.trim().length > 0) ?? false;
}

export function shouldUseCopilotAllowAllTools(
  permissionMode: string,
  allowAllToolsSupported: boolean,
  queryOptions: Pick<QueryOptions, 'allowedTools' | 'planMode'> | undefined,
): boolean {
  if (!allowAllToolsSupported || queryOptions?.planMode) {
    return false;
  }
  if (hasExplicitCopilotAllowedTools(queryOptions?.allowedTools)) {
    return false;
  }
  return permissionMode === 'agent';
}

interface CopilotJsonEvent {
  type: string;
  data?: Record<string, unknown>;
  sessionId?: string;
  exitCode?: number;
  usage?: Record<string, unknown>;
}

export function translateCopilotJsonEvent(
  event: CopilotJsonEvent,
  setSessionId?: (sessionId: string) => void
): StreamChunk[] {
  if (event.type === 'assistant.reasoning_delta') {
    const deltaContent = typeof event.data?.deltaContent === 'string' ? event.data.deltaContent : '';
    return deltaContent ? [{ type: 'thinking', content: deltaContent }] : [];
  }

  if (event.type === 'assistant.message_delta') {
    const deltaContent = typeof event.data?.deltaContent === 'string' ? event.data.deltaContent : '';
    return deltaContent ? [{ type: 'text', content: deltaContent }] : [];
  }

  if (event.type === 'assistant.message') {
    const toolRequests = Array.isArray(event.data?.toolRequests) ? event.data.toolRequests : [];
    const chunks: StreamChunk[] = [];

    for (const request of toolRequests) {
      if (!request || typeof request !== 'object') continue;
      const toolRequest = request as Record<string, unknown>;
      const id = typeof toolRequest.id === 'string'
        ? toolRequest.id
        : typeof toolRequest.toolRequestId === 'string'
          ? toolRequest.toolRequestId
          : null;
      const name = typeof toolRequest.name === 'string' ? toolRequest.name : null;
      const input = toolRequest.input;

      if (id && name && input && typeof input === 'object' && !Array.isArray(input)) {
        chunks.push({ type: 'tool_use', id, name, input: input as Record<string, unknown> });
      }
    }

    return chunks;
  }

  if (event.type === 'tool.execution_start') {
    const toolCallId = typeof event.data?.toolCallId === 'string' ? event.data.toolCallId : null;
    const toolName = typeof event.data?.toolName === 'string' ? event.data.toolName
      : typeof event.data?.name === 'string' ? event.data.name
      : null;
    const input = event.data?.input;
    const parentToolUseId = typeof event.data?.parentToolCallId === 'string'
      ? event.data.parentToolCallId
      : null;

    if (toolCallId && toolName) {
      return [{
        type: 'tool_use',
        id: toolCallId,
        name: toolName,
        input: (input && typeof input === 'object' && !Array.isArray(input))
          ? input as Record<string, unknown>
          : {},
        parentToolUseId,
      }];
    }
    return [];
  }

  if (event.type === 'tool.execution_complete') {
    const toolCallId = typeof event.data?.toolCallId === 'string' ? event.data.toolCallId : null;
    if (!toolCallId) {
      return [];
    }

    const result = event.data?.result;
    const resultRecord = result && typeof result === 'object' && !Array.isArray(result)
      ? result as Record<string, unknown>
      : null;
    const content = typeof resultRecord?.content === 'string'
      ? resultRecord.content
      : typeof resultRecord?.detailedContent === 'string'
        ? resultRecord.detailedContent
        : '';
    const isError = event.data?.success === false;
    const parentToolUseId = typeof event.data?.parentToolCallId === 'string'
      ? event.data.parentToolCallId
      : null;
    const toolName = typeof event.data?.toolName === 'string' ? event.data.toolName
      : typeof event.data?.name === 'string' ? event.data.name
      : null;

    return [{
      type: 'tool_result',
      id: toolCallId,
      content,
      isError,
      parentToolUseId,
      toolName,
    }];
  }

  if (event.type === 'result') {
    if (typeof event.sessionId === 'string' && event.sessionId.length > 0) {
      setSessionId?.(event.sessionId);
    }
    if (typeof event.exitCode === 'number' && event.exitCode !== 0) {
      return [{ type: 'error', content: `Copilot exited with code ${event.exitCode}` }];
    }

    const usageChunk = buildUsageChunkFromResult(event);
    if (usageChunk) {
      return [usageChunk];
    }
  }

  return [];
}

function buildUsageChunkFromResult(event: CopilotJsonEvent): { type: 'usage'; usage: UsageInfo; sessionId?: string | null } | null {
  const usage = event.usage;
  if (!usage) {
    return null;
  }

  const inputTokens = toFiniteNumber(usage.inputTokens);
  const cacheCreationInputTokens = toFiniteNumber(usage.cacheCreationInputTokens) ?? 0;
  const cacheReadInputTokens = toFiniteNumber(usage.cacheReadInputTokens) ?? 0;
  const contextWindow = toFiniteNumber(usage.contextWindow);
  const premiumRequests = toFiniteNumber(usage.premiumRequests) ?? 0;

  if (inputTokens === null || contextWindow === null || contextWindow <= 0) {
    if (premiumRequests <= 0) {
      return null;
    }

    return {
      type: 'usage',
      sessionId: event.sessionId ?? null,
      usage: {
        inputTokens: 0,
        cacheCreationInputTokens: 0,
        cacheReadInputTokens: 0,
        contextWindow: 0,
        contextTokens: 0,
        percentage: 0,
        premiumRequests,
      },
    };
  }

  const contextTokens = inputTokens + cacheCreationInputTokens + cacheReadInputTokens;
  const percentage = Math.max(0, Math.min(100, Math.round((contextTokens / contextWindow) * 100)));

  return {
    type: 'usage',
    sessionId: event.sessionId ?? null,
    usage: {
      inputTokens,
      cacheCreationInputTokens,
      cacheReadInputTokens,
      contextWindow,
      contextTokens,
      percentage,
      premiumRequests,
    },
  };
}

function toFiniteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

interface CopilotCliCapabilities {
  noAskUser: boolean;
  noCustomInstructions: boolean;
  outputFormatJson: boolean;
  stream: boolean;
  resume: boolean;
  /** `--session-id` accepts a UUID we invented; `--resume` does not. */
  sessionId: boolean;
  model: boolean;
  denyTool: boolean;
  availableTools: boolean;
  allowAllTools: boolean;
  reasoningEffort: boolean;
}

function stripWrappingQuotes(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

/**
 * How to ask copilot to continue a conversation.
 *
 * The plugin owns the conversation UUID, so it used to pass it to `--resume` —
 * which fails on the first request of every new chat, because copilot has no
 * session by that id yet:
 *   Error: No session, task, or name matched '<uuid>'.
 * `--session-id` is documented as "Resume an existing session or task by ID, or
 * set the UUID for a new session", and was confirmed against the real CLI to
 * accept a fresh UUID and then recall context on a second call with the same one.
 *
 * @param confirmed whether copilot itself reported this id. Only then is
 * `--resume` safe on a CLI too old to have `--session-id`.
 */
export function sessionArgs(
  capabilities: Pick<CopilotCliCapabilities, 'resume' | 'sessionId'>,
  sessionId: string,
  confirmed = false
): string[] {
  if (capabilities.sessionId) return ['--session-id', sessionId];
  if (capabilities.resume && confirmed) return ['--resume', sessionId];
  return [];
}

export function detectCopilotCliCapabilities(helpText: string): CopilotCliCapabilities {
  return {
    noAskUser: helpText.includes('--no-ask-user'),
    noCustomInstructions: helpText.includes('--no-custom-instructions'),
    outputFormatJson: helpText.includes('--output-format') && helpText.includes('json'),
    stream: helpText.includes('--stream'),
    resume: helpText.includes('--resume'),
    sessionId: helpText.includes('--session-id'),
    model: helpText.includes('--model'),
    denyTool: helpText.includes('--deny-tool'),
    availableTools: helpText.includes('--available-tools'),
    allowAllTools: helpText.includes('--allow-all-tools'),
    reasoningEffort: helpText.includes('--reasoning-effort'),
  };
}

export class CopilotBridgeService {
  /**
   * Told what each real request did, so a CLI that cannot be asked about login
   * still has honest evidence behind its badge. Set by the plugin at startup.
   */
  onOutcome?: (providerId: ProviderId, outcome: RequestOutcome) => void;
  /**
   * Something changed what the CLI is allowed to do, and the student must see it.
   * A callback rather than a Notice because this file must not reach into the UI,
   * and rather than a stream chunk because the conversation is the model's own
   * transcript — a warning written there is replayed as if the model had said it.
   */
  onPermissionNotice?: (message: string) => void;
  private plugin: ObsidianCopilotPlugin;
  private currentProcess: ChildProcess | null = null;
  private abortController: AbortController | null = null;
  private sessionId: string | null = null;
  /** True once copilot has reported this session id itself. A locally invented
   * id must never be handed to --resume. */
  private sessionConfirmedByCli = false;
  private wasInterrupted = false;
  private cachedCopilotPath: string | null | undefined = undefined;
  private cachedCapabilities = new Map<string, CopilotCliCapabilities>();
  private capabilityProbePromises = new Map<string, Promise<CopilotCliCapabilities>>();

  private exitPlanModeCallback: ExitPlanModeCallback | null = null;
  /** The last permission notice shown per provider, so the same one is not repeated. */
  private readonly shownPermissionNotices = new Map<ProviderId, string>();
  private currentPlanFilePath: string | null = null;
  private approvedPlanContent: string | null = null;
  private askUserQuestionAnswers = new Map<string, Record<string, string | string[]>>();
  private isAskUserQuestionSupported = true;
  private originalContents = new Map<string, DiffContentEntry>();
  private pendingDiffData = new Map<string, ToolDiffData>();

  constructor(plugin: ObsidianCopilotPlugin) {
    this.plugin = plugin;
  }

  private getCopilotPath(): string | null {
    const settingsPath = this.plugin.settings.copilotCliPath?.trim();
    if (settingsPath) {
      return normalizePathForFilesystem(stripWrappingQuotes(settingsPath)) || settingsPath;
    }

    if (this.cachedCopilotPath === undefined) {
      const detectedPath = findCopilotCLIPath();
      this.cachedCopilotPath = detectedPath
        ? normalizePathForFilesystem(stripWrappingQuotes(detectedPath)) || detectedPath
        : null;
    }
    return this.cachedCopilotPath;
  }

  /**
   * Clears the cached CLI path so the next call re-scans the filesystem.
   * Call this after auto-installing the CLI so the new binary is picked up
   * without requiring an Obsidian restart.
   */
  invalidatePathCache(): void {
    this.cachedCopilotPath = undefined;
  }

  private getWorkingDirectory(): string {
    const adapter = this.plugin.app.vault.adapter;
    if ('basePath' in adapter && typeof adapter.basePath === 'string' && adapter.basePath) {
      // Normalize to strip Windows extended prefixes (\\?\) and MSYS paths (/c/Users/...)
      // that cause spawn EINVAL when passed as cwd on Windows.
      return normalizePathForFilesystem(adapter.basePath) || process.cwd();
    }
    return process.cwd();
  }

  private buildSystemPromptText(prompt: string, vaultPath: string, queryOptions?: QueryOptions): string {
    const hasEditorContext = prompt.includes('<editor_selection');
    return buildSystemPrompt({
      mediaFolder: this.plugin.settings.mediaFolder,
      customPrompt: this.plugin.settings.systemPrompt,
      allowedExportPaths: this.plugin.settings.allowedExportPaths,
      externalContextPaths: queryOptions?.externalContextPaths,
      vaultPath,
      hasEditorContext,
      planMode: queryOptions?.planMode,
      appendedPlan: this.approvedPlanContent ?? undefined,
    });
  }

  private injectSystemPrompt(prompt: string, vaultPath: string, queryOptions?: QueryOptions): string {
    const systemPrompt = this.buildSystemPromptText(prompt, vaultPath, queryOptions).trim();
    return `<system_instructions>\n${systemPrompt}\n</system_instructions>\n\n${prompt}`;
  }

  private buildPromptWithHistory(
    prompt: string,
    conversationHistory: ChatMessage[] | undefined,
    vaultPath: string,
    queryOptions?: QueryOptions
  ): string {
    const injectedPrompt = this.injectSystemPrompt(prompt, vaultPath, queryOptions);

    if (this.wasInterrupted && conversationHistory && conversationHistory.length > 0) {
      const historyContext = buildContextFromHistory(conversationHistory);
      this.sessionId = null;
      this.sessionConfirmedByCli = false;
      this.wasInterrupted = false;
      return historyContext ? `${historyContext}\n\nUser: ${injectedPrompt}` : injectedPrompt;
    }

    if (!this.sessionId && conversationHistory && conversationHistory.length > 0) {
      const historyContext = buildContextFromHistory(conversationHistory);
      const lastUserMessage = getLastUserMessage(conversationHistory);
      const actualPrompt = stripCurrentNotePrefix(prompt);
      const shouldAppendPrompt = !lastUserMessage || lastUserMessage.content.trim() !== actualPrompt.trim();
      if (historyContext) {
        return shouldAppendPrompt ? `${historyContext}\n\nUser: ${injectedPrompt}` : historyContext;
      }
    }

    return injectedPrompt;
  }

  private ensureSessionId(): string {
    if (!this.sessionId) {
      this.sessionId = randomUUID();
    }
    return this.sessionId;
  }

  private getCustomEnv(copilotPath: string): NodeJS.ProcessEnv {
    const customEnv = parseEnvironmentVariables(this.plugin.getActiveEnvironmentVariables());
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      ...customEnv,
      PATH: getEnhancedPath(customEnv.PATH, copilotPath),
    };

    if (this.plugin.settings.githubToken) {
      env.COPILOT_GITHUB_TOKEN = this.plugin.settings.githubToken;
      env.GH_TOKEN = this.plugin.settings.githubToken;
      env.GITHUB_TOKEN = this.plugin.settings.githubToken;
    }

    return env;
  }

  async prewarmCapabilities(): Promise<void> {
    const copilotPath = this.getCopilotPath();
    if (!copilotPath) {
      return;
    }

    await this.getCliCapabilities(copilotPath);
  }

  /** Returns true if CLI capabilities have been probed and cached (CLI is ready). */
  isCliReady(): boolean {
    const copilotPath = this.getCopilotPath();
    if (!copilotPath) return false;
    return this.cachedCapabilities.has(copilotPath);
  }

  private getCliCapabilities(copilotPath: string): Promise<CopilotCliCapabilities> {
    const cached = this.cachedCapabilities.get(copilotPath);
    if (cached) {
      return Promise.resolve(cached);
    }

    const pending = this.capabilityProbePromises.get(copilotPath);
    if (pending) {
      return pending;
    }

    const probePromise = new Promise<CopilotCliCapabilities>((resolve) => {
      const probeShim = resolveCmdShim(copilotPath);
      const [probeCmd, probeArgs] = probeShim
        ? [probeShim[0], [probeShim[1], '--help', 'all']]
        : [copilotPath, ['--help', 'all']];
      execFile(probeCmd, probeArgs, {
        encoding: 'utf8',
        env: this.getCustomEnv(copilotPath),
        timeout: CLI_CAPABILITY_PROBE_TIMEOUT_MS,
        // shell:true only needed as fallback when .cmd shim resolution fails
        shell: !probeShim && process.platform === 'win32',
        windowsHide: true,
      }, (error, stdout, stderr) => {
        const helpText = typeof stdout === 'string' && stdout.trim().length > 0
          ? stdout
          : typeof stderr === 'string'
            ? stderr
            : '';
        const capabilities = detectCopilotCliCapabilities(helpText);
        if (error && helpText.length === 0) {
          resolve(detectCopilotCliCapabilities(''));
          return;
        }
        resolve(capabilities);
      });
    }).then((capabilities) => {
      this.cachedCapabilities.set(copilotPath, capabilities);
      this.capabilityProbePromises.delete(copilotPath);
      return capabilities;
    });

    this.capabilityProbePromises.set(copilotPath, probePromise);
    return probePromise;
  }

  private addToolArgs(
    args: string[],
    capabilities: CopilotCliCapabilities,
    queryOptions?: QueryOptions,
    skipAvailableTools = false
  ): void {
    const enableWebSearch = queryOptions?.enableWebSearch ?? this.plugin.settings.enableWebSearch;
    const finalTools = resolveCopilotAllowedTools(
      this.plugin.settings.permissionMode,
      queryOptions?.allowedTools,
      queryOptions?.planMode,
      enableWebSearch
    );

    if (skipAvailableTools) return;

    if (capabilities.availableTools && finalTools.length > 0) {
      args.push('--available-tools', ...finalTools);
    }
  }

  /** Lists account-available Antigravity models only when the selector requests them. */
  /**
   * Asks the installed CLI which models it can dispatch. Runs only when the user opens the
   * model picker, never on a timer, and stays local: `codex debug models` and `agy models`
   * are the CLIs' own listing commands. `claude` has no such command, so it is served from
   * the verified static aliases instead.
   */
  async listNativeProviderModels(provider: ProviderId): Promise<ProviderModelOption[]> {
    const staticModels = getStaticProviderModels(provider);
    if (staticModels.length > 0) return [...staticModels];
    const discovery: Partial<Record<ProviderId, string[]>> = {
      codex: ['debug', 'models'],
      agy: ['models'],
    };
    const args = discovery[provider];
    if (!args) return [];
    const configuredPath = this.plugin.settings.providerCliPaths[provider] || '';
    const cliPath = findProviderCliPath(provider, configuredPath);
    if (!cliPath) throw new Error(`${provider} CLI not found`);
    return new Promise((resolve, reject) => {
      execFile(cliPath, args, { cwd: this.getWorkingDirectory(), env: process.env, maxBuffer: 8 * 1024 * 1024 }, (error, stdout) => {
        if (error) { reject(error); return; }
        resolve(provider === 'codex' ? parseCodexModels(stdout) : parseAgyModels(stdout));
      });
    });
  }

  async *query(
    prompt: string,
    _images?: ImageAttachment[],
    conversationHistory?: ChatMessage[],
    queryOptions?: QueryOptions
  ): AsyncGenerator<StreamChunk> {
    if (this.plugin.settings.selectedProvider !== 'copilot') {
      yield* this.querySelectedProvider(prompt, conversationHistory, queryOptions);
      return;
    }
    const copilotPath = this.getCopilotPath();
    if (!copilotPath) {
      yield {
        type: 'error',
        content:
          'Copilot CLI not configured. Please set the path in settings or install @github/copilot globally.',
      };
      return;
    }

    const cwd = this.getWorkingDirectory();
    const capabilities = await this.getCliCapabilities(copilotPath);
    this.isAskUserQuestionSupported = !capabilities.noAskUser;
    const fullPrompt = this.buildPromptWithHistory(prompt, conversationHistory, cwd, queryOptions);
    const sessionId = this.ensureSessionId();
    const args = ['--no-color'];

    const useAllowAllTools = shouldUseCopilotAllowAllTools(
      this.plugin.settings.permissionMode,
      capabilities.allowAllTools,
      queryOptions,
    );

    if (capabilities.noAskUser) {
      args.push('--no-ask-user');
    }
    if (useAllowAllTools) {
      args.push('--allow-all-tools');
    }
    if (capabilities.noCustomInstructions) {
      args.push('--no-custom-instructions');
    }
    if (capabilities.outputFormatJson) {
      args.push('--output-format', 'json');
    }
    if (!queryOptions?.skipResume) {
      args.push(...sessionArgs(capabilities, sessionId, this.sessionConfirmedByCli));
    }
    args.push('-p', fullPrompt, '-s');
    if (capabilities.stream) {
      args.push('--stream', 'on');
    }

    const selectedModel = queryOptions?.model?.trim() || this.plugin.settings.model;
    if (capabilities.model && selectedModel && selectedModel !== 'auto') {
      args.push('--model', selectedModel);
    }

    const thinkingBudget = this.plugin.settings.thinkingBudget;
    const budgetInfo = THINKING_BUDGETS.find((b) => b.value === thinkingBudget);
    if (capabilities.reasoningEffort && budgetInfo?.cliValue) {
      args.push('--reasoning-effort', budgetInfo.cliValue);
    }

    // Avoid combining unrestricted access with a default --available-tools list. For MCP without
    // explicit tool requests, preserve unrestricted MCP routing even on older CLIs.
    this.addToolArgs(args, capabilities, queryOptions, useAllowAllTools);

    this.abortController = new AbortController();

    try {
      const isPlanMode = queryOptions?.planMode === true;
      let bufferedPlanText = '';
      let sawDone = false;

      for await (const chunk of this.spawnCopilot(copilotPath, args, this.getCustomEnv(copilotPath))) {
        if (chunk.type === 'tool_use') {
          this.trackWriteEditOriginalContent(chunk.id, chunk.name, chunk.input);
        } else if (chunk.type === 'tool_result') {
          this.finalizeWriteEditDiff(chunk.id, !!chunk.isError);
        }

        if (isPlanMode) {
          if (chunk.type === 'text') {
            bufferedPlanText += chunk.content;
            // No continue — fall through to yield chunk for real-time streaming
          }

          if (chunk.type === 'done') {
            sawDone = true;
            continue;
          }
        }

        yield chunk;
      }

      if (isPlanMode) {
        const trimmedPlan = bufferedPlanText.trim();
        if (!this.wasInterrupted && trimmedPlan) {
          if (this.exitPlanModeCallback) {
            await this.exitPlanModeCallback(trimmedPlan);
          } else {
            yield { type: 'text', content: bufferedPlanText };
          }
        }

        if (sawDone) {
          yield { type: 'done' };
        }
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      yield { type: 'error', content: msg };
    } finally {
      this.abortController = null;
    }
  }

  /** Direct native CLI seam for the non-Copilot providers. One request owns one child. */
  private async *querySelectedProvider(
    prompt: string,
    conversationHistory?: ChatMessage[],
    queryOptions?: QueryOptions
  ): AsyncGenerator<StreamChunk> {
    const provider = this.plugin.settings.selectedProvider as ProviderId;
    const configuredPath = this.plugin.settings.providerCliPaths[provider] || '';
    const cliPath = findProviderCliPath(provider, configuredPath);
    if (!cliPath) {
      yield { type: 'error', content: `${provider} CLI not found. Open Settings to complete setup.` };
      return;
    }

    const fullPrompt = this.buildPromptWithHistory(prompt, conversationHistory, this.getWorkingDirectory(), queryOptions);
    const selection = resolveNativeSelection(this.plugin.settings, queryOptions?.model);
    // Plan mode is a read-only exploration, so it maps to the same restriction as Ask.
    // A provider that cannot be held read-only gets `agent` whatever the toggle says;
    // pretending otherwise would be a guardrail that is not there.
    const mode = this.plugin.settings.permissionMode;
    const wantsReadOnly = mode === 'ask' || mode === 'plan' || Boolean(queryOptions?.planMode);
    // The consent gate lives here, not on the toggle: Agent is the default mode, so a
    // student who never touched the toggle would otherwise reach a blanket-write CLI
    // simply by selecting it. Until they have confirmed, this provider runs read-only.
    const acknowledged = this.plugin.settings.blanketWriteAcknowledged;
    // A hand-edited settings file can leave anything here, and `undefined.includes`
    // would take the request down rather than fall back to the safe answer.
    const needsConsent = writesWithoutAsking(provider)
      && !(Array.isArray(acknowledged) && acknowledged.includes(provider));
    const permissionMode = (wantsReadOnly && supportsReadOnlyMode(provider)) || needsConsent ? 'ask' : 'agent';

    // Both of these change what the CLI is allowed to do, so neither may be silent.
    // A Notice rather than a stream chunk: the conversation is the model's transcript,
    // and a warning written into it would be replayed back as if the model had said it.
    // Once per provider per session. Repeating it on every question would train the
    // student to dismiss the one notice that changes what the CLI may do.
    const notice = needsConsent && !wantsReadOnly
      ? `${provider}에 파일을 고칠 권한을 주려면 Ask/Agent 토글을 눌러 확인해 주세요. 지금은 읽기 전용으로 실행합니다.`
      : wantsReadOnly && !supportsReadOnlyMode(provider)
        ? `${provider}는 읽기 전용으로 제한할 수 없습니다. 파일을 고칠 수 있는 상태로 실행합니다.`
        : '';
    if (notice && this.shownPermissionNotices.get(provider) !== notice) {
      this.shownPermissionNotices.set(provider, notice);
      this.onPermissionNotice?.(notice);
    }
    const native = buildNativeProviderCommand(provider, fullPrompt, selection.model, selection.effort, permissionMode);
    const cmdShim = resolveCmdShim(cliPath);
    const [command, args] = cmdShim ? [cmdShim[0], [cmdShim[1], ...native.args]] : [cliPath, native.args];
    let child: ChildProcess;
    try {
      child = spawn(command, args, {
      cwd: this.getWorkingDirectory(),
      // Do not pass the legacy Copilot token setting to another provider.
      env: (() => {
        const customEnv = parseEnvironmentVariables(this.plugin.getActiveEnvironmentVariables());
        return {
          ...process.env,
          ...customEnv,
          PATH: getEnhancedPath(customEnv.PATH, cliPath),
        };
      })(),
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: !cmdShim && process.platform === 'win32',
      // No console window should flash on a student's screen per request.
      windowsHide: true,
      });
    } catch (error) {
      yield { type: 'error', content: `Failed to start ${provider} CLI: ${error instanceof Error ? error.message : String(error)}` };
      return;
    }
    this.currentProcess = child;
    // Parsed chunks are handed over as the child produces them. These CLIs are asked for a
    // streaming format, so buffering to exit would hide a token that was ready seconds earlier.
    const pending: StreamChunk[] = [];
    let lineBuffer = '';
    let errorOutput = '';
    let exitCode: number | null = null;
    let closeSignal: NodeJS.Signals | null = null;
    let closed = false;
    let wake: (() => void) | null = null;
    const signal = () => { const resume = wake; wake = null; resume?.(); };

    child.stdout?.on('data', (data: Buffer) => {
      lineBuffer += data.toString();
      const lines = lineBuffer.split(/\r?\n/);
      // The last element is whatever came after the final newline — possibly half a line.
      lineBuffer = lines.pop() ?? '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        const chunk = this.parseNativeProviderLine(provider, trimmed);
        if (chunk) pending.push(chunk);
      }
      signal();
    });
    child.stderr?.on('data', (data: Buffer) => { errorOutput += data.toString(); });
    child.on('close', (code, receivedSignal) => { exitCode = code; closeSignal = receivedSignal; closed = true; signal(); });
    child.on('error', (error) => { errorOutput = error.message; exitCode = 1; closed = true; signal(); });
    child.stdin?.end();

    try {
      for (;;) {
        while (pending.length) yield pending.shift() as StreamChunk;
        if (closed) break;
        // Re-checked inside the executor so a close that lands between the drain and the
        // await cannot leave us waiting on a signal that already fired.
        await new Promise<void>((resolve) => {
          if (closed || pending.length) { resolve(); return; }
          wake = resolve;
        });
      }
      const tail = lineBuffer.trim();
      if (tail) {
        const chunk = this.parseNativeProviderLine(provider, tail);
        if (chunk) yield chunk;
      }
      // Only a failed run's stderr is an error. All three CLIs write ordinary notices there
      // on success (codex prints "Reading additional input from stdin..." on every run),
      // and surfacing those as an error bubble made healthy runs look broken. A user-
      // requested stop is not a failure either, even though SIGTERM reports code === null.
      if (!this.wasInterrupted && exitCode === 0) {
        this.onOutcome?.(provider, 'ok');
      }
      if (!this.wasInterrupted && exitCode !== 0) {
        // Only 'failed'. These CLIs have no auth string we have verified, and
        // inventing one would be a guess about the student's login.
        this.onOutcome?.(provider, 'failed');
        // Never silent: a CLI that dies without writing to stderr would otherwise render
        // as an empty but successful answer.
        yield {
          type: 'error',
          content: errorOutput.trim()
            || (closeSignal
              ? `${provider} CLI was terminated (${closeSignal}).`
              : `${provider} CLI exited with code ${exitCode}.`),
        };
      }
      yield { type: 'done' };
    } finally {
      // Abandoning the iterator must not leave a CLI running with no owner.
      if (!closed) child.kill('SIGTERM');
      if (this.currentProcess === child) this.currentProcess = null;
    }
  }

  private parseNativeProviderLine(provider: ProviderId, line: string): StreamChunk | null {
    if (provider === 'agy') return { type: 'text', content: line + '\n' };
    try {
      const event = JSON.parse(line) as Record<string, unknown>;
      if (provider === 'claude') {
        const delta = event.delta as Record<string, unknown> | undefined;
        if (delta && typeof delta.text === 'string') return { type: 'text', content: delta.text };
        const message = event.message as Record<string, unknown> | undefined;
        const content = message?.content;
        if (Array.isArray(content)) {
          const text = content.map((item) => item && typeof item === 'object' && typeof (item as Record<string, unknown>).text === 'string' ? (item as Record<string, unknown>).text : '').join('');
          return text ? { type: 'text', content: text } : null;
        }
      }
      if (provider === 'codex') {
        const item = event.item as Record<string, unknown> | undefined;
        if (item && typeof item.text === 'string') return { type: 'text', content: item.text };
        if (typeof event.text === 'string') return { type: 'text', content: event.text };
      }
    } catch {
      return { type: 'text', content: line + '\n' };
    }
    return null;
  }

  private async *spawnCopilot(
    command: string,
    args: string[],
    env: NodeJS.ProcessEnv
  ): AsyncGenerator<StreamChunk> {
    const cwd = this.getWorkingDirectory();
    // On Windows, resolve .cmd shims to [node, script.js] and spawn node directly.
    // This bypasses cmd.exe entirely, avoiding shell metacharacter/encoding issues
    // when long prompts (containing Korean text, quotes, %, ^, etc.) are passed
    // as arguments. shell:true is only used as fallback if shim resolution fails.
    const cmdShim = resolveCmdShim(command);
    const [spawnCmd, spawnArgs] = cmdShim
      ? [cmdShim[0], [cmdShim[1], ...args]]
      : [command, args];
    let child: ChildProcess;
    try {
      child = spawn(spawnCmd, spawnArgs, {
        cwd,
        env,
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: !cmdShim && process.platform === 'win32',
        // No console window should flash on a student's screen per request.
        windowsHide: true,
      });
    } catch (spawnErr) {
      // spawn() throws synchronously for invalid args/cwd (e.g. EINVAL on Windows).
      // child.on('error') would never fire in this case.
      yield {
        type: 'error',
        content:
          `Failed to start Copilot CLI: ${spawnErr instanceof Error ? spawnErr.message : spawnErr}` +
          `\n(command: ${command}, cwd: ${cwd})`,
      };
      return;
    }

    this.currentProcess = child;

    let stdoutBuffer = '';
    let stderrBuffer = '';
    const chunks: StreamChunk[] = [];
    let resolveWait: (() => void) | null = null;
    let done = false;

    child.stdout?.on('data', (data: Buffer) => {
      stdoutBuffer += data.toString();
      const lines = stdoutBuffer.split(/\r?\n/);
      stdoutBuffer = lines.pop() ?? '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        const parsed = this.parseCopilotEvent(trimmed);
        if (!parsed) {
          chunks.push({ type: 'text', content: line + '\n' });
          continue;
        }

        for (const chunk of this.translateCopilotEvent(parsed)) {
          chunks.push(chunk);
        }
      }
      resolveWait?.();
    });

    child.stderr?.on('data', (data: Buffer) => {
      stderrBuffer += data.toString();
    });

    child.on('close', (code) => {
      done = true;
      const trailing = stdoutBuffer.trim();
      if (trailing) {
        const parsed = this.parseCopilotEvent(trailing);
        if (parsed) {
          for (const chunk of this.translateCopilotEvent(parsed)) {
            chunks.push(chunk);
          }
        } else {
          chunks.push({ type: 'text', content: stdoutBuffer });
        }
      }
      // Read before the error below is appended, so the answer is judged on
      // what it already carried.
      const sawErrorChunk = chunks.some((chunk) => chunk.type === 'error');
      this.onOutcome?.('copilot', copilotRequestOutcome(code, stderrBuffer, sawErrorChunk));
      if (code !== 0 && stderrBuffer.trim()) {
        chunks.push({
          type: 'error',
          content: classifyCopilotFailure(stderrBuffer.trim()).message,
        });
      }
      resolveWait?.();
    });

    child.on('error', (err) => {
      done = true;
      chunks.push({
        type: 'error',
        content: `Failed to start Copilot CLI: ${err.message}`,
      });
      resolveWait?.();
    });

    try {
      while (!done || chunks.length > 0) {
        if (chunks.length > 0) {
          const chunk = chunks.shift();
          if (chunk) {
            yield chunk;
          }
          continue;
        }

        if (!done) {
          await new Promise<void>((resolve) => {
            resolveWait = resolve;
          });
        }
      }
    } finally {
      if (this.currentProcess === child) {
        if (!done) {
          child.kill('SIGTERM');
        }
        this.currentProcess = null;
      }
    }

    yield { type: 'done' };
  }

  private parseCopilotEvent(line: string): CopilotJsonEvent | null {
    try {
      return JSON.parse(line) as CopilotJsonEvent;
    } catch {
      return null;
    }
  }

  /**
   * Tool names arrive as the CLI emits them. A CLI's own MCP tools already use the
   * `mcp__server__tool` shape the renderer detects; nothing is rewritten here.
   */
  private normalizeMcpToolName(toolName: string): string {
    return toolName;
  }

  private translateCopilotEvent(event: CopilotJsonEvent): StreamChunk[] {
    const chunks = translateCopilotJsonEvent(event, (sessionId) => {
      this.sessionId = sessionId;
      this.sessionConfirmedByCli = true;
    });

    // Normalize MCP tool names: "context7-resolve-library-id" → "mcp__context7__resolve-library-id"
    // This enables icon/badge detection and visual differentiation from Skill tools.
    for (const chunk of chunks) {
      if (chunk.type === 'tool_use' && !chunk.name.startsWith('mcp__')) {
        chunk.name = this.normalizeMcpToolName(chunk.name);
      } else if (chunk.type === 'tool_result' && chunk.toolName && !chunk.toolName.startsWith('mcp__')) {
        chunk.toolName = this.normalizeMcpToolName(chunk.toolName);
      }
    }

    if (chunks.some((c) => c.type === 'tool_use' || c.type === 'tool_result')) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      console.log('[OC] Tool event:', event.type, chunks.map((c) => `${c.type}:${(c as any).name ?? (c as any).id ?? ''}`));
    }
    return chunks;
  }

  cancel(): void {
    this.wasInterrupted = true;
    if (this.abortController) {
      this.abortController.abort();
    }
    if (this.currentProcess) {
      this.currentProcess.kill('SIGTERM');
      this.currentProcess = null;
    }
  }

  resetSession(): void {
    this.sessionId = null;
    this.sessionConfirmedByCli = false;
    this.wasInterrupted = false;
    this.askUserQuestionAnswers.clear();
    this.approvedPlanContent = null;
    this.currentPlanFilePath = null;
    this.clearDiffState();
  }

  getSessionId(): string | null {
    return this.sessionId;
  }

  setSessionId(id: string | null): void {
    this.sessionId = id;
    this.wasInterrupted = false;
  }

  cleanup(): void {
    this.cancel();
    this.resetSession();
  }

  async *streamQuery(prompt: string, queryOptions?: QueryOptions): AsyncGenerator<string> {
    for await (const chunk of this.query(prompt, undefined, undefined, queryOptions)) {
      if (chunk.type === 'text') {
        yield chunk.content;
      } else if (chunk.type === 'error') {
        throw new Error(chunk.content);
      }
    }
  }

  isAskUserQuestionToolSupported(): boolean {
    return this.isAskUserQuestionSupported;
  }

  setExitPlanModeCallback(callback: ExitPlanModeCallback | null): void {
    this.exitPlanModeCallback = callback;
  }

  private resolveVaultFilePath(filePath: string): string {
    const normalizedPath = normalizePathForFilesystem(filePath);
    return path.isAbsolute(normalizedPath) ? normalizedPath : path.join(this.getWorkingDirectory(), normalizedPath);
  }

  private trackWriteEditOriginalContent(
    toolUseId: string,
    toolName: string,
    toolInput: Record<string, unknown>
  ): void {
    if (!isWriteEditTool(toolName)) {
      return;
    }

    const rawPath = toolInput.file_path;
    const filePath = typeof rawPath === 'string' && rawPath ? rawPath : null;
    if (!filePath) {
      return;
    }

    const fullPath = this.resolveVaultFilePath(filePath);
    try {
      if (fs.existsSync(fullPath)) {
        const stats = fs.statSync(fullPath);
        if (stats.size <= MAX_DIFF_SIZE) {
          const content = fs.readFileSync(fullPath, 'utf-8');
          this.originalContents.set(toolUseId, { filePath, content });
        } else {
          this.originalContents.set(toolUseId, { filePath, content: null, skippedReason: 'too_large' });
        }
      } else {
        this.originalContents.set(toolUseId, { filePath, content: '' });
      }
    } catch (error) {
      console.warn('Failed to capture original file contents for diff:', fullPath, error);
      this.originalContents.set(toolUseId, { filePath, content: null, skippedReason: 'unavailable' });
    }
  }

  private finalizeWriteEditDiff(toolUseId: string, isError: boolean): void {
    const originalEntry = this.originalContents.get(toolUseId);
    if (!originalEntry) {
      return;
    }

    const { filePath } = originalEntry;
    if (isError) {
      this.originalContents.delete(toolUseId);
      return;
    }

    const fullPath = this.resolveVaultFilePath(filePath);
    let diffData: ToolDiffData | undefined;

    if (originalEntry.content === null) {
      diffData = { filePath, skippedReason: originalEntry.skippedReason ?? 'unavailable' };
    } else {
      try {
        if (fs.existsSync(fullPath)) {
          const stats = fs.statSync(fullPath);
          if (stats.size <= MAX_DIFF_SIZE) {
            const newContent = fs.readFileSync(fullPath, 'utf-8');
            diffData = {
              filePath,
              originalContent: originalEntry.content,
              newContent,
            };
          } else {
            diffData = { filePath, skippedReason: 'too_large' };
          }
        } else {
          diffData = { filePath, skippedReason: 'unavailable' };
        }
      } catch (error) {
        console.warn('Failed to capture updated file contents for diff:', fullPath, error);
        diffData = { filePath, skippedReason: 'unavailable' };
      }
    }

    if (diffData) {
      this.pendingDiffData.set(toolUseId, diffData);
    }

    this.originalContents.delete(toolUseId);
  }

  getDiffData(toolUseId: string): ToolDiffData | undefined {
    const data = this.pendingDiffData.get(toolUseId);
    if (data) {
      this.pendingDiffData.delete(toolUseId);
    }

    return data;
  }

  clearDiffState(): void {
    this.originalContents.clear();
    this.pendingDiffData.clear();
  }

  getAskUserQuestionAnswers(toolUseId: string): Record<string, string | string[]> | undefined {
    const answers = this.askUserQuestionAnswers.get(toolUseId);
    if (answers) {
      this.askUserQuestionAnswers.delete(toolUseId);
    }
    return answers;
  }

  setApprovedPlanContent(content: string | null): void {
    this.approvedPlanContent = content;
  }

  getApprovedPlanContent(): string | null {
    return this.approvedPlanContent;
  }

  clearApprovedPlanContent(): void {
    this.approvedPlanContent = null;
  }

  setCurrentPlanFilePath(planPath: string | null): void {
    this.currentPlanFilePath = planPath;
  }

  getCurrentPlanFilePath(): string | null {
    return this.currentPlanFilePath;
  }
}
