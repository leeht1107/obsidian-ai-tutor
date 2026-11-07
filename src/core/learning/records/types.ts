/**
 * Saved learning records: types shared by the snapshot, draft, save service and discovery.
 *
 * The Markdown file is the only record store. Nothing here is a database, index or mastery model.
 */

export const LEARNING_RECORD_FORMAT_VERSION = 1;
export const DEFAULT_LEARNING_RECORDS_FOLDER = '.ai-tutor/learning-records';
/** Total UTF-8 bytes of all selected record bodies that may reach one provider request. */
export const MAX_SELECTED_RECORD_BYTES = 64 * 1024;
/** One record file larger than this is not read at all during discovery. */
export const MAX_RECORD_FILE_BYTES = 256 * 1024;

export type LearningRecordMode = 'quiz' | 'socratic';
/** Where a completed report came from; a Quiz review is a Socratic run that continued a Quiz. */
export type LearningRecordOrigin = 'quiz' | 'socratic' | 'quiz-review';

/** One Quiz question as stored message references, never copied text. */
export interface LearningQuestionRef {
  questionMessageId: string;
  /** The student's submitted answer message, absent when the question was never answered. */
  answerMessageId?: string;
  /** The assistant message that graded this answer. */
  feedbackMessageId?: string;
  questionNumber: number;
}

/** Fixed before a note is created; recovery bookkeeping, not a write authorization. */
export interface LearningSaveIntent {
  saveIntentId: string;
  recordId: string;
  conversationId: string;
  completionMessageId: string;
  /** Preview revision the student confirmed. */
  previewRevision: number;
  folder: string;
  path: string;
  /** SHA-256 of the exact confirmed UTF-8 bytes; kept outside those bytes. */
  contentFingerprint: string;
  frozenAt: number;
}

export interface LearningSavedRef {
  path: string;
  recordId: string;
  contentFingerprint: string;
  savedAt: number;
}

/** Persisted on the completed assistant message; absent on legacy messages. */
export interface CompletedLearningSnapshot {
  version: 1;
  conversationId: string;
  completionMessageId: string;
  mode: LearningRecordMode;
  origin: LearningRecordOrigin;
  /** The learning session this completion belongs to (first message id of the session). */
  learningSessionId: string;
  completedAt: number;
  /** Explicit typed paths captured at setup; never parsed from prompt prose. */
  sourcePaths: string[];
  /** Fingerprints observed at setup, when the sources could be read. */
  sourceFingerprints?: Record<string, string>;
  scopeLabel: string;
  questions: LearningQuestionRef[];
  totalQuestions?: number;
  /** Socratic: the assistant message holding the session summary. */
  summaryMessageId?: string;
  /** Socratic: the student's actual final synthesis, only when it was bound while sent. */
  synthesisMessageId?: string;
  reportOrigin: 'ai-draft' | 'local-evidence';
  pendingSave?: LearningSaveIntent;
  saved?: LearningSavedRef;
}

/** What the preview shows and the student edits; the exact bytes come from `markdown`. */
export interface LearningRecordDraft {
  mode: LearningRecordMode;
  origin: LearningRecordOrigin;
  title: string;
  folder: string;
  fileName: string;
  markdown: string;
}

export interface LearningRecordSummary {
  path: string;
  recordId: string;
  title: string;
  mode: LearningRecordMode | 'unknown';
  createdAt: string;
  sourcePaths: string[];
  /** Questions the record says were not reached; enables "continue" only when above zero. */
  remainingQuestions: number;
  size: number;
  /** Other paths carrying the same recordId; ambiguity is shown, never silently resolved. */
  duplicatePaths: string[];
}

export interface LearningRecordBody {
  path: string;
  recordId: string;
  body: string;
  fingerprint: string;
  bytes: number;
  /** Fresh from this read: the record has something to continue from. */
  canContinue: boolean;
}
