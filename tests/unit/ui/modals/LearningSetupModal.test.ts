import type { App } from 'obsidian';
import { TFile } from 'obsidian';

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
  afterEach(() => jest.restoreAllMocks());

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

  it('does not start from course notes that are empty or frontmatter only', async () => {
    const files = ['Course/Empty.md', 'Course/Template.md'].map(path => Object.assign(new TFile(), { path }));
    const bodies: Record<string, string> = { 'Course/Empty.md': '---\n---\n', 'Course/Template.md': '---\ntags: [lecture]\n---\n' };
    const modal = new LearningSetupModal({
      vault: {
        getMarkdownFiles: () => files,
        getAbstractFileByPath: (path: string) => files.find(file => file.path === path),
        cachedRead: async (file: TFile) => bodies[file.path],
      },
    } as unknown as App, null, 'quiz');
    (modal as any).learningScope = 'folder';
    (modal as any).selectedFolderPaths = new Set(['Course']);
    const finish = jest.spyOn(modal as any, 'finish').mockImplementation(() => undefined);

    await (modal as any).start();
    expect(finish).not.toHaveBeenCalled();

    bodies['Course/Template.md'] = '---\ntags: [lecture]\n---\n조건부확률 정의';
    await (modal as any).start();
    expect(finish).toHaveBeenCalledTimes(1);
  });

  it('drops empty notes from a mixed selection instead of citing them as ground truth', async () => {
    const files = ['Course/Blank.md', 'Course/Lecture.md'].map(path => Object.assign(new TFile(), { path }));
    const modal = new LearningSetupModal({
      vault: {
        getMarkdownFiles: () => files,
        getAbstractFileByPath: (path: string) => files.find(file => file.path === path),
        cachedRead: async (file: TFile) => file.path === 'Course/Lecture.md' ? '확률의 정의' : '',
      },
    } as unknown as App, null, 'quiz');
    (modal as any).learningScope = 'folder';
    (modal as any).selectedFolderPaths = new Set(['Course']);
    let finished: any;
    jest.spyOn(modal as any, 'finish').mockImplementation((result: unknown) => { finished = result; });

    await (modal as any).start();

    expect(finished.sourceInstruction).toContain('@Course/Lecture.md');
    expect(finished.sourceInstruction).not.toContain('Blank.md');
  });

  it.each(['quiz', 'socratic'] as const)('treats a selected Brief like any other note and follows how it says to prepare (%s)', (mode) => {
    const files = ['Hackathon/Brief.md', 'Hackathon/Idea.md'].map(path => Object.assign(new TFile(), { path }));
    const modal = new LearningSetupModal({
      vault: { getMarkdownFiles: () => files, getAbstractFileByPath: (path: string) => files.find(file => file.path === path) },
      metadataCache: { getFileCache: () => ({ frontmatter: { tags: ['StudyBrief'] } }) },
    } as unknown as App, null, mode);
    (modal as any).learningScope = 'note';
    (modal as any).selectedNotePaths = new Set(['Hackathon/Brief.md', 'Hackathon/Idea.md']);

    const result = (modal as any).buildResult();

    expect(result.hasSourceNotes).toBe(true);
    expect(result.sourceInstruction).toContain('@Hackathon/Brief.md');
    expect(result.sourceInstruction).toContain('@Hackathon/Idea.md');
    expect(result.sourceInstruction).toContain('If a selected note describes how the student is preparing');
    expect(result.prompt).toContain('If a selected note describes how the student is preparing');
    expect(result).not.toHaveProperty('studyGoal');
  });
});

describe('LearningSetupModal Start checks', () => {
  afterEach(() => jest.restoreAllMocks());

  it('does not start from a note selected while the empty-note check was still reading', async () => {
    const files = ['Course/A.md', 'Course/B.md'].map(path => Object.assign(new TFile(), { path }));
    let releaseA!: () => void;
    const modal = new LearningSetupModal({
      vault: {
        getMarkdownFiles: () => files,
        getAbstractFileByPath: (path: string) => files.find(file => file.path === path),
        cachedRead: (file: TFile) => file.path === 'Course/A.md'
          ? new Promise<string>(resolve => { releaseA = () => resolve('확률의 정의'); })
          : Promise.resolve(''),
      },
    } as unknown as App, null, 'quiz');
    (modal as any).learningScope = 'note';
    (modal as any).selectedNotePaths = new Set(['Course/A.md']);
    const finish = jest.spyOn(modal as any, 'finish').mockImplementation(() => undefined);

    const starting = (modal as any).start();
    (modal as any).selectedNotePaths.delete('Course/A.md');
    (modal as any).selectedNotePaths.add('Course/B.md');
    releaseA();
    await starting;
    expect(finish).not.toHaveBeenCalled();
    expect((modal as any).starting).toBe(false);

    (modal as any).selectedNotePaths = new Set(['Course/A.md']);
    const retry = (modal as any).start();
    releaseA();
    await retry;
    expect(finish).toHaveBeenCalledTimes(1);
  });
});
