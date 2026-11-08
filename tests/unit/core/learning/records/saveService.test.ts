import {
  discoverRecords,
  LearningRecordSaveService,
  MAX_RECORD_FILE_BYTES,
  parseRecordSummary,
  recordProblem,
  sha256,
} from '../../../../../src/core/learning/records';
import { MemoryFs, MemoryHost, quizSnapshot } from './helpers';

const MARKDOWN = '---\ntype: ai-tutor-learning-record\nformatVersion: 1\nrecordId: "lr-1"\n---\n\n# 기록\n';
const request = (overrides = {}) => ({
  conversationId: 'conv-1',
  completionMessageId: 'a3',
  folder: '.ai-tutor/learning-records',
  fileName: '2026-11-07 퀴즈',
  markdown: MARKDOWN,
  previewRevision: 1,
  ...overrides,
});
const PATH = '.ai-tutor/learning-records/2026-11-07 퀴즈.md';

function setup() {
  const fs = new MemoryFs();
  const host = new MemoryHost(quizSnapshot(), fs);
  return { fs, host, service: new LearningRecordSaveService(host) };
}

describe('LearningRecordSaveService', () => {
  it('acknowledges the pending intent before creating the note, then links it', async () => {
    const { fs, host, service } = setup();
    const order: string[] = [];
    const commit = host.commit;
    host.commit = async (...args) => {
      order.push(`commit(createCalls=${fs.createCalls})`);
      return commit(...args);
    };
    const outcome = await service.save(request());
    expect(outcome).toMatchObject({ kind: 'saved', path: PATH, recordId: 'lr-1' });
    expect(order).toEqual(['commit(createCalls=0)', 'commit(createCalls=1)']);
    expect(fs.files.get(PATH)).toBe(MARKDOWN);
    expect(host.snapshot?.pendingSave?.contentFingerprint).toBe(sha256(MARKDOWN));
    expect(host.snapshot?.saved?.path).toBe(PATH);
  });

  it('does not create the note when the intent acknowledgement fails', async () => {
    const { fs, host, service } = setup();
    host.failCommitAt = [1];
    expect(await service.save(request())).toEqual({ kind: 'rejected', reason: 'intent-not-acknowledged' });
    expect(fs.createCalls).toBe(0);
    expect(fs.files.size).toBe(0);
  });

  it('serialises duplicate clicks into one create', async () => {
    const { fs, service } = setup();
    const [a, b] = await Promise.all([service.save(request()), service.save(request())]);
    expect(a).toEqual(b);
    expect(fs.createCalls).toBe(1);
  });

  it('opens an exact existing target as already saved without rewriting it', async () => {
    const { fs, service } = setup();
    fs.files.set(PATH, MARKDOWN);
    expect(await service.save(request())).toEqual({ kind: 'already-saved', path: PATH });
    expect(fs.createCalls).toBe(0);
  });

  it('never overwrites or suffixes a differing file at the target', async () => {
    const { fs, service } = setup();
    fs.files.set(PATH, 'someone else wrote this');
    expect(await service.save(request())).toMatchObject({ kind: 'conflict', path: PATH });
    expect(fs.files.get(PATH)).toBe('someone else wrote this');
    expect([...fs.files.keys()]).toEqual([PATH]);
    expect(fs.createCalls).toBe(0);
  });

  it('treats a lost response with the file present as a verified save', async () => {
    const { fs, service } = setup();
    fs.failCreate = 'lost';
    expect(await service.save(request())).toMatchObject({ kind: 'saved', path: PATH });
  });

  it('reports an uncertain write when nothing was created and does not retry on its own', async () => {
    const { fs, host, service } = setup();
    fs.failCreate = 'throw';
    expect(await service.save(request())).toEqual({ kind: 'needs-fresh-choice', path: PATH, reason: 'write-uncertain' });
    expect(fs.createCalls).toBe(1);
    expect(host.snapshot?.saved).toBeUndefined();
    fs.failCreate = 'none';
    // Same-intent retry reconciles the exact target and sees it missing: no recreation.
    expect(await service.save(request())).toEqual({ kind: 'needs-fresh-choice', path: PATH, reason: 'missing-after-attempt' });
    expect(fs.createCalls).toBe(1);
    expect(fs.files.size).toBe(0);
  });

  it('does not recreate a note the student deleted after a known save', async () => {
    const { fs, service } = setup();
    await service.save(request());
    fs.files.delete(PATH);
    expect(await service.save(request())).toEqual({ kind: 'needs-fresh-choice', path: PATH, reason: 'missing-after-attempt' });
    expect(fs.files.size).toBe(0);
  });

  it('allows a new save only after an explicit fresh choice', async () => {
    const { fs, service } = setup();
    await service.save(request());
    fs.files.delete(PATH);
    const outcome = await service.save(request({ freshChoice: true, previewRevision: 2 }));
    expect(outcome).toMatchObject({ kind: 'saved', path: PATH });
    expect(fs.files.get(PATH)).toBe(MARKDOWN);
  });

  it('reports a student-edited retry target as a conflict and keeps the edit', async () => {
    const { fs, service } = setup();
    await service.save(request());
    fs.files.set(PATH, `${MARKDOWN}\n내가 고침`);
    expect(await service.save(request())).toMatchObject({ kind: 'conflict', path: PATH });
    expect(fs.files.get(PATH)).toBe(`${MARKDOWN}\n내가 고침`);
  });

  it('distinguishes note saved from history link failure and repairs only the link', async () => {
    const { fs, host, service } = setup();
    host.failCommitAt = [2];
    expect(await service.save(request())).toEqual({ kind: 'saved-link-failed', path: PATH });
    expect(fs.files.get(PATH)).toBe(MARKDOWN);
    expect(host.snapshot?.saved).toBeUndefined();
    expect(await service.repairLink('conv-1', 'a3')).toEqual({ kind: 'already-saved', path: PATH });
    expect(fs.createCalls).toBe(1);
    expect(host.snapshot?.saved?.path).toBe(PATH);
  });

  it('after a restart with a pending intent only inspects the exact target', async () => {
    const { fs, host, service } = setup();
    host.snapshot = quizSnapshot({
      pendingSave: {
        saveIntentId: 's', recordId: 'lr-1', conversationId: 'conv-1', completionMessageId: 'a3',
        previewRevision: 1, folder: '.ai-tutor/learning-records', path: PATH, contentFingerprint: sha256(MARKDOWN), frozenAt: 1,
      },
    });
    expect(await service.inspect('conv-1', 'a3')).toEqual({ kind: 'pending', path: PATH, target: 'absent' });
    fs.files.set(PATH, MARKDOWN);
    expect(await service.inspect('conv-1', 'a3')).toEqual({ kind: 'pending', path: PATH, target: 'match' });
    expect(fs.createCalls).toBe(0);
  });

  it('rejects paths that leave the record folder and unknown snapshots', async () => {
    const { fs, service } = setup();
    expect(await service.save(request({ fileName: '../evil' }))).toEqual({ kind: 'rejected', reason: 'invalid-path' });
    expect(await service.save(request({ folder: '../outside' }))).toEqual({ kind: 'rejected', reason: 'invalid-path' });
    expect(fs.files.size).toBe(0);
    const orphan = new LearningRecordSaveService(new MemoryHost(null, fs));
    expect(await orphan.save(request())).toEqual({ kind: 'rejected', reason: 'no-snapshot' });
  });

  it('leaves unrelated files alone', async () => {
    const { fs, service } = setup();
    fs.files.set('.ai-tutor/learning-records/other.md', 'keep');
    fs.files.set('과목A/노트1.md', 'course');
    await service.save(request());
    expect(fs.files.get('.ai-tutor/learning-records/other.md')).toBe('keep');
    expect(fs.files.get('과목A/노트1.md')).toBe('course');
  });
});

describe('an edited record must stay a record the vault can find again', () => {
  const INVALID: Array<[string, string]> = [
    ['no frontmatter at all', '# 내가 편집한 기록\n\n본문만 남김'],
    ['recordId deleted', MARKDOWN.replace('recordId: "lr-1"\n', '')],
    ['recordId emptied', MARKDOWN.replace('"lr-1"', '""')],
    ['recordId no longer a JSON string', MARKDOWN.replace('"lr-1"', 'lr-1')],
    ['type deleted', MARKDOWN.replace('type: ai-tutor-learning-record\n', '')],
    ['type changed', MARKDOWN.replace('ai-tutor-learning-record', 'note')],
    ['formatVersion changed', MARKDOWN.replace('formatVersion: 1', 'formatVersion: 2')],
    ['too large to be discovered again', `${MARKDOWN}${'x'.repeat(MAX_RECORD_FILE_BYTES)}`],
  ];

  it.each(INVALID)('%s: rejects before the intent is staged or any file is created', async (_name, markdown) => {
    const { fs, host, service } = setup();
    expect(await service.save(request({ markdown }))).toEqual({ kind: 'rejected', reason: 'invalid-record' });
    expect(fs.createCalls).toBe(0);
    expect(fs.files.size).toBe(0);
    expect(host.commits).toBe(0);
    expect(host.snapshot?.pendingSave).toBeUndefined();
    expect(host.snapshot?.saved).toBeUndefined();
  });

  it('also rejects when the student chose to save again after an unresolved attempt', async () => {
    const { fs, host, service } = setup();
    expect(await service.save(request({ markdown: '# 본문만', freshChoice: true }))).toEqual({ kind: 'rejected', reason: 'invalid-record' });
    expect(fs.createCalls).toBe(0);
    expect(host.commits).toBe(0);
  });

  it('positive control: an edited but still valid record is saved with exactly the approved bytes and is discoverable', async () => {
    const { fs, service } = setup();
    const edited = MARKDOWN.replace('# 기록', '# 내가 고친 제목\n\n내 메모');
    const outcome = await service.save(request({ markdown: edited }));
    expect(outcome).toMatchObject({ kind: 'saved', path: PATH, recordId: 'lr-1' });
    expect(fs.files.get(PATH)).toBe(edited);
    const found = await discoverRecords(fs, '.ai-tutor/learning-records');
    expect(found.records.map((r) => [r.path, r.recordId])).toEqual([[PATH, 'lr-1']]);
  });

  it('keeps read-only reconciliation of an earlier attempt independent of the new check', async () => {
    const { fs, host, service } = setup();
    expect(await service.save(request())).toMatchObject({ kind: 'saved' });
    expect(await service.save(request({ markdown: '# 본문만' }))).toEqual({ kind: 'already-saved', path: PATH });
    expect(fs.createCalls).toBe(1);
    expect(host.snapshot?.saved?.path).toBe(PATH);
  });

  it('recordProblem agrees with parseRecordSummary on what counts as a record', () => {
    for (const [, markdown] of INVALID) {
      const summary = parseRecordSummary('p.md', markdown, new TextEncoder().encode(markdown).length);
      const tooLarge = new TextEncoder().encode(markdown).length > MAX_RECORD_FILE_BYTES;
      expect(recordProblem(markdown)).not.toBeNull();
      expect(summary === null || tooLarge).toBe(true);
    }
    expect(recordProblem(MARKDOWN)).toBeNull();
    expect(parseRecordSummary('p.md', MARKDOWN, MARKDOWN.length)).not.toBeNull();
  });
});
