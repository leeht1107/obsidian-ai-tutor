/**
 * Windows readiness probe. Reported by an independent reviewer, confirmed in
 * the source: providerReadiness spawned the CLI path directly while
 * CopilotBridgeService routes the same path through resolveCmdShim. npm
 * installs `claude` and `codex` as .cmd shims on Windows, which spawn cannot
 * execute without the shim, so every Windows probe resolved to 'unknown' and
 * a logged-in Windows student was told 확인 불가.
 *
 * The Windows behaviour itself is unverified — no Windows machine was
 * available — so this pins the resolution, not the spawn.
 */
import { resolveProbeCommand } from '@/core/setup/providerReadiness';
import { resolveCmdShim } from '@/utils/copilotCli';

jest.mock('@/utils/copilotCli', () => ({
  ...jest.requireActual('@/utils/copilotCli'),
  resolveCmdShim: jest.fn(),
}));

describe('resolveProbeCommand', () => {
  it('leaves the command alone where there is no shim (macOS and Linux)', () => {
    (resolveCmdShim as jest.Mock).mockReturnValue(null);
    expect(resolveProbeCommand('/usr/local/bin/claude', ['auth', 'status']))
      .toEqual(['/usr/local/bin/claude', ['auth', 'status']]);
  });

  it('runs the shim target with the probe args appended, as the request path does', () => {
    (resolveCmdShim as jest.Mock).mockReturnValue(['C:\\node.exe', 'C:\\cli.js']);
    expect(resolveProbeCommand('C:\\claude.cmd', ['auth', 'status']))
      .toEqual(['C:\\node.exe', ['C:\\cli.js', 'auth', 'status']]);
  });
});

/**
 * checkProviderReadiness documents "Never rejects: a CLI that hangs, crashes or
 * is missing resolves to a state, because this drives a badge and must not be
 * able to break the view." spawn() throws synchronously for an invalid path or
 * args — EINVAL on Windows — and the callers attach no .catch, so a throw here
 * became an unhandled rejection in the settings tab.
 */
describe('checkProviderReadiness when spawn throws synchronously', () => {
  it('resolves to unknown instead of rejecting', async () => {
    jest.resetModules();
    jest.doMock('child_process', () => ({
      spawn: () => { throw new Error('EINVAL'); },
    }));
    const { checkProviderReadiness } = await import('@/core/setup/providerReadiness');
    const registry = await import('@/core/providers/providerRegistry');
    jest.spyOn(registry, 'findProviderCliPath').mockReturnValue('/path/claude');

    await expect(checkProviderReadiness('claude')).resolves.toEqual({ state: 'unknown' });
    jest.dontMock('child_process');
  });
});
