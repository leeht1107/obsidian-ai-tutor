import * as fs from 'fs';
import * as path from 'path';

import { getEnhancedPath } from '../../utils/env';
import { expandHomePath } from '../../utils/path';

export type ProviderId = 'copilot' | 'claude' | 'codex' | 'agy';
export type ProviderStatus = 'ready' | 'not-installed' | 'manual-setup' | 'unsupported';

export interface ProviderDescriptor {
  id: ProviderId;
  label: string;
  command: string;
  loginCommand: string;
  installCommand?: string;
  windowsInstallCommand?: string;
  status: ProviderStatus;
}

/** UI-bound selection table. Providers intentionally retain their native CLI contracts. */
export const PROVIDERS: readonly ProviderDescriptor[] = [
  { id: 'copilot', label: 'GitHub Copilot', command: 'copilot', loginCommand: 'copilot login', installCommand: 'npm install -g @github/copilot', windowsInstallCommand: 'npm install -g @github/copilot', status: 'ready' },
  { id: 'claude', label: 'Claude Code', command: 'claude', loginCommand: 'claude', installCommand: 'npm install -g @anthropic-ai/claude-code', windowsInstallCommand: 'npm install -g @anthropic-ai/claude-code', status: 'ready' },
  { id: 'codex', label: 'OpenAI Codex', command: 'codex', loginCommand: 'codex login', installCommand: 'npm install -g @openai/codex', windowsInstallCommand: 'npm install -g @openai/codex', status: 'ready' },
  { id: 'agy', label: 'Antigravity (agy)', command: 'agy', loginCommand: 'agy', status: 'manual-setup' },
];

export type EffortLevel = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export interface ProviderModelOption {
  id: string;
  label: string;
  /** Effort levels this model can actually be dispatched with; empty means no effort control. */
  efforts: readonly EffortLevel[];
}

/**
 * Effort levels each installed CLI validated on this machine. Sourced from the CLIs'
 * own rejection messages, not from documentation or UI wording:
 *   claude --effort bogus -> "Valid values: low, medium, high, xhigh, max"
 *   agy    --effort bogus -> 'invalid --effort "bogus" (valid: low, medium, high)'
 *   codex  -c model_reasoning_effort=bogusvalue -> reasoning.effort enum:
 *          'none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'
 * Copilot is absent on purpose: it keeps its existing thinking-budget control.
 */
const PROVIDER_EFFORT_LEVELS: Readonly<Record<ProviderId, readonly EffortLevel[]>> = {
  copilot: [],
  claude: ['low', 'medium', 'high', 'xhigh', 'max'],
  codex: ['low', 'medium', 'high', 'xhigh', 'max'],
  agy: ['low', 'medium', 'high'],
};

/**
 * Models we can name without asking a CLI. Only `claude` qualifies: it has no
 * model-listing subcommand, but `claude -p --model <id>` rejects an unknown id with
 * `[claude-code:unrecognized_model]` before authenticating, and each id below passed
 * that check. `codex` and `agy` are deliberately empty — both ship a real local listing
 * command, so a frozen list here is exactly the staleness this change removes.
 */
const STATIC_PROVIDER_MODELS: Readonly<Record<ProviderId, readonly ProviderModelOption[]>> = {
  copilot: [],
  claude: (['fable', 'opus', 'sonnet', 'haiku'] as const).map((id) => ({
    id,
    label: id,
    efforts: PROVIDER_EFFORT_LEVELS.claude,
  })),
  codex: [],
  agy: [],
};

/**
 * Whether a provider accepts `--model` and a reasoning level in the same invocation.
 * agy cannot: the level is part of the model id (`gemini-3.8-flash-high`), and its CLI
 * rejects the pair outright —
 *   --model gemini-3.8-flash-high --effort low
 *     -> "--model gemini-3.8-flash-high conflicts with --effort=low"
 *   --model claude-sonnet-4-6 --effort high
 *     -> "--effort is not supported for model \"claude-sonnet-4-6\""
 * Either flag alone is fine, so effort stays available while no model is pinned.
 */
const EFFORT_COMBINES_WITH_MODEL: Readonly<Record<ProviderId, boolean>> = {
  copilot: false,
  claude: true,
  codex: true,
  agy: false,
};

export function allowsEffortWithModel(id: ProviderId): boolean {
  return EFFORT_COMBINES_WITH_MODEL[id] ?? false;
}

export function getProviderEffortLevels(id: ProviderId): readonly EffortLevel[] {
  return PROVIDER_EFFORT_LEVELS[id] ?? [];
}

export function supportsEffortSelection(id: ProviderId): boolean {
  return getProviderEffortLevels(id).length > 0;
}

/** Where the settings tab can get a provider's model list from. */
export type DefaultModelSource =
  /** The bundled Copilot catalog. */
  | 'copilot-catalog'
  /** A fixed list shipped here; no process needed. */
  | 'bundled'
  /** Only the CLI knows, and asking it spawns one. */
  | 'ask-cli';

export function defaultModelSource(id: ProviderId): DefaultModelSource {
  if (id === 'copilot') return 'copilot-catalog';
  return getStaticProviderModels(id).length > 0 ? 'bundled' : 'ask-cli';
}

/**
 * Store a chosen default model where the request path will actually read it.
 *
 * copilot's model is `settings.model`, from the bundled catalog. Every other
 * provider dispatches from `settings.providerModels[id]`, so writing a native
 * choice into `settings.model` changed nothing the student could see — and
 * offering them a Copilot id was worse than useless: `claude --model gpt-5-mini`
 * is rejected outright.
 */
export function storeDefaultModel(
  settings: { model: string; providerModels?: Partial<Record<ProviderId, string>> },
  id: ProviderId,
  value: string
): void {
  if (id === 'copilot') { settings.model = value; return; }
  const models = { ...settings.providerModels };
  // An empty choice means "let the CLI decide", which is the absence of a
  // pinned model rather than a model whose id is the empty string.
  if (value.trim()) models[id] = value.trim();
  else delete models[id];
  settings.providerModels = models;
}

export function getStaticProviderModels(id: ProviderId): readonly ProviderModelOption[] {
  return STATIC_PROVIDER_MODELS[id] ?? [];
}

/** Parses `agy models`, whose rows are `<id>\t<display name>` after a status line. */
export function parseAgyModels(stdout: string): ProviderModelOption[] {
  const seen = new Set<string>();
  const options: ProviderModelOption[] = [];
  for (const line of stdout.split(/\r?\n/)) {
    // Only a real `<id>\t<label>` row counts. Without the tab requirement any single-token
    // status or footer line ("Done", "Models:") would be presented as a dispatchable model.
    if (!line.includes('\t')) continue;
    const [rawId, ...rest] = line.split('\t');
    const id = rawId?.trim() ?? '';
    if (!/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/.test(id) || seen.has(id)) continue;
    seen.add(id);
    // No per-model levels: for agy the level is encoded in the id itself.
    options.push({ id, label: rest.join(' ').trim() || id, efforts: [] });
  }
  return options;
}

/**
 * Parses the JSON printed by `codex debug models`. Hidden entries are internal routing targets, and
 * a catalog level the API enum rejects (e.g. `ultra`) is dropped so no inert choice ships.
 */
export function parseCodexModels(stdout: string): ProviderModelOption[] {
  let parsed: unknown;
  try { parsed = JSON.parse(stdout); } catch { return []; }
  const models = (parsed as { models?: unknown })?.models;
  if (!Array.isArray(models)) return [];
  const allowed = new Set<string>(PROVIDER_EFFORT_LEVELS.codex);
  const options: ProviderModelOption[] = [];
  for (const entry of models) {
    const model = entry as { slug?: unknown; display_name?: unknown; visibility?: unknown; supported_reasoning_levels?: unknown };
    const id = typeof model.slug === 'string' ? model.slug.trim() : '';
    if (!id || model.visibility === 'hide') continue;
    const efforts = (Array.isArray(model.supported_reasoning_levels) ? model.supported_reasoning_levels : [])
      .map((level) => (level as { effort?: unknown })?.effort)
      .filter((effort): effort is EffortLevel => typeof effort === 'string' && allowed.has(effort));
    options.push({
      id,
      label: typeof model.display_name === 'string' && model.display_name.trim() ? model.display_name.trim() : id,
      efforts,
    });
  }
  return options;
}

/**
 * Model ids that a previous release offered but the installed CLI does not list, so they
 * cannot be un-picked from the current menu. A user who selected one keeps dispatching it
 * on every send until it is cleared here. Removing an id from the menu is not enough —
 * the choice already persisted in the user's data.json.
 *   0.1.7 shipped codex: ['gpt-5.4', 'o3']. `gpt-5.4` is still in the CLI catalog; `o3` is not.
 */
const RETIRED_PROVIDER_MODELS: Readonly<Partial<Record<ProviderId, readonly string[]>>> = {
  codex: ['o3'],
};

/** Clears retired ids in place so the provider falls back to its own default. */
export function migrateProviderModels(providerModels: Partial<Record<ProviderId, string>> | undefined): void {
  if (!providerModels) return;
  for (const [id, retired] of Object.entries(RETIRED_PROVIDER_MODELS) as [ProviderId, readonly string[]][]) {
    const current = providerModels[id]?.trim();
    if (current && retired.includes(current)) delete providerModels[id];
  }
}

export function getProviderDescriptor(id: ProviderId): ProviderDescriptor {
  return PROVIDERS.find((provider) => provider.id === id) ?? PROVIDERS[0];
}

/**
 * What the chat toolbar's provider / model / effort picks turn into for one request.
 * The toolbar writes them per provider, so switching provider must not carry the
 * previous one's model across.
 */
export function resolveNativeSelection(
  settings: {
    selectedProvider: ProviderId;
    providerModels?: Partial<Record<ProviderId, string>>;
    providerEfforts?: Partial<Record<ProviderId, string>>;
  },
  requestedModel?: string
): { provider: ProviderId; model: string; effort: string } {
  const provider = settings.selectedProvider;
  return {
    provider,
    model: requestedModel?.trim() || settings.providerModels?.[provider]?.trim() || '',
    effort: settings.providerEfforts?.[provider]?.trim() || '',
  };
}

/**
 * Whether asking this CLI for read-only actually holds it to read-only.
 *
 * Measured 2026-09-05 by asking each CLI in `-p` mode to create a file:
 * claude refuses under `--disallowedTools`, agy cannot write headless at all,
 * copilot has `--deny-tool`. codex wrote the file under `-s read-only` — that
 * flag governs only model-generated shell commands, not its own edit tool, and
 * no `tools.*` config key exists to switch that tool off.
 */
export function supportsReadOnlyMode(id: ProviderId): boolean {
  return id !== 'codex';
}

/**
 * Whether letting this CLI write means auto-approving every tool it has.
 *
 * agy cannot ask for a permission headless, so `--dangerously-skip-permissions`
 * is the only thing that lets it write at all — there is no per-tool middle
 * setting to fall back on. A student should confirm that once, in writing.
 */
export function writesWithoutAsking(id: ProviderId): boolean {
  return id === 'agy';
}

/** What the chat toolbar's Ask / Agent choice means to a CLI. */
export type NativePermissionMode = 'ask' | 'agent';

export function buildNativeProviderCommand(
  id: ProviderId,
  prompt: string,
  model = '',
  effort = '',
  permissionMode: NativePermissionMode = 'agent'
): { command: string; args: string[] } {
  const selectedModel = model.trim();
  // A level this CLI never validated is dropped rather than passed through: agy aborts the
  // run on an unknown --effort, and codex would fail the request at the API enum.
  let selectedEffort = getProviderEffortLevels(id).includes(effort.trim() as EffortLevel) ? effort.trim() : '';
  // Where the two cannot be combined, the model wins: it is the more specific choice, and
  // for agy it already encodes the level. Sending both aborts the run.
  if (selectedModel && selectedEffort && !allowsEffortWithModel(id)) selectedEffort = '';
  const modelArgs = selectedModel ? ['--model', selectedModel] : [];
  const readOnly = permissionMode === 'ask';
  switch (id) {
    // A positive `--allowedTools` list did NOT stop claude writing; only the
    // disallow list did. `--disallowedTools` is variadic and comma-joining its value
    // does NOT terminate it: measured at claude 2.1.236,
    // `--disallowedTools Write,Edit,Bash <prompt> --output-format ...` still ate the
    // prompt and died with "Input must be provided ... as a prompt argument", so ask
    // mode failed every request. Only a recognised option ends the list, which is why
    // the prompt goes LAST, behind `--output-format`/`--verbose`. Order is load-bearing
    // here; `nativePermissionMode.test.ts` is what keeps it from drifting back.
    case 'claude': return { command: 'claude', args: ['-p', ...modelArgs, ...(selectedEffort ? ['--effort', selectedEffort] : []), ...(readOnly ? ['--disallowedTools', 'Write,Edit,Bash'] : []), '--output-format', 'stream-json', '--verbose', prompt] };
    // codex exec has no effort flag; the reasoning level is a config override instead.
    // `--skip-git-repo-check` is unconditional: codex refuses to start outside a Git
    // repository, and a student's vault usually is not one.
    case 'codex': return { command: 'codex', args: ['exec', '--skip-git-repo-check', ...modelArgs, ...(selectedEffort ? ['-c', `model_reasoning_effort="${selectedEffort}"`] : []), '--json', prompt] };
    // agy cannot use a writing tool headless — it has no way to ask permission — so
    // read-only is its default and this flag is the only thing that lifts it.
    case 'agy': return { command: 'agy', args: [...(readOnly ? [] : ['--dangerously-skip-permissions']), ...modelArgs, ...(selectedEffort ? ['--effort', selectedEffort] : []), '-p', prompt] };
    case 'copilot': return { command: 'copilot', args: ['-p', prompt] };
  }
}

export function findProviderCliPath(id: ProviderId, customPath = ''): string | null {
  const configured = customPath.trim();
  if (configured) {
    // The settings field validates what was typed through expandHomePath, so a
    // student who pastes `~/bin/copilot` sees no error. Stat'ing the literal
    // string here accepted that path and then failed every check and request.
    const resolved = expandHomePath(configured);
    return isFile(resolved) ? resolved : null;
  }
  const descriptor = getProviderDescriptor(id);
  const delimiter = process.platform === 'win32' ? ';' : ':';
  // .exe before .cmd. A .cmd shim can only be run through cmd.exe or by
  // parsing the shim to find its .js target, and the cmd.exe path mangles
  // quotes, %, ^, & and Korean text in a long prompt. obsidian-copilot refuses
  // .cmd entirely for the same reason ("requires shell: true and breaks SDK
  // stdio streaming"); we keep it as a last resort so npm-only installs work.
  // The extensionless name goes LAST on Windows. npm global installs drop
  // `claude`, `claude.cmd` and `claude.ps1` side by side, and the
  // extensionless one is a bash script Windows cannot run: cmd.exe will not
  // execute a file with no extension, and resolveCmdShim only reads .cmd.
  const names = process.platform === 'win32'
    ? [`${descriptor.command}.exe`, `${descriptor.command}.cmd`, descriptor.command]
    : [descriptor.command];
  for (const dir of getEnhancedPath().split(delimiter)) {
    for (const name of names) {
      const candidate = path.join(dir, name);
      if (isFile(candidate)) return candidate;
    }
  }
  return null;
}

function isFile(candidate: string): boolean {
  try { return fs.statSync(candidate).isFile(); } catch { return false; }
}
