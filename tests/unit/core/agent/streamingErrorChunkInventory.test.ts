/**
 * A tripwire, not a proof.
 *
 * Every failure the student is shown as a Notice goes through
 * `reportBlockingFailure`, so a new one cannot be added without a log entry.
 * The streaming chat failures deliberately do not: they are yielded `error`
 * chunks inside an async generator, and routing them through a Notice-shaped
 * seam would change control flow and chunk ordering in the one place that must
 * not change. That exception is the right call and it leaves a gap — the next
 * ordinary addition to this file can be silent again, exactly as three of them
 * were until 0.1.16.
 *
 * So the construction sites are counted instead. This does not prove any of them
 * logs; the behavioural tests beside it do that, one path at a time. It makes
 * adding a new one conspicuous: the count moves, this fails, and whoever added
 * it has to decide on purpose whether the student's failure is recorded.
 *
 * When that happens: add the logging if the student is shown the failure, then
 * update the number and the note below. Do not just bump the number.
 */
import * as fs from 'fs';
import * as path from 'path';

const SOURCE = path.join(__dirname, '../../../../src/core/agent/CopilotBridgeService.ts');

/**
 * 16 sites: the original logged branches plus explicit-tool policy rejections. Agy Web-OFF no longer creates an error
 * chunk or refuses to spawn; its limitation is communicated with a Notice while
 * the request proceeds with Web available.
 *
 * - 1 inside the copilot event translator (a `result` event carrying a non-zero
 *   exit code). A pure function with no access to the log; the `close` handler
 *   records the same run, which is why it is the exception and not a gap.
 * - 4 at the request level: no copilot CLI configured, unsupported zero-tool
 *   execution, an explicit Copilot allowlist emptied by Web policy, and anything
 *   thrown on the plugin's side. Both policy rejections call logError before yielding.
 * - 5 on the native path: CLI not found, nothing runnable resolved, a Windows
 *   command line too long to spawn, launch, and the shared structured-output
 *   failure branch.
 * - 6 on the copilot path: nothing runnable resolved, a Windows command line too
 *   long to spawn, a synchronous `spawn` throw, the asynchronous `error` event,
 *   exit, and empty-answer. Both too-long sites log in windowsCommandLineTooLong.
 */
const KNOWN_ERROR_CHUNK_SITES = 16;

describe('streaming error chunks', () => {
  it('has not grown a new construction site without someone deciding about the log', () => {
    const source = fs.readFileSync(SOURCE, 'utf-8');
    const sites = source.match(/type: 'error'/g) ?? [];

    expect(sites).toHaveLength(KNOWN_ERROR_CHUNK_SITES);
  });

  it('logs from every branch of the copilot close handler', () => {
    // The specific shape of the 0.1.15 gap: the exit entry was written only when
    // stderr had content, so a silent death produced a bubble and no record.
    const source = fs.readFileSync(SOURCE, 'utf-8');
    const closeHandler = source.slice(
      source.indexOf("child.on('close', (code, receivedSignal) => {"),
      source.indexOf("child.on('error', (err) => {")
    );

    expect(closeHandler).toContain("stage: 'exit'");
    expect(closeHandler).toContain("stage: 'empty-answer'");
    // Not conditioned on stderr having content.
    expect(closeHandler).not.toContain('if (code !== 0 && stderrBuffer.trim())');
  });
});
