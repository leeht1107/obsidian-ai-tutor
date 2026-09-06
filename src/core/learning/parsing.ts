import type { QuizQuestionMeta, QuizQuestionOption, SocraticTurnMeta } from '../types';

export function parseSocraticMeta(content: string): SocraticTurnMeta | undefined {
  if (!/^\s*##SOCRATIC_SUMMARY##/m.test(content)) return undefined;
  return { isSummary: true };
}

/** A Markdown container prefix a fence or a line can sit behind: `> `, `- `, `1. `. */
const CONTAINER_PREFIX = /^\s*(?:(?:>\s*)+|(?:[-*+]|\d+[.)])\s+)/;

/**
 * A fence line, capturing the delimiter run so its length and character can be matched.
 *
 * Two shapes only: a delimiter behind a block-quote or list prefix (`> ```markdown` inside a
 * quote is still a fence, and missing that left the quoted code unguarded), or a bare
 * delimiter indented at most three spaces. The indent limit is load-bearing in the other
 * direction: four spaces is an indented code block, not a fence opener, and accepting one
 * opened a block that never closed — which, since this mask now also gates option scanning,
 * hid a real quiz's answers and cost it its panel (ai-review round 6).
 */
const CODE_FENCE = /^(?:\s*(?:(?:>\s*)+|(?:[-*+]|\d+[.)])\s+)\s*| {0,3})(`{3,}|~{3,})(.*)$/;

/**
 * Marks every line that is fenced code — the delimiters included, since a delimiter line is
 * never prose either. Fences nest by delimiter, not by count: a run closes the block only if
 * it is the same character, at least as long as the opener, and alone on its line, because
 * only an OPENING fence may carry an info string (CommonMark).
 */
function fencedLineMask(lines: string[]): boolean[] {
  let openFence: string | null = null;
  return lines.map((line) => {
    const fence = CODE_FENCE.exec(line);
    if (!fence) {
      return openFence !== null;
    }
    const [, run, rest] = fence;
    if (openFence === null) {
      openFence = run;
    } else if (run[0] === openFence[0] && run.length >= openFence.length && rest.trim() === '') {
      openFence = null;
    }
    return true;
  });
}

/** The content with fenced code blanked out, line count preserved so `^`/`$` still line up. */
function withoutFencedCode(content: string): string {
  const lines = content.split('\n');
  const fenced = fencedLineMask(lines);
  return lines.map((line, index) => (fenced[index] ? '' : line)).join('\n');
}

export function parseQuizQuestionMeta(content: string): QuizQuestionMeta | undefined {
  // Read the prose only. A quiz that teaches Markdown quotes a header and `A.`/`B.` lines
  // inside a fence, and counting those turned a code sample into a live, clickable question
  // (ai-review round 5). Measured over the 140 quizzes already stored in the vault: every
  // one produces identical metadata this way, so nothing real is lost by ignoring fences.
  const prose = withoutFencedCode(content);
  const headerMatch = prose.match(/^##\s*(\d+)\s*\/\s*(\d+)번 문제/im);
  if (!headerMatch) {
    return undefined;
  }

  const options = Array.from(prose.matchAll(/^([A-Z])\.\s+(.+)$/gm)).map<QuizQuestionOption>((match) => ({
    label: match[1],
    text: match[2].trim(),
  }));

  const freeText = options.length === 0 && /\(자유 서술\)|답안 형식:\s*(?:자유 서술|단답|서술|직접 입력)/i.test(prose);

  if (options.length === 0 && !freeText) {
    return undefined;
  }

  const multiSelect = /\(복수 선택 가능\)|복수 선택 가능|답안 형식:\s*[A-Z](?:\s*,\s*[A-Z])+/i.test(prose);
  return {
    current: Number(headerMatch[1]),
    total: Number(headerMatch[2]),
    multiSelect,
    freeText,
    options,
  };
}

/**
 * A `## N/T번 문제` header glued to the end of the preceding sentence, and ending its
 * line. The trailing anchor is the whole guard against inventing questions: a real
 * glued header is a block that opened with `## N/T번 문제\n`, so nothing follows it on
 * the line, while prose that merely mentions a question number ("...습니다.## 1/5번
 * 문제 를 다시 보면") carries on and is left alone.
 */
const GLUED_QUIZ_HEADER = /(\S)[ \t]*(##\s*\d+\s*\/\s*\d+번 문제)[ \t]*$/;

/**
 * Puts a line boundary back in front of a quiz header that a provider glued to the
 * previous sentence. codex emits whole blocks, so a turn that used a tool arrived as
 * `...작성합니다.## 1/5번 문제` and every `^##` anchor downstream missed it.
 *
 * Skips fenced code, where a quoted header or a `### 정답 확인` retrospective must not
 * turn into a live question. Idempotent: once the header starts its own line there is
 * no preceding non-space character left to match.
 */
function restoreQuizHeaderBoundaries(content: string): string {
  const lines = content.split('\n');
  const fenced = fencedLineMask(lines);
  // A line behind a container prefix is never rewritten either. A real glued header is plain
  // top-level prose ("...제시합니다.## 1/5번 문제"); a quoted or listed line is someone
  // showing markup, and splitting it would tear it out of its container.
  return lines
    .map((line, index) =>
      fenced[index] || CONTAINER_PREFIX.test(line)
        ? line
        : line.replace(GLUED_QUIZ_HEADER, '$1\n\n$2'))
    .join('\n');
}

export function normalizeQuizMarkdown(content: string): string {
  const normalized = restoreQuizHeaderBoundaries(
    content.replace(/\r\n/g, '\n').replace(/\n+\(정답을 입력해 주세요[^\n]*\)/g, '')
  );
  const lines = normalized.split('\n');
  // The same mask the parser uses. Without it this third call site picked a header quoted
  // inside a fence, promoted the next line of that code sample to `#### ...`, and left a
  // real header further down un-normalized (advisor-fable).
  const fenced = fencedLineMask(lines);
  const headerIndex = lines.findIndex(
    (line, index) => !fenced[index] && /^##\s*\d+\s*\/\s*\d+번 문제$/i.test(line.trim())
  );
  if (headerIndex === -1) {
    return normalized;
  }

  let cursor = headerIndex + 1;
  while (cursor < lines.length && lines[cursor].trim() === '') {
    cursor += 1;
  }
  while (cursor < lines.length && (/^####\s*문제$/i.test(lines[cursor].trim()) || lines[cursor].trim() === '문제')) {
    cursor += 1;
  }
  while (cursor < lines.length && lines[cursor].trim() === '') {
    cursor += 1;
  }

  const questionLine = lines[cursor] ?? '';
  let questionHeading: string;
  if (fenced[cursor]) {
    // Code, not the question sentence. Promoting a fence opening produced
    // `#### \`\`\`markdown`, which is both wrong on screen and stops the fence ever opening,
    // so the options quoted inside it were read as the real ones.
    questionHeading = '';
  } else if (questionLine.startsWith('#')) {
    questionHeading = questionLine;
    cursor += 1;
  } else if (questionLine.trim()) {
    questionHeading = `#### ${questionLine.trim()}`;
    cursor += 1;
  } else {
    questionHeading = '';
  }

  const rebuilt = [
    ...lines.slice(0, headerIndex + 1),
    '',
    questionHeading,
    ...lines.slice(cursor),
  ];

  return rebuilt.join('\n');
}
