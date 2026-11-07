import type {
  CompletedLearningSnapshot,
  RecordFs,
} from '../../../../../src/core/learning/records';
import type { ChatMessage, Conversation } from '../../../../../src/core/types';

/** In-memory vault. Folders are implied by file paths plus explicit mkdirs. */
export class MemoryFs implements RecordFs {
  files = new Map<string, string>();
  folders = new Set<string>();
  createCalls = 0;
  /** 'throw': create fails with nothing written. 'lost': file is written but the call rejects. */
  failCreate: 'none' | 'throw' | 'lost' = 'none';

  async exists(path: string): Promise<boolean> {
    return this.files.has(path) || this.folders.has(path) || [...this.files.keys()].some((f) => f.startsWith(`${path}/`));
  }
  async read(path: string): Promise<string> {
    const text = this.files.get(path);
    if (text === undefined) throw new Error(`ENOENT ${path}`);
    return text;
  }
  async list(folder: string): Promise<{ files: string[]; folders: string[] }> {
    const files: string[] = [];
    const folders = new Set<string>();
    for (const file of this.files.keys()) {
      if (!file.startsWith(`${folder}/`)) continue;
      const rest = file.slice(folder.length + 1);
      if (rest.includes('/')) folders.add(`${folder}/${rest.split('/')[0]}`);
      else files.push(file);
    }
    return { files, folders: [...folders] };
  }
  async stat(path: string): Promise<{ size: number } | null> {
    const text = this.files.get(path);
    return text === undefined ? null : { size: Buffer.byteLength(text) };
  }
  async createOnly(path: string, content: string): Promise<void> {
    this.createCalls += 1;
    if (this.failCreate === 'throw') throw new Error('disk error');
    if (this.files.has(path)) throw new Error('exists');
    this.files.set(path, content);
    if (this.failCreate === 'lost') throw new Error('response lost');
  }
}

export function msg(id: string, role: 'user' | 'assistant', content: string, extra: Partial<ChatMessage> = {}): ChatMessage {
  return { id, role, content, timestamp: 1, contentBlocks: role === 'assistant' ? [{ type: 'text', content }] : undefined, ...extra };
}

export function quizSnapshot(overrides: Partial<CompletedLearningSnapshot> = {}): CompletedLearningSnapshot {
  return {
    version: 1,
    conversationId: 'conv-1',
    completionMessageId: 'a3',
    mode: 'quiz',
    origin: 'quiz',
    learningSessionId: 'u1',
    completedAt: 10,
    sourcePaths: ['과목A/노트1.md'],
    scopeLabel: '/quiz · 노트 · 노트1.md',
    totalQuestions: 2,
    questions: [
      { questionNumber: 1, questionMessageId: 'a1', answerMessageId: 'u2', feedbackMessageId: 'a2' },
      { questionNumber: 2, questionMessageId: 'a2', answerMessageId: 'u3', feedbackMessageId: 'a3' },
    ],
    reportOrigin: 'ai-draft',
    ...overrides,
  };
}

export function quizConversation(): Conversation {
  const messages: ChatMessage[] = [
    msg('u1', 'user', '/quiz 시작'),
    msg('a1', 'assistant', '## 1/2번 문제\n\n#### 1+1은?\n\nA. 1\nB. 2'),
    msg('u2', 'user', 'B'),
    msg('a2', 'assistant', '### 정답 확인\n- 정오: 정답\n\n---\n\n## 2/2번 문제\n\n#### 2+2는?\n\nA. 3\nB. 4'),
    msg('u3', 'user', 'A'),
    msg('a3', 'assistant', '### 정답 확인\n- 정오: 오답\n\n### 학습 요약 (AI 초안)\n- 덧셈을 복습하세요'),
  ];
  return { id: 'conv-1', title: 't', createdAt: 1, updatedAt: 1, sessionId: null, messages };
}

/** Host whose commit goes through a controllable fake store. */
export class MemoryHost {
  snapshot: CompletedLearningSnapshot | null;
  commits = 0;
  failCommitAt: number[] = [];
  constructor(snapshot: CompletedLearningSnapshot | null, public fs = new MemoryFs()) {
    this.snapshot = snapshot;
  }
  getSnapshot = () => this.snapshot;
  commit = async (_c: string, _m: string, update: (s: CompletedLearningSnapshot) => CompletedLearningSnapshot) => {
    this.commits += 1;
    if (this.failCommitAt.includes(this.commits) || !this.snapshot) return false;
    this.snapshot = update(this.snapshot);
    return true;
  };
}
