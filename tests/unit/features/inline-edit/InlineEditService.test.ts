/**
 * Tests for InlineEditService - write-authority counter coverage.
 *
 * `sendMessage()` streams through the same `agentService.streamQuery` child-process
 * path as the chat and instruction-refine flows, so it must hold the plugin's
 * write-authority counter (`setBashExpansionActive`) for the whole stream and release
 * it unconditionally, including when the stream throws.
 */
import { InlineEditService } from '@/features/inline-edit/InlineEditService';

function buildPlugin(streamQueryImpl: () => AsyncGenerator<string>) {
  return {
    agentService: {
      streamQuery: jest.fn().mockImplementation(streamQueryImpl),
    },
    setBashExpansionActive: jest.fn(),
  } as any;
}

describe('InlineEditService - write-authority counter', () => {
  it('locks the toggle while the stream runs and releases it once the stream completes', async () => {
    let busy = false;
    let busyMidStream: boolean | null = null;
    const plugin = buildPlugin(() => (async function* () {
      busyMidStream = busy;
      yield '<replacement>done</replacement>';
    })());
    plugin.setBashExpansionActive.mockImplementation((active: boolean) => { busy = active; });

    const service = new InlineEditService(plugin);
    const result = await service.continueConversation('refine this');

    expect(busyMidStream).toBe(true);
    expect(busy).toBe(false);
    expect(plugin.setBashExpansionActive).toHaveBeenNthCalledWith(1, true);
    expect(plugin.setBashExpansionActive).toHaveBeenNthCalledWith(2, false);
    expect(result).toEqual({ success: true, editedText: 'done' });
  });

  it('releases the toggle even when the stream throws', async () => {
    const plugin = buildPlugin(() => (async function* () {
      throw new Error('CLI crashed');
      // eslint-disable-next-line no-unreachable
      yield 'unreachable';
    })());

    const service = new InlineEditService(plugin);
    const result = await service.continueConversation('refine this');

    expect(result).toEqual({ success: false, error: 'CLI crashed' });
    expect(plugin.setBashExpansionActive).toHaveBeenNthCalledWith(1, true);
    expect(plugin.setBashExpansionActive).toHaveBeenNthCalledWith(2, false);
  });

  it('releases the toggle on the mid-stream cancel path', async () => {
    const holder: { service?: InlineEditService } = {};
    const plugin = buildPlugin(() => (async function* () {
      yield 'partial';
      // Simulate the user cancelling while the stream is still in flight.
      holder.service?.cancel();
      yield 'more';
    })());
    const service = new InlineEditService(plugin);
    holder.service = service;

    const result = await service.continueConversation('refine this');

    expect(result).toEqual({ success: false, error: 'Cancelled' });
    expect(plugin.setBashExpansionActive).toHaveBeenNthCalledWith(1, true);
    expect(plugin.setBashExpansionActive).toHaveBeenNthCalledWith(2, false);
  });
});
