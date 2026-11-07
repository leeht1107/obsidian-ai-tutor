import type { ChatMessage } from '../../types';
import { messageText, QUIZ_SUMMARY_HEADING, summaryAndFeedback } from './draft';
import type { CompletedLearningSnapshot, LearningQuestionRef, LearningRecordOrigin } from './types';

export interface SnapshotSession {
  conversationId: string;
  learningSessionId: string;
  scopeLabel: string;
  sourcePaths: string[];
  sourceFingerprints?: Record<string, string>;
  totalQuestions?: number;
}

const MAX_QUESTION_REFS = 50;

/** Messages of this learning session only: from its first user message on. */
function sessionMessages(messages: ChatMessage[], learningSessionId: string): ChatMessage[] {
  const start = messages.findIndex((message) => message.id === learningSessionId);
  return start === -1 ? messages : messages.slice(start);
}

/**
 * Quiz evidence as message references. A hint turn (its user message and the reply) is never an
 * answer or feedback, and neither is a reply that did not complete.
 */
export function collectQuizQuestionRefs(messages: ChatMessage[]): LearningQuestionRef[] {
  const refs: LearningQuestionRef[] = [];
  const seen = new Set<number>();
  for (let i = 0; i < messages.length && refs.length < MAX_QUESTION_REFS; i += 1) {
    const message = messages[i];
    if (message.role !== 'assistant' || !message.quizQuestion || message.requestOutcome !== 'completed') continue;
    if (i > 0 && messages[i - 1].quizHint) continue;
    const number = message.quizQuestion.current;
    if (seen.has(number)) continue;
    seen.add(number);
    const ref: LearningQuestionRef = { questionNumber: number, questionMessageId: message.id };
    let j = i + 1;
    while (j < messages.length) {
      const next = messages[j];
      if (next.role === 'user' && next.quizHint) {
        j += 2; // the hint and its reply
        continue;
      }
      if (next.role === 'user') {
        ref.answerMessageId = next.id;
        const reply = messages[j + 1];
        if (reply && reply.role === 'assistant' && reply.requestOutcome === 'completed') {
          ref.feedbackMessageId = reply.id;
        }
      }
      break;
    }
    refs.push(ref);
  }
  return refs;
}

export function buildQuizSnapshot(input: {
  session: SnapshotSession;
  messages: ChatMessage[];
  completionMessageId: string;
  now: number;
}): CompletedLearningSnapshot {
  const { session, completionMessageId } = input;
  const scoped = sessionMessages(input.messages, session.learningSessionId);
  const completion = scoped.find((message) => message.id === completionMessageId);
  const hasSummary = summaryAndFeedback(messageText(completion)).summary.length > 0
    && messageText(completion).includes(QUIZ_SUMMARY_HEADING);
  return {
    version: 1,
    conversationId: session.conversationId,
    completionMessageId,
    mode: 'quiz',
    origin: 'quiz',
    learningSessionId: session.learningSessionId,
    completedAt: input.now,
    sourcePaths: [...session.sourcePaths],
    ...(session.sourceFingerprints ? { sourceFingerprints: { ...session.sourceFingerprints } } : {}),
    scopeLabel: session.scopeLabel,
    totalQuestions: session.totalQuestions,
    questions: collectQuizQuestionRefs(scoped),
    reportOrigin: hasSummary ? 'ai-draft' : 'local-evidence',
  };
}

export function buildSocraticSnapshot(input: {
  session: SnapshotSession;
  messages: ChatMessage[];
  completionMessageId: string;
  origin: Extract<LearningRecordOrigin, 'socratic' | 'quiz-review'>;
  now: number;
}): CompletedLearningSnapshot {
  const { session, completionMessageId } = input;
  const scoped = sessionMessages(input.messages, session.learningSessionId);
  const completionIndex = scoped.findIndex((message) => message.id === completionMessageId);
  const before = completionIndex === -1 ? scoped : scoped.slice(0, completionIndex);
  // Bound explicitly while sent (summary phase); never inferred from "the previous user turn".
  const synthesis = [...before].reverse().find((message) => message.role === 'user' && message.socraticSynthesis);
  return {
    version: 1,
    conversationId: session.conversationId,
    completionMessageId,
    mode: 'socratic',
    origin: input.origin,
    learningSessionId: session.learningSessionId,
    completedAt: input.now,
    sourcePaths: [...session.sourcePaths],
    ...(session.sourceFingerprints ? { sourceFingerprints: { ...session.sourceFingerprints } } : {}),
    scopeLabel: session.scopeLabel,
    questions: [],
    summaryMessageId: completionMessageId,
    ...(synthesis ? { synthesisMessageId: synthesis.id } : {}),
    reportOrigin: 'ai-draft',
  };
}
