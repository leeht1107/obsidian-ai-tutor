import {
  buildNativeProviderCommand,
  supportsReadOnlyMode,
  writesWithoutAsking,
} from '../../../../src/core/providers/providerRegistry';

/**
 * Measured 2026-09-05 against each CLI in `-p` mode; see
 * `.claude/artifacts/provider-settings-20260905-2100/cli-permission-evidence.md`.
 * Every expectation here is a lever that was watched to hold or fail.
 */
describe('read-only support per CLI', () => {
  it('knows codex cannot be held to read-only', () => {
    expect(supportsReadOnlyMode('codex')).toBe(false);
    expect(supportsReadOnlyMode('claude')).toBe(true);
    expect(supportsReadOnlyMode('agy')).toBe(true);
    expect(supportsReadOnlyMode('copilot')).toBe(true);
  });
});

describe('ask mode', () => {
  it('turns off the writing tools for claude — an allow-list did not restrict it', () => {
    // One comma-separated argument, not three. The flag is variadic, so separate
    // words swallow the prompt that follows and the run fails outright.
    expect(buildNativeProviderCommand('claude', 'hi', '', '', 'ask').args)
      .toEqual(['-p', '--disallowedTools', 'Write,Edit,Bash',
        'hi', '--output-format', 'stream-json', '--verbose']);
  });

  it('adds nothing for agy, which cannot write headless in the first place', () => {
    expect(buildNativeProviderCommand('agy', 'hi', '', '', 'ask').args).toEqual(['-p', 'hi']);
  });

  it('adds nothing for codex, which has no read-only to ask for', () => {
    expect(buildNativeProviderCommand('codex', 'hi', '', '', 'ask').args)
      .toEqual(['exec', '--skip-git-repo-check', '--json', 'hi']);
  });
});

describe('agent mode', () => {
  it('needs the skip-permissions flag for agy, its only headless write lever', () => {
    expect(buildNativeProviderCommand('agy', 'hi', '', '', 'agent').args)
      .toEqual(['--dangerously-skip-permissions', '-p', 'hi']);
  });

  it('leaves claude and codex on their defaults, which already write', () => {
    expect(buildNativeProviderCommand('claude', 'hi', '', '', 'agent').args)
      .not.toContain('--disallowedTools');
    expect(buildNativeProviderCommand('codex', 'hi', '', '', 'agent').args)
      .toEqual(['exec', '--skip-git-repo-check', '--json', 'hi']);
  });
});

describe('codex outside a Git repository', () => {
  it('always passes --skip-git-repo-check, since a student vault is rarely a repo', () => {
    for (const mode of ['ask', 'agent'] as const) {
      expect(buildNativeProviderCommand('codex', 'hi', '', '', mode).args)
        .toContain('--skip-git-repo-check');
    }
  });
});

describe('the prompt survives every flag combination', () => {
  it('never leaves the prompt where a variadic flag would swallow it', () => {
    for (const mode of ['ask', 'agent'] as const) {
      const { args } = buildNativeProviderCommand('claude', 'PROMPT', 'opus', 'high', mode);
      const promptIndex = args.indexOf('PROMPT');
      expect(promptIndex).toBeGreaterThan(-1);
      // Whatever precedes the prompt must be a value that its flag fully consumed.
      expect(args[promptIndex - 1]).not.toBe('--disallowedTools');
    }
  });
});

describe('providers whose write permission is all or nothing', () => {
  it('names agy, whose only headless write lever auto-approves every tool', () => {
    expect(writesWithoutAsking('agy')).toBe(true);
    expect(writesWithoutAsking('claude')).toBe(false);
    expect(writesWithoutAsking('codex')).toBe(false);
    expect(writesWithoutAsking('copilot')).toBe(false);
  });

  it('is exactly the set that receives --dangerously-skip-permissions', () => {
    for (const provider of ['claude', 'codex', 'agy', 'copilot'] as const) {
      const args = buildNativeProviderCommand(provider, 'hi', '', '', 'agent').args;
      expect(args.includes('--dangerously-skip-permissions')).toBe(writesWithoutAsking(provider));
    }
  });
});
