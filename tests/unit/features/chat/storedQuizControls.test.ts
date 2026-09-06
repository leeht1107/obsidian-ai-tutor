import { resolveStoredQuizControl } from '../../../../src/features/chat/ObsidianCopilotView';
import { QUIZ_STUCK_ANSWER } from '../../../../src/ui/components/QuizAnswerPanel';

/**
 * The stored quiz row's two buttons carry no handlers of their own — this container
 * delegation is all that stands behind them. Drawing them without registering here is
 * worse than not drawing them: a stuck student presses and nothing happens.
 */
const clickOn = (...classes: string[]) =>
  ({ closest: (selector: string) => (classes.includes(selector.slice(1)) ? {} : null) }) as unknown as Element;

describe('stored quiz controls reach the same actions as the live panel', () => {
  it('routes 힌트 to the non-advancing hint request', () => {
    expect(resolveStoredQuizControl(clickOn('ocop-quiz-hint-btn'))).toEqual({ kind: 'hint' });
  });

  it('sends 모르겠어요 as the exact text the live panel submits', () => {
    // Same string, not a lookalike: the two paths must grade identically.
    expect(resolveStoredQuizControl(clickOn('ocop-quiz-stuck-btn')))
      .toEqual({ kind: 'answer', content: QUIZ_STUCK_ANSWER });
    expect(QUIZ_STUCK_ANSWER).toBe('모르겠어요. 정답과 핵심 개념을 알려주세요.');
  });

  it('ignores clicks that are not on either control', () => {
    expect(resolveStoredQuizControl(clickOn('ocop-quiz-answer-btn'))).toBeNull();
    expect(resolveStoredQuizControl(null)).toBeNull();
  });
});
