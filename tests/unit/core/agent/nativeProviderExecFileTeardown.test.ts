import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { CopilotBridgeService } from '@/core/agent/CopilotBridgeService';
import { DEFAULT_SETTINGS } from '@/core/types/settings';
import type ObsidianCopilotPlugin from '@/main';

/**
 * Two sites in CopilotBridgeService used `execFile` instead of `spawn`: the
 * copilot `--help all` capability probe, and `listNativeProviderModels` (the
 * `agy models` / `codex debug models` listing behind the model picker). Both
 * had neither the process-group teardown nor `detached`.
 *
 * Unlike the `spawn` sites covered in providerProcessTeardown.test.ts, adding
 * `detached: true` to `execFile`'s options does nothing — Node's own
 * `execFile` only forwards cwd/env/gid/shell/signal/uid/windowsHide to the
 * spawn() it wraps and silently drops everything else, confirmed by spawning
 * a child with `execFile(..., { detached: true })` and reading back its pgid:
 * it matched the parent's group, not its own pid. Passing a non-detached
 * child's pid to `killTree`'s POSIX branch would also have been actively
 * dangerous: `process.kill(-pid, ...)` targets *this* process's own group
 * when the child was never made a group leader. So both sites were converted
 * to `spawn` with manual stdout/stderr aggregation, matching the pattern
 * already used elsewhere in this file, with `killTree` on every settle path.
 */
const write = (dir: string, name: string, body: string): string => {
  const p = path.join(dir, name);
  fs.writeFileSync(p, `#!/bin/sh\n${body}\n`);
  fs.chmodSync(p, 0o755);
  return p;
};

const makeCopilotService = (cliPath: string, vault: string) =>
  new CopilotBridgeService(
    {
      settings: { ...DEFAULT_SETTINGS, selectedProvider: 'copilot', copilotCliPath: cliPath },
      app: { vault: { adapter: { basePath: vault } } },
      getActiveEnvironmentVariables: () => '',
    } as unknown as ObsidianCopilotPlugin
  );

const makeAgyService = (cliPath: string, vault: string) =>
  new CopilotBridgeService(
    {
      settings: { ...DEFAULT_SETTINGS, selectedProvider: 'agy', providerCliPaths: { agy: cliPath } },
      app: { vault: { adapter: { basePath: vault } } },
      getActiveEnvironmentVariables: () => '',
    } as unknown as ObsidianCopilotPlugin
  );

const maybe = process.platform === 'win32' ? describe.skip : describe;

maybe('capability probe (--help all): process-group teardown of backgrounded children', () => {
  let dir: string;
  beforeAll(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-probe-teardown-')); });
  afterAll(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  async function drain(service: CopilotBridgeService): Promise<string> {
    let text = '';
    for await (const chunk of service.query('hello')) {
      if (chunk.type === 'text') text += chunk.content;
    }
    return text;
  }

  it("reaps the reviewer's backgrounded child once the --help probe settles", async () => {
    const proofFile = path.join(dir, 'cap-probe-proof.txt');
    const cli = write(dir, 'copilot-cap-detach.sh', [
      'if [ "$1" = "--help" ]; then',
      `  sh -c 'sleep 0.3; printf x >> "${proofFile}"' >/dev/null 2>&1 &`,
      "  printf 'no special flags here\\n'",
      '  exit 0',
      'fi',
      "printf 'ok\\n'",
    ].join('\n'));
    const service = makeCopilotService(cli, dir);

    await drain(service);

    // Past the 0.3s delay: if the group survived the probe's own exit, the
    // grandchild would have written by now.
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(fs.existsSync(proofFile)).toBe(false);
  });

  it('still parses the full probe output for capability detection (teardown does not truncate it)', async () => {
    // Pad the help text so it arrives across more than one stdout chunk, and
    // put the marker capability at the tail — an early cutoff from the new
    // teardown would lose it, and the real invocation below would never see
    // `--stream on` in its argv.
    const padding = 'x'.repeat(200_000);
    const cli = write(dir, 'copilot-cap-normal.sh', [
      'if [ "$1" = "--help" ]; then',
      `  printf '%s\\n--stream  stream output\\n' '${padding}'`,
      '  exit 0',
      'fi',
      'printf \'ARGS:%s\\n\' "$*"',
    ].join('\n'));
    const service = makeCopilotService(cli, dir);

    const text = await drain(service);

    expect(text).toContain('--stream on');
  });
});

maybe('listNativeProviderModels: process-group teardown of backgrounded children', () => {
  let dir: string;
  beforeAll(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'model-list-teardown-')); });
  afterAll(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  it("reaps the reviewer's backgrounded child once the model listing settles", async () => {
    const proofFile = path.join(dir, 'model-list-proof.txt');
    const cli = write(dir, 'agy-models-detach.sh', [
      `sh -c 'sleep 0.3; printf x >> "${proofFile}"' >/dev/null 2>&1 &`,
      "printf 'model-a\\tModel A\\n'",
    ].join('\n'));
    const service = makeAgyService(cli, dir);

    await service.listNativeProviderModels('agy');

    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(fs.existsSync(proofFile)).toBe(false);
  });

  it('still returns the full model list for an ordinary listing (teardown does not truncate output)', async () => {
    const cli = write(dir, 'agy-models-normal.sh',
      "printf 'model-a\\tModel A\\nmodel-b\\tModel B\\n'");
    const service = makeAgyService(cli, dir);

    const models = await service.listNativeProviderModels('agy');

    expect(models).toEqual([
      { id: 'model-a', label: 'Model A', efforts: [] },
      { id: 'model-b', label: 'Model B', efforts: [] },
    ]);
  });
});
