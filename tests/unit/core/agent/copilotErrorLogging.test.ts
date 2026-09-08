/**
 * The copilot path used to fail quietly.
 *
 * The native providers write every failure they show the student into
 * `.ai-tutor/logs/errors.jsonl`; copilot — the default — skipped the two cases a
 * student on a fresh Windows machine is most likely to hit: no CLI at all, and a
 * `spawn()` that throws synchronously on the `.cmd` shim. The student saw a red
 * bubble, closed Obsidian, and there was nothing left to hand over.
 */
import * as childProcess from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

jest.mock('@/utils/copilotCli', () => ({
  findCopilotCLIPath: jest.fn(() => null),
  resolveProviderEntry: jest.fn(() => ['/usr/local/bin/copilot', []]),
}));

import { CopilotBridgeService } from '@/core/agent/CopilotBridgeService';
import { ERROR_LOG_PATH, type ErrorLogEntry } from '@/core/storage/ErrorLog';
import type { StreamChunk } from '@/core/types';
import { DEFAULT_SETTINGS } from '@/core/types/settings';
import type ObsidianCopilotPlugin from '@/main';
import { findCopilotCLIPath } from '@/utils/copilotCli';

const TOKEN = 'github_pat_11ABCDEFG_supersecretvalue';

const HOME_VAULT = path.join(os.homedir(), 'Obsidian', 'vault');

function makeService(settings: Record<string, unknown> = {}) {
  const files = new Map<string, string>();
  const adapter = {
    exists: async (p: string) => files.has(p),
    read: async (p: string) => files.get(p) ?? '',
    write: async (p: string, c: string) => { files.set(p, c); },
  };
  const plugin = {
    settings: {
      ...DEFAULT_SETTINGS,
      selectedProvider: 'copilot',
      githubToken: TOKEN,
      ...settings,
    },
    manifest: { version: '0.1.15' },
    app: { vault: { adapter: { basePath: HOME_VAULT } } },
    storage: { getAdapter: () => adapter },
    getActiveEnvironmentVariables: () => '',
  } as unknown as ObsidianCopilotPlugin;
  return { service: new CopilotBridgeService(plugin), files };
}

async function drain(gen: AsyncGenerator<StreamChunk>): Promise<StreamChunk[]> {
  const chunks: StreamChunk[] = [];
  for await (const chunk of gen) chunks.push(chunk);
  return chunks;
}

/** The log is written fire-and-forget, so let the queue settle before reading it. */
async function entries(files: Map<string, string>): Promise<ErrorLogEntry[]> {
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  return (files.get(ERROR_LOG_PATH) ?? '')
    .split('\n')
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l) as ErrorLogEntry);
}

describe('the copilot path leaves a record of what the student was shown', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (findCopilotCLIPath as jest.Mock).mockReturnValue(null);
    jest.spyOn(fs, 'statSync').mockImplementation((() => ({ isFile: () => true }) as fs.Stats) as unknown as typeof fs.statSync);
  });
  afterEach(() => jest.restoreAllMocks());

  it('logs the case where there is no Copilot CLI at all', async () => {
    // The single most likely real failure: a student with neither Node nor the
    // CLI sends their first message.
    const { service, files } = makeService({ copilotCliPath: '' });

    const chunks = await drain(service.query('안녕'));

    expect(chunks.some((c) => c.type === 'error')).toBe(true);
    const logged = await entries(files);
    expect(logged).toHaveLength(1);
    expect(logged[0]).toMatchObject({ provider: 'copilot', stage: 'resolve' });
  });

  it('logs a spawn that throws synchronously, redacted', async () => {
    // Windows EINVAL on the `.cmd` shim class: child.on('error') never fires, so
    // without this the failure exists only in the chat bubble.
    const { service, files } = makeService({ copilotCliPath: '/usr/local/bin/copilot' });
    jest.spyOn(childProcess, 'spawn').mockImplementation(() => {
      throw new Error(`spawn EINVAL (token ${TOKEN})`);
    });

    const chunks = await drain(service.query('안녕'));

    expect(chunks.some((c) => c.type === 'error')).toBe(true);
    const logged = await entries(files);
    const launch = logged.find((e) => e.stage === 'launch');
    expect(launch).toBeDefined();
    expect(launch?.provider).toBe('copilot');
    expect(launch?.message).not.toContain(TOKEN);
    expect(launch?.message).toContain('EINVAL');
  });

  it('redacts the native launch failure it writes to the log', async () => {
    // Its three siblings — empty-answer, exit, and the copilot exit — redact.
    // This one did not, so a credential echoed by a failing spawn reached the
    // copy button in plain text, breaking the log's own invariant.
    const { service, files } = makeService({
      selectedProvider: 'claude',
      providerCliPaths: { claude: process.platform === 'win32' ? 'C:\\Users\\s\\claude.exe' : '/usr/local/bin/claude' },
      blanketWriteAcknowledged: ['claude'],
    });
    jest.spyOn(childProcess, 'spawn').mockImplementation(() => {
      throw new Error(`spawn failed with ${TOKEN}`);
    });

    await drain(service.query('안녕'));

    const launch = (await entries(files)).find((e) => e.stage === 'launch');
    expect(launch?.message).not.toContain(TOKEN);
  });

  it('keeps the student\'s real name out of the message it persists', async () => {
    // The failure message carries the working directory, and the vault sits
    // under the home folder — so an unmasked message hands over the student's
    // account name to whoever reads the log. Masking the two path fields was
    // never enough; the message is a path field too.
    const { service, files } = makeService({ copilotCliPath: '/usr/local/bin/copilot' });
    jest.spyOn(childProcess, 'spawn').mockImplementation(() => { throw new Error('spawn EINVAL'); });

    await drain(service.query('안녕'));

    const launch = (await entries(files)).find((e) => e.stage === 'launch');
    expect(launch?.message).not.toContain(os.homedir());
    expect(launch?.message).toContain('~');
  });

  it('does not take the request down when the vault refuses an adapter', async () => {
    // The arguments are evaluated before the logger's own guard is entered, so a
    // throwing `getAdapter()` would escape into the student's request.
    const { service } = makeService({ copilotCliPath: '' });
    (service as unknown as { plugin: { storage: { getAdapter: () => never } } }).plugin.storage = {
      getAdapter: () => { throw new Error('vault not ready'); },
    };

    const chunks = await drain(service.query('안녕'));

    expect(chunks.some((c) => c.type === 'error')).toBe(true);
  });
});

