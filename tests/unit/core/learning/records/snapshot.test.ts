import { buildQuizSnapshot, buildSocraticSnapshot, collectQuizQuestionRefs } from '../../../../../src/core/learning/records';
import type { ChatMessage } from '../../../../../src/core/types';
import { msg } from './helpers';

const q = (n: number, total = 3) => ({ current: n, total, multiSelect: false, freeText: false, options: [{ label: 'A', text: 'x' }] });
const done = (id: string, content: string, extra: Partial<ChatMessage> = {}) =>
  msg(id, 'assistant', content, { requestOutcome: 'completed', ...extra });

const session = { conversationId: 'c1', learningSessionId: 'u0', scopeLabel: '/quiz', sourcePaths: ['a.md'], totalQuestions: 3 };

function transcript(): ChatMessage[] {
  return [
    msg('u0', 'user', '/quiz'),
    done('a1', '## 1/3번 문제', { quizQuestion: q(1) }),
    msg('u1', 'user', '힌트 주세요', { quizHint: true }),
    done('ah', '힌트: ...', { quizQuestion: q(1) }),
    msg('u2', 'user', 'B'),
    done('a2', '### 정답 확인\n\n## 2/3번 문제', { quizQuestion: q(2) }),
    msg('u3', 'user', 'C'),
    done('a3', '### 정답 확인\n\n## 3/3번 문제', { quizQuestion: q(3) }),
    msg('u4', 'user', 'A'),
    done('a4', '### 정답 확인\n\n### 학습 요약 (AI 초안)\n- 요약', { quizQuestion: null }),
  ];
}

describe('quiz snapshot', () => {
  it('binds each question to its own answer and feedback and skips hint turns', () => {
    expect(collectQuizQuestionRefs(transcript())).toEqual([
      { questionNumber: 1, questionMessageId: 'a1', answerMessageId: 'u2', feedbackMessageId: 'a2' },
      { questionNumber: 2, questionMessageId: 'a2', answerMessageId: 'u3', feedbackMessageId: 'a3' },
      { questionNumber: 3, questionMessageId: 'a3', answerMessageId: 'u4', feedbackMessageId: 'a4' },
    ]);
  });

  it('leaves unanswered questions without answer or feedback refs', () => {
    const refs = collectQuizQuestionRefs(transcript().slice(0, 2));
    expect(refs).toEqual([{ questionNumber: 1, questionMessageId: 'a1' }]);
  });

  it('ignores failed or interrupted replies as questions and feedback', () => {
    const messages = transcript();
    messages[5] = done('a2', 'partial', { quizQuestion: q(2), requestOutcome: 'interrupted' });
    const refs = collectQuizQuestionRefs(messages);
    expect(refs.find((r) => r.questionNumber === 2)).toBeUndefined();
    expect(refs[0].feedbackMessageId).toBeUndefined();
  });

  it('keeps only this learning session and marks an AI draft only when the heading exists', () => {
    const older = [msg('x0', 'user', '/quiz old'), done('x1', '## 1/3번 문제', { quizQuestion: q(1) })];
    const snapshot = buildQuizSnapshot({ session, messages: [...older, ...transcript()], completionMessageId: 'a4', now: 5 });
    expect(snapshot.questions.map((r) => r.questionMessageId)).toEqual(['a1', 'a2', 'a3']);
    expect(snapshot).toMatchObject({ version: 1, mode: 'quiz', origin: 'quiz', reportOrigin: 'ai-draft', sourcePaths: ['a.md'], totalQuestions: 3 });

    const noSummary = transcript();
    noSummary[9] = done('a4', '### 정답 확인');
    expect(buildQuizSnapshot({ session, messages: noSummary, completionMessageId: 'a4', now: 5 }).reportOrigin).toBe('local-evidence');
  });
});

describe('socratic snapshot', () => {
  const messages = [
    msg('s0', 'user', '/socratic'),
    done('s1', '질문'),
    msg('s2', 'user', '내 생각', { socraticSynthesis: true }),
    done('s3', '##SOCRATIC_SUMMARY##\n요약'),
  ];
  const sSession = { ...session, learningSessionId: 's0' };

  it('binds the synthesis only when it was marked while sent', () => {
    const bound = buildSocraticSnapshot({ session: sSession, messages, completionMessageId: 's3', origin: 'socratic', now: 1 });
    expect(bound).toMatchObject({ mode: 'socratic', summaryMessageId: 's3', synthesisMessageId: 's2', questions: [] });
    const unmarked = messages.map((m) => (m.id === 's2' ? { ...m, socraticSynthesis: undefined } : m));
    const absent = buildSocraticSnapshot({ session: sSession, messages: unmarked, completionMessageId: 's3', origin: 'quiz-review', now: 1 });
    expect(absent.synthesisMessageId).toBeUndefined();
    expect(absent.origin).toBe('quiz-review');
  });
});
