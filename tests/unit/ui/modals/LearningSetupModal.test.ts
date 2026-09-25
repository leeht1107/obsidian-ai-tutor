import type { App } from 'obsidian';

import { LearningSetupModal } from '@/ui/modals/LearningSetupModal';

function createModal(mode: 'quiz' | 'socratic', focusText = '') {
  const app = {
    vault: {
      getMarkdownFiles: () => [{ path: 'Statistics/Week1.md' }],
    },
  } as unknown as App;
  return new LearningSetupModal(app, 'Statistics/Week1.md', mode, focusText);
}

describe('LearningSetupModal', () => {
  it('opens on the requested quiz tab and returns a material-based quiz by default', () => {
    const modal = createModal('quiz');
    const result = (modal as any).buildResult();

    expect((modal as any).mode).toBe('quiz');
    expect(result).toMatchObject({
      mode: 'quiz',
      totalQuestions: 5,
      difficulty: '중',
      questionStyle: 'material',
    });
    expect(result.displayContent).not.toContain('연계 응용');
  });

  it('keeps the related-application selection in the quiz result and display label', () => {
    const modal = createModal('quiz');
    (modal as any).questionStyle = 'application';
    const result = (modal as any).buildResult();

    expect(result).toMatchObject({ mode: 'quiz', questionStyle: 'application' });
    expect(result.displayContent).toContain('연계 응용');
    expect(result.prompt).toContain('apply concepts from the selected material to fresh scenarios');
  });

  it('keeps Socratic dialogue and lets focused students ask directly about gaps', () => {
    const modal = createModal('socratic', '조건부확률');
    const result = (modal as any).buildResult();

    expect((modal as any).mode).toBe('socratic');
    expect(result).toMatchObject({ mode: 'socratic', focusText: '조건부확률' });
    expect(result.prompt).toContain('Continue while dialogue helps the student reach a clear insight');
    expect(result.prompt).toContain('Invite the student to name the exact point they find unclear or ask their question directly');
    expect(result.prompt).not.toContain('one gentle diagnostic question about a prerequisite');
    expect(result.prompt).toContain('show how it connects to the target before relying on an unfamiliar term or rule');
    expect(result.prompt).toContain('Choose the simplest useful definition, example, contrast, or worked step');
    expect(result.prompt).toContain('use general knowledge to explain only what is needed');
  });

  it('keeps topic discovery when no Socratic focus has been selected', () => {
    const result = (createModal('socratic') as any).buildResult();

    expect(result.prompt).toContain('ask the student which part of the material they want to explore');
    expect(result.prompt).toContain('Continue while dialogue helps the student reach a clear insight');
  });
});
