import {
  buildNativeProviderCommand,
  supportsReadOnlyMode,
  writesOutsideVault,
  writesWithoutAsking,
} from '../../../../src/core/providers/providerRegistry';

/**
 * Measured 2026-09-06 against each installed CLI in `-p` mode; see
 * `.claude/artifacts/ask-agent-toggle-20260906-1020/measured-flag-table.md`.
 * Every expectation here is a lever that was watched to hold or fail — the toggle
 * used to be a label over four different meanings.
 */
describe('read-only support per CLI', () => {
  it('holds all four to read-only, codex included', () => {
    // DEC-21: `-s read-only` alone let codex create the file by escalating through its
    // approval path; with `approval_policy="never"` beside it, codex answered "Blocked".
    // DEC-22: copilot was already claimed here while the builder passed it nothing — true
    // only because copilot is fail-closed, which is luck rather than a lever.
    expect(supportsReadOnlyMode('codex')).toBe(true);
    expect(supportsReadOnlyMode('claude')).toBe(true);
    expect(supportsReadOnlyMode('agy')).toBe(true);
    expect(supportsReadOnlyMode('copilot')).toBe(true);
  });
});

describe('ask mode', () => {
  it('turns off the writing tools for claude — an allow-list did not restrict it', () => {
    // Comma-joining the value does NOT terminate the flag. Measured at claude 2.1.236:
    // `--disallowedTools Write,Edit,Bash hi --output-format ...` still died with
    // "Input must be provided ... as a prompt argument", so ask mode failed every
    // request, quiz or not. The prompt goes last, out of the variadic flag's reach.
    expect(buildNativeProviderCommand('claude', 'hi', '', '', 'ask').args)
      .toEqual(['-p', '--disallowedTools', 'Write,Edit,Bash',
        '--output-format', 'stream-json', '--verbose', 'hi']);
  });

  it('adds nothing for agy, which cannot write headless in the first place', () => {
    expect(buildNativeProviderCommand('agy', 'hi', '', '', 'ask').args).toEqual(['-p', 'hi']);
  });

  it('adds nothing for copilot, which is fail-closed with no flag at all', () => {
    expect(buildNativeProviderCommand('copilot', 'hi', '', '', 'ask').args).toEqual(['-p', 'hi']);
  });

  it('locks both of codex\'s doors, because either one alone still writes', () => {
    expect(buildNativeProviderCommand('codex', 'hi', '', '', 'ask').args)
      .toEqual(['exec', '--skip-git-repo-check',
        '-s', 'read-only', '-c', 'approval_policy="never"', '--json', 'hi']);
  });
});

describe('agent mode', () => {
  it('needs the skip-permissions flag for agy, its only headless write lever', () => {
    expect(buildNativeProviderCommand('agy', 'hi', '', '', 'agent').args)
      .toEqual(['--dangerously-skip-permissions', '-p', 'hi']);
  });

  it('needs --allow-all-tools for copilot, which otherwise could not edit a note', () => {
    // Without it copilot reported "Permission denied and could not request permission
    // from user", so Agent mode promised a write the CLI never performed. `--allow-all-paths`
    // is deliberately absent: copilot wrote in the working directory without it.
    // This pins the policy table, NOT a live dispatch: `query()` routes copilot through its
    // own older argv path, which already pushes the same flag in agent mode. Read this row
    // as the shared answer, not as coverage of what copilot is actually spawned with.
    expect(buildNativeProviderCommand('copilot', 'hi', '', '', 'agent').args)
      .toEqual(['--allow-all-tools', '-p', 'hi']);
  });

  it('gives claude and codex a lever each, rather than leaning on their defaults', () => {
    // Both write headless with no flags, so the old build worked by accident. codex now
    // gains a real boundary — `workspace-write` refused `$HOME` as "outside the permitted
    // workspace" — while claude's only open-ended lever stays open-ended.
    expect(buildNativeProviderCommand('claude', 'hi', '', '', 'agent').args)
      .toEqual(['-p', '--permission-mode', 'bypassPermissions',
        '--output-format', 'stream-json', '--verbose', 'hi']);
    expect(buildNativeProviderCommand('codex', 'hi', '', '', 'agent').args)
      .toEqual(['exec', '--skip-git-repo-check',
        '-s', 'workspace-write', '-c', 'approval_policy="never"', '--json', 'hi']);
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

  it('puts a recognised option between --disallowedTools and the prompt', () => {
    // "the prompt comes after every flag" is too weak on its own: it also passes for
    // `--disallowedTools VALUE PROMPT`, which is the broken form. Only another option
    // ends a variadic list, so assert one actually sits in between.
    const { args } = buildNativeProviderCommand('claude', 'PROMPT', '', '', 'ask');
    const disallowIndex = args.indexOf('--disallowedTools');
    const promptIndex = args.indexOf('PROMPT');
    expect(disallowIndex).toBeGreaterThan(-1);
    expect(promptIndex).toBeGreaterThan(disallowIndex);

    const between = args.slice(disallowIndex + 1, promptIndex);
    expect(between.some((arg) => arg.startsWith('--'))).toBe(true);
  });

  it.each([
    ['claude', 'agent'],
    ['codex', 'ask'],
    ['codex', 'agent'],
    ['copilot', 'agent'],
  ] as const)('keeps the prompt last behind a recognised option for %s in %s mode', (provider, mode) => {
    // The four rows this change introduced. A permission flag added before the prompt
    // instead of before an option is exactly how claude's Ask mode broke once already.
    const { args } = buildNativeProviderCommand(provider, 'PROMPT', '', '', mode);
    expect(args[args.length - 1]).toBe('PROMPT');
    expect(args.indexOf('PROMPT')).toBe(args.length - 1);
    expect(args[args.length - 2]?.startsWith('-')).toBe(true);
  });
});

describe('providers that can write outside the vault', () => {
  it('names claude and agy, and only those two', () => {
    // codex is held by `workspace-write` and copilot by the absence of --allow-all-paths.
    // Agent means something different for those two, and the UI must say so.
    expect(writesOutsideVault('claude')).toBe(true);
    expect(writesOutsideVault('agy')).toBe(true);
    expect(writesOutsideVault('codex')).toBe(false);
    expect(writesOutsideVault('copilot')).toBe(false);
  });

  it('is the same set the write-consent dialog gates on', () => {
    // Every provider auto-approves its tools in Agent mode now, so "does it ask?" no
    // longer discriminates. Reach does, and that is what the student is consenting to.
    for (const provider of ['claude', 'codex', 'agy', 'copilot'] as const) {
      expect(writesWithoutAsking(provider)).toBe(writesOutsideVault(provider));
    }
  });

  it('does not imply one shared flag: agy alone takes --dangerously-skip-permissions', () => {
    // claude is in the consent set but receives --permission-mode, so asserting the two
    // sets are equal would now be asserting something false.
    expect(buildNativeProviderCommand('agy', 'hi', '', '', 'agent').args)
      .toContain('--dangerously-skip-permissions');
    for (const provider of ['claude', 'codex', 'copilot'] as const) {
      expect(buildNativeProviderCommand(provider, 'hi', '', '', 'agent').args)
        .not.toContain('--dangerously-skip-permissions');
    }
  });
});
