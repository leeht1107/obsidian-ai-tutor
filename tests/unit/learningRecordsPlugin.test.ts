/**
 * Plugin-level storage acknowledgement for learning snapshots (src/main.ts) and the real
 * session JSONL round trip. A snapshot is only "there" after the file write resolved.
 */
jest.mock('@/ui/modals/InlineEditModal', () => ({
  InlineEditModal: jest.fn(),
  cancelActiveInlineEdit: jest.fn(),
}));

import type { CompletedLearningSnapshot } from '@/core/learning/records';
import { SessionStorage } from '@/core/storage/SessionStorage';
import type { VaultFileAdapter } from '@/core/storage/VaultFileAdapter';
import { type Conversation,DEFAULT_SETTINGS } from '@/core/types';
import ObsidianCopilotPlugin from '@/main';

const SNAPSHOT: CompletedLearningSnapshot = {
  version: 1,
  conversationId: 'conv-1',
  completionMessageId: 'a2',
  mode: 'socratic',
  origin: 'socratic',
  learningSessionId: 'u1',
  completedAt: 1,
  sourcePaths: ['과목A/노트.md'],
  scopeLabel: '/socratic',
  questions: [],
  summaryMessageId: 'a2',
  reportOrigin: 'ai-draft',
};

function conversation(): Conversation {
  return {
    id: 'conv-1', title: 't', createdAt: 1, updatedAt: 1, sessionId: null,
    messages: [
      { id: 'u1', role: 'user', content: 'hi', timestamp: 1 },
      { id: 'a2', role: 'assistant', content: '##SOCRATIC_SUMMARY##\n요약', timestamp: 2 },
    ],
  };
}

function buildPlugin(saveConversation: jest.Mock) {
  const plugin = new ObsidianCopilotPlugin({ workspace: { getLeavesOfType: jest.fn().mockReturnValue([]) } } as any, { id: 'x', version: '0' } as any);
  plugin.settings = { ...DEFAULT_SETTINGS };
  plugin.storage = { sessions: { saveConversation }, updateState: jest.fn() } as any;
  const conv = conversation();
  (plugin as any).conversations = [conv];
  return { plugin, conv };
}

describe('learning snapshot persistence on the plugin', () => {
  it('exposes the snapshot only after the write is acknowledged', async () => {
    const save = jest.fn().mockResolvedValue(undefined);
    const { plugin, conv } = buildPlugin(save);
    const seen: string[] = [];
    plugin.onLearningSnapshotCommitted((_c, messageId) => seen.push(messageId));

    expect(await plugin.attachLearningSnapshot('conv-1', 'a2', SNAPSHOT)).toBe(true);
    expect(plugin.getLearningSnapshot('conv-1', 'a2')).toEqual(SNAPSHOT);
    expect(conv.messages[1].learningSnapshot).toEqual(SNAPSHOT);
    expect(save).toHaveBeenCalledTimes(1);
    expect(seen).toEqual(['a2']);
  });

  it('leaves no snapshot in the cache when the write fails', async () => {
    const save = jest.fn().mockRejectedValue(new Error('disk full'));
    const { plugin, conv } = buildPlugin(save);
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const heard = jest.fn();
    plugin.onLearningSnapshotCommitted(heard);

    expect(await plugin.attachLearningSnapshot('conv-1', 'a2', SNAPSHOT)).toBe(false);
    expect(plugin.getLearningSnapshot('conv-1', 'a2')).toBeNull();
    expect(conv.messages[1].learningSnapshot).toBeUndefined();
    expect(heard).not.toHaveBeenCalled();
  });

  it('does not acknowledge an unknown conversation or message', async () => {
    const save = jest.fn().mockResolvedValue(undefined);
    const { plugin } = buildPlugin(save);
    expect(await plugin.attachLearningSnapshot('nope', 'a2', SNAPSHOT)).toBe(false);
    expect(await plugin.attachLearningSnapshot('conv-1', 'nope', SNAPSHOT)).toBe(false);
    expect(save).not.toHaveBeenCalled();
  });

  it('commits updates only onto an existing snapshot and keeps the old one when the write fails', async () => {
    const save = jest.fn().mockResolvedValue(undefined);
    const { plugin } = buildPlugin(save);
    expect(await plugin.commitLearningSnapshot('conv-1', 'a2', (s) => s)).toBe(false);

    await plugin.attachLearningSnapshot('conv-1', 'a2', SNAPSHOT);
    save.mockRejectedValueOnce(new Error('io'));
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const updated = await plugin.commitLearningSnapshot('conv-1', 'a2', (s) => ({ ...s, saved: { path: 'p', recordId: 'r', contentFingerprint: 'f', savedAt: 1 } }));
    expect(updated).toBe(false);
    expect(plugin.getLearningSnapshot('conv-1', 'a2')?.saved).toBeUndefined();
  });

  it('shares one save service so duplicate clicks from any view meet', () => {
    const { plugin } = buildPlugin(jest.fn());
    expect(plugin.getLearningRecordSaveService()).toBe(plugin.getLearningRecordSaveService());
  });
});

describe('snapshot survives a restart through the real session file', () => {
  function memoryAdapter() {
    const files = new Map<string, string>();
    const adapter = {
      exists: async (p: string) => files.has(p),
      read: async (p: string) => files.get(p) as string,
      write: async (p: string, c: string) => { files.set(p, c); },
      delete: async (p: string) => { files.delete(p); },
      listFiles: async () => [...files.keys()],
    } as unknown as VaultFileAdapter;
    return { files, adapter };
  }

  it('round-trips the snapshot, pending save and saved reference', async () => {
    const { adapter } = memoryAdapter();
    const storage = new SessionStorage(adapter);
    const conv = conversation();
    conv.messages[1].learningSnapshot = {
      ...SNAPSHOT,
      pendingSave: {
        saveIntentId: 's', recordId: 'r', conversationId: 'conv-1', completionMessageId: 'a2', previewRevision: 1,
        folder: 'f', path: 'f/x.md', contentFingerprint: 'abc', frozenAt: 1,
      },
    };
    await storage.saveConversation(conv);
    const loaded = await storage.loadConversation('conv-1');
    expect(loaded?.messages[1].learningSnapshot).toEqual(conv.messages[1].learningSnapshot);
  });

  it('keeps legacy messages without a snapshot exactly legacy', async () => {
    const { adapter, files } = memoryAdapter();
    files.set('.ai-tutor/sessions/old.jsonl', [
      JSON.stringify({ type: 'meta', id: 'old', title: 'old', createdAt: 1, updatedAt: 1, sessionId: null }),
      JSON.stringify({ type: 'message', message: { id: 'a1', role: 'assistant', content: '##SOCRATIC_SUMMARY##\n요약', timestamp: 1, socraticTurn: { isSummary: true } } }),
    ].join('\n'));
    const loaded = await new SessionStorage(adapter).loadConversation('old');
    expect(loaded?.messages[0].learningSnapshot).toBeUndefined();
    expect(loaded?.messages[0].socraticTurn).toEqual({ isSummary: true });
  });
});

describe('one conversation, one ordered write stream (real plugin, real SessionStorage, gated adapter)', () => {
  interface Pending { path: string; content: string; release: () => void; fail: (error: Error) => void }

  function gatedStorage() {
    const files = new Map<string, string>();
    const pending: Pending[] = [];
    let gated = true;
    const adapter = {
      exists: async (p: string) => files.has(p),
      read: async (p: string) => files.get(p) as string,
      write: (path: string, content: string) => new Promise<void>((resolve, reject) => {
        if (!gated) { files.set(path, content); resolve(); return; }
        pending.push({ path, content, release: () => { files.set(path, content); resolve(); }, fail: reject });
      }),
      delete: async (p: string) => { files.delete(p); },
      listFiles: async () => [...files.keys()],
    } as unknown as VaultFileAdapter;
    const flush = () => new Promise<void>((resolve) => setImmediate(resolve));
    /** Completes every write that gets issued, in the given order, until none is left. */
    const drain = async (order: 'fifo' | 'lifo') => {
      await flush();
      while (pending.length > 0) {
        const next = order === 'fifo' ? pending.shift() : pending.pop();
        next?.release();
        await flush();
      }
    };
    return { files, pending, adapter, flush, drain, open: () => { gated = false; } };
  }

  function build() {
    const gate = gatedStorage();
    const storage = new SessionStorage(gate.adapter);
    const plugin = new ObsidianCopilotPlugin({ workspace: { getLeavesOfType: jest.fn().mockReturnValue([]) } } as any, { id: 'x', version: '0' } as any);
    plugin.settings = { ...DEFAULT_SETTINGS };
    plugin.storage = { sessions: storage, updateState: jest.fn() } as any;
    const conv = conversation();
    (plugin as any).conversations = [conv];
    const persisted = async () => storage.loadConversation('conv-1');
    return { plugin, conv, persisted, ...gate };
  }

  const later = { id: 'later', role: 'user' as const, content: 'keep my next message', timestamp: 3 };

  it('keeps a message added while a snapshot write is in flight — in the cache, in the file, and after a later title-only save', async () => {
    const t = build();
    const heard = jest.fn();
    t.plugin.onLearningSnapshotCommitted(heard);
    const snapshotWrite = t.plugin.attachLearningSnapshot('conv-1', 'a2', SNAPSHOT);
    await t.flush();
    const update = t.plugin.updateConversation('conv-1', { messages: [...t.conv.messages, later] });
    await t.drain('fifo');
    expect(await snapshotWrite).toBe(true);
    await update;

    expect(t.conv.messages.map((m) => m.id)).toEqual(['u1', 'a2', 'later']);
    expect(t.conv.messages[1].learningSnapshot).toEqual(SNAPSHOT);
    let stored = await t.persisted();
    expect(stored?.messages.map((m) => m.id)).toEqual(['u1', 'a2', 'later']);
    expect(stored?.messages[1].learningSnapshot).toEqual(SNAPSHOT);

    t.open();
    await t.plugin.renameConversation('conv-1', '새 제목');
    await t.plugin.updateConversation('conv-1', { titleGenerationStatus: 'success' });
    stored = await t.persisted();
    expect(stored?.title).toBe('새 제목');
    expect(stored?.messages.map((m) => m.id)).toEqual(['u1', 'a2', 'later']);
    expect(stored?.messages[1].learningSnapshot).toEqual(SNAPSHOT);
    expect(heard).toHaveBeenCalledTimes(1);
  });

  it('keeps the newest transcript when the storage completes writes in reverse order', async () => {
    const t = build();
    const first = t.plugin.updateConversation('conv-1', { messages: [...t.conv.messages, later] });
    const second = t.plugin.updateConversation('conv-1', { messages: [...t.conv.messages, { ...later, id: 'later2' }], sessionId: 'sess-2' });
    await t.drain('lifo');
    await Promise.all([first, second]);
    const stored = await t.persisted();
    expect(stored?.messages.map((m) => m.id)).toEqual(['u1', 'a2', 'later', 'later2']);
    expect(stored?.sessionId).toBe('sess-2');
  });

  it('writes one conversation strictly one at a time', async () => {
    const t = build();
    void t.plugin.updateConversation('conv-1', { sessionId: 's1' });
    void t.plugin.updateConversation('conv-1', { sessionId: 's2' });
    void t.plugin.renameConversation('conv-1', 'r');
    void t.plugin.attachLearningSnapshot('conv-1', 'a2', SNAPSHOT);
    await t.flush();
    expect(t.pending).toHaveLength(1);
    await t.drain('fifo');
  });

  it('never carries an older snapshot-less copy of a message over an acknowledged snapshot', async () => {
    const t = build();
    t.open();
    const staleMessages = t.conv.messages.map((m) => ({ ...m }));
    expect(await t.plugin.attachLearningSnapshot('conv-1', 'a2', SNAPSHOT)).toBe(true);
    await t.plugin.updateConversation('conv-1', { messages: [...staleMessages, later] });
    expect(t.conv.messages[1].learningSnapshot).toEqual(SNAPSHOT);
    expect((await t.persisted())?.messages[1].learningSnapshot).toEqual(SNAPSHOT);
  });

  it('a failed acknowledgement leaves no snapshot in the cache or file, and does not wedge later saves', async () => {
    const t = build();
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const heard = jest.fn();
    t.plugin.onLearningSnapshotCommitted(heard);
    const snapshotWrite = t.plugin.attachLearningSnapshot('conv-1', 'a2', SNAPSHOT);
    await t.flush();
    const update = t.plugin.updateConversation('conv-1', { messages: [...t.conv.messages, later] });
    t.pending.shift()?.fail(new Error('disk full'));
    expect(await snapshotWrite).toBe(false);
    await t.drain('fifo');
    await update;

    expect(heard).not.toHaveBeenCalled();
    expect(t.conv.messages[1].learningSnapshot).toBeUndefined();
    const stored = await t.persisted();
    expect(stored?.messages.map((m) => m.id)).toEqual(['u1', 'a2', 'later']);
    expect(stored?.messages[1].learningSnapshot).toBeUndefined();
  });

  it('a rejected ordinary save still lets the next save through', async () => {
    const t = build();
    const failing = t.plugin.updateConversation('conv-1', { sessionId: 'lost' });
    await t.flush();
    t.pending.shift()?.fail(new Error('io'));
    await expect(failing).rejects.toThrow('io');
    const next = t.plugin.updateConversation('conv-1', { sessionId: 'kept' });
    await t.drain('fifo');
    await next;
    expect((await t.persisted())?.sessionId).toBe('kept');
  });

  it('deleting a conversation waits for its in-flight write and nothing resurrects the file', async () => {
    const t = build();
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const snapshotWrite = t.plugin.attachLearningSnapshot('conv-1', 'a2', SNAPSHOT);
    await t.flush();
    const deletion = t.plugin.deleteConversation('conv-1');
    const lateUpdate = t.plugin.updateConversation('conv-1', { sessionId: 'after-delete' });
    await t.drain('lifo');
    await deletion;
    await lateUpdate;

    expect(await snapshotWrite).toBe(false);
    expect(t.files.size).toBe(0);
    expect(t.plugin.getConversationById('conv-1')).toBeNull();
    expect(t.plugin.getLearningSnapshot('conv-1', 'a2')).toBeNull();
  });

  it('a conversation recreated under the same id is not overwritten by a write queued for the deleted one', async () => {
    const t = build();
    const stale = t.plugin.updateConversation('conv-1', { messages: [...t.conv.messages, later] });
    await t.flush();
    const deletion = t.plugin.deleteConversation('conv-1');
    const recreated = { id: 'conv-1', title: 'recreated', createdAt: 9, updatedAt: 9, sessionId: null, messages: [] };
    (t.plugin as any).conversations.unshift(recreated);
    const fresh = t.plugin.updateConversation('conv-1', { title: 'recreated 2' });
    await t.drain('lifo');
    await Promise.all([stale, deletion, fresh]);

    const stored = await t.persisted();
    expect(stored?.title).toBe('recreated 2');
    expect(stored?.messages).toEqual([]);
  });

  it('positive control: strictly sequential saves behave as before', async () => {
    const t = build();
    t.open();
    await t.plugin.updateConversation('conv-1', { messages: [...t.conv.messages, later] });
    expect(await t.plugin.attachLearningSnapshot('conv-1', 'a2', SNAPSHOT)).toBe(true);
    const stored = await t.persisted();
    expect(stored?.messages.map((m) => m.id)).toEqual(['u1', 'a2', 'later']);
    expect(stored?.messages[1].learningSnapshot).toEqual(SNAPSHOT);
  });
});
