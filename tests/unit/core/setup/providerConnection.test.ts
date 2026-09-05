/**
 * Where a provider's connection state comes from.
 *
 * The chat popover used to answer this itself, spawning every installed CLI on
 * each open. copilot has no command that answers it — every non-interactive
 * subcommand replies from local files, identically under a fresh HOME — so
 * copilot alone rendered 확인 불가, which the student whose default provider it
 * was read as an error. Settings now owns the check and chat shows its result.
 *
 * The failure this file is written against: recording only successes. A stale
 * 연결됨 outliving the login it described is exactly what the badge exists to
 * prevent, and an earlier version of this feature shipped that bug.
 */
import * as providerRegistry from '@/core/providers/providerRegistry';
import { applyRequestOutcome, checkCopilotCredential, checkProviderConnection, connectionLabel, resolveCheckedState } from '@/core/setup/providerConnection';
import * as readiness from '@/core/setup/providerReadiness';

describe('connectionLabel', () => {
  it('separates a confirmed connection from an unanswered one', () => {
    expect(connectionLabel('connected')).toBe('연결됨');
    expect(connectionLabel('not-connected')).toBe('연결 필요');
    expect(connectionLabel('unknown')).toBe('확인 안 됨');
  });

  it('says nothing has been checked yet when no state was ever stored', () => {
    expect(connectionLabel(undefined)).toBe('확인 안 됨');
  });
});

describe('applyRequestOutcome', () => {
  it('records a working request as a connection', () => {
    expect(applyRequestOutcome(undefined, 'copilot', 'ok', 5))
      .toEqual({ copilot: { state: 'connected', at: 5 } });
  });

  it('replaces a standing connection when the CLI reports an authentication failure', () => {
    const before = { copilot: { state: 'connected' as const, at: 1 } };
    expect(applyRequestOutcome(before, 'copilot', 'auth-failed', 2))
      .toEqual({ copilot: { state: 'not-connected', at: 2 } });
  });

  it('leaves a standing connection alone when the request failed for another reason', () => {
    // A network drop or a rate limit is not a logout, and treating it as one
    // would send a signed-in student back through the login flow.
    const before = { copilot: { state: 'connected' as const, at: 1 } };
    expect(applyRequestOutcome(before, 'copilot', 'failed', 2)).toEqual(before);
  });

  it('keeps the other providers untouched', () => {
    const before = { claude: { state: 'connected' as const, at: 1 } };
    expect(applyRequestOutcome(before, 'copilot', 'auth-failed', 2)).toEqual({
      claude: { state: 'connected', at: 1 },
      copilot: { state: 'not-connected', at: 2 },
    });
  });
});

/**
 * Flagged by an independent reviewer: on Windows the copilot check can only
 * ever answer unknown, so opening settings after a working request would have
 * thrown away the connection that request proved.
 */
describe('resolveCheckedState', () => {
  it('keeps a standing connection when the check could not decide', () => {
    expect(resolveCheckedState('connected', 'unknown')).toBe('connected');
  });

  it('still lets a definite answer overwrite anything', () => {
    expect(resolveCheckedState('connected', 'not-connected')).toBe('not-connected');
    expect(resolveCheckedState('not-connected', 'connected')).toBe('connected');
  });

  it('reports the inconclusive answer when there was nothing stronger stored', () => {
    expect(resolveCheckedState(undefined, 'unknown')).toBe('unknown');
    expect(resolveCheckedState('not-connected', 'unknown')).toBe('unknown');
  });
});

describe('checkCopilotCredential', () => {
  afterEach(() => { jest.restoreAllMocks(); });

  it('reads existence only, never the secret', async () => {
    const run = jest.spyOn(readiness, 'runProbeProcess')
      .mockResolvedValue({ stdout: '', stderr: '', code: 0 });

    await expect(checkCopilotCredential()).resolves.toBe('connected');

    const [command, args] = run.mock.calls[0];
    expect(command).toBe('security');
    // -w would print the token and raise the keychain permission prompt.
    expect(args).not.toContain('-w');
    expect(args).toEqual(expect.arrayContaining(['find-generic-password', '-s', 'copilot-cli']));
  });

  it('reports not-connected when the keychain has no entry', async () => {
    jest.spyOn(readiness, 'runProbeProcess')
      .mockResolvedValue({ stdout: '', stderr: 'The specified item could not be found', code: 44 });
    await expect(checkCopilotCredential()).resolves.toBe('not-connected');
  });

  it('stays unknown when the command could not be run at all', async () => {
    jest.spyOn(readiness, 'runProbeProcess').mockResolvedValue(null);
    await expect(checkCopilotCredential()).resolves.toBe('unknown');
  });

  it('does not touch the keychain on Windows, whose credential store is elsewhere', async () => {
    // No Windows machine was available to find out where copilot stores its
    // token there, so Windows answers unknown rather than guessing — and it
    // must not spawn a macOS-only binary to do it.
    jest.resetModules();
    const spawn = jest.fn();
    jest.doMock('child_process', () => ({ spawn }));
    jest.doMock('@/core/setup/processTree', () => ({ isWindows: true, killTree: jest.fn() }));

    const module = await import('@/core/setup/providerConnection');
    await expect(module.checkCopilotCredential()).resolves.toBe('unknown');
    expect(spawn).not.toHaveBeenCalled();

    jest.dontMock('child_process');
    jest.dontMock('@/core/setup/processTree');
    jest.resetModules();
  });
});

/**
 * The mapping the settings rows are drawn from. A reviewer noted it was the one
 * piece of this module with no test of its own.
 */
describe('checkProviderConnection', () => {
  afterEach(() => { jest.restoreAllMocks(); });

  it('translates what a CLI said about its login', async () => {
    const probe = jest.spyOn(readiness, 'checkProviderReadiness');

    probe.mockResolvedValue({ state: 'logged-in' });
    await expect(checkProviderConnection('claude')).resolves.toBe('connected');

    probe.mockResolvedValue({ state: 'logged-out' });
    await expect(checkProviderConnection('codex')).resolves.toBe('not-connected');

    // A CLI that is not installed is not connected either; the button behind
    // this label opens the wizard, which installs before it logs in.
    probe.mockResolvedValue({ state: 'cli-missing' });
    await expect(checkProviderConnection('agy')).resolves.toBe('not-connected');

    probe.mockResolvedValue({ state: 'unknown' });
    await expect(checkProviderConnection('agy')).resolves.toBe('unknown');
  });

  it('never asks a login probe about copilot, which cannot answer one', async () => {
    const probe = jest.spyOn(readiness, 'checkProviderReadiness');
    jest.spyOn(providerRegistry, 'findProviderCliPath').mockReturnValue('/usr/local/bin/copilot');
    const run = jest.spyOn(readiness, 'runProbeProcess')
      .mockResolvedValue({ stdout: '', stderr: '', code: 0 });

    await expect(checkProviderConnection('copilot')).resolves.toBe('connected');
    expect(probe).not.toHaveBeenCalled();
    expect(run).toHaveBeenCalledWith('security', expect.any(Array), expect.any(Object));
  });

  it('does not call a leftover keychain entry a connection when copilot is not installed', async () => {
    jest.spyOn(providerRegistry, 'findProviderCliPath').mockReturnValue(null);
    const run = jest.spyOn(readiness, 'runProbeProcess');
    await expect(checkProviderConnection('copilot')).resolves.toBe('not-connected');
    expect(run).not.toHaveBeenCalled();
  });
});
