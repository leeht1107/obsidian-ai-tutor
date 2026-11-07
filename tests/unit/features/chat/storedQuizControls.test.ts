import { resolveStoredQuizControl } from '../../../../src/features/chat/ObsidianCopilotView';
import { QUIZ_STUCK_ANSWER } from '../../../../src/ui/components/QuizAnswerPanel';

/**
 * The stored quiz row's two buttons carry no handlers of their own — this container
 * delegation is all that stands behind them. Drawing them without registering here is
 * worse than not drawing them: a stuck student presses and nothing happens.
 */
const clickOn = (...classes: string[]) => ({
  closest: (selector: string) => (classes.includes(selector.slice(1))
    ? { dataset: { messageId: 'quiz-message-1' } }
    : null),
}) as unknown as Element;

describe('stored quiz controls reach the same actions as the live panel', () => {
  it('routes 힌트 to the non-advancing hint request', () => {
    expect(resolveStoredQuizControl(clickOn('ocop-quiz-hint-btn'))).toEqual({ kind: 'hint' });
  });

  it('routes the optional end-of-quiz review button', () => {
    expect(resolveStoredQuizControl(clickOn('ocop-quiz-review-btn')))
      .toEqual({ kind: 'review', messageId: 'quiz-message-1' });
  });

  it('does not route a review control that has no message identity', () => {
    const target = { closest: (selector: string) => selector === '.ocop-quiz-review-btn' ? { dataset: {} } : null } as unknown as Element;
    expect(resolveStoredQuizControl(target)).toBeNull();
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

describe('learning record save button delegation', () => {
  const { resolveLearningRecordSave } = jest.requireActual('../../../../src/features/chat/ObsidianCopilotView');
  it('resolves the message of the clicked save button', () => {
    const button = { dataset: { messageId: 'done-1' } };
    const target = { closest: (selector: string) => (selector === '.ocop-learning-record-save-btn' ? button : null) } as unknown as Element;
    expect(resolveLearningRecordSave(target)).toEqual({ messageId: 'done-1', button });
  });

  it('ignores other clicks and buttons without a message id', () => {
    expect(resolveLearningRecordSave(clickOn('ocop-quiz-hint-btn'))).toBeNull();
    const bare = { closest: () => ({ dataset: {} }) } as unknown as Element;
    expect(resolveLearningRecordSave(bare)).toBeNull();
    expect(resolveLearningRecordSave(null)).toBeNull();
  });
});
