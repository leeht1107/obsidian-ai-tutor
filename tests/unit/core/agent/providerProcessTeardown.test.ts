import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { CopilotBridgeService } from '@/core/agent/CopilotBridgeService';
import { DEFAULT_SETTINGS } from '@/core/types/settings';
import type ObsidianCopilotPlugin from '@/main';

/**
 * A native provider CLI never got the every-settle process-group teardown that
 * `defaultBashRunner` (see SlashCommandManager.test.ts) already has. An
 * adversarial reviewer demonstrated it: a custom CLI path can point at a
 * wrapper that backgrounds a second invocation, print a valid answer, and
 * exit — the parent settles and the write-authority counter unlocks, but the
 * backgrounded process (holding whatever permission the request was granted)
 * keeps running. These tests reproduce that shape against `querySelectedProvider`
 * and confirm a normal answer is never truncated by the new teardown.
 */
const write = (dir: string, name: string, body: string): string => {
  const p = path.join(dir, name);
  fs.writeFileSync(p, `#!/bin/sh\n${body}\n`);
  fs.chmodSync(p, 0o755);
  return p;
};

const makeService = (cliPath: string, vault: string) =>
  new CopilotBridgeService(
    {
      settings: { ...DEFAULT_SETTINGS, selectedProvider: 'agy', providerCliPaths: { agy: cliPath } },
      app: { vault: { adapter: { basePath: vault } } },
      getActiveEnvironmentVariables: () => '',
    } as unknown as ObsidianCopilotPlugin
  );

const maybe = process.platform === 'win32' ? describe.skip : describe;

maybe('querySelectedProvider: process-group teardown of backgrounded children', () => {
  let dir: string;
  beforeAll(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'provider-teardown-')); });
  afterAll(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  async function drain(service: CopilotBridgeService): Promise<string> {
    let text = '';
    for await (const chunk of service.query('hello')) {
      if (chunk.type === 'text') text += chunk.content;
    }
    return text;
  }

  it("reaps the reviewer's backgrounded child once the request settles", async () => {
    const proofFile = path.join(dir, 'delayed-proof.txt');
    // Prints an answer immediately, like the reviewer's wrapper, then leaves a
    // detached grandchild running past the parent's own exit.
    const cli = write(dir, 'provider-detach.sh',
      `sh -c 'sleep 0.3; printf x >> "${proofFile}"' >/dev/null 2>&1 &\nprintf 'ok\\n'`);
    const service = makeService(cli, dir);

    await drain(service);

    // Past the 0.3s delay: if the group survived the parent's exit, the
    // grandchild would have written by now.
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(fs.existsSync(proofFile)).toBe(false);
  });

  it('still returns the full answer for an ordinary request (teardown does not truncate output)', async () => {
    const cli = write(dir, 'provider-normal.sh', `printf 'line one\\nline two\\n'`);
    const service = makeService(cli, dir);

    const text = await drain(service);

    expect(text).toBe('line one\nline two\n');
  });
});

// spawnCopilot is a second, independent spawn site (the copilot path itself,
// vs. the generic native-provider path above) and needed the identical fix.
// query() first probes `--help all` to detect CLI capabilities before the
// real invocation — the script below only backgrounds on the real call, so
// the capability probe's own child (also covered, see
// nativeProviderExecFileTeardown.test.ts) can't confound the assertion.
const makeCopilotService = (cliPath: string, vault: string) =>
  new CopilotBridgeService(
    {
      settings: { ...DEFAULT_SETTINGS, selectedProvider: 'copilot', copilotCliPath: cliPath },
      app: { vault: { adapter: { basePath: vault } } },
      getActiveEnvironmentVariables: () => '',
    } as unknown as ObsidianCopilotPlugin
  );

maybe('spawnCopilot (copilot path): process-group teardown of backgrounded children', () => {
  let dir: string;
  beforeAll(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'copilot-teardown-')); });
  afterAll(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  async function drain(service: CopilotBridgeService): Promise<string> {
    let text = '';
    for await (const chunk of service.query('hello')) {
      if (chunk.type === 'text') text += chunk.content;
    }
    return text;
  }

  it("reaps the reviewer's backgrounded child once the copilot request settles", async () => {
    const proofFile = path.join(dir, 'delayed-proof.txt');
    const cli = write(dir, 'copilot-detach.sh', [
      'if [ "$1" = "--help" ]; then',
      '  printf \'no special flags here\\n\'',
      '  exit 0',
      'fi',
      `sh -c 'sleep 0.3; printf x >> "${proofFile}"' >/dev/null 2>&1 &`,
      "printf 'ok\\n'",
    ].join('\n'));
    const service = makeCopilotService(cli, dir);

    await drain(service);

    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(fs.existsSync(proofFile)).toBe(false);
  });

  it('still returns the full answer for an ordinary copilot request (teardown does not truncate output)', async () => {
    const cli = write(dir, 'copilot-normal.sh', [
      'if [ "$1" = "--help" ]; then',
      '  printf \'no special flags here\\n\'',
      '  exit 0',
      'fi',
      "printf 'line one\\nline two\\n'",
    ].join('\n'));
    const service = makeCopilotService(cli, dir);

    const text = await drain(service);

    expect(text).toBe('line one\nline two\n');
  });
});
