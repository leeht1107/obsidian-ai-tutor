import { type ChildProcess, spawn } from 'child_process';
import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import type ObsidianCopilotPlugin from '../../main';
import { findCopilotCLIPath, resolveProviderEntry } from '../../utils/copilotCli';
import { getEnhancedPath, parseEnvironmentVariables } from '../../utils/env';
import { normalizePathForFilesystem } from '../../utils/path';
import { buildContextFromHistory } from '../../utils/session';
import { buildSystemPrompt } from '../prompts/mainAgent';
import {
  buildNativeProviderCommand,
  findProviderCliPath,
  getProviderDescriptor,
  getStaticProviderModels,
  needsBlanketWriteConsent,
  parseAgyModels,
  parseCodexModels,
  type ProviderId,
  type ProviderModelOption,
  resolveEffectivePermissionMode,
  resolveNativeSelection,
  supportsReadOnlyMode,
} from '../providers/providerRegistry';
import { isWindows, killTree } from '../setup/processTree';
import type { RequestOutcome } from '../setup/providerConnection';
import { type ErrorLogEntry, recordError } from '../storage/ErrorLog';
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
  'web_fetch',
  'web_search',
] as const;

const MAX_DIFF_SIZE = 100 * 1024;
const CLI_CAPABILITY_PROBE_TIMEOUT_MS = 2500;

/**
 * Ceilings for what one child process may hold in memory.
 *
 * There is no request timeout on purpose — the stop button already sends
 * SIGTERM, and a research question can legitimately run for minutes — but a CLI
 * that loops or streams without newlines must not be able to grow these strings
 * until Obsidian dies. 1 MiB is far past any real answer or error message.
 */
const MAX_STDERR_CHARS = 1024 * 1024;
const MAX_LINE_BUFFER_CHARS = 1024 * 1024;
/** Same ceiling execFile's own `maxBuffer` used to enforce for listNativeProviderModels. */
const MODEL_LIST_MAX_STDOUT_CHARS = 8 * 1024 * 1024;

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
    const webTools = new Set(['web_search', 'web_fetch']);
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

/**
 * What to tell the student when a native CLI exits successfully having said nothing.
 *
 * agy does this routinely: headless it cannot prompt for a permission, so a tool it chose
 * is auto-denied and it exits 0 with the explanation on stderr only — measured 2026-09-06,
 * 3 of 4 agy Ask runs. Its tool choice is non-deterministic, and the same question answered
 * correctly on the fourth, so the honest answer is "ask again", not a silent retry behind
 * the student's back and not a claim that agy cannot read. The generic branch covers any
 * other CLI that dies quietly the same way.
 */
export function explainEmptyAnswer(provider: ProviderId, stderr: string): string {
  const detail = stderr.trim();
  if (provider === 'agy' && /no output produced/i.test(detail) && /permission/i.test(detail)) {
    return 'Antigravity가 이번에는 권한이 필요한 도구를 골라서 아무 답도 내지 못했습니다. 같은 질문을 다시 보내시거나 다른 provider를 골라 주세요.';
  }
  return `${provider} CLI가 아무 답도 내지 않고 끝났습니다. 다시 물어보시거나 다른 provider를 골라 주세요.${detail ? `\n\n${detail}` : ''}`;
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
  /**
   * Which provider handled the previous turn — any provider, not just copilot. Set once
   * per turn in `buildPromptWithHistory`, the single choke point both the copilot and
   * native provider paths already call once per turn. Lets a copilot turn tell whether
   * its own remembered session is stale because a different provider held the turn
   * just before it (see the comment above `holdsItsOwnSession`).
   */
  private lastTurnProvider: ProviderId | null = null;
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
      permissionMode: this.plugin.settings.permissionMode,
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
    const currentProvider = this.plugin.settings.selectedProvider as ProviderId;
    // A copilot session is only a valid thing to resume if copilot ALSO held the
    // previous turn. If a different provider handled the turn right before this one,
    // copilot's remembered session never saw it — resuming it would silently skip the
    // middle of the conversation, invisible from both directions at once. Invalidate it
    // here, before `holdsItsOwnSession` below is read, so the normal replay path runs
    // and rebuilds the full transcript into a fresh session instead.
    if (currentProvider === 'copilot' && this.lastTurnProvider !== null && this.lastTurnProvider !== 'copilot') {
      this.sessionId = null;
      this.sessionConfirmedByCli = false;
    }
    this.lastTurnProvider = currentProvider;

    const injectedPrompt = this.injectSystemPrompt(prompt, vaultPath, queryOptions);

    if (this.wasInterrupted && conversationHistory && conversationHistory.length > 0) {
      const historyContext = buildContextFromHistory(conversationHistory);
      this.sessionId = null;
      this.sessionConfirmedByCli = false;
      this.wasInterrupted = false;
      return historyContext ? `${historyContext}\n\nUser: ${injectedPrompt}` : injectedPrompt;
    }

    // `sessionId` is a copilot concept — only the copilot path ever assigns one —
    // and it means "the CLI is holding this conversation, so do not resend it".
    // No native CLI can do that: `buildNativeProviderCommand` passes no resume flag
    // for claude, codex or agy, so each turn is a fresh process and the replayed
    // transcript is the only continuity there is. Reading the flag for every
    // provider meant one copilot turn anywhere in a conversation left the next
    // claude turn with no history and no current note, while the UI still showed
    // the note attached. A fresh conversation looked fine; switching mid-way did not.
    // The reverse direction (copilot resuming its OWN earlier session after a different
    // provider's turn in between) is covered above, by invalidating `sessionId` whenever
    // the previous turn's provider was not copilot — so by the time this flag is read,
    // a copilot turn only ever "holds its own session" when copilot held the last one too.
    const holdsItsOwnSession = this.plugin.settings.selectedProvider === 'copilot' && Boolean(this.sessionId);

    if (!holdsItsOwnSession && conversationHistory && conversationHistory.length > 0) {
      // `conversationHistory` is the conversation BEFORE this turn — the caller drops
      // the in-flight user message and the assistant placeholder by id — so the prompt
      // is always what comes next, and always gets appended. The old guard compared the
      // stored question against the wrapped prompt, which never matched, so it never
      // suppressed anything; the duplication it was aimed at is gone at the source now.
      const historyContext = buildContextFromHistory(conversationHistory);
      if (historyContext) {
        return `${historyContext}\n\nUser: ${injectedPrompt}`;
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
      const probeEntry = resolveProviderEntry(copilotPath, getProviderDescriptor('copilot').npmPackage);
      // No entry means no shell either. The probe simply fails, and
      // detectCopilotCliCapabilities('') already returns the conservative set.
      const [probeCmd, probeArgs] = probeEntry
        ? [probeEntry[0], [...probeEntry[1], '--help', 'all']]
        : [copilotPath, ['--help', 'all']];
      // spawn, not execFile: execFile silently drops `detached` (it only forwards
      // cwd/env/gid/shell/signal/uid/windowsHide to the spawn() it wraps), so a
      // probe that backgrounds a helper would outlive this probe's own timeout.
      let child: ChildProcess;
      try {
        child = spawn(probeCmd, probeArgs, {
          env: this.getCustomEnv(copilotPath),
          windowsHide: true,
          detached: !isWindows,
        });
      } catch {
        resolve(detectCopilotCliCapabilities(''));
        return;
      }
      let stdout = '';
      let stderr = '';
      let settled = false;
      const finish = (errored: boolean) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        killTree(child);
        const helpText = stdout.trim().length > 0 ? stdout : stderr;
        resolve(errored && helpText.length === 0 ? detectCopilotCliCapabilities('') : detectCopilotCliCapabilities(helpText));
      };
      const timer = setTimeout(() => finish(true), CLI_CAPABILITY_PROBE_TIMEOUT_MS);
      child.stdout?.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
      child.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });
      child.on('error', () => finish(true));
      child.on('close', (code) => finish(code !== 0));
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
    // Discovery has to resolve the CLI exactly as dispatch does. Windows cannot
    // launch a .cmd shim through execFile at all, and there is no shell here to
    // do it for us — this path failed with EINVAL long before the shell removal.
    const entry = resolveProviderEntry(cliPath, getProviderDescriptor(provider).npmPackage);
    if (!entry) throw new Error(`${provider} CLI could not be run`);
    return new Promise((resolve, reject) => {
      // spawn, not execFile: execFile silently drops `detached` (it only forwards
      // cwd/env/gid/shell/signal/uid/windowsHide to the spawn() it wraps), so a
      // CLI that backgrounds a helper here would outlive this listing call.
      let child: ChildProcess;
      try {
        child = spawn(entry[0], [...entry[1], ...args], {
          cwd: this.getWorkingDirectory(),
          env: process.env,
          windowsHide: true,
          detached: !isWindows,
        });
      } catch (spawnErr) {
        reject(spawnErr instanceof Error ? spawnErr : new Error(String(spawnErr)));
        return;
      }
      let stdout = '';
      let stderr = '';
      let settled = false;
      const finish = (fn: () => void) => {
        if (settled) return;
        settled = true;
        killTree(child);
        fn();
      };
      child.stdout?.on('data', (chunk: Buffer) => {
        stdout += chunk.toString();
        if (stdout.length > MODEL_LIST_MAX_STDOUT_CHARS) {
          finish(() => reject(new Error(`${provider} models output exceeded buffer limit`)));
        }
      });
      child.stderr?.on('data', (chunk: Buffer) => {
        stderr = (stderr + chunk.toString()).slice(0, MAX_STDERR_CHARS);
      });
      child.on('error', (error) => finish(() => reject(error)));
      child.on('close', (code) => finish(() => {
        if (code !== 0) {
          reject(new Error(stderr.trim() || `${provider} models exited with code ${code}`));
          return;
        }
        resolve(provider === 'codex' ? parseCodexModels(stdout) : parseAgyModels(stdout));
      }));
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
      const message =
        'Copilot CLI not configured. Please set the path in settings or install @github/copilot globally.';
      // The likeliest real failure of all: a student with neither Node nor the CLI
      // sends their first message. The native providers already log this case.
      this.logError({ provider: 'copilot', stage: 'resolve', message });
      yield { type: 'error', content: message };
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
      // Anything thrown on the plugin's own side of the request. Without this the
      // student sees one sentence and nothing survives to say where it came from.
      const msg = this.redactSecrets(error instanceof Error ? error.message : 'Unknown error');
      this.logError({ provider: this.plugin.settings.selectedProvider, stage: 'internal', message: msg });
      yield { type: 'error', content: msg };
    } finally {
      this.abortController = null;
    }
  }

  /**
   * Record a failure the student was shown, so it can be handed over later.
   *
   * Fire-and-forget on purpose: a logger that can fail a request is worse than
   * no logger. Messages must arrive already redacted — this does not scrub.
   */
  private logError(entry: Omit<ErrorLogEntry, 'at' | 'platform' | 'pluginVersion'>): void {
    // The guard is here, not only inside recordError: arguments are evaluated
    // before the callee is entered, so a vault that is not ready yet would throw
    // out of `getAdapter()` and take the student's request with it.
    try {
      recordError(this.plugin.storage?.getAdapter?.(), entry, {
        home: os.homedir(),
        pluginVersion: this.plugin.manifest?.version ?? 'unknown',
      });
    } catch { /* never break a request to write a log line */ }
  }

  /**
   * Redaction for a caller outside this class.
   *
   * The setup wizard logs npm and winget output, which is exactly the kind of
   * text that can echo a configured credential. It has no business owning a
   * second copy of the pattern, so it borrows this one.
   */
  redactForLog(text: string): string {
    return this.redactSecrets(text);
  }

  /**
   * Strip configured credentials out of anything shown to the student.
   *
   * A failing CLI's stderr goes into the chat, and the chat is written to
   * `.ai-tutor/sessions/` inside the vault — the same synced folder the token
   * was just moved out of. One stack trace that echoes GH_TOKEN would put it
   * straight back.
   *
   * Only values long enough to be credentials are matched. `LANG=ko_KR.UTF-8`
   * sits in the same settings field as an API key, and scrubbing every
   * configured value would blank ordinary words out of error messages.
   */
  private redactSecrets(text: string): string {
    if (!text) return text;
    const candidates = [
      this.plugin.settings.githubToken,
      ...Object.values(parseEnvironmentVariables(this.plugin.getActiveEnvironmentVariables())),
    ];
    let out = text;
    for (const value of candidates) {
      if (typeof value !== 'string' || value.trim().length < 16) continue;
      out = out.split(value).join('[비밀 값 가림]');
    }
    return out;
  }

  /**
   * What a student sees when the CLI is installed but nothing runnable can be
   * named. Korean, and pointed at the fix rather than at the cause: a shim
   * format we cannot parse is not something a student can act on, and the
   * wizard below reinstalls the CLI in a layout we can.
   */
  private unrunnableCliMessage(provider: ProviderId): string {
    const descriptor = getProviderDescriptor(provider);
    // agy has no install command, so the wizard opens on its manual page. Telling
    // that student to press an auto-install button they will not find is worse
    // than saying nothing.
    const remedy = descriptor.installCommand
      ? '자동 설정 창에서 다시 설치하면 해결됩니다.'
      : `${descriptor.label}는 자동 설치를 지원하지 않습니다. 방금 열린 창의 안내대로 다시 설치해 주세요.`;
    return `${descriptor.label}를 실행할 수 없습니다. 설치가 손상되었을 수 있습니다.\n${remedy}`;
  }

  /** Open the setup wizard so the message above has somewhere to go. */
  private async openSetupWizard(provider: ProviderId): Promise<void> {
    try {
      const { SetupWizardModal } = await import('../../ui/modals/SetupWizardModal');
      new SetupWizardModal(this.plugin.app, this.plugin, provider).open();
    } catch (err) {
      console.warn('[ObsidianCopilot] Setup wizard failed to open:', err);
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
      this.logError({ provider, stage: 'resolve', message: 'CLI not found on PATH or at the configured path' });
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
    const needsConsent = needsBlanketWriteConsent(provider, acknowledged);
    // The shared predicate so the toolbar, this dispatch, and both inline-bash gates
    // agree on what "Agent" means for this provider right now — see its doc comment
    // in providerRegistry.ts for why `settings.permissionMode` alone is not enough.
    const permissionMode = resolveEffectivePermissionMode(mode, provider, acknowledged, Boolean(queryOptions?.planMode));

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
    // The prompt carries note content, so it must stay one argv element. A shell
    // would flatten it into a command string where `&` and `|` are operators.
    const entry = resolveProviderEntry(cliPath, getProviderDescriptor(provider).npmPackage);
    if (!entry) {
      // The single most valuable line in this log: it names the exact install
      // layout that defeated the resolver on a machine we cannot reach.
      this.logError({ provider, stage: 'resolve', message: 'No runnable executable could be resolved from this CLI path', cliPath });
      yield { type: 'error', content: this.unrunnableCliMessage(provider) };
      void this.openSetupWizard(provider);
      return;
    }
    const [command, args] = [entry[0], [...entry[1], ...native.args]];
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
      // No console window should flash on a student's screen per request.
      windowsHide: true,
      // Own the whole tree: a provider CLI that backgrounds a helper (to keep
      // a permission it was granted alive past this request, or for any other
      // reason) inherits this process group and is torn down with it in the
      // `finally` below via `killTree`, on every settle path, not just a clean exit.
      detached: !isWindows,
      });
    } catch (error) {
      const message = this.redactSecrets(`Failed to start ${provider} CLI: ${error instanceof Error ? error.message : String(error)}`);
      this.logError({ provider, stage: 'launch', message, cliPath, resolved: `${command} ${entry[1].join(' ')}`.trim() });
      yield { type: 'error', content: message };
      return;
    }
    this.currentProcess = child;
    // Parsed chunks are handed over as the child produces them. These CLIs are asked for a
    // streaming format, so buffering to exit would hide a token that was ready seconds earlier.
    const pending: StreamChunk[] = [];
    let lineBuffer = '';
    let errorOutput = '';
    // A CLI can exit 0 having answered nothing at all, and only the chunks tell us.
    let sawText = false;
    let exitCode: number | null = null;
    let closeSignal: NodeJS.Signals | null = null;
    let closed = false;
    let wake: (() => void) | null = null;
    const signal = () => { const resume = wake; wake = null; resume?.(); };

    const push = (line: string) => {
      const chunk = this.parseNativeProviderLine(provider, line);
      if (!chunk) return;
      if (chunk.type === 'text' && chunk.content.trim()) sawText = true;
      pending.push(chunk);
    };
    child.stdout?.on('data', (data: Buffer) => {
      lineBuffer += data.toString();
      const lines = lineBuffer.split(/\r?\n/);
      // The last element is whatever came after the final newline — possibly half a line.
      lineBuffer = lines.pop() ?? '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        push(trimmed);
      }
      // A CLI that streams without newlines would grow this buffer for the whole
      // request. Flush rather than truncate: this is the student's answer, so the
      // cap costs a line break, not content.
      if (lineBuffer.length > MAX_LINE_BUFFER_CHARS) {
        const forced = lineBuffer;
        lineBuffer = '';
        push(forced);
      }
      signal();
    });
    child.stderr?.on('data', (data: Buffer) => {
      // stderr is diagnostic and only its head is ever read, so this one is
      // capped rather than flushed — a crash loop must not fill memory.
      if (errorOutput.length >= MAX_STDERR_CHARS) return;
      errorOutput = (errorOutput + data.toString()).slice(0, MAX_STDERR_CHARS);
    });
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
        if (chunk) {
          if (chunk.type === 'text' && chunk.content.trim()) sawText = true;
          yield chunk;
        }
      }
      // Only a failed run's stderr is an error. All three CLIs write ordinary notices there
      // on success (codex prints "Reading additional input from stdin..." on every run),
      // and surfacing those as an error bubble made healthy runs look broken. A user-
      // requested stop is not a failure either, even though SIGTERM reports code === null.
      if (!this.wasInterrupted && exitCode === 0 && sawText) {
        this.onOutcome?.(provider, 'ok');
      }
      // A clean exit with no answer is a failure the student can act on, not a success.
      // agy reaches here whenever headless mode auto-denies a tool it picked: exit 0, the
      // reason on stderr only. Guarding on a non-zero exit alone showed an empty bubble
      // and counted the run as ok.
      if (!this.wasInterrupted && exitCode === 0 && !sawText) {
        this.onOutcome?.(provider, 'failed');
        const emptyMessage = this.redactSecrets(explainEmptyAnswer(provider, errorOutput));
        this.logError({ provider, stage: 'empty-answer', message: emptyMessage, exitCode, cliPath, resolved: command });
        yield { type: 'error', content: emptyMessage };
      }
      if (!this.wasInterrupted && exitCode !== 0) {
        // Only 'failed'. These CLIs have no auth string we have verified, and
        // inventing one would be a guess about the student's login.
        this.onOutcome?.(provider, 'failed');
        // Never silent: a CLI that dies without writing to stderr would otherwise render
        // as an empty but successful answer.
        const exitMessage = this.redactSecrets(errorOutput.trim())
          || (closeSignal
            ? `${provider} CLI was terminated (${closeSignal}).`
            : `${provider} CLI exited with code ${exitCode}.`);
        this.logError({ provider, stage: 'exit', message: exitMessage, exitCode, signal: closeSignal, cliPath, resolved: command });
        yield { type: 'error', content: exitMessage };
      }
      yield { type: 'done' };
    } finally {
      // Every settle path lands here — normal close, error, cancel(), or the
      // iterator being abandoned — and each must take the whole process group
      // with it, not just the direct child, which may already have exited
      // normally while a helper it backgrounded is still running. Safe to call
      // even after a clean close: killTree no-ops on an already-gone group.
      killTree(child);
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
        if (item && typeof item.text === 'string') {
          // codex is block-buffered, not token-streamed: a completed `agent_message` is a
          // whole block, so two of them must not be concatenated. Measured at codex-cli
          // 0.153.4, one turn that uses a tool emits a preamble message, a
          // `command_execution` that carries no text, then the answer — nothing else
          // creates a boundary, and the two glued into `...작성합니다.## 1/5번 문제`,
          // which stops the quiz header being at the start of a line.
          // Narrow on purpose: only this event is known to be a block. The top-level
          // `event.text` path below has never been observed, and claude's `delta.text`
          // above is a real token delta, so neither gets a newline.
          const isCompletedBlock = event.type === 'item.completed' && item.type === 'agent_message';
          const needsBoundary = isCompletedBlock && item.text !== '' && !item.text.endsWith('\n');
          return { type: 'text', content: needsBoundary ? item.text + '\n' : item.text };
        }
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
    // On Windows, resolve the CLI to a real executable and spawn it directly.
    // This bypasses cmd.exe entirely, avoiding shell metacharacter/encoding issues
    // when long prompts (containing Korean text, quotes, %, ^, etc.) are passed
    // as arguments — and, more importantly, keeping note content off a command line.
    const entry = resolveProviderEntry(command, getProviderDescriptor('copilot').npmPackage);
    if (!entry) {
      this.logError({ provider: 'copilot', stage: 'resolve', message: 'No runnable executable could be resolved from this CLI path', cliPath: command });
      yield { type: 'error', content: this.unrunnableCliMessage('copilot') };
      void this.openSetupWizard('copilot');
      return;
    }
    const [spawnCmd, spawnArgs] = [entry[0], [...entry[1], ...args]];
    // What the resolver decided to run, for the log. The resolver's own
    // arguments only: `spawnArgs` also carries the student's prompt, and the
    // prompt is note content, which has no business in a file they mail to
    // somebody. On Windows this pair is the whole diagnostic — an npm `.cmd`
    // shim resolves to `node.exe <script>`, and recording `node.exe` alone, as
    // this used to, threw away the half that says which install is broken.
    const resolvedCommand = [spawnCmd, ...entry[1]].join(' ').trim();
    let child: ChildProcess;
    try {
      child = spawn(spawnCmd, spawnArgs, {
        cwd,
        env,
        stdio: ['pipe', 'pipe', 'pipe'],
        // No console window should flash on a student's screen per request.
        windowsHide: true,
        // Own the whole tree, same reasoning as the native provider spawn above.
        detached: !isWindows,
      });
    } catch (spawnErr) {
      // spawn() throws synchronously for invalid args/cwd (e.g. EINVAL on Windows).
      // child.on('error') would never fire in this case.
      const message = this.redactSecrets(
        `Failed to start Copilot CLI: ${spawnErr instanceof Error ? spawnErr.message : spawnErr}` +
        `\n(command: ${command}, cwd: ${cwd})`
      );
      this.logError({ provider: 'copilot', stage: 'launch', message, cliPath: command, resolved: resolvedCommand });
      yield { type: 'error', content: message };
      return;
    }

    this.currentProcess = child;

    let stdoutBuffer = '';
    let stderrBuffer = '';
    const chunks: StreamChunk[] = [];
    let resolveWait: (() => void) | null = null;
    let done = false;

    // A CLI can exit 0 having answered nothing at all, and only the chunks tell
    // us — the same thing the native path tracks, for the same reason.
    let sawText = false;
    const pushChunk = (chunk: StreamChunk) => {
      if (chunk.type === 'text' && chunk.content.trim()) sawText = true;
      chunks.push(chunk);
    };
    const pushLine = (line: string) => {
      const parsed = this.parseCopilotEvent(line.trim());
      if (!parsed) {
        pushChunk({ type: 'text', content: line + '\n' });
        return;
      }
      for (const chunk of this.translateCopilotEvent(parsed)) pushChunk(chunk);
    };
    child.stdout?.on('data', (data: Buffer) => {
      stdoutBuffer += data.toString();
      const lines = stdoutBuffer.split(/\r?\n/);
      stdoutBuffer = lines.pop() ?? '';

      for (const line of lines) {
        if (!line.trim()) continue;
        pushLine(line);
      }
      // See the native path: flush an over-long unterminated line rather than
      // hold the whole answer in memory waiting for a newline.
      if (stdoutBuffer.length > MAX_LINE_BUFFER_CHARS) {
        const forced = stdoutBuffer;
        stdoutBuffer = '';
        pushLine(forced);
      }
      resolveWait?.();
    });

    child.stderr?.on('data', (data: Buffer) => {
      if (stderrBuffer.length >= MAX_STDERR_CHARS) return;
      stderrBuffer = (stderrBuffer + data.toString()).slice(0, MAX_STDERR_CHARS);
    });

    child.on('close', (code, receivedSignal) => {
      done = true;
      const trailing = stdoutBuffer.trim();
      if (trailing) {
        const parsed = this.parseCopilotEvent(trailing);
        if (parsed) {
          for (const chunk of this.translateCopilotEvent(parsed)) {
            pushChunk(chunk);
          }
        } else {
          pushChunk({ type: 'text', content: stdoutBuffer });
        }
      }
      // Read before the error below is appended, so the answer is judged on
      // what it already carried.
      const sawErrorChunk = chunks.some((chunk) => chunk.type === 'error');
      this.onOutcome?.('copilot', copilotRequestOutcome(code, stderrBuffer, sawErrorChunk));
      // A request the student stopped is not a failure, and must not reach the
      // log: an entry there would destroy the only thing an empty log means.
      if (this.wasInterrupted) { resolveWait?.(); return; }
      if (code !== 0) {
        // The old condition also required stderr. A CLI that was killed, ran out
        // of memory, or crashed without a message showed the student a red
        // bubble and left nothing behind — which is precisely the machine this
        // log exists for. Fall back to what is known when stderr is empty.
        const copilotMessage = stderrBuffer.trim()
          ? this.redactSecrets(classifyCopilotFailure(stderrBuffer.trim()).message)
          : (receivedSignal
            ? `Copilot CLI was terminated (${receivedSignal}).`
            : `Copilot CLI exited with code ${code}.`);
        this.logError({ provider: 'copilot', stage: 'exit', message: copilotMessage, exitCode: code, signal: receivedSignal, cliPath: command, resolved: resolvedCommand });
        pushChunk({ type: 'error', content: copilotMessage });
      } else if (!sawText) {
        // Exit 0 with no answer. The native providers call this out and log it;
        // copilot rendered an empty bubble and counted the run as fine.
        const emptyMessage = this.redactSecrets(explainEmptyAnswer('copilot', stderrBuffer));
        this.logError({ provider: 'copilot', stage: 'empty-answer', message: emptyMessage, exitCode: code, cliPath: command, resolved: resolvedCommand });
        pushChunk({ type: 'error', content: emptyMessage });
      }
      resolveWait?.();
    });

    child.on('error', (err) => {
      done = true;
      // The asynchronous half of a failed launch: an ENOENT on a shim that
      // passed the resolver, a permissions failure. The native path folds the
      // same event into an exit-code entry, so copilot was the only one of the
      // four that showed this and recorded nothing.
      const message = this.redactSecrets(`Failed to start Copilot CLI: ${err.message}`);
      this.logError({ provider: 'copilot', stage: 'launch', message, cliPath: command, resolved: resolvedCommand });
      pushChunk({ type: 'error', content: message });
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
      // Every settle path — normal close, error, cancel(), or the iterator
      // being abandoned — takes the whole process group with it, not just
      // this direct child. Runs after the while loop above has drained every
      // real chunk, so a normal answer is never truncated by it.
      killTree(child);
      if (this.currentProcess === child) {
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
      // The whole group, not just this direct child — same reasoning as the
      // `finally` blocks in spawnCopilot and querySelectedProvider, which
      // this pre-empts: this stop path runs first, and their own killTree
      // call after the child actually closes is what reaps this same group
      // a second, harmless time.
      killTree(this.currentProcess);
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
