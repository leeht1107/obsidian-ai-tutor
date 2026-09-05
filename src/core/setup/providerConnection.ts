/**
 * Whether a provider is connected, and who is allowed to decide that.
 *
 * The chat popover used to answer this itself: every open spawned the installed
 * CLIs to ask who was logged in. copilot has no command that answers — every
 * non-interactive subcommand replies from local files, identically under a
 * fresh HOME — so copilot alone rendered 확인 불가, and the student whose
 * default provider it was read that as an error.
 *
 * So the question moved. Settings asks it, chat shows the stored answer, and a
 * real request corrects it. Nothing here costs credits.
 */

import { findProviderCliPath, type ProviderId } from '../providers/providerRegistry';
import { isWindows } from './processTree';
import { checkProviderReadiness, runProbeProcess } from './providerReadiness';

export type ConnectionState =
  /** A credential is present, or a CLI said it is logged in. */
  | 'connected'
  /** Asked, and the answer was no. */
  | 'not-connected'
  /** Nobody has been able to ask yet. */
  | 'unknown';

/** One provider's connection state, with when it was last decided. */
export interface ProviderConnection {
  state: ConnectionState;
  /** Epoch ms. Stored but not acted on; it costs one field and spares a
   * migration if the badge ever needs to age out. */
  at: number;
}

export type ProviderConnections = Partial<Record<ProviderId, ProviderConnection>>;

/**
 * What one finished request proved about the provider's login.
 *
 * Kept separate from ConnectionState because 'failed' is deliberately not a
 * connection verdict at all — see applyRequestOutcome.
 */
export type RequestOutcome = 'ok' | 'auth-failed' | 'failed';

export function connectionLabel(state: ConnectionState | undefined): string {
  switch (state) {
    case 'connected': return '연결됨';
    case 'not-connected': return '연결 필요';
    // Covers undefined too: never checked reads the same as could not check.
    default: return '확인 안 됨';
  }
}

/**
 * Fold one finished request into the stored map.
 *
 * A success and an authentication failure both overwrite. Recording only
 * successes is the failure mode here: a 연결됨 would outlive the login it
 * described. Any other failure changes nothing, because a network drop or a
 * rate limit is not a logout and must not send a signed-in student back
 * through the login flow.
 */
export function applyRequestOutcome(
  current: ProviderConnections | undefined,
  providerId: ProviderId,
  outcome: RequestOutcome,
  at: number
): ProviderConnections {
  if (outcome === 'failed') return current ?? {};
  const state: ConnectionState = outcome === 'ok' ? 'connected' : 'not-connected';
  return { ...current, [providerId]: { state, at } };
}

/**
 * What a settings check should store, given what was already known.
 *
 * The same rule as applyRequestOutcome, from the other side: a check that
 * could not decide is not evidence of a logout. On Windows the copilot check
 * can only ever answer 'unknown', so without this, opening settings after a
 * working request would discard the connection that request proved.
 */
export function resolveCheckedState(
  previous: ConnectionState | undefined,
  checked: ConnectionState
): ConnectionState {
  return checked === 'unknown' && previous === 'connected' ? 'connected' : checked;
}

/**
 * macOS keychain service the copilot CLI stores its token under. Read off the
 * live keychain on 2026-09-05: `security find-generic-password -s copilot-cli`
 * exits 0 with an account of `https://github.com:<user>`.
 */
const COPILOT_KEYCHAIN_SERVICE = 'copilot-cli';

/**
 * Is there a copilot credential on this machine?
 *
 * This is the same standard Smart Composer's `Connected` badge uses — stored
 * credentials exist, not that they still work. An expired token reads as
 * connected here and is corrected by the first request that fails on auth.
 */
export async function checkCopilotCredential(signal?: AbortSignal): Promise<ConnectionState> {
  // Windows keeps credentials somewhere else and no Windows machine was
  // available to find out where, so it stays unknown rather than guessed at.
  if (isWindows) return 'unknown';
  // No -w. Reading the secret would raise the keychain permission prompt, and
  // existence is the entire question.
  const run = await runProbeProcess(
    'security',
    ['find-generic-password', '-s', COPILOT_KEYCHAIN_SERVICE],
    { timeoutMs: 5000, signal }
  );
  if (!run) return 'unknown';
  return run.code === 0 ? 'connected' : 'not-connected';
}

/**
 * Decide one provider's connection state, the expensive way.
 *
 * Spawns a process, so this belongs to settings — the chat popover reads the
 * stored result instead.
 */
export async function checkProviderConnection(
  providerId: ProviderId,
  options: { cliPath?: string; signal?: AbortSignal } = {}
): Promise<ConnectionState> {
  if (providerId === 'copilot') {
    // A leftover keychain entry means nothing without the CLI to use it.
    return findProviderCliPath('copilot', options.cliPath ?? '')
      ? checkCopilotCredential(options.signal)
      : 'not-connected';
  }
  const { state } = await checkProviderReadiness(providerId, options);
  switch (state) {
    case 'logged-in': return 'connected';
    // A missing binary is not connected either; the button behind this label
    // opens the wizard, which installs before it logs in.
    case 'logged-out': case 'cli-missing': return 'not-connected';
    case 'unknown': return 'unknown';
  }
}
