import type { ChatMessage, Conversation } from '../../types';
import { buildFrontmatter } from './markdown';
import type { CompletedLearningSnapshot, LearningRecordDraft } from './types';

/** Heading the final Quiz turn is asked to use for its short AI draft summary. */
export const QUIZ_SUMMARY_HEADING = '### 학습 요약 (AI 초안)';
const NO_AI_SUMMARY = 'No AI summary available; question/answer record only. 이 기록에는 AI 요약이 없고 실제 문제·답안·피드백만 담겨 있습니다.';
const ABSENT = '(없음)';

export function messageText(message: ChatMessage | undefined): string {
  if (!message) return '';
  const blocks = (message.contentBlocks ?? [])
    .filter((block): block is { type: 'text'; content: string } => block.type === 'text')
    .map((block) => block.content);
  return (blocks.length > 0 ? blocks.join('\n\n') : message.content).replace(/\r\n/g, '\n').trim();
}

/** Lines of `text` that are outside fenced code (fences may nest by delimiter run). */
function proseLineMask(lines: string[]): boolean[] {
  let open: string | null = null;
  return lines.map((line) => {
    const fence = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (!fence) return open === null;
    if (open === null) {
      open = fence[1];
    } else if (fence[1][0] === open[0] && fence[1].length >= open.length && fence[2].trim() === '') {
      open = null;
    }
    return false;
  });
}

/** Text before a Quiz question header that starts the next question (the feedback of the last one). */
export function feedbackPart(text: string): string {
  const lines = text.split('\n');
  const prose = proseLineMask(lines);
  const next = lines.findIndex((line, index) => prose[index] && /^##\s*\d+\s*\/\s*\d+번 문제/.test(line.trim()));
  const kept = (next === -1 ? lines : lines.slice(0, next)).join('\n').replace(/\n-{3,}\s*$/, '');
  return summaryAndFeedback(kept).feedback;
}

/** Splits the AI draft summary (own heading, outside code) from the grading feedback. */
export function summaryAndFeedback(text: string): { feedback: string; summary: string } {
  const lines = text.split('\n');
  const prose = proseLineMask(lines);
  const at = lines.findIndex((line, index) => prose[index] && line.trim() === QUIZ_SUMMARY_HEADING);
  if (at === -1) return { feedback: text.trim(), summary: '' };
  return {
    feedback: lines.slice(0, at).join('\n').trim(),
    summary: lines.slice(at + 1).join('\n').trim(),
  };
}

function questionBlock(text: string, number: number): string {
  const lines = text.split('\n');
  const prose = proseLineMask(lines);
  const start = lines.findIndex((line, index) => prose[index] && new RegExp(`^##\\s*${number}\\s*/\\s*\\d+번 문제`).test(line.trim()));
  if (start === -1) return text.trim();
  const next = lines.findIndex((line, index) => index > start && prose[index] && /^##\s*\d+\s*\/\s*\d+번 문제/.test(line.trim()));
  return (next === -1 ? lines.slice(start) : lines.slice(start, next)).join('\n').replace(/\n-{3,}\s*$/, '').trim();
}

/** Indents a quoted block so imported text cannot open headings or frontmatter in the note. */
function quote(text: string): string {
  return text.split('\n').map((line) => `> ${line}`.trimEnd()).join('\n');
}

export function newRecordIds(now: number): { recordId: string; saveIntentId: string } {
  const suffix = Math.random().toString(36).slice(2, 10);
  return { recordId: `lr-${now.toString(36)}-${suffix}`, saveIntentId: `si-${now.toString(36)}-${suffix}` };
}

function dateLabel(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function fileNameFor(snapshot: CompletedLearningSnapshot, now: number): string {
  const label = snapshot.scopeLabel.replace(/^\/(?:quiz|socratic)\s*·?\s*/u, '').split('·')[0].trim() || '학습';
  const kind = snapshot.mode === 'quiz' ? '퀴즈' : '소크라테스';
  return `${dateLabel(now)} ${kind} ${label}`;
}

export interface BuildDraftInput {
  snapshot: CompletedLearningSnapshot;
  conversation: Conversation;
  folder: string;
  now?: number;
  recordId?: string;
  saveIntentId?: string;
}

/**
 * Assembles the editable preview from the snapshot's own message references. Missing refs are
 * labelled missing; nothing is rebuilt from another chat or the note open in the editor.
 */
export function buildRecordDraft(input: BuildDraftInput): LearningRecordDraft {
  const { snapshot, conversation, folder } = input;
  const now = input.now ?? Date.now();
  const ids = input.recordId && input.saveIntentId
    ? { recordId: input.recordId, saveIntentId: input.saveIntentId }
    : newRecordIds(now);
  const byId = new Map(conversation.messages.map((message) => [message.id, message]));
  const title = `${snapshot.mode === 'quiz' ? '퀴즈' : '소크라테스 대화'} 학습 기록`;

  const answered = snapshot.questions.filter((q) => q.answerMessageId).length;
  const remaining = snapshot.mode === 'quiz'
    ? Math.max(0, (snapshot.totalQuestions ?? snapshot.questions.length) - answered)
    : 0;

  const sections: string[] = [`# ${title}`, ''];
  sections.push('## 1. 학습 자료와 날짜', '');
  sections.push(`- 날짜: ${dateLabel(now)}`);
  sections.push(`- 범위: ${snapshot.scopeLabel || ABSENT}`);
  sections.push(snapshot.sourcePaths.length > 0
    ? `- 자료: ${snapshot.sourcePaths.map((path) => `\`${path}\``).join(', ')}`
    : '- 자료: No verified original learning material available.');
  sections.push('');

  let aiSummary = '';
  if (snapshot.mode === 'quiz') {
    sections.push('## 2. 문제와 내가 제출한 답', '');
    if (snapshot.questions.length === 0) sections.push(ABSENT, '');
    const lastIndex = snapshot.questions.length - 1;
    snapshot.questions.forEach((ref, index) => {
      const questionMessage = byId.get(ref.questionMessageId);
      const answerMessage = ref.answerMessageId ? byId.get(ref.answerMessageId) : undefined;
      const feedbackMessage = ref.feedbackMessageId ? byId.get(ref.feedbackMessageId) : undefined;
      sections.push(`### 문제 ${ref.questionNumber}`, '');
      sections.push(questionMessage
        ? quote(questionBlock(messageText(questionMessage), ref.questionNumber))
        : '(원본 문제 메시지를 찾을 수 없음)');
      sections.push('', '**내 답안 (제출한 그대로)**', '');
      sections.push(ref.answerMessageId
        ? (answerMessage ? quote(messageText(answerMessage)) : '(원본 답안 메시지를 찾을 수 없음)')
        : '(제출한 답안 없음)');
      sections.push('', '**기존 AI 피드백 (참고용, 검증되지 않음)**', '');
      if (feedbackMessage) {
        const parts = summaryAndFeedback(messageText(feedbackMessage));
        sections.push(quote(index === lastIndex ? parts.feedback : feedbackPart(messageText(feedbackMessage))) || ABSENT);
        if (index === lastIndex) aiSummary = parts.summary;
      } else {
        sections.push(ref.feedbackMessageId ? '(원본 피드백 메시지를 찾을 수 없음)' : ABSENT);
      }
      sections.push('');
    });
  } else {
    const synthesis = snapshot.synthesisMessageId ? byId.get(snapshot.synthesisMessageId) : undefined;
    const summary = snapshot.summaryMessageId ? byId.get(snapshot.summaryMessageId) : undefined;
    sections.push('## 2. 대화 요약 대상', '');
    sections.push(summary ? '소크라테스식 대화가 끝까지 진행되었습니다.' : '(세션 요약 메시지를 찾을 수 없음)', '');
    sections.push('## 4. 내가 직접 정리한 내용', '');
    sections.push(snapshot.synthesisMessageId
      ? (synthesis ? quote(messageText(synthesis)) : '(원본 학생 정리 메시지를 찾을 수 없음)')
      : '(기록된 학생 정리 없음 — 아래에 직접 적어도 됩니다)', '');
    aiSummary = summary ? messageText(summary).replace(/^\s*##SOCRATIC_SUMMARY##\s*$/m, '').trim() : '';
  }

  sections.push('## 3. 다시 볼 것 / 스스로 점검 (직접 작성)', '', '(비어 있음 — 다시 확인하고 싶은 것을 직접 적으세요. 이 메모는 나중에 "선택한 기록으로 복습"에서 다시 읽힙니다)', '');
  if (snapshot.mode === 'quiz') {
    sections.push('## 4. 내가 직접 정리한 내용', '', '(비어 있음 — 직접 정리하고 싶다면 적으세요)', '');
  }
  sections.push('## 5. 기존 AI 요약 (참고용, 검증되지 않음)', '');
  sections.push(aiSummary ? quote(aiSummary) : NO_AI_SUMMARY, '');

  const markdown = `${buildFrontmatter({
    recordId: ids.recordId,
    saveIntentId: ids.saveIntentId,
    createdAt: new Date(now).toISOString(),
    mode: snapshot.mode,
    origin: snapshot.origin,
    sourcePaths: snapshot.sourcePaths,
    sourceConversationId: snapshot.conversationId,
    completionMessageId: snapshot.completionMessageId,
    remainingQuestions: remaining,
  })}\n\n${sections.join('\n').trimEnd()}\n`;

  return { mode: snapshot.mode, origin: snapshot.origin, title, folder, fileName: fileNameFor(snapshot, now), markdown };
}
