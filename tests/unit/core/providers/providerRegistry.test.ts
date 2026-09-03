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
});
