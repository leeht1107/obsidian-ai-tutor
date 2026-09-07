/**
 * Windows readiness probe. Reported by an independent reviewer, confirmed in
 * the source: providerReadiness spawned the CLI path directly while
 * CopilotBridgeService routes the same path through resolveCmdShim. npm
 * installs `claude` and `codex` as .cmd shims on Windows, which spawn cannot
 * execute without the shim, so every Windows probe resolved to 'unknown' and
 * a logged-in Windows student was told 확인 불가.
 *
 * That first fix used resolveCmdShim, which only understands npm's own shim
 * text. A windows-latest CI runner then reported every claude and codex probe
 * still answering 'unknown' — so the probe now uses the same four-rung
 * resolveProviderEntry the request path does. The failure was measured, not
 * predicted; the spawn itself is still only exercised on that runner.
 */
import { resolveProbeCommand } from '@/core/setup/providerReadiness';
import { resolveProviderEntry } from '@/utils/copilotCli';

jest.mock('@/utils/copilotCli', () => ({
  ...jest.requireActual('@/utils/copilotCli'),
  resolveProviderEntry: jest.fn(),
}));

describe('resolveProbeCommand', () => {
  it('leaves the command alone where there is no shim (macOS and Linux)', () => {
    (resolveProviderEntry as jest.Mock).mockReturnValue(['/usr/local/bin/claude', []]);
    expect(resolveProbeCommand('/usr/local/bin/claude', ['auth', 'status']))
      .toEqual(['/usr/local/bin/claude', ['auth', 'status']]);
  });

  it('runs the shim target with the probe args appended, as the request path does', () => {
    (resolveProviderEntry as jest.Mock).mockReturnValue(['C:\\node.exe', ['C:\\cli.js']]);
    expect(resolveProbeCommand('C:\\claude.cmd', ['auth', 'status']))
      .toEqual(['C:\\node.exe', ['C:\\cli.js', 'auth', 'status']]);
  });

  it('falls back to the raw path when nothing can be resolved', () => {
    // The probe must still answer a state rather than throw; an unlaunchable
    // path fails the spawn and the caller reports 'unknown'.
    (resolveProviderEntry as jest.Mock).mockReturnValue(null);
    expect(resolveProbeCommand('C:\\claude.cmd', ['auth', 'status']))
      .toEqual(['C:\\claude.cmd', ['auth', 'status']]);
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
