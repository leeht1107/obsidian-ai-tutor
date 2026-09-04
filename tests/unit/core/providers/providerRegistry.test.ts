import { buildNativeProviderCommand, getProviderDescriptor, PROVIDERS } from '../../../../src/core/providers/providerRegistry';

describe('provider registry', () => {
  it('offers exactly the four supported provider choices', () => {
    expect(PROVIDERS.map((provider) => provider.id)).toEqual(['copilot', 'claude', 'codex', 'agy']);
  });

  it.each([
    ['claude', 'claude', ['-p', 'hello', '--output-format', 'stream-json', '--verbose']],
    ['codex', 'codex', ['exec', '--json', 'hello']],
    ['agy', 'agy', ['-p', 'hello']],
  ] as const)('builds the native %s command', (id, command, args) => {
    expect(buildNativeProviderCommand(id, 'hello')).toEqual({ command, args });
  });

  it('keeps agy guided because no package-manager recipe is verified', () => {
    expect(getProviderDescriptor('agy').installCommand).toBeUndefined();
    expect(getProviderDescriptor('agy').status).toBe('manual-setup');
  });

  it('passes only explicit native model overrides with each CLI contract', () => {
    expect(buildNativeProviderCommand('claude', 'hello', 'opus').args).toEqual(['-p', '--model', 'opus', 'hello', '--output-format', 'stream-json', '--verbose']);
    expect(buildNativeProviderCommand('codex', 'hello', 'o3').args).toEqual(['exec', '--model', 'o3', '--json', 'hello']);
    expect(buildNativeProviderCommand('agy', 'hello', 'gemini-pro').args).toEqual(['--model', 'gemini-pro', '-p', 'hello']);
    expect(buildNativeProviderCommand('agy', 'hello', '   ').args).toEqual(['-p', 'hello']);
  });
});
