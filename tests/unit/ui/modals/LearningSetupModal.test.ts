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

  it.each([
    ['하', false],
    ['중', false],
    ['상', true],
  ] as const)('returns the %s Web-search policy with its Quiz setup', (difficulty, enableWebSearch) => {
    const modal = createModal('quiz');
    (modal as any).difficulty = difficulty;

    expect((modal as any).buildResult()).toMatchObject({ difficulty, enableWebSearch });
  });

  it('keeps selected notes primary while allowing official web context for a high Quiz', () => {
    const modal = createModal('quiz');
    (modal as any).difficulty = '상';
    const result = (modal as any).buildResult();
    expect(result.sourceInstruction).toContain('primary course ground truth');
    expect(result.sourceInstruction).toContain('official web sources may supplement application context');
    expect(result.sourceInstruction).not.toContain('Use only');
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

  it('keeps an explicitly selected Brief separate from selected course evidence and reuses its confirmed goal', () => {
    const goal = {
      id: 'goal-stable', briefPath: 'Briefs/Exam.md', folderPath: 'Study/Exam',
      contextPath: 'Study/Exam/STUDY_CONTEXT.md',
    };
    const modal = new LearningSetupModal(
      ({ vault: { getMarkdownFiles: () => [{ path: 'Statistics/Week1.md' }] } } as unknown) as App,
      'Statistics/Week1.md', 'quiz', '', [goal],
    );
    (modal as any).briefPath = goal.briefPath;
    (modal as any).studyFolderPath = goal.folderPath;

    const result = (modal as any).buildResult();

    expect(result.studyGoal).toEqual({
      briefPath: goal.briefPath, folderPath: goal.folderPath, contextPath: goal.contextPath, existingId: goal.id,
    });
    expect(result.sourceInstruction).toContain('@Statistics/Week1.md');
    expect(result.sourceInstruction).not.toContain('@Briefs/Exam.md');
  });

  it('builds the real empty-folder scope as prepared-concepts-only evidence', () => {
    const modal = new LearningSetupModal(
      ({ vault: { getMarkdownFiles: () => [{ path: 'Study/Brief.md' }] } } as unknown) as App,
      'Study/Brief.md', 'quiz', '',
    );
    (modal as any).briefPath = 'Study/Brief.md';
    (modal as any).learningScope = 'folder';
    (modal as any).selectedFolderPaths = new Set(['Study/Empty']);

    const scope = (modal as any).buildScope();

    expect(scope.sourceInstruction).toBe('No markdown files found in selected folders: Study/Empty. Please inform the user.');
  });

  it('clears Brief A folder and context when switching the selected Brief to B', () => {
    const modal = new LearningSetupModal(
      ({ vault: { getMarkdownFiles: () => [{ path: 'Briefs/A.md' }, { path: 'Briefs/B.md' }] } } as unknown) as App,
      'Briefs/A.md', 'quiz', '', [
        { id: 'goal-a', briefPath: 'Briefs/A.md', folderPath: 'Study/A', contextPath: 'Study/A/context.md' },
        { id: 'goal-b', briefPath: 'Briefs/B.md', folderPath: 'Study/B', contextPath: 'Study/B/context.md' },
      ],
    );
    (modal as any).briefPath = 'Briefs/A.md';
    (modal as any).studyFolderPath = 'Study/A';
    (modal as any).studyContextPath = 'Study/A/context.md';
    (modal as any).renderContent = jest.fn();

    (modal as any).handleBriefSelection('Briefs/B.md');

    expect((modal as any).studyFolderPath).toBe('');
    expect((modal as any).studyContextPath).toBe('');
    expect((modal as any).briefPath).toBe('Briefs/B.md');
    expect((modal as any).renderContent).toHaveBeenCalledTimes(1);
  });
});
