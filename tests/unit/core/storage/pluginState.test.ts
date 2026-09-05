/**
 * Concurrent writes to data.json.
 *
 * updateState is a read-modify-write: it loads the whole state, merges, and
 * saves it back. The settings tab now checks four providers at once and each
 * answer writes, so two updates can both read the pre-write state and the
 * slower one can save last — persisting a map that is missing the other
 * provider's verdict. Flagged by an independent reviewer; the failure is a
 * connection check that silently does not survive a restart.
 */
import { StorageService } from '@/core/storage';

function makeStorage(initial: Record<string, unknown>, readDelay: () => Promise<void>) {
  let stored: Record<string, unknown> = { ...initial };
  const plugin = {
    app: {},
    loadData: jest.fn(async () => { await readDelay(); return { ...stored }; }),
    saveData: jest.fn(async (data: Record<string, unknown>) => { stored = { ...data }; }),
  };
  return { storage: new StorageService(plugin as never), plugin, read: () => stored };
}

describe('StorageService.updateState under concurrency', () => {
  it('keeps both writes when two updates overlap', async () => {
    // The second read is slower, so an unserialised implementation saves the
    // older map last and drops the first provider.
    let reads = 0;
    const { storage, read } = makeStorage(
      { activeConversationId: null },
      () => new Promise<void>((resolve) => { setTimeout(resolve, reads++ === 0 ? 20 : 0); })
    );

    await Promise.all([
      storage.updateState({ providerConnections: { claude: { state: 'connected', at: 1 } } }),
      storage.updateState({ providerConnections: { codex: { state: 'connected', at: 2 } } }),
    ]);

    // Whichever landed last, the earlier write must not have been read away
    // before it was persisted.
    const state = read() as { providerConnections?: Record<string, unknown> };
    expect(Object.keys(state.providerConnections ?? {})).toContain('codex');
  });

  it('does not lose an unrelated field written by an overlapping update', async () => {
    let reads = 0;
    const { storage, read } = makeStorage(
      { activeConversationId: null },
      () => new Promise<void>((resolve) => { setTimeout(resolve, reads++ === 0 ? 20 : 0); })
    );

    await Promise.all([
      storage.updateState({ activeConversationId: 'conv-1' }),
      storage.updateState({ providerConnections: { copilot: { state: 'connected', at: 3 } } }),
    ]);

    const state = read() as { activeConversationId?: string | null; providerConnections?: unknown };
    expect(state.activeConversationId).toBe('conv-1');
    expect(state.providerConnections).toEqual({ copilot: { state: 'connected', at: 3 } });
  });
});
