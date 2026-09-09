/**
 * The failures worth logging are the ones nobody here can reproduce: a Windows
 * shim that resolves to nothing, a CLI that exits without answering. The student
 * sees one Korean sentence and the evidence is gone.
 *
 * So the log has to survive being read by a person weeks later, and it has to be
 * safe to hand over — which means no credentials and no real names in paths.
 */
import {
  appendErrorLog,
  ERROR_LOG_PATH,
  type ErrorLogEntry,
  formatErrorsForReport,
  readRecentErrors,
  recordError,
} from '@/core/storage/ErrorLog';
import type { VaultFileAdapter } from '@/core/storage/VaultFileAdapter';

const LOG_PATH = ERROR_LOG_PATH;

/** An in-memory vault. */
function fakeAdapter(seed: Record<string, string> = {}) {
  const files = new Map(Object.entries(seed));
  const adapter = {
    exists: async (p: string) => files.has(p),
    read: async (p: string) => files.get(p) ?? '',
    write: async (p: string, c: string) => { files.set(p, c); },
  } as unknown as VaultFileAdapter;
  return { adapter, files };
}

function entry(overrides: Partial<ErrorLogEntry> = {}): ErrorLogEntry {
  return {
    at: '2026-09-07T04:00:00.000Z',
    provider: 'claude',
    stage: 'exit',
    message: 'CLI exited with code 1',
    platform: 'win32',
    pluginVersion: '0.1.8',
    ...overrides,
  };
}

describe('ErrorLog', () => {
  it('lives in the vault so a student can find it on any platform', () => {
    // It used to sit under `.obsidian/plugins/<id>/logs/`, which is correct but
    // unreachable for the person who has to send it: on Windows that folder is
    // hidden, and asking a student to open it by hand is how the evidence gets
    // lost. `.ai-tutor/` is the folder they already know.
    expect(ERROR_LOG_PATH).toBe('.ai-tutor/logs/errors.jsonl');
  });

  it('writes one JSON object per line', async () => {
    const { adapter, files } = fakeAdapter();
    await appendErrorLog(adapter, LOG_PATH, entry());

    expect(JSON.parse((files.get(LOG_PATH) ?? '').trim())).toMatchObject({ provider: 'claude', stage: 'exit' });
  });

  it('keeps the tail rather than growing without limit', async () => {
    // A student who hits a crash loop must not end up mailing a 40 MB file.
    const { adapter, files } = fakeAdapter();
    for (let i = 0; i < 320; i++) {
      // eslint-disable-next-line no-await-in-loop -- appends are ordered by design
      await appendErrorLog(adapter, LOG_PATH, entry({ message: `failure ${i}` }));
    }

    const lines = (files.get(LOG_PATH) ?? '').split('\n').filter(Boolean);
    expect(lines.length).toBe(300);
    // The newest survives; the oldest is what got dropped.
    expect(lines[lines.length - 1]).toContain('failure 319');
    expect(files.get(LOG_PATH)).not.toContain('failure 0"');
  });

  it('never throws when the vault refuses the write', async () => {
    // A logger that takes a request down is worse than no logger.
    const broken = {
      exists: async () => false,
      read: async () => '',
      write: async () => { throw new Error('EACCES'); },
    } as unknown as VaultFileAdapter;

    await expect(appendErrorLog(broken, LOG_PATH, entry())).resolves.toBeUndefined();
  });

  it('survives a corrupted line when reading back', async () => {
    const { adapter } = fakeAdapter({
      [LOG_PATH]: `${JSON.stringify(entry())}\nnot json at all\n${JSON.stringify(entry({ provider: 'codex' }))}\n`,
    });
    const read = await readRecentErrors(adapter, LOG_PATH);
    expect(read.map((e) => e.provider)).toEqual(['claude', 'codex']);
  });

  it('masks the home directory out of a path field', async () => {
    // `C:\\Users\\<real name>\\AppData\\...` is the whole diagnostic on Windows, so
    // the path is kept and only the name is removed.
    const { adapter, files } = fakeAdapter();

    recordError(
      adapter,
      { provider: 'claude', stage: 'resolve', message: 'not found', cliPath: 'C:\\Users\\Jihoon\\AppData\\Roaming\\npm\\claude.cmd' },
      { home: 'C:\\Users\\Jihoon', pluginVersion: '0.1.16' }
    );
    await new Promise((resolve) => setImmediate(resolve));

    expect(JSON.parse((files.get(LOG_PATH) ?? '').trim()).cliPath)
      .toBe('~\\AppData\\Roaming\\npm\\claude.cmd');
  });

  it('leaves a path outside the home directory alone', async () => {
    const { adapter, files } = fakeAdapter();

    recordError(
      adapter,
      { provider: 'claude', stage: 'resolve', message: 'not found', cliPath: '/opt/homebrew/bin/claude' },
      { home: '/Users/jihoon', pluginVersion: '0.1.16' }
    );
    await new Promise((resolve) => setImmediate(resolve));

    const written = JSON.parse((files.get(LOG_PATH) ?? '').trim());
    expect(written.cliPath).toBe('/opt/homebrew/bin/claude');
    // A field the caller never set stays absent rather than becoming a string.
    expect(written.resolved).toBeUndefined();
  });

  it('formats entries as something a student can paste into a message', () => {
    const text = formatErrorsForReport([
      entry({ stage: 'resolve', message: '실행 파일을 찾지 못했습니다', cliPath: '~\\AppData\\Roaming\\npm\\claude.cmd' }),
    ]);

    expect(text).toContain('claude / resolve');
    expect(text).toContain('~\\AppData\\Roaming\\npm\\claude.cmd');
    expect(text).toContain('win32');
    expect(text).toContain('0.1.8');
  });

  it('keeps both entries when two failures are written in the same tick', async () => {
    // One CopilotBridgeService is shared by chat, title generation, inline edit and
    // instruction refine, and logError fires the append without awaiting it. An
    // unserialised read-modify-write means the second reader sees the file as it was
    // before the first wrote, and one failure disappears — exactly the failure the
    // student was going to hand over.
    const { adapter, files } = fakeAdapter();

    await Promise.all([
      appendErrorLog(adapter, LOG_PATH, entry({ message: 'first' })),
      appendErrorLog(adapter, LOG_PATH, entry({ message: 'second' })),
    ]);

    const lines = (files.get(LOG_PATH) ?? '').split('\n').filter(Boolean);
    expect(lines.length).toBe(2);
    expect(files.get(LOG_PATH)).toContain('first');
    expect(files.get(LOG_PATH)).toContain('second');
  });

  it('does not wedge later writes when one of them fails', async () => {
    // The queue is shared, so a vault that refuses one write must not take the
    // rest of the session's log entries down with it.
    let refuse = true;
    const files = new Map<string, string>();
    const flaky = {
      exists: async (pth: string) => files.has(pth),
      read: async (pth: string) => files.get(pth) ?? '',
      write: async (pth: string, c: string) => {
        if (refuse) { refuse = false; throw new Error('EACCES'); }
        files.set(pth, c);
      },
    } as unknown as VaultFileAdapter;

    await appendErrorLog(flaky, LOG_PATH, entry({ message: 'lost' }));
    await appendErrorLog(flaky, LOG_PATH, entry({ message: 'kept' }));

    expect(files.get(LOG_PATH)).toContain('kept');
  });

  it('masks the home directory only at a path boundary', async () => {
    // `/Users/markAlt` is a different person's directory that merely starts with
    // the same text. Masking it produced `~Alt/...`: a garbled path that also
    // leaked half the real directory name it was supposed to hide.
    const { adapter, files } = fakeAdapter();

    recordError(
      adapter,
      { provider: 'claude', stage: 'resolve', message: '/Users/markAlt/secret/a.js', cliPath: '/Users/mark/bin/claude' },
      { home: '/Users/mark', pluginVersion: '0.1.16' }
    );
    await new Promise((resolve) => setImmediate(resolve));

    const written = JSON.parse((files.get(LOG_PATH) ?? '').trim());
    expect(written.message).toBe('/Users/markAlt/secret/a.js');
    expect(written.cliPath).toBe('~/bin/claude');
  });

  it('records an entry through the shared writer, with the home masked', async () => {
    // `recordError` is the one seam both the chat path and the setup wizard use,
    // so a failure the student was shown lands in the same file either way.
    const { adapter, files } = fakeAdapter();

    recordError(
      adapter,
      { provider: 'node', stage: 'install', message: 'winget failed', cliPath: '/Users/mark/.npm/claude' },
      { home: '/Users/mark', pluginVersion: '0.1.15' }
    );
    await new Promise((resolve) => setImmediate(resolve));

    const written = JSON.parse((files.get(LOG_PATH) ?? '').trim());
    expect(written).toMatchObject({ provider: 'node', stage: 'install', cliPath: '~/.npm/claude', pluginVersion: '0.1.15' });
    expect(written.at).toEqual(expect.any(String));
  });

  it('records nothing, and does not throw, when there is no vault adapter yet', () => {
    // Setup can fail before storage is ready. A logger that throws there would
    // replace a recoverable install error with a broken wizard.
    expect(() => recordError(undefined, { provider: 'node', stage: 'install', message: 'x' }, { home: '/Users/mark', pluginVersion: '0.1.15' })).not.toThrow();
  });

  it('scrubs credential-shaped text the plugin never configured', async () => {
    // Redaction upstream can only remove values this plugin knows: the student's
    // configured token and their environment variables. npm and winget output is
    // somebody else's text — a registry URL with a token in it, an npmrc
    // auth line — and it is written to a file the student mails to a stranger.
    const { adapter, files } = fakeAdapter();

    recordError(
      adapter,
      {
        provider: 'claude',
        stage: 'install',
        message: [
          'npm ERR! 404 https://registry.example/?token=UNCONFIGURED_SECRET_123456',
          'npm ERR! //registry.example/:_authToken=abcdefghijklmnop123456',
          'npm ERR! https://user:hunter2@registry.example/pkg',
          'npm ERR! Authorization: Bearer ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ012345',
          // A bearer token with no vendor prefix is the ordinary case, and it is
          // the one a key-first rule leaves standing after eating only the word
          // "Bearer".
          'npm ERR! Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.payload.signature',
          'npm ERR! Authorization: Basic dXNlcjpwYXNzd29yZA==',
          // Node prints headers quoted, and a quote is not whitespace: the scheme
          // and its value have to be consumed together anyway.
          'npm ERR! Authorization: "Bearer eyJxyz.quoted.blob"',
          "npm ERR! Authorization: 'Basic cXVvdGVkOnBhc3M='",
        ].join('\n'),
      },
      { home: '/Users/mark', pluginVersion: '0.1.15' }
    );

    await new Promise((resolve) => setImmediate(resolve));
    const written = files.get(LOG_PATH) ?? '';
    expect(written).not.toContain('UNCONFIGURED_SECRET_123456');
    expect(written).not.toContain('abcdefghijklmnop123456');
    expect(written).not.toContain('hunter2');
    expect(written).not.toContain('ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ012345');
    expect(written).not.toContain('eyJhbGciOiJIUzI1NiJ9.payload.signature');
    expect(written).not.toContain('dXNlcjpwYXNzd29yZA==');
    expect(written).not.toContain('eyJxyz.quoted.blob');
    expect(written).not.toContain('cXVvdGVkOnBhc3M=');
    // The diagnostic itself has to survive, or there was no point keeping the tail.
    expect(written).toContain('404');
    expect(written).toContain('registry.example');
  });

  it('masks the home directory even when the separators are doubled', async () => {
    // Windows output that has already been through a JSON encoder arrives as
    // `C:\\Users\\Jihoon\\...`, which matches neither separator variant.
    const { adapter, files } = fakeAdapter();

    recordError(
      adapter,
      { provider: 'claude', stage: 'install', message: 'npm ERR! path C:\\\\Users\\\\Jihoon\\\\AppData' },
      { home: 'C:\\Users\\Jihoon', pluginVersion: '0.1.15' }
    );

    await new Promise((resolve) => setImmediate(resolve));
    expect(files.get(LOG_PATH) ?? '').toContain('npm ERR');
    expect(files.get(LOG_PATH) ?? '').not.toContain('Jihoon');
  });

  it('says so plainly when there is nothing to report', () => {
    expect(formatErrorsForReport([])).toBe('기록된 오류가 없습니다.');
  });

  it('masks the home directory inside a composite resolved command, not only at its start', async () => {
    // The Windows leak this test exists for. An npm `.cmd` shim resolves to a
    // synthetic two-part string — `node.exe <path under the home directory>` —
    // and the old path masker only looked at character zero, so the student's
    // account name was written to the file verbatim. The 0.1.15 tests only ever
    // exercised the POSIX branch, where `resolved` happens to start at the home
    // directory, so nothing caught it.
    const { adapter, files } = fakeAdapter();

    recordError(
      adapter,
      {
        provider: 'copilot',
        stage: 'launch',
        message: 'Failed to start Copilot CLI: spawn EINVAL',
        cliPath: 'C:\\Users\\Jihoon\\AppData\\Roaming\\npm\\copilot.cmd',
        resolved: 'C:\\Program Files\\nodejs\\node.exe C:\\Users\\Jihoon\\AppData\\Roaming\\npm\\node_modules\\copilot\\index.js',
      },
      { home: 'C:\\Users\\Jihoon', pluginVersion: '0.1.16' }
    );
    await new Promise((resolve) => setImmediate(resolve));

    const raw = files.get(LOG_PATH) ?? '';
    expect(raw).not.toContain('Jihoon');
    const written = JSON.parse(raw.trim());
    expect(written.resolved).toBe('C:\\Program Files\\nodejs\\node.exe ~\\AppData\\Roaming\\npm\\node_modules\\copilot\\index.js');
    expect(written.cliPath).toBe('~\\AppData\\Roaming\\npm\\copilot.cmd');
  });

  it('still leaves a different account whose name merely starts the same alone', async () => {
    // The boundary rule the old masker got right, kept while replacing it:
    // `C:\Users\JihoonBackup` is somebody else's directory.
    const { adapter, files } = fakeAdapter();

    recordError(
      adapter,
      { provider: 'claude', stage: 'resolve', message: 'not found', cliPath: 'C:\\Users\\JihoonBackup\\npm\\claude.cmd' },
      { home: 'C:\\Users\\Jihoon', pluginVersion: '0.1.16' }
    );
    await new Promise((resolve) => setImmediate(resolve));

    expect(JSON.parse((files.get(LOG_PATH) ?? '').trim()).cliPath)
      .toBe('C:\\Users\\JihoonBackup\\npm\\claude.cmd');
  });

  it('scrubs a credential out of a path field, not only out of the message', async () => {
    // `cliPath` and `resolved` used to skip the credential scrub entirely. A
    // configured CLI path is student-supplied text and can carry a query string.
    const { adapter, files } = fakeAdapter();

    recordError(
      adapter,
      { provider: 'claude', stage: 'resolve', message: 'not found', resolved: 'https://registry.example.com/x?token=abcd1234efgh' },
      { home: '/Users/mark', pluginVersion: '0.1.16' }
    );
    await new Promise((resolve) => setImmediate(resolve));

    expect(files.get(LOG_PATH) ?? '').not.toContain('abcd1234efgh');
  });

  it('keeps the npm diagnostic that merely mentions an Authorization header', async () => {
    // The scrub used to swallow everything after `Authorization:` to the end of
    // the line, and npm's one useful sentence about why an install failed is
    // written exactly that way. Deleting a diagnostic to hide a secret that was
    // never there is the worse of the two failures: it is the only line telling
    // the student what to do next.
    const { adapter, files } = fakeAdapter();

    recordError(
      adapter,
      {
        provider: 'claude',
        stage: 'install',
        message: 'npm error code E401\nnpm error Incorrect or missing password.\n'
          + 'npm error Authorization: Personal access tokens with fine-grained permissions are not supported for this registry.',
      },
      { home: '/Users/mark', pluginVersion: '0.1.16' }
    );
    await new Promise((resolve) => setImmediate(resolve));

    const written = JSON.parse((files.get(LOG_PATH) ?? '').trim());
    expect(written.message).toContain('Personal access tokens with fine-grained permissions are not supported');
  });

  it('still removes an Authorization header that carries an actual token', async () => {
    const { adapter, files } = fakeAdapter();

    recordError(
      adapter,
      {
        provider: 'claude',
        stage: 'install',
        message: 'request headers: Authorization: "Bearer ghp_aaaabbbbccccddddeeeeffff0000" and nothing else',
      },
      { home: '/Users/mark', pluginVersion: '0.1.16' }
    );
    await new Promise((resolve) => setImmediate(resolve));

    const raw = files.get(LOG_PATH) ?? '';
    expect(raw).not.toContain('ghp_aaaabbbbccccddddeeeeffff0000');
    // The sentence around it survives; only the value goes.
    expect(raw).toContain('and nothing else');
  });

  it('removes the credential-shaped query parameters npm and cloud SDKs echo back', async () => {
    const { adapter, files } = fakeAdapter();

    recordError(
      adapter,
      {
        provider: 'claude',
        stage: 'install',
        message: 'GET https://x.example/v1?key=AIzaSyD-ExampleExampleExample123456789'
          + '&AWSAccessKeyId=AKIAIOSFODNN7EXAMPLE&Signature=Yn3s%2FbXQ1example%3D failed',
      },
      { home: '/Users/mark', pluginVersion: '0.1.16' }
    );
    await new Promise((resolve) => setImmediate(resolve));

    const raw = files.get(LOG_PATH) ?? '';
    expect(raw).not.toContain('AIzaSyD-ExampleExampleExample123456789');
    expect(raw).not.toContain('AKIAIOSFODNN7EXAMPLE');
    expect(raw).not.toContain('Yn3s%2FbXQ1example');
    expect(raw).toContain('failed');
  });

  it('caps one entry so a single crash cannot fill the whole file', async () => {
    // The 300-entry cap alone bounded nothing useful: a provider CLI is allowed
    // to write a megabyte of stderr, and that whole megabyte reached one line.
    const { adapter, files } = fakeAdapter();

    await appendErrorLog(adapter, LOG_PATH, entry({ message: 'x'.repeat(50_000) }));

    const raw = (files.get(LOG_PATH) ?? '').trim();
    expect(raw.length).toBeLessThan(10_000);
    const written = JSON.parse(raw);
    // Truncated, and said to be truncated, rather than silently shortened.
    expect(written.message).toContain('잘림');
    expect(written.message.startsWith('xxxx')).toBe(true);
  });

  it('leaves an ordinary-sized entry untouched by the cap', async () => {
    const { adapter, files } = fakeAdapter();

    await appendErrorLog(adapter, LOG_PATH, entry({ message: 'npm error code E401' }));

    expect(JSON.parse((files.get(LOG_PATH) ?? '').trim()).message).toBe('npm error code E401');
  });
});
