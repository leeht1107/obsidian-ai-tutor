import type { App } from 'obsidian';
import { Setting, TFile } from 'obsidian';

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

  it('lets the learner turn off an automatically detected Brief', () => {
    const brief = Object.assign(new TFile(), { path: 'Briefs/Goal.md' });
    const modal = new LearningSetupModal({
      vault: {
        getMarkdownFiles: () => [brief],
        getAbstractFileByPath: () => brief,
      },
      metadataCache: { getFileCache: () => ({ frontmatter: { tags: ['StudyBrief'], study_folder: 'Study/Goal' } }) },
    } as unknown as App, brief.path, 'quiz');
    const dropdowns: Array<{ options: Array<[string, string]>; onChange?: (value: string) => void }> = [];
    const makeElement = (): any => ({
      empty: jest.fn(), addClass: jest.fn(), setAttribute: jest.fn(), addEventListener: jest.fn(),
      createDiv: jest.fn(() => makeElement()), createSpan: jest.fn(() => makeElement()),
      createEl: jest.fn(() => makeElement()),
    });
    (modal as any).contentEl = makeElement();
    jest.spyOn(Setting.prototype, 'addDropdown').mockImplementation(function (callback: any) {
      const record: { options: Array<[string, string]>; onChange?: (value: string) => void } = { options: [] };
      const dropdown = {
        addOption(value: string, label: string) { record.options.push([value, label]); return dropdown; },
        setValue() { return dropdown; },
        onChange(handler: (value: string) => void) { record.onChange = handler; return dropdown; },
      };
      callback(dropdown);
      dropdowns.push(record);
      return this;
    });

    (modal as any).renderContent();

    const briefDropdown = dropdowns.find(item => item.options.some(([, label]) => label === 'Brief 없이 기존 방식으로 학습'));
    expect(briefDropdown).toBeDefined();
    briefDropdown?.onChange?.('');
    expect((modal as any).buildResult().studyGoal).toBeUndefined();
  });

  it('hides a saved Brief binding whose note was deleted or renamed', () => {
    const course = Object.assign(new TFile(), { path: 'Study/Lecture.md' });
    const modal = new LearningSetupModal({
      vault: { getMarkdownFiles: () => [course], getAbstractFileByPath: (path: string) => path === course.path ? course : null },
      metadataCache: { getFileCache: () => null },
    } as unknown as App, null, 'quiz', '', [{
      id: 'goal-old', briefPath: 'Briefs/Removed.md', folderPath: 'Study/Goal', contextPath: 'Study/Goal/STUDY_CONTEXT.md',
    }]);
    const dropdownOptions: string[] = [];
    const makeElement = (): any => ({
      empty: jest.fn(), addClass: jest.fn(), setAttribute: jest.fn(), addEventListener: jest.fn(),
      createDiv: jest.fn(() => makeElement()), createSpan: jest.fn(() => makeElement()), createEl: jest.fn(() => makeElement()),
    });
    (modal as any).contentEl = makeElement();
    jest.spyOn(Setting.prototype, 'addDropdown').mockImplementation(function (callback: any) {
      const dropdown = { addOption(value: string) { dropdownOptions.push(value); return dropdown; }, setValue: () => dropdown, onChange: () => dropdown };
      callback(dropdown);
      return this;
    });

    (modal as any).renderContent();

    expect(dropdownOptions).not.toContain('Briefs/Removed.md');
  });

  it('does not reapply Brief defaults over settings the learner changes before starting', () => {
    const brief = Object.assign(new TFile(), { path: 'Briefs/Goal.md' });
    const modal = new LearningSetupModal({
      vault: { getMarkdownFiles: () => [brief], getAbstractFileByPath: () => brief },
      metadataCache: { getFileCache: () => ({ frontmatter: { tags: ['StudyBrief'], study_folder: 'Study/Goal', quiz_difficulty: '상', quiz_count: 5, quiz_style: 'application' } }) },
    } as unknown as App, brief.path, 'quiz');

    (modal as any).inferBriefFromSelectedSource();
    (modal as any).difficulty = '하';
    (modal as any).questionCount = '8';
    (modal as any).questionStyle = 'material';

    expect((modal as any).buildResult()).toMatchObject({ difficulty: '하', totalQuestions: 8, questionStyle: 'material' });
  });

  it('clears Brief defaults when the learner opts out, preserving settings they changed manually', () => {
    const brief = Object.assign(new TFile(), { path: 'Briefs/Goal.md' });
    const modal = new LearningSetupModal({
      vault: { getMarkdownFiles: () => [brief], getAbstractFileByPath: () => brief },
      metadataCache: { getFileCache: () => ({ frontmatter: {
        tags: ['StudyBrief'], study_folder: 'Study/Goal', quiz_difficulty: '상', quiz_count: 8,
        quiz_style: 'application', study_web_search: true,
      } }) },
    } as unknown as App, brief.path, 'quiz');
    jest.spyOn(modal as any, 'renderContent').mockImplementation(() => undefined);

    (modal as any).handleBriefSelection(brief.path);
    expect((modal as any).buildResult()).toMatchObject({ difficulty: '상', totalQuestions: 8, questionStyle: 'application' });
    expect((modal as any).buildResult().studyGoal.webSearch).toBe(true);

    (modal as any).difficulty = '하';
    (modal as any).quizPreferencesTouched.add('difficulty');
    (modal as any).handleBriefSelection('');

    expect((modal as any).briefPath).toBe('');
    expect((modal as any).studyWebSearch).toBe(false);
    expect((modal as any).buildResult()).toMatchObject({ difficulty: '하', totalQuestions: 5, questionStyle: 'material' });
    expect((modal as any).buildResult().studyGoal).toBeUndefined();
  });

  it('retains a saved folder binding for an inferred Brief during the rendered setup flow', () => {
    const brief = Object.assign(new TFile(), { path: 'Briefs/Goal.md' });
    const goal = { id: 'goal-1', briefPath: brief.path, folderPath: 'Study/Goal', contextPath: 'Study/Goal/STUDY_CONTEXT.md' };
    const modal = new LearningSetupModal({
      vault: { getMarkdownFiles: () => [brief], getAbstractFileByPath: () => brief },
      metadataCache: { getFileCache: () => ({ frontmatter: { tags: ['StudyBrief'], quiz_difficulty: '상' } }) },
    } as unknown as App, brief.path, 'quiz', '', [goal]);
    const makeElement = (): any => ({
      empty: jest.fn(), addClass: jest.fn(), setAttribute: jest.fn(), addEventListener: jest.fn(),
      createDiv: jest.fn(() => makeElement()), createSpan: jest.fn(() => makeElement()),
      createEl: jest.fn(() => makeElement()),
    });
    (modal as any).contentEl = makeElement();
    jest.spyOn(Setting.prototype, 'addDropdown').mockImplementation(function (callback: any) {
      const dropdown = { addOption: () => dropdown, setValue: () => dropdown, onChange: () => dropdown };
      callback(dropdown);
      return this;
    });

    (modal as any).renderContent();

    expect((modal as any).buildResult().studyGoal).toMatchObject({
      briefPath: brief.path, folderPath: goal.folderPath, contextPath: goal.contextPath, existingId: goal.id,
    });
  });

  it('excludes Brief and learner-history documents from selected folder quiz evidence', () => {
    const paths = [
      'Study/Brief.md', 'Study/QUIZ_HISTORY.md', 'Study/STUDY_CONTEXT.md', 'Study/Lecture.md',
    ];
    const files = paths.map(path => Object.assign(new TFile(), { path }));
    const brief = files[0];
    const modal = new LearningSetupModal({
      vault: { getMarkdownFiles: () => files, getAbstractFileByPath: (path: string) => files.find(file => file.path === path) },
      metadataCache: { getFileCache: (file: TFile) => file === brief ? { frontmatter: { tags: ['StudyBrief'] } } : null },
    } as unknown as App, 'Study/Lecture.md', 'quiz');
    (modal as any).learningScope = 'folder';
    (modal as any).selectedFolderPaths = new Set(['Study']);
    (modal as any).studyFolderPath = 'Study/Goal';
    (modal as any).briefPath = brief.path;

    const scope = (modal as any).buildScope();

    expect(scope.sourceInstruction).toContain('@Study/Lecture.md');
    expect(scope.sourceInstruction).not.toContain('@Study/Brief.md');
    expect(scope.sourceInstruction).not.toContain('QUIZ_HISTORY.md');
    expect(scope.sourceInstruction).not.toContain('STUDY_CONTEXT.md');
  });

  it('uses prepared concepts instead of Brief or learner-history files in Socratic evidence', () => {
    const paths = ['Study/Brief.md', 'Study/QUIZ_HISTORY.md', 'Study/STUDY_CONTEXT.md', 'Study/Lecture.md'];
    const files = paths.map(path => Object.assign(new TFile(), { path }));
    const brief = files[0];
    const modal = new LearningSetupModal({
      vault: { getMarkdownFiles: () => files, getAbstractFileByPath: (path: string) => files.find(file => file.path === path) },
      metadataCache: { getFileCache: (file: TFile) => file === brief ? { frontmatter: { tags: ['StudyBrief'] } } : null },
    } as unknown as App, 'Study/Lecture.md', 'socratic');
    (modal as any).learningScope = 'folder';
    (modal as any).selectedFolderPaths = new Set(['Study']);
    (modal as any).briefPath = brief.path;
    (modal as any).studyFolderPath = 'Study/Goal';

    const scope = (modal as any).buildScope();

    expect(scope.sourceInstruction).toContain('@Study/Lecture.md');
    expect(scope.sourceInstruction).not.toContain('@Study/Brief.md');
    expect(scope.sourceInstruction).not.toContain('QUIZ_HISTORY.md');
    expect(scope.sourceInstruction).not.toContain('STUDY_CONTEXT.md');
  });

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
    (modal as any).studyFolderPath = 'Study/Goal';
    (modal as any).learningScope = 'folder';
    (modal as any).selectedFolderPaths = new Set(['Study/Empty']);

    const scope = (modal as any).buildScope();

    expect(scope).toMatchObject({
      sourceInstruction: 'No selected course notes. Use prepared concept evidence only.',
      hasSourceNotes: false,
    });
  });

  it('never uses a Brief note as course evidence, even after the learner turns the Brief off', () => {
    const brief = Object.assign(new TFile(), { path: 'Briefs/Goal.md' });
    const modal = new LearningSetupModal({
      vault: { getMarkdownFiles: () => [brief], getAbstractFileByPath: () => brief },
      metadataCache: { getFileCache: () => ({ frontmatter: { tags: ['StudyBrief'], study_folder: 'Study/Goal' } }) },
    } as unknown as App, brief.path, 'quiz');
    jest.spyOn(modal as any, 'renderContent').mockImplementation(() => undefined);

    (modal as any).handleBriefSelection('');
    const result = (modal as any).buildResult();

    expect(result.sourceInstruction).not.toContain('@Briefs/Goal.md');
    expect(result.hasSourceNotes).toBe(false);
    expect((modal as any).canStart(result)).toBe(false);
  });

  it('releases an inferred Brief and its defaults when its note is unticked', () => {
    const brief = Object.assign(new TFile(), { path: 'Briefs/Goal.md' });
    const lecture = Object.assign(new TFile(), { path: 'Study/Lecture.md' });
    const files = [brief, lecture];
    const modal = new LearningSetupModal({
      vault: { getMarkdownFiles: () => files, getAbstractFileByPath: (path: string) => files.find(file => file.path === path) },
      metadataCache: { getFileCache: (file: TFile) => file === brief
        ? { frontmatter: { tags: ['StudyBrief'], study_folder: 'Study/Goal', quiz_difficulty: '상', quiz_count: 10 } }
        : null },
    } as unknown as App, null, 'quiz');
    (modal as any).learningScope = 'note';
    (modal as any).selectedNotePaths = new Set([brief.path]);
    (modal as any).inferBriefFromSelectedSource();
    expect((modal as any).briefPath).toBe(brief.path);

    (modal as any).selectedNotePaths = new Set([lecture.path]);
    const result = (modal as any).buildResult();

    expect(result.studyGoal).toBeUndefined();
    expect(result).toMatchObject({ difficulty: '중', totalQuestions: 5, hasSourceNotes: true });
    expect(result.sourceInstruction).toContain('@Study/Lecture.md');
  });

  it('blocks a Socratic dialogue with no course evidence and never uses learner history as its source', () => {
    const history = Object.assign(new TFile(), { path: 'Study/QUIZ_HISTORY.md' });
    const modal = new LearningSetupModal({
      vault: { getMarkdownFiles: () => [history], getAbstractFileByPath: () => history },
    } as unknown as App, history.path, 'socratic');

    const result = (modal as any).buildResult();

    expect(result.sourceInstruction).not.toContain('QUIZ_HISTORY.md');
    expect(result.hasSourceNotes).toBe(false);
    expect((modal as any).canStart(result)).toBe(false);
  });

  it('releases an inferred Brief when the learner switches to folder scope', () => {
    const brief = Object.assign(new TFile(), { path: 'Briefs/Goal.md' });
    const modal = new LearningSetupModal({
      vault: { getMarkdownFiles: () => [brief], getAbstractFileByPath: () => brief },
      metadataCache: { getFileCache: () => ({ frontmatter: { tags: ['StudyBrief'], study_folder: 'Study/Goal' } }) },
    } as unknown as App, brief.path, 'quiz');
    (modal as any).inferBriefFromSelectedSource();
    expect((modal as any).briefPath).toBe(brief.path);

    (modal as any).learningScope = 'folder';
    (modal as any).selectedFolderPaths = new Set(['Course']);

    expect((modal as any).buildResult().studyGoal).toBeUndefined();
  });

  it('excludes a goal context document saved under a custom name from course evidence', () => {
    const files = ['Course/notes-context.md', 'Course/Lecture.md'].map(path => Object.assign(new TFile(), { path }));
    const modal = new LearningSetupModal({
      vault: { getMarkdownFiles: () => files, getAbstractFileByPath: (path: string) => files.find(file => file.path === path) },
    } as unknown as App, null, 'quiz', '', [{
      id: 'goal-1', briefPath: 'Briefs/Goal.md', folderPath: 'Course', contextPath: 'Course/notes-context.md',
    }]);
    (modal as any).learningScope = 'folder';
    (modal as any).selectedFolderPaths = new Set(['Course']);

    const result = (modal as any).buildResult();

    expect(result.sourceInstruction).toContain('@Course/Lecture.md');
    expect(result.sourceInstruction).not.toContain('notes-context.md');
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

  it('lets a prepared Brief goal start on its concepts when the selected notes are empty', async () => {
    const empty = Object.assign(new TFile(), { path: 'Course/Week1.md' });
    const modal = new LearningSetupModal({
      vault: {
        getMarkdownFiles: () => [empty],
        getAbstractFileByPath: (path: string) => path === empty.path ? empty : Object.assign(new TFile(), { path }),
        cachedRead: async () => '',
      },
    } as unknown as App, null, 'quiz');
    (modal as any).learningScope = 'folder';
    (modal as any).selectedFolderPaths = new Set(['Course']);
    (modal as any).briefPath = 'Briefs/Goal.md';
    (modal as any).studyFolderPath = 'Study/Goal';
    let finished: any;
    jest.spyOn(modal as any, 'finish').mockImplementation((result: unknown) => { finished = result; });

    await (modal as any).start();

    expect(finished).toMatchObject({
      hasSourceNotes: false,
      sourceInstruction: 'No selected course notes. Use prepared concept evidence only.',
    });
  });

  it('lists only Briefs inside the current subject scope plus saved goals', () => {
    const files = ['Math/Week1.md', 'Math/Brief.md', 'Physics/Brief.md'].map(path => Object.assign(new TFile(), { path }));
    const modal = new LearningSetupModal({
      vault: { getMarkdownFiles: () => files, getAbstractFileByPath: (path: string) => files.find(file => file.path === path) },
      metadataCache: { getFileCache: (file: TFile) => file.path.endsWith('Brief.md') ? { frontmatter: { tags: ['StudyBrief'] } } : null },
    } as unknown as App, 'Math/Week1.md', 'quiz');

    expect((modal as any).getBriefPaths(['Math/Week1.md', 'Math/Brief.md'])).toEqual(['Math/Brief.md']);
  });

  it('looks up Brief metadata once per note for a render, not once per candidate check', () => {
    const files = Array.from({ length: 50 }, (_, i) => Object.assign(new TFile(), { path: `Course/Week${i}.md` }));
    const getFileCache = jest.fn(() => null);
    const modal = new LearningSetupModal({
      vault: { getMarkdownFiles: () => files, getAbstractFileByPath: (path: string) => files.find(file => file.path === path) },
      metadataCache: { getFileCache },
    } as unknown as App, null, 'quiz');
    (modal as any).learningScope = 'folder';
    (modal as any).selectedFolderPaths = new Set(['Course']);

    (modal as any).buildResult();

    expect(getFileCache.mock.calls.length).toBeLessThanOrEqual(files.length);
  });

  it('uses opt-in Brief frontmatter for the goal folder, advanced application quiz and Web', () => {
    const brief = Object.assign(new TFile(), { path: 'Briefs/skhynix.md' });
    const app = {
      vault: {
        getMarkdownFiles: () => [{ path: brief.path }],
        getAbstractFileByPath: () => brief,
      },
      metadataCache: { getFileCache: () => ({
        frontmatter: {
          study_folder: 'skhynix',
          quiz_difficulty: '상',
          quiz_style: 'application',
          quiz_count: 5,
          study_web_search: true,
        },
      }) },
    } as unknown as App;
    const modal = new LearningSetupModal(app, brief.path, 'quiz');
    (modal as any).renderContent = jest.fn();

    const result = (modal as any).buildResult();
    expect(result).toMatchObject({
      totalQuestions: 5, difficulty: '상', questionStyle: 'application', enableWebSearch: true,
      studyGoal: {
        folderPath: 'skhynix', contextPath: 'skhynix/STUDY_CONTEXT.md', webSearch: true,
      },
    });
    expect(result.sourceInstruction).toContain('prepared concept evidence only');
  });

  it('reports when selected-note filtering leaves a Quiz with no usable evidence', () => {
    const paths = ['Study/STUDY_CONTEXT.md', 'Study/QUIZ_HISTORY.md'];
    const files = paths.map(path => Object.assign(new TFile(), { path }));
    const modal = new LearningSetupModal({
      vault: { getMarkdownFiles: () => files, getAbstractFileByPath: (path: string) => files.find(file => file.path === path) },
    } as unknown as App, null, 'quiz');
    (modal as any).learningScope = 'note';
    (modal as any).selectedNotePaths = new Set(paths);

    const result = (modal as any).buildResult();

    expect(result.sourceInstruction).toContain('No eligible course notes selected');
    expect(result.studyGoal).toBeUndefined();
    expect((modal as any).canStart(result)).toBe(false);
  });

  it('preserves manual Quiz settings when a checked Brief is inferred at start', () => {
    const brief = Object.assign(new TFile(), { path: 'Briefs/Goal.md' });
    const goal = { id: 'goal-1', briefPath: brief.path, folderPath: 'Study/Goal', contextPath: 'Study/Goal/STUDY_CONTEXT.md' };
    const modal = new LearningSetupModal({
      vault: { getMarkdownFiles: () => [brief], getAbstractFileByPath: () => brief },
      metadataCache: { getFileCache: () => ({ frontmatter: { tags: ['StudyBrief'], study_folder: 'Suggested/Folder', quiz_difficulty: '상', quiz_count: 5, quiz_style: 'application' } }) },
    } as unknown as App, null, 'quiz', '', [goal]);
    (modal as any).learningScope = 'note';
    (modal as any).selectedNotePaths = new Set([brief.path]);
    (modal as any).difficulty = '하';
    (modal as any).questionCount = '8';
    (modal as any).questionStyle = 'material';
    (modal as any).quizPreferencesTouched = new Set(['difficulty', 'questionCount', 'questionStyle']);

    (modal as any).inferBriefFromSelectedSource();
    const result = (modal as any).buildResult();

    expect(result).toMatchObject({ difficulty: '하', totalQuestions: 8, questionStyle: 'material' });
    expect(result.studyGoal).toMatchObject({
      briefPath: brief.path, folderPath: goal.folderPath, contextPath: goal.contextPath, existingId: goal.id,
    });
    expect(result.sourceInstruction).toBe('No selected course notes. Use prepared concept evidence only.');
  });

  it('does not turn ordinary quiz settings into Brief-driven defaults', () => {
    const result = (createModal('quiz') as any).buildResult();
    expect(result).toMatchObject({ difficulty: '중', questionStyle: 'material', enableWebSearch: false });
    expect(result.studyGoal).toBeUndefined();
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

describe('LearningSetupModal goal documents and Start checks', () => {
  afterEach(() => jest.restoreAllMocks());

  it('offers any note as the goal document, not only tagged Briefs', () => {
    const notes = ['Hackathon/Overview.md', 'Hackathon/Idea.md', 'Hackathon/Prep/STUDY_CONTEXT.md'].map(path => Object.assign(new TFile(), { path }));
    const modal = new LearningSetupModal({
      vault: { getMarkdownFiles: () => notes, getAbstractFileByPath: (path: string) => notes.find(note => note.path === path) },
      metadataCache: { getFileCache: () => null },
    } as unknown as App, 'Hackathon/Idea.md', 'quiz');
    const dropdowns: string[][] = [];
    const makeElement = (): any => ({
      empty: jest.fn(), addClass: jest.fn(), setAttribute: jest.fn(), addEventListener: jest.fn(),
      createDiv: jest.fn(() => makeElement()), createSpan: jest.fn(() => makeElement()), createEl: jest.fn(() => makeElement()),
    });
    (modal as any).contentEl = makeElement();
    jest.spyOn(Setting.prototype, 'addDropdown').mockImplementation(function (callback: any) {
      const options: string[] = [];
      const dropdown = { addOption(value: string) { options.push(value); return dropdown; }, setValue: () => dropdown, onChange: () => dropdown };
      callback(dropdown);
      dropdowns.push(options);
      return this;
    });

    (modal as any).renderContent();

    const goalOptions = dropdowns.find(options => options[0] === '' && options.includes('Hackathon/Overview.md'));
    expect(goalOptions).toBeDefined();
    expect(goalOptions).not.toContain('Hackathon/Prep/STUDY_CONTEXT.md');
  });

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
