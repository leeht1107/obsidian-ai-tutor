import { buildNativeProviderCommand, getProviderDescriptor, PROVIDERS } from '../../../../src/core/providers/providerRegistry';

describe('provider registry', () => {
  it('offers exactly the four supported provider choices', () => {
    expect(PROVIDERS.map((provider) => provider.id)).toEqual(['copilot', 'claude', 'codex', 'agy']);
  });

  it.each([
    ['claude', 'claude', ['-p', '--permission-mode', 'bypassPermissions', '--output-format', 'stream-json', '--verbose', 'hello']],
    ['codex', 'codex', ['exec', '--skip-git-repo-check', '-s', 'workspace-write', '-c', 'approval_policy="never"', '--json', 'hello']],
    ['agy', 'agy', ['--dangerously-skip-permissions', '-p', 'hello']],
  ] as const)('builds the native %s command', (id, command, args) => {
    expect(buildNativeProviderCommand(id, 'hello')).toEqual({ command, args });
  });

  it('keeps agy guided because no package-manager recipe is verified', () => {
    expect(getProviderDescriptor('agy').installCommand).toBeUndefined();
    expect(getProviderDescriptor('agy').status).toBe('manual-setup');
  });

  it('passes only explicit native model overrides with each CLI contract', () => {
    expect(buildNativeProviderCommand('claude', 'hello', 'opus').args).toEqual(['-p', '--model', 'opus', '--permission-mode', 'bypassPermissions', '--output-format', 'stream-json', '--verbose', 'hello']);
    expect(buildNativeProviderCommand('codex', 'hello', 'o3').args).toEqual(['exec', '--skip-git-repo-check', '--model', 'o3', '-s', 'workspace-write', '-c', 'approval_policy="never"', '--json', 'hello']);
    expect(buildNativeProviderCommand('agy', 'hello', 'gemini-pro').args).toEqual(['--dangerously-skip-permissions', '--model', 'gemini-pro', '-p', 'hello']);
    expect(buildNativeProviderCommand('agy', 'hello', '   ').args).toEqual(['--dangerously-skip-permissions', '-p', 'hello']);
  });
});
