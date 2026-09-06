import {
  buildQuizContinuationPrompt,
  buildQuizHintPrompt,
  buildSocraticContinuationPrompt,
  buildSocraticPrompt,
  DIFFICULTY_INSTRUCTIONS,
  inferSocraticSupportLevel,
  normalizeQuizMarkdown,
  parseQuizDisplayContent,
  parseQuizQuestionMeta,
  parseSocraticMeta,
  shouldEnableQuizExternalTools,
} from '@/core/learning';

describe('learning helpers', () => {
  describe('quiz display parsing', () => {
    it('parses generated quiz labels for toolbar session inference', () => {
      expect(parseQuizDisplayContent('/quiz · 현재 노트 · db.md · 7문제 · 상 · 정규화')).toEqual({
        totalQuestions: 7,
        difficulty: '상',
        focusText: '정규화',
      });
    });

    it('treats 전체 범위 as empty focus text', () => {
      expect(parseQuizDisplayContent('/quiz · 노트 · a.md · 5문제 · 중 · 전체 범위')).toEqual({
        totalQuestions: 5,
        difficulty: '중',
        focusText: undefined,
      });
    });
  });

  describe('quiz external tools', () => {
    it('only enables external tools for high difficulty', () => {
      expect(shouldEnableQuizExternalTools('상')).toBe(true);
      expect(shouldEnableQuizExternalTools('중')).toBe(false);
      expect(shouldEnableQuizExternalTools('하')).toBe(false);
    });
  });

  describe('continuation prompts', () => {
    it('keeps quiz continuations constrained to Korean', () => {
      expect(buildQuizContinuationPrompt({ currentQuestion: 1, totalQuestions: 3 })).toContain('All output must be in Korean');
      expect(buildQuizContinuationPrompt({ currentQuestion: 3, totalQuestions: 3 })).toContain('All output must be in Korean');
    });

    it('keeps quiz continuations constrained to the original source scope', () => {
      const prompt = buildQuizContinuationPrompt({
        currentQuestion: 1,
        totalQuestions: 3,
        difficulty: '중',
        sourceInstruction: 'Use only the current note as ground truth source material: @db.md',
        focusText: 'CTE vs VIEW',
      });

      expect(prompt).toContain('@db.md');
      expect(prompt).toContain('Do not use any knowledge outside the selected ground truth notes/folder');
      expect(prompt).toContain('Continue the SAME quiz scope');
      expect(prompt).toContain('## {N}/{T}번 문제');
      expect(prompt).toContain('CTE vs VIEW');
    });

    it('includes exact previous quiz question context when grading a bare answer', () => {
      const prompt = buildQuizContinuationPrompt({
        currentQuestion: 2,
        totalQuestions: 5,
        difficulty: '중',
        questionContext: {
          questionNumber: 1,
          totalQuestions: 5,
          questionText: [
            '## 1/5번 문제',
            '',
            '#### 이름 없는 인라인뷰에서 노트가 지적한 통증이 아닌 것은?',
            '',
            'A. 가독성 문제',
            'B. 의도 불명 문제',
            'C. 수정 부담 문제',
            'D. 성능 향상',
          ].join('\n'),
        },
      });

      expect(prompt).toContain('student is answering question 1 of 5');
      expect(prompt).toContain('ask exactly question 2 of 5');
      expect(prompt).toContain('<quiz_question_to_grade>');
      expect(prompt).toContain('D. 성능 향상');
      expect(prompt).toContain('source notes only as the answer key/ground truth');
    });

    it('keeps quiz hint requests from revealing the answer or advancing the question', () => {
      const prompt = buildQuizHintPrompt({
        sourceInstruction: 'Use only the current note as ground truth source material: @db.md',
        focusText: 'CTE vs VIEW',
        questionContext: {
          questionNumber: 2,
          totalQuestions: 5,
          questionText: [
            '## 2/5번 문제',
            '',
            '#### CTE와 VIEW의 차이로 옳은 것은?',
            '',
            'A. CTE는 영구 저장된다',
            'B. VIEW는 세션에 한정된다',
          ].join('\n'),
        },
      });

      expect(prompt).toContain('Do NOT reveal the correct answer');
      expect(prompt).toContain('Do NOT grade the student');
      expect(prompt).toContain('do NOT output a "## {N}/{T}번 문제" header');
      expect(prompt).toContain('<quiz_question_to_grade>');
      expect(prompt).toContain('B. VIEW는 세션에 한정된다');
      expect(prompt).toContain('@db.md');
      expect(prompt).toContain('CTE vs VIEW');
    });

    it('still asks for exactly one hint when there is no prior question context', () => {
      const prompt = buildQuizHintPrompt({});
      expect(prompt).toContain('exactly ONE source-grounded hint');
      expect(prompt).not.toContain('<quiz_question_to_grade>');
    });

    it('keeps Socratic continuations constrained to Korean', () => {
      expect(buildSocraticContinuationPrompt(false)).toContain('All output must be in Korean');
      expect(buildSocraticContinuationPrompt(true)).toContain('All output must be in Korean');
    });

    it('keeps Socratic continuations grounded in the original source and focus', () => {
      const prompt = buildSocraticContinuationPrompt({
        isSummaryPhase: false,
        sourceInstruction: 'The following note is the source material for the dialogue: @db.md',
        focusText: 'CTE vs VIEW',
        supportLevel: 2,
      });

      expect(prompt).toContain('Mark\'s digital teaching twin');
      expect(prompt).toContain('@db.md');
      expect(prompt).toContain('CTE vs VIEW');
      expect(prompt).toContain('Current mode: rescue');
      expect(prompt).toContain('Do not run a twenty-questions game');
      expect(prompt).toContain('All output must be in Korean');
    });

    it('keeps summary-phase Socratic continuations from asking another question', () => {
      const prompt = buildSocraticContinuationPrompt({
        isSummaryPhase: true,
        sourceInstruction: 'The following note is the source material for the dialogue: @db.md',
      });

      expect(prompt).toContain('##SOCRATIC_SUMMARY##');
      expect(prompt).toContain('Do NOT ask any more questions');
      expect(prompt).toContain('@db.md');
    });
  });

  describe('Socratic prompts', () => {
    it('uses a source-grounded digital twin persona without contradictory first-response instructions', () => {
      const prompt = buildSocraticPrompt({ scopeInstruction: 'The current note: @note.md' });

      expect(prompt).toContain('Mark\'s digital teaching twin');
      expect(prompt).toContain('Korean AI 조교');
      expect(prompt).toContain('SOURCE BOUNDARY');
      expect(prompt).toContain('질문만 반복하지도 마세요');
      expect(prompt).toContain('START: Begin with a warm, brief greeting');
      expect(prompt).not.toContain('Your FIRST response should jump straight');
    });

    it('raises support level for stuck learners and lowers it for strong answers', () => {
      expect(inferSocraticSupportLevel(1, '모르겠어요')).toBe(2);
      expect(inferSocraticSupportLevel(2, '정답 알려줘')).toBe(3);
      expect(inferSocraticSupportLevel(2, 'CTE는 단일 문장 안에서만 유효하고 VIEW는 카탈로그에 저장되므로 세션과 팀 단위 재사용성에서 차이가 납니다. 그래서 일회성 가독성은 CTE, 반복 재사용과 권한 관리는 VIEW가 더 적합합니다.')).toBe(1);
    });

    it('detects indented summary markers', () => {
      expect(parseSocraticMeta('  ##SOCRATIC_SUMMARY##\n### 발견의 여정 요약')).toEqual({
        isSummary: true,
      });
    });
  });
});

/**
 * Context7 was dropped from the quiz on 2026-09-05. It reached only two of the
 * four CLIs, so a 상 quiz answered differently depending on which AI a student
 * had selected. Web search covers all four and was already the only thing the
 * 상 difficulty actually switched on — `enableExternalTools` sets the web
 * search toggle and never configured an MCP server.
 */
describe('quiz difficulty instructions', () => {
  it('no longer promises a tool that only some providers have', () => {
    for (const instruction of Object.values(DIFFICULTY_INSTRUCTIONS)) {
      expect(instruction).not.toMatch(/context7/i);
    }
  });

  it('keeps web search as the way a 상 question reaches outside the notes', () => {
    expect(DIFFICULTY_INSTRUCTIONS['상']).toMatch(/web search/i);
  });
});

describe('quiz header boundaries a block-buffered provider destroyed', () => {
  const GLUED = '[Solo] 노트를 읽고 작성합니다.## 1/5번 문제\n\n#### 질문\n\nA. 첫째\nB. 둘째';

  it('parses a question whose header was glued to the sentence before it', () => {
    // Straight from the vault: codex emitted the preamble and the question as two
    // blocks and they arrived concatenated, so the `^##` anchor missed the header.
    expect(parseQuizQuestionMeta(GLUED)).toBeUndefined();

    const meta = parseQuizQuestionMeta(normalizeQuizMarkdown(GLUED));
    expect(meta?.current).toBe(1);
    expect(meta?.total).toBe(5);
    expect(meta?.options.map((option) => option.label)).toEqual(['A', 'B']);
  });

  it('leaves a header quoted inside a code fence alone', () => {
    // A quiz that teaches the markup would otherwise open a live answer panel over
    // its own example.
    const fenced = ['설명합니다:', '```markdown', '앞 문장.## 2/5번 문제', '```'].join('\n');
    expect(normalizeQuizMarkdown(fenced)).toBe(fenced);
    expect(parseQuizQuestionMeta(normalizeQuizMarkdown(fenced))).toBeUndefined();
  });

  it('leaves a 정답 확인 retrospective inside a fence alone', () => {
    const retro = [
      '### 정답 확인',
      '~~~',
      '지난 문제였습니다.## 3/5번 문제',
      'A. 보기',
      '~~~',
    ].join('\n');
    expect(normalizeQuizMarkdown(retro)).toBe(retro);
    expect(parseQuizQuestionMeta(normalizeQuizMarkdown(retro))).toBeUndefined();
  });

  it('leaves an unfenced recap that merely mentions a question number alone', () => {
    // ai-review (codex M1): the fence guard alone still let ordinary prose become a live
    // question. A real glued header ends its line, because the block it came from opened
    // with `## N/T번 문제\n`. A sentence that carries on past the number is a reference,
    // not a question, and must not grow a clickable panel over a graded answer.
    const recap = [
      '### 정답 확인',
      '아쉽게 틀렸습니다.## 1/5번 문제 를 다시 보면 힌트가 있었습니다.',
      'A. 첫째 가 정답이었습니다.',
      'B. 둘째 는 오답입니다.',
    ].join('\n');
    expect(normalizeQuizMarkdown(recap)).toBe(recap);
    expect(parseQuizQuestionMeta(normalizeQuizMarkdown(recap))).toBeUndefined();
  });

  it('does not let a ``` literal close a longer fence and expose the code inside', () => {
    // ai-review round 2 (codex M1): a boolean toggle ended the fence on the quoted
    // delimiter, so everything after it read as prose and a code example could grow a
    // clickable panel. A ````-fence closes only on four or more of the same character.
    const nested = [
      '마크다운 자체를 설명합니다:',
      '````markdown',
      '```',
      '앞 문장.## 4/5번 문제',
      'A. 첫째',
      'B. 둘째',
      '```',
      '````',
    ].join('\n');
    expect(normalizeQuizMarkdown(nested)).toBe(nested);
    expect(parseQuizQuestionMeta(normalizeQuizMarkdown(nested))).toBeUndefined();
  });

  it('leaves a fenced example quoted inside a block quote or list alone', () => {
    // ai-review round 3 (codex M1): the fence recognizer allowed only whitespace before
    // the delimiter, so `> ```markdown` never opened a fence and the quoted code after it
    // was rewritten. Free-text detection would then have mounted a panel over a code
    // sample. Both the fence and the line itself are now container-aware.
    const quoted = [
      '> 이렇게 씁니다:',
      '> ```markdown',
      '> 앞 문장.## 1/5번 문제',
      '> 답안 형식: 자유 서술',
      '> ```',
    ].join('\n');
    expect(normalizeQuizMarkdown(quoted)).toBe(quoted);
    expect(parseQuizQuestionMeta(normalizeQuizMarkdown(quoted))).toBeUndefined();

    const listed = [
      '- 예시는 다음과 같습니다:',
      '- ```markdown',
      '  앞 문장.## 2/5번 문제',
      '  A. 첫째',
      '- ```',
    ].join('\n');
    expect(normalizeQuizMarkdown(listed)).toBe(listed);
  });

  it('does not let an info-string line close an open fence', () => {
    // ai-review round 4 (codex M1): only an OPENING fence may carry an info string, so a
    // ```-prefixed word inside an open block is content. Closing on it released the rest
    // of the code sample and a quiz-shaped line in it would have grown a panel.
    const nested = [
      '펜스 안에서 다시 펜스를 보여줍니다:',
      '```markdown',
      '```not-a-closing-fence',
      '앞 문장.## 5/5번 문제',
      'A. 첫째',
      'B. 둘째',
      '```',
    ].join('\n');
    expect(normalizeQuizMarkdown(nested)).toBe(nested);
    expect(parseQuizQuestionMeta(normalizeQuizMarkdown(nested))).toBeUndefined();
  });

  it('does not build a question out of options quoted in a code fence', () => {
    // ai-review round 5 (codex M1): the header could be genuine prose while every option
    // lived inside a fenced example. The parser counted them and mounted a panel whose
    // clicks would have been sent as the student's answer.
    const sample = [
      '보기 표기법을 설명합니다.## 1/5번 문제',
      '',
      '```markdown',
      'A. 예시 보기',
      'B. 또 다른 예시',
      '```',
    ].join('\n');
    expect(parseQuizQuestionMeta(normalizeQuizMarkdown(sample))).toBeUndefined();
  });

  it('still reads a real question that merely includes a code sample', () => {
    // The guard must not cost a genuine question its options.
    const real = [
      '## 2/5번 문제',
      '',
      '#### 다음 출력의 원인은?',
      '',
      '```python',
      'print(mean)',
      '```',
      '',
      'A. 평균',
      'B. 중앙값',
    ].join('\n');
    const meta = parseQuizQuestionMeta(normalizeQuizMarkdown(real));
    expect(meta?.current).toBe(2);
    expect(meta?.options.map((option) => option.label)).toEqual(['A', 'B']);
  });

  it('does not let a four-space-indented literal swallow a real question', () => {
    // ai-review round 6 (codex M1): four spaces of indent is an indented code block, not a
    // fence opener. Treating one as a fence left the block open to end of content, and since
    // the same mask gates option scanning, the student's real answers vanished with it —
    // recreating the exact failure this repair exists to fix.
    const real = [
      '## 1/1번 문제',
      '',
      '#### 마크다운 예시를 들여쓰기로 보여줍니다',
      '',
      '    ```markdown',
      '    예시 줄',
      '',
      'A. 첫째',
      'B. 둘째',
    ].join('\n');
    const meta = parseQuizQuestionMeta(normalizeQuizMarkdown(real));
    expect(meta?.current).toBe(1);
    expect(meta?.options.map((option) => option.label)).toEqual(['A', 'B']);
  });

  it('leaves a message whose only header is quoted in a fence completely untouched', () => {
    // advisor-fable: the header search was the one call site still not fence-aware. It
    // picked the quoted header, promoted the next line of the code sample to `#### ...`,
    // and the student saw their own example corrupted — while a real header further down
    // was never normalized at all.
    const quoted = ['```markdown', '## 1/3번 문제', '', '보기 예시', '```'].join('\n');
    expect(normalizeQuizMarkdown(quoted)).toBe(quoted);
    expect(parseQuizQuestionMeta(normalizeQuizMarkdown(quoted))).toBeUndefined();
  });

  it('normalizes the real header even when a quoted one comes first', () => {
    const both = [
      '```markdown',
      '## 1/3번 문제',
      '```',
      '',
      '## 2/3번 문제',
      '실제 질문입니다',
      '',
      'A. 첫째',
      'B. 둘째',
    ].join('\n');
    const out = normalizeQuizMarkdown(both);
    expect(out).toContain('#### 실제 질문입니다');
    expect(parseQuizQuestionMeta(out)?.current).toBe(2);
  });

  it('is idempotent, so a re-render cannot keep adding blank lines', () => {
    const once = normalizeQuizMarkdown(GLUED);
    expect(normalizeQuizMarkdown(once)).toBe(once);
    expect(normalizeQuizMarkdown(normalizeQuizMarkdown(once))).toBe(once);
  });
});
