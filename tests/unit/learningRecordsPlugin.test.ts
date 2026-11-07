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
