/**
 * Tests for InstructionRefineService - write-authority counter coverage.
 *
 * `sendMessage()` streams through the same `agentService.streamQuery` child-process
 * path as the chat and inline-edit flows, so it must hold the plugin's write-authority
 * counter (`setBashExpansionActive`) for the whole stream and release it unconditionally.
 */
import { InstructionRefineService } from '@/features/chat/services/InstructionRefineService';

function buildPlugin(streamQueryImpl: () => AsyncGenerator<string>) {
  return {
    agentService: {
      streamQuery: jest.fn().mockImplementation(streamQueryImpl),
    },
    setBashExpansionActive: jest.fn(),
  } as any;
}

describe('InstructionRefineService - write-authority counter', () => {
  it('locks the toggle while the stream runs and releases it once the stream completes', async () => {
    let busy = false;
    let busyMidStream: boolean | null = null;
    const plugin = buildPlugin(() => (async function* () {
      busyMidStream = busy;
      yield '<instruction>refined</instruction>';
    })());
    plugin.setBashExpansionActive.mockImplementation((active: boolean) => { busy = active; });

    const service = new InstructionRefineService(plugin);
    const result = await service.refineInstruction('raw instruction', 'existing');

    expect(busyMidStream).toBe(true);
    expect(busy).toBe(false);
    expect(plugin.setBashExpansionActive).toHaveBeenNthCalledWith(1, true);
    expect(plugin.setBashExpansionActive).toHaveBeenNthCalledWith(2, false);
    expect(result).toEqual({ success: true, refinedInstruction: 'refined' });
  });

  it('releases the toggle even when the stream throws', async () => {
    const plugin = buildPlugin(() => (async function* () {
      throw new Error('CLI crashed');
      // eslint-disable-next-line no-unreachable
      yield 'unreachable';
    })());

    const service = new InstructionRefineService(plugin);
    const result = await service.refineInstruction('raw instruction', 'existing');

    expect(result).toEqual({ success: false, error: 'CLI crashed' });
    expect(plugin.setBashExpansionActive).toHaveBeenNthCalledWith(1, true);
    expect(plugin.setBashExpansionActive).toHaveBeenNthCalledWith(2, false);
  });
});
