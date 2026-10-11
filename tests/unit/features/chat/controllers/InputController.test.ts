/**
 * Tests for InputController - Message Queue and Input Handling
 */

import { Notice, TFile } from 'obsidian';

import { DEFAULT_SETTINGS } from '@/core/types/settings';
import { InputController, type InputControllerDeps } from '@/features/chat/controllers/InputController';
import { dispatchLearningSetup, requestStudyAgentMode } from '@/features/chat/ObsidianCopilotView';
import { ChatState } from '@/features/chat/state/ChatState';
import ObsidianCopilotPlugin from '@/main';
import { PermissionToggle } from '@/ui/components/InputToolbar';
import { LearningSetupModal } from '@/ui/modals/LearningSetupModal';

// Helper to create mock DOM element
function createMockElement() {
  const style: Record<string, string> = { display: 'none' };
  return {
    style,
    setText: jest.fn((text: string) => {
      (createMockElement as any).lastText = text;
    }),
    get textContent() {
      return (createMockElement as any).lastText || '';
    },
  };
}

// Helper to create mock input element
function createMockInputEl() {
  return {
    value: '',
    focus: jest.fn(),
  } as unknown as HTMLTextAreaElement;
}

function createMockChatContainer() {
  const inputWrapper = { style: { display: '' } } as any;
  let quizPanel: any = {
    remove: jest.fn(() => {
      quizPanel = null;
    }),
  };

  const container = {
    querySelector: jest.fn((selector: string) => {
      if (selector === '.ocop-quiz-answer-panel') {
        return quizPanel;
      }
      if (selector === '.ocop-input-wrapper') {
        return inputWrapper;
      }
      return null;
    }),
  } as any;

  const messagesEl = { parentElement: container } as any;

  return {
    container,
    inputWrapper,
    messagesEl,
    attachQuizPanel: () => {
      quizPanel = {
        remove: jest.fn(() => {
          quizPanel = null;
        }),
      };
      return quizPanel;
    },
  };
}

// Helper to create mock image context manager
function createMockImageContextManager() {
  return {
    hasImages: jest.fn().mockReturnValue(false),
    getAttachedImages: jest.fn().mockReturnValue([]),
    clearImages: jest.fn(),
    setImages: jest.fn(),
  };
}

async function* createMockStream(chunks: any[]) {
  for (const chunk of chunks) {
    yield chunk;
  }
}

// Helper to create mock dependencies
function createMockDeps(overrides: Partial<InputControllerDeps> = {}): InputControllerDeps {
  const state = new ChatState();
  const inputEl = createMockInputEl();
  const queueIndicatorEl = createMockElement();
  state.queueIndicatorEl = queueIndicatorEl as any;

  // Store image context manager so tests can access it
  const imageContextManager = createMockImageContextManager();

  return {
    plugin: {
      agentService: {
        query: jest.fn(),
        cancel: jest.fn(),
        resetSession: jest.fn(),
        getSessionId: jest.fn().mockReturnValue(null),
        setSessionId: jest.fn(),
        setApprovedPlanContent: jest.fn(),
        setCurrentPlanFilePath: jest.fn(),
      },
      saveSettings: jest.fn(),
      recapturePermissionMode: jest.fn(),
      settings: {
        slashCommands: [],
        blockedCommands: { unix: [], windows: [] },
        enableBlocklist: true,
        permissionMode: 'yolo',
        enableAutoTitleGeneration: true,
      },
      renameConversation: jest.fn(),
      updateConversation: jest.fn(),
      getConversationById: jest.fn().mockReturnValue(null),
    } as any,
    state,
    renderer: {
      addMessage: jest.fn().mockReturnValue({
        querySelector: jest.fn().mockReturnValue(createMockElement()),
      }),
    } as any,
    streamController: {
      showThinkingIndicator: jest.fn(),
      hideThinkingIndicator: jest.fn(),
      handleStreamChunk: jest.fn(),
      finalizeCurrentTextBlock: jest.fn(),
      finalizeCurrentThinkingBlock: jest.fn(),
      appendText: jest.fn(),
      injectChoiceButtonsIfNeeded: jest.fn(),
    } as any,
    selectionController: {
      getContext: jest.fn().mockReturnValue(null),
    } as any,
    conversationController: {
      save: jest.fn(),
      generateFallbackTitle: jest.fn().mockReturnValue('Test Title'),
      updateHistoryDropdown: jest.fn(),
    } as any,
    getInputEl: () => inputEl,
    getWelcomeEl: () => null,
    getMessagesEl: () => createMockElement() as any,
    getFileContextManager: () => ({
      startSession: jest.fn(),
      getCurrentNotePath: jest.fn().mockReturnValue(null),
      shouldSendCurrentNote: jest.fn().mockReturnValue(false),
      markCurrentNoteSent: jest.fn(),
      transformContextMentions: jest.fn().mockImplementation((text: string) => text),
    }) as any,
    getImageContextManager: () => imageContextManager as any,
    getSlashCommandManager: () => null,
    getWebSearchToggle: () => ({ isEnabled: jest.fn().mockReturnValue(false) }),
    getExternalContextSelector: () => null,
    getInstructionModeManager: () => null,
    getInstructionRefineService: () => null,
    getTitleGenerationService: () => null,
    getComponent: () => ({} as any),
    setPlanModeActive: jest.fn(),
    setBashExpansionActive: jest.fn(),
    getPlanBanner: () => null,
    generateId: () => `msg-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`,
    resetContextMeter: jest.fn(),
    ...overrides,
  };
}

/** DOM primitives for exercising the production AskUserQuestionPanel under Jest's node environment. */
class StudyPanelElement {
  className = '';
  classList = { add: jest.fn(), remove: jest.fn(), toggle: jest.fn(), contains: jest.fn().mockReturnValue(false) };
  style: Record<string, string> = {};
  children: StudyPanelElement[] = [];
  listeners: Record<string, Array<(event: any) => void>> = {};
  attributes: Record<string, string> = {};
  value = '';
  textContent = '';
  parent: StudyPanelElement | null = null;
  constructor(public tagName: string) {}
  set innerHTML(_value: string) { this.children = []; }
  appendChild(child: StudyPanelElement) { child.parent = this; this.children.push(child); return child; }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter(child => child !== this); }
  setAttribute(key: string, value: string) { this.attributes[key] = value; }
  getAttribute(key: string) { return this.attributes[key] ?? null; }
  addEventListener(key: string, listener: (event: any) => void) { (this.listeners[key] ??= []).push(listener); }
  removeEventListener(key: string, listener: (event: any) => void) { this.listeners[key] = (this.listeners[key] ?? []).filter(item => item !== listener); }
  dispatchEvent(event: any) { for (const listener of this.listeners[event.type] ?? []) listener(event); if (event.bubbles) this.parent?.dispatchEvent(event); }
  focus() { (global as any).document.activeElement = this; }
  click(event: any = {}) { this.dispatchEvent({ type: 'click', target: this, ...event }); }
  querySelectorAll(selector: string): StudyPanelElement[] {
    const className = selector.match(/\.([\w-]+)/)?.[1];
    const attr = selector.match(/\[data-([\w-]+)="([^"]+)"\]/);
    const key = attr?.[1].replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    const found: StudyPanelElement[] = [];
    const visit = (node: StudyPanelElement) => {
      if ((!className || node.className.split(/\s+/).includes(className)) && (!key || node.attributes[`data-${attr![1]}`] === attr![2])) found.push(node);
      node.children.forEach(visit);
    };
    this.children.forEach(visit);
    return found;
  }
  querySelector(selector: string) { return this.querySelectorAll(selector)[0] ?? null; }
}

function makeStudyPanelDocument() {
  const listeners: Record<string, Array<(event: any) => void>> = {};
  const body = new StudyPanelElement('body');
  return {
    body,
    activeElement: null as StudyPanelElement | null,
    createElement: (tag: string) => new StudyPanelElement(tag),
    createTextNode: (text: string) => Object.assign(new StudyPanelElement('#text'), { textContent: text }),
    addEventListener: (type: string, listener: (event: any) => void) => { (listeners[type] ??= []).push(listener); },
    removeEventListener: (type: string, listener: (event: any) => void) => { listeners[type] = (listeners[type] ?? []).filter(item => item !== listener); },
    dispatchEvent: (event: any) => (listeners[event.type] ?? []).forEach(listener => listener(event)),
  };
}

function answerStudyQuestion(container: StudyPanelElement, value: string, optionIndex = 0) {
  const panel = container.querySelector('.ocop-ask-panel');
  const option = panel?.querySelector(`.ocop-ask-panel-option[data-option-index="${optionIndex}"]`);
  if (option) {
    if (value !== option.textContent) option.textContent = value;
    option.click();
    panel?.querySelector('.ocop-ask-panel-submit-tab')?.click();
    panel?.querySelector('.ocop-ask-panel-submit-option')?.click();
  }
}

function createStudyQuestionContainer() {
  const container = new StudyPanelElement('div');
  const inputContainer = new StudyPanelElement('div');
  inputContainer.className = 'ocop-input-container';
  const inputWrapper = new StudyPanelElement('div');
  inputWrapper.className = 'ocop-input-wrapper';
  inputContainer.appendChild(inputWrapper);
  container.appendChild(inputContainer);
  (global as any).document.body.appendChild(container);
  return container;
}

describe('InputController - Message Queue', () => {
  let controller: InputController;
  let deps: InputControllerDeps;
  let inputEl: ReturnType<typeof createMockInputEl>;

  beforeEach(() => {
    jest.clearAllMocks();
    deps = createMockDeps();
    inputEl = deps.getInputEl() as ReturnType<typeof createMockInputEl>;
    controller = new InputController(deps);
  });

  describe('Queuing messages while streaming', () => {
    it('should queue message when isStreaming is true', async () => {
      deps.state.isStreaming = true;
      inputEl.value = 'queued message';

      await controller.sendMessage();

      expect(deps.state.queuedMessage).toEqual({
        content: 'queued message',
        images: undefined,
        editorContext: null,
        hidden: undefined,
        promptPrefix: undefined,
        skipLearningCommand: true,
      });
      expect(inputEl.value).toBe('');
    });

    it('should queue message with images when streaming', async () => {
      deps.state.isStreaming = true;
      inputEl.value = 'queued with images';
      const mockImages = [{ id: 'img1', name: 'test.png' }];
      const imageContextManager = deps.getImageContextManager()!;
      (imageContextManager.hasImages as jest.Mock).mockReturnValue(true);
      (imageContextManager.getAttachedImages as jest.Mock).mockReturnValue(mockImages);

      await controller.sendMessage();

      expect(deps.state.queuedMessage).toEqual({
        content: 'queued with images',
        images: mockImages,
        editorContext: null,
        hidden: undefined,
        promptPrefix: undefined,
        skipLearningCommand: true,
      });
      expect(imageContextManager.clearImages).toHaveBeenCalled();
    });

    it('should append new message to existing queued message', async () => {
      deps.state.isStreaming = true;
      inputEl.value = 'first message';
      await controller.sendMessage();

      inputEl.value = 'second message';
      await controller.sendMessage();

      expect(deps.state.queuedMessage!.content).toBe('first message\n\nsecond message');
    });

    it('should preserve prompt prefix when queuing', async () => {
      deps.state.isStreaming = true;
      inputEl.value = 'queued plan';

      await controller.sendMessage({ promptPrefix: 'Plan prefix' });

      expect(deps.state.queuedMessage?.promptPrefix).toBe('Plan prefix');
    });

    it('should merge images when appending to queue', async () => {
      deps.state.isStreaming = true;
      const imageContextManager = deps.getImageContextManager()!;

      // First message with image
      inputEl.value = 'first';
      (imageContextManager.hasImages as jest.Mock).mockReturnValue(true);
      (imageContextManager.getAttachedImages as jest.Mock).mockReturnValue([{ id: 'img1' }]);
      await controller.sendMessage();

      // Second message with another image
      inputEl.value = 'second';
      (imageContextManager.getAttachedImages as jest.Mock).mockReturnValue([{ id: 'img2' }]);
      await controller.sendMessage();

      expect(deps.state.queuedMessage!.images).toHaveLength(2);
      expect(deps.state.queuedMessage!.images![0].id).toBe('img1');
      expect(deps.state.queuedMessage!.images![1].id).toBe('img2');
    });

    it('should not queue empty message', async () => {
      deps.state.isStreaming = true;
      inputEl.value = '';
      const imageContextManager = deps.getImageContextManager()!;
      (imageContextManager.hasImages as jest.Mock).mockReturnValue(false);

      await controller.sendMessage();

      expect(deps.state.queuedMessage).toBeNull();
    });
  });

  describe('Queued message processing', () => {
    it('sends a queued bare Brief mention as chat after the active learning session ends', async () => {
      jest.useFakeTimers();
      try {
        const brief = Object.assign(new TFile(), { path: 'Briefs/Goal.md' });
        (deps.plugin as any).app = {
          vault: { getAbstractFileByPath: jest.fn(() => brief) },
          metadataCache: { getFileCache: jest.fn(() => ({ frontmatter: { tags: ['StudyBrief'] } })) },
        };
        deps.getFileContextManager = () => ({
          startSession: jest.fn(), getCurrentNotePath: jest.fn().mockReturnValue(null),
          shouldSendCurrentNote: jest.fn().mockReturnValue(false),
          transformContextMentions: jest.fn((text: string) => text),
          getResolvedMentionPaths: jest.fn().mockReturnValue([{ start: 0, end: 15, path: brief.path }]),
        }) as any;
        (deps.plugin as any).storage = { loadState: jest.fn().mockResolvedValue({ studyGoalBindings: [] }) };
        deps.plugin.agentService.query = jest.fn().mockImplementation(() => createMockStream([{ type: 'done' }]));
        const openModal = jest.spyOn(LearningSetupModal.prototype, 'openAndWait').mockResolvedValue(null);
        deps.state.isStreaming = true;
        deps.state.quizSession = { totalQuestions: 2, currentQuestion: 2, scopeLabel: 'quiz' };
        await controller.sendMessage({ content: '@Briefs/Goal.md' });
        expect(deps.state.queuedMessage?.skipLearningCommand).toBe(true);
        deps.state.isStreaming = false;
        deps.state.quizSession = null;

        (controller as any).processQueuedMessage();
        jest.runAllTimers();
        await Promise.resolve();

        expect(openModal).not.toHaveBeenCalled();
        expect(deps.plugin.agentService.query).toHaveBeenCalled();
      } finally {
        jest.useRealTimers();
      }
    });

    it('should forward prompt prefix when sending queued message in non-plan mode', async () => {
      jest.useFakeTimers();
      try {
        deps.plugin.settings.permissionMode = 'ask';
        deps.state.queuedMessage = {
          content: 'queued plan',
          images: undefined,
          editorContext: null,
          promptPrefix: 'Plan prefix',
        };

        const sendSpy = jest.spyOn(controller, 'sendMessage').mockResolvedValue(undefined);

        (controller as any).processQueuedMessage();
        jest.runAllTimers();
        await Promise.resolve();

        expect(sendSpy).toHaveBeenCalledWith(expect.objectContaining({ promptPrefix: 'Plan prefix' }));
        sendSpy.mockRestore();
      } finally {
        jest.useRealTimers();
      }
    });
  });

  describe('Queue indicator UI', () => {
    it('should show queue indicator when message is queued', () => {
      deps.state.queuedMessage = { content: 'test message', images: undefined, editorContext: null };

      controller.updateQueueIndicator();

      const queueIndicatorEl = deps.state.queueIndicatorEl as any;
      expect(queueIndicatorEl.setText).toHaveBeenCalledWith('⌙ Queued: test message');
      expect(queueIndicatorEl.style.display).toBe('block');
    });

    it('should hide queue indicator when no message is queued', () => {
      deps.state.queuedMessage = null;

      controller.updateQueueIndicator();

      const queueIndicatorEl = deps.state.queueIndicatorEl as any;
      expect(queueIndicatorEl.style.display).toBe('none');
    });

    it('should truncate long message preview in indicator', () => {
      const longMessage = 'a'.repeat(100);
      deps.state.queuedMessage = { content: longMessage, images: undefined, editorContext: null };

      controller.updateQueueIndicator();

      const queueIndicatorEl = deps.state.queueIndicatorEl as any;
      const call = queueIndicatorEl.setText.mock.calls[0][0] as string;
      expect(call).toContain('...');
    });

    it('should include [images] when queue message has images', () => {
      const mockImages = [{ id: 'img1', name: 'test.png' }];
      deps.state.queuedMessage = { content: 'queued content', images: mockImages as any, editorContext: null };

      controller.updateQueueIndicator();

      const queueIndicatorEl = deps.state.queueIndicatorEl as any;
      const call = queueIndicatorEl.setText.mock.calls[0][0] as string;
      expect(call).toContain('queued content');
      expect(call).toContain('[images]');
    });

    it('should show [images] when queue message has only images', () => {
      const mockImages = [{ id: 'img1', name: 'test.png' }];
      deps.state.queuedMessage = { content: '', images: mockImages as any, editorContext: null };

      controller.updateQueueIndicator();

      const queueIndicatorEl = deps.state.queueIndicatorEl as any;
      expect(queueIndicatorEl.setText).toHaveBeenCalledWith('⌙ Queued: [images]');
    });
  });

  describe('Clearing queued message', () => {
    it('should clear queued message and update indicator', () => {
      deps.state.queuedMessage = { content: 'test', images: undefined, editorContext: null };

      controller.clearQueuedMessage();

      expect(deps.state.queuedMessage).toBeNull();
      const queueIndicatorEl = deps.state.queueIndicatorEl as any;
      expect(queueIndicatorEl.style.display).toBe('none');
    });
  });

  describe('Cancel streaming', () => {
    it('should clear queue on cancel', () => {
      deps.state.queuedMessage = { content: 'test', images: undefined, editorContext: null };
      deps.state.isStreaming = true;

      controller.cancelStreaming();

      expect(deps.state.queuedMessage).toBeNull();
      expect(deps.state.cancelRequested).toBe(true);
      expect(deps.plugin.agentService.cancel).toHaveBeenCalled();
    });

    it('should not cancel if not streaming', () => {
      deps.state.isStreaming = false;

      controller.cancelStreaming();

      expect(deps.plugin.agentService.cancel).not.toHaveBeenCalled();
    });
  });

  describe('Sending messages', () => {
    it('should send message, hide welcome, and save conversation', async () => {
      const welcomeEl = { style: { display: '' } } as any;
      const fileContextManager = {
        startSession: jest.fn(),
        getCurrentNotePath: jest.fn().mockReturnValue(null),
        shouldSendCurrentNote: jest.fn().mockReturnValue(false),
        markCurrentNoteSent: jest.fn(),
        transformContextMentions: jest.fn().mockImplementation((text: string) => text),
      };
      const imageContextManager = deps.getImageContextManager()!;

      deps.getWelcomeEl = () => welcomeEl;
      deps.getFileContextManager = () => fileContextManager as any;
      deps.state.currentConversationId = 'conv-1';
      deps.plugin.agentService.query = jest.fn().mockImplementation(() => createMockStream([{ type: 'done' }]));

      inputEl.value = 'See ![[image.png]]';

      await controller.sendMessage();

      expect(welcomeEl.style.display).toBe('none');
      expect(fileContextManager.startSession).toHaveBeenCalled();
      expect(deps.renderer.addMessage).toHaveBeenCalledTimes(2);
      expect(deps.state.messages).toHaveLength(2);
      expect(deps.state.messages[0].content).toBe('See ![[image.png]]');
      expect(deps.state.messages[0].images).toBeUndefined();
      expect(imageContextManager.clearImages).toHaveBeenCalled();
      expect(deps.plugin.renameConversation).toHaveBeenCalledWith('conv-1', 'Test Title');
      expect(deps.conversationController.save).toHaveBeenCalledWith(true);
      expect(deps.plugin.agentService.query).toHaveBeenCalled();
      expect(deps.state.isStreaming).toBe(false);
    });

    // Was "only once per session". Three of the four CLIs get a fresh process per
    // turn, so the note the first turn announced is gone with the process that
    // heard it — which is how a student ended up asking about the note on screen
    // and being told there was none.
    it('prepends the current note to every message, not just the first', async () => {
      const prompts: string[] = [];
      const fileContextManager = {
        startSession: jest.fn(),
        getCurrentNotePath: jest.fn().mockReturnValue('notes/session.md'),
        shouldSendCurrentNote: jest.fn().mockReturnValue(true),
        transformContextMentions: jest.fn().mockImplementation((text: string) => text),
      };

      deps.getFileContextManager = () => fileContextManager as any;
      deps.plugin.agentService.query = jest.fn().mockImplementation((prompt: string) => {
        prompts.push(prompt);
        return createMockStream([{ type: 'done' }]);
      });

      inputEl.value = 'First message';
      await controller.sendMessage();

      inputEl.value = 'Second message';
      await controller.sendMessage();

      expect(prompts[0]).toContain('<current_note>');
      expect(prompts[1]).toContain('<current_note>');
      expect(prompts[1]).toContain('notes/session.md');
    });

    it('should send hidden message with content override without clearing input', async () => {
      deps.plugin.agentService.query = jest.fn().mockImplementation(() => createMockStream([{ type: 'done' }]));
      inputEl.value = 'draft message';

      await controller.sendMessage({ hidden: true, content: 'Auto prompt' });

      expect(inputEl.value).toBe('draft message');
      expect(deps.state.messages[0].content).toBe('Auto prompt');
      expect(deps.state.messages[0].hidden).toBe(true);
      expect(deps.renderer.addMessage).toHaveBeenCalledTimes(1);
    });

    it.each(['quiz', 'socratic'] as const)('treats a bare Brief mention as a normal answer during an active %s session', async (mode) => {
      const brief = Object.assign(new TFile(), { path: 'Briefs/Goal.md' });
      (deps.plugin as any).app = {
        vault: { getAbstractFileByPath: jest.fn(() => brief) },
        metadataCache: { getFileCache: jest.fn(() => ({ frontmatter: { tags: ['StudyBrief'] } })) },
      };
      if (mode === 'quiz') {
        deps.state.quizSession = { totalQuestions: 3, currentQuestion: 1, scopeLabel: 'quiz' };
      } else {
        deps.state.socraticSession = { maxDepth: 20, currentDepth: 1, scopeLabel: 'socratic', supportLevel: 1, isSummaryPhase: false };
      }
      (deps.plugin as any).storage = { loadState: jest.fn().mockResolvedValue({}) };
      deps.getFileContextManager = () => ({
        startSession: jest.fn(), getCurrentNotePath: jest.fn().mockReturnValue(null),
        shouldSendCurrentNote: jest.fn().mockReturnValue(false),
        transformContextMentions: jest.fn((text: string) => text),
        getResolvedMentionPaths: jest.fn().mockReturnValue([{ start: 0, end: 15, path: brief.path }]),
      }) as any;
      const openModal = jest.spyOn(LearningSetupModal.prototype, 'openAndWait').mockResolvedValue(null);
      deps.plugin.agentService.query = jest.fn().mockImplementation(() => createMockStream([{ type: 'done' }]));

      await controller.sendMessage({ content: '@Briefs/Goal.md' });

      expect(openModal).not.toHaveBeenCalled();
      expect(deps.plugin.agentService.query).toHaveBeenCalled();
    });

    it('clears the bash-expansion busy flag even when expandCommand throws', async () => {
      const slashCommandManager = {
        setCommands: jest.fn(),
        detectCommand: jest.fn().mockReturnValue({ commandName: 'boom', args: [] }),
        expandCommand: jest.fn().mockRejectedValue(new Error('bash expansion failed')),
      };
      deps.getSlashCommandManager = () => slashCommandManager as any;
      deps.plugin.settings.slashCommands = [
        { id: 'boom', name: 'boom', content: '!`sleep 5`' },
      ];

      await expect(controller.sendMessage({ content: '/boom' })).rejects.toThrow('bash expansion failed');

      expect(deps.setBashExpansionActive).toHaveBeenNthCalledWith(1, true);
      expect(deps.setBashExpansionActive).toHaveBeenNthCalledWith(2, false);
    });

    it('fails a slash command before dispatch when a native provider cannot enforce its tool restriction', async () => {
      (deps.plugin.settings as any).selectedProvider = 'claude';
      const slashCommandManager = {
        setCommands: jest.fn(),
        detectCommand: jest.fn().mockReturnValue({ commandName: 'read-only', args: [] }),
        expandCommand: jest.fn().mockResolvedValue({
          expandedPrompt: 'Inspect these notes',
          allowedTools: ['Read'],
          errors: [],
        }),
      };
      deps.getSlashCommandManager = () => slashCommandManager as any;
      deps.plugin.settings.slashCommands = [{ id: 'read-only', name: 'read-only', content: 'Inspect', allowedTools: ['Read'] }];
      deps.plugin.agentService.query = jest.fn().mockImplementation(() => createMockStream([{ type: 'done' }]));

      await controller.sendMessage({ content: '/read-only' });

      expect(slashCommandManager.expandCommand).not.toHaveBeenCalled();
      expect(deps.plugin.agentService.query).not.toHaveBeenCalled();
      expect(deps.streamController.appendText).toHaveBeenCalledWith(expect.stringContaining('cannot enforce'));
      expect(deps.state.messages[1].requestOutcome).toBe('failed');
    });

    it('treats an empty slash-command allowlist as an explicit zero-tool restriction', async () => {
      (deps.plugin.settings as any).selectedProvider = 'claude';
      const slashCommandManager = {
        setCommands: jest.fn(),
        detectCommand: jest.fn().mockReturnValue({ commandName: 'no-tools', args: [] }),
        expandCommand: jest.fn().mockResolvedValue({ expandedPrompt: 'Prompt', allowedTools: [], errors: [] }),
      };
      deps.getSlashCommandManager = () => slashCommandManager as any;
      deps.plugin.settings.slashCommands = [{ id: 'no-tools', name: 'no-tools', content: 'Prompt', allowedTools: [] }];
      deps.plugin.agentService.query = jest.fn().mockImplementation(() => createMockStream([{ type: 'done' }]));

      await controller.sendMessage({ content: '/no-tools' });

      expect(slashCommandManager.expandCommand).not.toHaveBeenCalled();
      expect(deps.plugin.agentService.query).not.toHaveBeenCalled();
      expect(deps.streamController.appendText).toHaveBeenCalledWith(expect.stringContaining('cannot enforce'));
      expect(deps.state.messages[1].requestOutcome).toBe('failed');
    });

    it('does not enable inline bash when a Copilot slash allowlist omits Bash', async () => {
      deps.plugin.settings.permissionMode = 'agent';
      (deps.plugin.settings as any).selectedProvider = 'copilot';
      (deps.plugin.settings as any).enableInlineBash = true;
      let seenBashOptions: any;
      const slashCommandManager = {
        setCommands: jest.fn(),
        detectCommand: jest.fn().mockReturnValue({ commandName: 'read-only', args: [] }),
        expandCommand: jest.fn().mockImplementation((_cmd: any, _args: any, options: any) => {
          seenBashOptions = options.bash;
          return Promise.resolve({ expandedPrompt: 'expanded', allowedTools: ['Read'], errors: [] });
        }),
      };
      deps.getSlashCommandManager = () => slashCommandManager as any;
      deps.plugin.settings.slashCommands = [{
        id: 'read-only',
        name: 'read-only',
        content: 'inspect notes',
        allowedTools: ['Read'],
      }];
      deps.plugin.agentService.query = jest.fn().mockImplementation(() => createMockStream([{ type: 'done' }]));

      await controller.sendMessage({ content: '/read-only' });

      expect(seenBashOptions.enabled).toBe(false);
    });

    it('does not infer current-note scope from expanded @file content', async () => {
      (deps.plugin.settings as any).selectedProvider = 'copilot';
      const slashCommandManager = {
        setCommands: jest.fn(),
        detectCommand: jest.fn().mockReturnValue({ commandName: 'review', args: ['other.md'] }),
        expandCommand: jest.fn().mockResolvedValue({
          expandedPrompt: 'Review <referenced_file>This note explains another topic.</referenced_file>',
          errors: [],
        }),
      };
      deps.getSlashCommandManager = () => slashCommandManager as any;
      deps.plugin.settings.slashCommands = [{
        id: 'review',
        name: 'review',
        content: 'Review @$1',
      }];
      const readCurrentNoteContent = jest.fn().mockResolvedValue('ACTIVE NOTE SECRET');
      (controller as any).readCurrentNoteContent = readCurrentNoteContent;
      deps.getFileContextManager = () => ({
        startSession: jest.fn(),
        getCurrentNotePath: jest.fn().mockReturnValue('active.md'),
        shouldSendCurrentNote: jest.fn().mockReturnValue(true),
        markCurrentNoteSent: jest.fn(),
        transformContextMentions: (text: string) => text,
      }) as any;
      let promptSeen = '';
      deps.plugin.agentService.query = jest.fn().mockImplementation((prompt: string) => {
        promptSeen = prompt;
        return createMockStream([{ type: 'done' }]);
      });

      await controller.sendMessage({ content: '/review other.md' });

      expect(readCurrentNoteContent).not.toHaveBeenCalled();
      expect(promptSeen).not.toContain('ACTIVE NOTE SECRET');
      expect((deps.plugin.agentService.query as jest.Mock).mock.calls[0][3].allowedTools).toBeUndefined();
    });

    // agy in a read-only mode cannot read the note itself: headless agy auto-denies the
    // shell tool its model reaches for, so a path-only prompt ends with no answer.
    it('inlines the attached current note body for agy in ask mode', async () => {
      (deps.plugin.settings as any).selectedProvider = 'agy';
      (deps.plugin.settings as any).permissionMode = 'ask';
      const readCurrentNoteContent = jest.fn().mockResolvedValue('ACTIVE NOTE BODY');
      (controller as any).readCurrentNoteContent = readCurrentNoteContent;
      deps.getFileContextManager = () => ({
        startSession: jest.fn(),
        getCurrentNotePath: jest.fn().mockReturnValue('active.md'),
        shouldSendCurrentNote: jest.fn().mockReturnValue(true),
        markCurrentNoteSent: jest.fn(),
        transformContextMentions: (text: string) => text,
      }) as any;
      let promptSeen = '';
      deps.plugin.agentService.query = jest.fn().mockImplementation((prompt: string) => {
        promptSeen = prompt;
        return createMockStream([{ type: 'done' }]);
      });

      await controller.sendMessage({ content: '이 내용이 뭐야?' });

      expect(promptSeen).toContain('<current_note_content path="active.md">');
      expect(promptSeen).toContain('ACTIVE NOTE BODY');
      expect((deps.plugin.agentService.query as jest.Mock).mock.calls[0][3]?.allowedTools).toBeUndefined();
    });

    // The inline decision must follow the mode agy is actually dispatched in, not the toggle:
    // a learning session forces read-only, and agy stays read-only unless unsafe agent is on.
    it.each([
      ['an active learning session', true, () => {
        deps.state.socraticSession = { maxDepth: 20, currentDepth: 2, scopeLabel: 'socratic', supportLevel: 1, isSummaryPhase: false } as any;
      }],
      ['unsafe agy agent disabled', false, () => {}],
    ])('inlines the attached note for agy dispatched read-only by %s', async (_label, allowUnsafe, arrange) => {
      (deps.plugin.settings as any).selectedProvider = 'agy';
      (deps.plugin.settings as any).permissionMode = 'agent';
      (deps.plugin.settings as any).blanketWriteAcknowledged = ['agy'];
      (deps.plugin.settings as any).allowUnsafeAgyAgent = allowUnsafe;
      (arrange as () => void)();
      (controller as any).readCurrentNoteContent = jest.fn().mockResolvedValue('ACTIVE NOTE BODY');
      deps.getFileContextManager = () => ({
        startSession: jest.fn(),
        getCurrentNotePath: jest.fn().mockReturnValue('active.md'),
        shouldSendCurrentNote: jest.fn().mockReturnValue(true),
        markCurrentNoteSent: jest.fn(),
        transformContextMentions: (text: string) => text,
      }) as any;
      let promptSeen = '';
      deps.plugin.agentService.query = jest.fn().mockImplementation((prompt: string) => {
        promptSeen = prompt;
        return createMockStream([{ type: 'done' }]);
      });

      await controller.sendMessage({ content: '이 내용이 뭐야?' });

      expect(promptSeen).toContain('ACTIVE NOTE BODY');
    });

    it('keeps agy path-only when it is really dispatched in agent mode', async () => {
      (deps.plugin.settings as any).selectedProvider = 'agy';
      (deps.plugin.settings as any).permissionMode = 'agent';
      (deps.plugin.settings as any).blanketWriteAcknowledged = ['agy'];
      (deps.plugin.settings as any).allowUnsafeAgyAgent = true;
      const readCurrentNoteContent = jest.fn().mockResolvedValue('ACTIVE NOTE BODY');
      (controller as any).readCurrentNoteContent = readCurrentNoteContent;
      deps.getFileContextManager = () => ({
        startSession: jest.fn(),
        getCurrentNotePath: jest.fn().mockReturnValue('active.md'),
        shouldSendCurrentNote: jest.fn().mockReturnValue(true),
        markCurrentNoteSent: jest.fn(),
        transformContextMentions: (text: string) => text,
      }) as any;
      deps.plugin.agentService.query = jest.fn().mockImplementation(() => createMockStream([{ type: 'done' }]));

      await controller.sendMessage({ content: '이 내용이 뭐야?' });

      expect(readCurrentNoteContent).not.toHaveBeenCalled();
    });

    it('does not read a current note the user excluded, even for agy in ask mode', async () => {
      (deps.plugin.settings as any).selectedProvider = 'agy';
      (deps.plugin.settings as any).permissionMode = 'ask';
      const readCurrentNoteContent = jest.fn().mockResolvedValue('EXCLUDED NOTE BODY');
      (controller as any).readCurrentNoteContent = readCurrentNoteContent;
      deps.getFileContextManager = () => ({
        startSession: jest.fn(),
        getCurrentNotePath: jest.fn().mockReturnValue('active.md'),
        shouldSendCurrentNote: jest.fn().mockReturnValue(false),
        markCurrentNoteSent: jest.fn(),
        transformContextMentions: (text: string) => text,
      }) as any;
      let promptSeen = '';
      deps.plugin.agentService.query = jest.fn().mockImplementation((prompt: string) => {
        promptSeen = prompt;
        return createMockStream([{ type: 'done' }]);
      });

      await controller.sendMessage({ content: '이 내용이 뭐야?' });

      expect(readCurrentNoteContent).not.toHaveBeenCalled();
      expect(promptSeen).not.toContain('EXCLUDED NOTE BODY');
    });

    it('detects current-note scope after argument substitution but before side-effect expansion', async () => {
      (deps.plugin.settings as any).selectedProvider = 'copilot';
      const slashCommandManager = {
        setCommands: jest.fn(),
        detectCommand: jest.fn().mockReturnValue({ commandName: 'sum', args: 'this' }),
        expandSemanticPrompt: jest.fn().mockReturnValue('Summarize this note'),
        expandCommand: jest.fn().mockResolvedValue({
          expandedPrompt: 'Summarize this note',
          errors: [],
        }),
      };
      deps.getSlashCommandManager = () => slashCommandManager as any;
      deps.plugin.settings.slashCommands = [{
        id: 'sum',
        name: 'sum',
        content: 'Summarize $ARGUMENTS note',
      }];
      const readCurrentNoteContent = jest.fn().mockResolvedValue('ACTIVE NOTE CONTENT');
      (controller as any).readCurrentNoteContent = readCurrentNoteContent;
      deps.getFileContextManager = () => ({
        startSession: jest.fn(),
        getCurrentNotePath: jest.fn().mockReturnValue('active.md'),
        shouldSendCurrentNote: jest.fn().mockReturnValue(true),
        markCurrentNoteSent: jest.fn(),
        transformContextMentions: (text: string) => text,
      }) as any;
      let promptSeen = '';
      deps.plugin.agentService.query = jest.fn().mockImplementation((prompt: string) => {
        promptSeen = prompt;
        return createMockStream([{ type: 'done' }]);
      });

      await controller.sendMessage({ content: '/sum this' });

      expect(slashCommandManager.expandSemanticPrompt).toHaveBeenCalled();
      expect(readCurrentNoteContent).toHaveBeenCalledWith('active.md');
      expect(promptSeen).toContain('ACTIVE NOTE CONTENT');
      expect((deps.plugin.agentService.query as jest.Mock).mock.calls[0][3].allowedTools)
        .toEqual(expect.arrayContaining(['view']));
    });

    it('intersects current-note tools with an explicit slash allowlist instead of broadening it', async () => {
      (deps.plugin.settings as any).selectedProvider = 'copilot';
      const slashCommandManager = {
        setCommands: jest.fn(),
        detectCommand: jest.fn().mockReturnValue({ commandName: 'grep-only', args: [] }),
        expandCommand: jest.fn().mockResolvedValue({
          expandedPrompt: '현재 노트에서 찾아줘',
          allowedTools: ['Grep'],
          errors: [],
        }),
      };
      deps.getSlashCommandManager = () => slashCommandManager as any;
      deps.plugin.settings.slashCommands = [{
        id: 'grep-only',
        name: 'grep-only',
        content: '현재 노트에서 찾아줘',
        allowedTools: ['Grep'],
      }];
      (controller as any).readCurrentNoteContent = jest.fn().mockResolvedValue('note body');
      deps.getFileContextManager = () => ({
        startSession: jest.fn(),
        getCurrentNotePath: jest.fn().mockReturnValue('db.md'),
        shouldSendCurrentNote: jest.fn().mockReturnValue(true),
        markCurrentNoteSent: jest.fn(),
        transformContextMentions: (text: string) => text,
      }) as any;
      deps.plugin.agentService.query = jest.fn().mockImplementation(() => createMockStream([{ type: 'done' }]));

      await controller.sendMessage({ content: '/grep-only' });

      const queryOptions = (deps.plugin.agentService.query as jest.Mock).mock.calls[0][3];
      expect(queryOptions.allowedTools).toEqual([]);
    });

    it('does not auto-generate a title after a restricted native slash command is rejected', async () => {
      (deps.plugin.settings as any).selectedProvider = 'claude';
      (deps.plugin.settings as any).enableAutoTitleGeneration = true;
      const mockTitleService = {
        generateTitle: jest.fn().mockResolvedValue(undefined),
        cancel: jest.fn(),
      };
      deps.getTitleGenerationService = () => mockTitleService as any;
      const slashCommandManager = {
        setCommands: jest.fn(),
        detectCommand: jest.fn().mockReturnValue({ commandName: 'read-only', args: [] }),
        expandCommand: jest.fn(),
      };
      deps.getSlashCommandManager = () => slashCommandManager as any;
      deps.plugin.settings.slashCommands = [{
        id: 'read-only',
        name: 'read-only',
        content: 'Inspect',
        allowedTools: ['Read'],
      }];

      await controller.sendMessage({ content: '/read-only' });

      expect(slashCommandManager.expandCommand).not.toHaveBeenCalled();
      expect(mockTitleService.generateTitle).not.toHaveBeenCalled();
    });

    it('treats Read and view as the same tool when intersecting current-note scope', async () => {
      (deps.plugin.settings as any).selectedProvider = 'copilot';
      const slashCommandManager = {
        setCommands: jest.fn(),
        detectCommand: jest.fn().mockReturnValue({ commandName: 'read-only', args: [] }),
        expandCommand: jest.fn().mockResolvedValue({
          expandedPrompt: '현재 노트를 읽어줘',
          allowedTools: ['Read'],
          errors: [],
        }),
      };
      deps.getSlashCommandManager = () => slashCommandManager as any;
      deps.plugin.settings.slashCommands = [{
        id: 'read-only',
        name: 'read-only',
        content: '현재 노트를 읽어줘',
        allowedTools: ['Read'],
      }];
      (controller as any).readCurrentNoteContent = jest.fn().mockResolvedValue('note body');
      deps.getFileContextManager = () => ({
        startSession: jest.fn(),
        getCurrentNotePath: jest.fn().mockReturnValue('db.md'),
        shouldSendCurrentNote: jest.fn().mockReturnValue(true),
        markCurrentNoteSent: jest.fn(),
        transformContextMentions: (text: string) => text,
      }) as any;
      deps.plugin.agentService.query = jest.fn().mockImplementation(() => createMockStream([{ type: 'done' }]));

      await controller.sendMessage({ content: '/read-only' });

      const queryOptions = (deps.plugin.agentService.query as jest.Mock).mock.calls[0][3];
      expect(queryOptions.allowedTools).toEqual(['Read']);
    });

    it('does not enable inline bash when permissionMode is agent but the selected provider still needs blanket-write consent', async () => {
      // claude writes without asking, so it needs one-time consent before Agent means
      // anything; switching providers does not run that consent gate, so raw
      // permissionMode === 'agent' is not enough on its own.
      deps.plugin.settings.permissionMode = 'agent';
      (deps.plugin.settings as any).selectedProvider = 'claude';
      (deps.plugin.settings as any).blanketWriteAcknowledged = [];
      (deps.plugin.settings as any).enableInlineBash = true;
      let seenBashOptions: any;
      const slashCommandManager = {
        setCommands: jest.fn(),
        detectCommand: jest.fn().mockReturnValue({ commandName: 'greet', args: [] }),
        expandCommand: jest.fn().mockImplementation((_cmd: any, _args: any, options: any) => {
          seenBashOptions = options.bash;
          return Promise.resolve({ expandedPrompt: 'expanded', errors: [] });
        }),
      };
      deps.getSlashCommandManager = () => slashCommandManager as any;
      deps.plugin.settings.slashCommands = [{ id: 'greet', name: 'greet', content: 'hi !`echo hi`' }];
      deps.plugin.agentService.query = jest.fn().mockImplementation(() => createMockStream([{ type: 'done' }]));

      await controller.sendMessage({ content: '/greet' });

      expect(seenBashOptions.enabled).toBe(false);
    });

    it.each(['quiz', 'socratic'] as const)(
      'blocks inline bash in an active %s session before expanding a slash command',
      async (mode) => {
        deps.plugin.settings.permissionMode = 'agent';
        (deps.plugin.settings as any).selectedProvider = 'copilot';
        (deps.plugin.settings as any).enableInlineBash = true;
        const slashCommandManager = {
          setCommands: jest.fn(),
          detectCommand: jest.fn().mockReturnValue({ commandName: 'greet', args: [] }),
          expandCommand: jest.fn().mockImplementation((_cmd: any, _args: any, options: any) => {
            expect(options.bash.enabled).toBe(false);
            return Promise.resolve({ expandedPrompt: 'expanded', errors: [] });
          }),
        };
        deps.getSlashCommandManager = () => slashCommandManager as any;
        deps.plugin.settings.slashCommands = [{ id: 'greet', name: 'greet', content: 'hi !`echo hi`' }];
        deps.plugin.agentService.query = jest.fn().mockImplementation(() => createMockStream([{ type: 'done' }]));
        if (mode === 'quiz') {
          deps.state.quizSession = { totalQuestions: 2, currentQuestion: 1, scopeLabel: 'quiz' };
        } else {
          deps.state.socraticSession = {
            maxDepth: 4, currentDepth: 1, scopeLabel: 'socratic', supportLevel: 1, isSummaryPhase: false,
          };
        }

        await controller.sendMessage({ content: '/greet' });

        expect(slashCommandManager.expandCommand).toHaveBeenCalled();
        expect((deps.plugin.agentService.query as jest.Mock).mock.calls[0][3]).toMatchObject({ readOnly: true, enableWebSearch: false });
      }
    );

    it('locks the toggle for the whole duration a provider request is streaming, not just inline bash', async () => {
      let busy = false;
      let busyMidStream: boolean | null = null;
      deps.setBashExpansionActive = jest.fn((active: boolean) => { busy = active; });
      deps.plugin.agentService.query = jest.fn().mockImplementation(() => createMockStream([{ type: 'probe' }, { type: 'done' }]));
      deps.streamController.handleStreamChunk = jest.fn().mockImplementation(async (chunk: any) => {
        if (chunk.type === 'probe') {
          // Mid-stream: the request is in flight and nothing has settled it yet.
          busyMidStream = busy;
        }
      });

      await controller.sendMessage({ content: 'hello' });

      expect(busyMidStream).toBe(true);
      expect(busy).toBe(false);
    });

    it('infers quiz session state for toolbar-launched quiz prompts', async () => {
      deps.plugin.agentService.query = jest.fn().mockImplementation(() => createMockStream([{ type: 'done' }]));
      const displayContent = '/quiz · 현재 노트 · db.md · 4문제 · 상 · 연계 응용 · 정규화';

      await controller.sendMessage({
        content: 'Generated quiz prompt',
        displayContentOverride: displayContent,
      });

      expect((deps.plugin.agentService.query as jest.Mock).mock.calls[0][3]).toMatchObject({ readOnly: true, enableWebSearch: true });

      expect(deps.state.quizSession).toEqual({
        totalQuestions: 4,
        currentQuestion: 1,
        scopeLabel: displayContent,
        focusText: '정규화',
        difficulty: '상',
        questionStyle: 'application',
        enableWebSearch: true,
      });
      const prompt = (deps.plugin.agentService.query as jest.Mock).mock.calls[0][0] as string;
      expect(prompt).not.toContain('You are continuing an active quiz');
    });

    it('keeps quiz continuation prompts grounded in the original quiz source', async () => {
      deps.plugin.agentService.query = jest.fn().mockImplementation(() => createMockStream([{ type: 'done' }]));
      deps.state.quizSession = {
        totalQuestions: 5,
        currentQuestion: 1,
        scopeLabel: '/quiz · 현재 노트 · db.md · 5문제 · 중 · 전체 범위',
        difficulty: '중',
        sourceInstruction: 'Use only the current note as ground truth source material: @db.md',
      };

      await controller.sendMessage({ content: 'C' });

      expect((deps.plugin.agentService.query as jest.Mock).mock.calls[0][3]).toMatchObject({ readOnly: true, enableWebSearch: false });

      const prompt = (deps.plugin.agentService.query as jest.Mock).mock.calls[0][0] as string;
      expect(prompt).toContain('You are continuing an active quiz');
      expect(prompt).toContain('@db.md');
      expect(prompt).toContain('Do not use any knowledge outside the selected ground truth notes/folder');
      expect(prompt).toContain('Continue the SAME quiz scope');
      expect(prompt).toContain('## {N}/{T}번 문제');
      expect(deps.state.quizSession?.currentQuestion).toBe(2);
    });

    it('does not advance Quiz or Socratic state when the provider returns an error chunk', async () => {
      deps.plugin.agentService.query = jest.fn().mockImplementation(() => createMockStream([
        { type: 'error', content: 'provider failed' },
        { type: 'text', content: 'late output after terminal error' },
      ]));
      deps.streamController.handleStreamChunk = jest.fn().mockImplementation((_chunk: any, msg: any) => {
        msg.quizQuestion = { current: 2, total: 3, multiSelect: false, freeText: false, options: [] };
      });
      deps.state.quizSession = { totalQuestions: 3, currentQuestion: 1, scopeLabel: 'quiz', difficulty: '중' };
      await controller.sendMessage({ content: 'C' });
      expect(deps.state.quizSession?.currentQuestion).toBe(1);
      expect(deps.state.messages.at(-1)?.quizQuestion).toBeNull();
      expect(deps.state.messages.at(-1)?.requestOutcome).toBe('failed');
      expect(deps.streamController.handleStreamChunk).toHaveBeenCalledTimes(1);

      deps.plugin.agentService.query = jest.fn().mockImplementation(() => createMockStream([{ type: 'error', content: 'provider failed' }]));
      deps.state.socraticSession = { maxDepth: 20, currentDepth: 2, scopeLabel: 'socratic', supportLevel: 1, isSummaryPhase: false };
      await controller.sendMessage({ content: '모르겠어요' });
      expect(deps.state.socraticSession).toMatchObject({ currentDepth: 2, supportLevel: 1 });
    });

    it('clears a newly started learning session when the provider throws', async () => {
      deps.plugin.agentService.query = jest.fn().mockImplementation(() => { throw new Error('provider failed'); });
      await controller.sendMessage({ content: 'quiz prompt', quizSessionInit: { totalQuestions: 2, scopeLabel: 'quiz', difficulty: '중' } });
      expect(deps.state.quizSession).toBeNull();

      deps.plugin.agentService.query = jest.fn().mockImplementation(() => createMockStream([{ type: 'error', content: 'provider failed' }]));
      await controller.sendMessage({ content: 'socratic prompt', socraticSessionInit: { scopeLabel: 'socratic' } });
      expect(deps.state.socraticSession).toBeNull();
    });

    it.each([['상', ['view', 'web_search', 'web_fetch']], ['중', ['view']]] as const)(
      'keeps current-note Quiz tools aligned with difficulty %s', async (difficulty, allowedTools) => {
        deps.plugin.agentService.query = jest.fn().mockImplementation(() => createMockStream([{ type: 'done' }]));
        (controller as any).readCurrentNoteContent = jest.fn().mockResolvedValue('note body');
        deps.getFileContextManager = () => ({
          startSession: jest.fn(), getCurrentNotePath: jest.fn().mockReturnValue('db.md'),
          shouldSendCurrentNote: jest.fn().mockReturnValue(true), markCurrentNoteSent: jest.fn(),
          transformContextMentions: (text: string) => text,
        }) as any;
        await controller.sendMessage({
          content: '현재 노트로 퀴즈를 내 주세요',
          quizSessionInit: { totalQuestions: 2, scopeLabel: '현재 노트', difficulty },
        });
        expect((deps.plugin.agentService.query as jest.Mock).mock.calls[0][3].allowedTools).toEqual(allowedTools);
      }
    );

    it('preserves related-application mode when an active quiz continues', async () => {
      deps.plugin.agentService.query = jest.fn().mockImplementation(() => createMockStream([{ type: 'done' }]));
      deps.state.quizSession = Object.assign({
        totalQuestions: 5,
        currentQuestion: 1,
        scopeLabel: '/quiz · 현재 노트 · db.md · 5문제 · 중 · 연계 응용 · 전체 범위',
        difficulty: '중' as const,
        sourceInstruction: 'Use only the current note as ground truth source material: @db.md',
      }, { questionStyle: 'application' as const });

      await controller.sendMessage({ content: 'C' });

      const prompt = (deps.plugin.agentService.query as jest.Mock).mock.calls[0][0] as string;
      expect(prompt).toContain('apply concepts from the selected material to fresh scenarios');
      expect(deps.state.quizSession).toHaveProperty('questionStyle', 'application');
    });

    it('injects the exact previous quiz question when grading a bare answer after progression', async () => {
      deps.plugin.agentService.query = jest.fn().mockImplementation(() => createMockStream([{ type: 'done' }]));
      deps.state.quizSession = {
        totalQuestions: 5,
        currentQuestion: 2,
        scopeLabel: '/quiz · 폴더 · Week14/notes · 5문제 · 중 · 전체 범위',
        difficulty: '중',
        sourceInstruction: 'Use only these selected notes as ground truth source material: @Week14/notes/a.md, @Week14/notes/b.md',
      };
      deps.state.addMessage({
        id: 'assistant-q1',
        role: 'assistant',
        content: '',
        timestamp: Date.now(),
        contentBlocks: [{
          type: 'text',
          content: [
            '## 1/5번 문제',
            '',
            '#### 이름 없는 인라인뷰(중첩)에서 노트가 지적한 통증이 아닌 것은 무엇입니까?',
            '',
            'A. 가독성 문제 — 읽는 순서와 실행 순서가 반대여서 혼란이 생긴다.',
            'B. 의도 불명 문제 — 서브쿼리의 목적이 코드만으로 드러나지 않는다.',
            'C. 수정 부담 문제 — 조건을 바꾸려면 깊은 괄호 안을 찾아 여러 곳을 고쳐야 한다.',
            'D. 성능 향상 — 중첩으로 인해 실행 속도가 항상 빨라진다.',
          ].join('\n'),
        }],
        quizQuestion: {
          current: 1,
          total: 5,
          multiSelect: false,
          freeText: false,
          options: [
            { label: 'A', text: '가독성 문제 — 읽는 순서와 실행 순서가 반대여서 혼란이 생긴다.' },
            { label: 'B', text: '의도 불명 문제 — 서브쿼리의 목적이 코드만으로 드러나지 않는다.' },
            { label: 'C', text: '수정 부담 문제 — 조건을 바꾸려면 깊은 괄호 안을 찾아 여러 곳을 고쳐야 한다.' },
            { label: 'D', text: '성능 향상 — 중첩으로 인해 실행 속도가 항상 빨라진다.' },
          ],
        },
      });

      await controller.sendMessage({ content: 'D' });

      const prompt = (deps.plugin.agentService.query as jest.Mock).mock.calls[0][0] as string;
      expect(prompt).toContain('student is answering question 1 of 5');
      expect(prompt).toContain('ask exactly question 2 of 5');
      expect(prompt).toContain('<quiz_question_to_grade>');
      expect(prompt).toContain('이름 없는 인라인뷰(중첩)');
      expect(prompt).toContain('D. 성능 향상 — 중첩으로 인해 실행 속도가 항상 빨라진다.');
      expect(prompt).toContain('Use <quiz_question_to_grade> as the grading target');
      expect(deps.state.quizSession?.currentQuestion).toBe(3);
    });

    it('sends a non-advancing hint prompt for quizHintRequest and leaves the current question unchanged', async () => {
      deps.plugin.agentService.query = jest.fn().mockImplementation(() => createMockStream([{ type: 'done' }]));
      deps.state.quizSession = {
        totalQuestions: 5,
        currentQuestion: 2,
        scopeLabel: '/quiz · 현재 노트 · db.md · 5문제 · 중 · 전체 범위',
        difficulty: '중',
        sourceInstruction: 'Use only the current note as ground truth source material: @db.md',
      };

      await controller.sendMessage({ content: '힌트 주세요', quizHintRequest: true });

      expect((deps.plugin.agentService.query as jest.Mock).mock.calls[0][3]).toMatchObject({ readOnly: true, enableWebSearch: false });

      const prompt = (deps.plugin.agentService.query as jest.Mock).mock.calls[0][0] as string;
      expect(prompt).toContain('QUIZ HINT REQUEST');
      expect(prompt).toContain('Do NOT reveal the correct answer');
      expect(prompt).not.toContain('You are continuing an active quiz');
      expect(prompt).toContain('@db.md');
      // The hint must not consume a turn — the student still needs to answer question 2.
      expect(deps.state.quizSession?.currentQuestion).toBe(2);
    });

    it('uses the Quiz setup result Web policy without changing the global toolbar toggle', async () => {
      const setEnabled = jest.fn();
      deps = createMockDeps({
        getWebSearchToggle: () => ({ isEnabled: jest.fn().mockReturnValue(false), setEnabled }),
      });
      controller = new InputController(deps);
      deps.plugin.agentService.query = jest.fn().mockImplementation(() => createMockStream([{ type: 'done' }]));

      await (controller as any).sendLearningSetupResult({
        mode: 'quiz', prompt: 'quiz prompt', displayContent: 'quiz display', totalQuestions: 2,
        difficulty: '상', enableWebSearch: true,
      }, {});

      expect((deps.plugin.agentService.query as jest.Mock).mock.calls[0][3]).toMatchObject({ enableWebSearch: true });
      expect(setEnabled).not.toHaveBeenCalled();
    });

    it('keeps a Brief Web choice enabled across every Quiz turn without changing the toolbar toggle', async () => {
      const setEnabled = jest.fn();
      deps = createMockDeps({
        getWebSearchToggle: () => ({ isEnabled: () => false, setEnabled }),
      });
      controller = new InputController(deps);
      (deps.plugin as any).storage = {
        loadState: jest.fn().mockResolvedValue({ studyGoalBindings: [] }), updateState: jest.fn(),
      };
      (deps.plugin as any).getActiveConversation = jest.fn().mockReturnValue(null);
      deps.plugin.agentService.query = jest.fn().mockImplementation(() => createMockStream([{ type: 'done' }]));
      const goal = { existingId: 'goal-1', briefPath: 'Briefs/Goal.md', folderPath: 'Study', contextPath: 'Study/STUDY_CONTEXT.md', webSearch: true };
      jest.spyOn(controller as any, 'confirmStudyGoalSetup').mockResolvedValue(goal);
      jest.spyOn(controller as any, 'prepareStudyGoal').mockImplementation(async (_goal: unknown, result: unknown) => result);

      await (controller as any).sendLearningSetupResult({
        mode: 'quiz', prompt: 'quiz prompt', displayContent: 'quiz display', totalQuestions: 2,
        difficulty: '중', questionStyle: 'material', sourceInstruction: 'prepared', enableWebSearch: false,
        studyGoal: goal,
      }, {});
      await controller.sendMessage({ content: 'student answer' });

      expect((deps.plugin.agentService.query as jest.Mock).mock.calls.map(call => call[3].enableWebSearch)).toEqual([true, true]);
      expect(deps.state.quizSession?.enableWebSearch).toBe(true);
      expect(setEnabled).not.toHaveBeenCalled();
    });

    it('keeps a Brief Web choice enabled across Socratic turns without changing the toolbar toggle', async () => {
      const setEnabled = jest.fn();
      deps = createMockDeps({
        getWebSearchToggle: () => ({ isEnabled: () => false, setEnabled }),
      });
      controller = new InputController(deps);
      (deps.plugin as any).storage = {
        loadState: jest.fn().mockResolvedValue({ studyGoalBindings: [] }), updateState: jest.fn(),
      };
      (deps.plugin as any).getActiveConversation = jest.fn().mockReturnValue(null);
      deps.plugin.agentService.query = jest.fn().mockImplementation(() => createMockStream([{ type: 'done' }]));
      const goal = { existingId: 'goal-1', briefPath: 'Briefs/Goal.md', folderPath: 'Study', contextPath: 'Study/STUDY_CONTEXT.md', webSearch: true };
      jest.spyOn(controller as any, 'confirmStudyGoalSetup').mockResolvedValue(goal);
      jest.spyOn(controller as any, 'prepareStudyGoal').mockImplementation(async (_goal: unknown, result: unknown) => result);

      await (controller as any).sendLearningSetupResult({
        mode: 'socratic', prompt: 'dialogue prompt', displayContent: 'dialogue display', sourceInstruction: 'prepared',
        studyGoal: goal,
      }, {});
      await controller.sendMessage({ content: 'student answer' });

      expect((deps.plugin.agentService.query as jest.Mock).mock.calls.map(call => call[3].enableWebSearch)).toEqual([true, true]);
      expect(deps.state.socraticSession?.enableWebSearch).toBe(true);
      expect(setEnabled).not.toHaveBeenCalled();
    });

    it.each([false, true])('keeps ordinary chat governed by the global Web toggle (%s)', async (enabled) => {
      deps = createMockDeps({
        getWebSearchToggle: () => ({ isEnabled: jest.fn().mockReturnValue(enabled) }),
      });
      controller = new InputController(deps);
      deps.plugin.agentService.query = jest.fn().mockImplementation(() => createMockStream([{ type: 'done' }]));

      await controller.sendMessage({ content: 'hello' });

      expect((deps.plugin.agentService.query as jest.Mock).mock.calls[0][3]).toMatchObject({ enableWebSearch: enabled });
    });

    it('passes low-difficulty Quiz Web-off intent to Agy for its one-time warning and fallback', async () => {
      deps.plugin.settings.selectedProvider = 'agy' as any;
      deps.plugin.agentService.query = jest.fn().mockImplementation(() => createMockStream([{ type: 'done' }]));
      await controller.sendMessage({
        content: 'quiz prompt',
        quizSessionInit: { totalQuestions: 2, scopeLabel: 'quiz', difficulty: '중' },
      });
      expect((deps.plugin.agentService.query as jest.Mock).mock.calls[0][3]).toMatchObject({
        enableWebSearch: false,
      });
    });

    it.each([
      ['하', false, false], ['하', true, false],
      ['중', false, false], ['중', true, false],
      ['상', false, true], ['상', true, true],
    ] as const)('uses Quiz %s Web policy with global toggle %s', async (difficulty, globalToggle, expectedWebSearch) => {
      for (const requestType of ['initial', 'continuation', 'hint'] as const) {
        const setEnabled = jest.fn();
        const isEnabled = jest.fn().mockReturnValue(globalToggle);
        deps = createMockDeps({
          getWebSearchToggle: () => ({ isEnabled, setEnabled }),
        });
        controller = new InputController(deps);
        deps.plugin.agentService.query = jest.fn().mockImplementation(() => createMockStream([{ type: 'done' }]));

        if (requestType === 'initial') {
          await controller.sendMessage({
            content: 'quiz prompt',
            quizSessionInit: {
              totalQuestions: 2,
              scopeLabel: 'quiz display',
              difficulty,
            },
          });
        } else {
          deps.state.quizSession = {
            totalQuestions: 2,
            currentQuestion: 1,
            scopeLabel: 'quiz display',
            difficulty,
          };
          await controller.sendMessage({ content: 'C', quizHintRequest: requestType === 'hint' });
        }

        const queryOptions = (deps.plugin.agentService.query as jest.Mock).mock.calls[0][3];
        expect(queryOptions).toMatchObject({
          enableWebSearch: expectedWebSearch,
        });
        expect(setEnabled).not.toHaveBeenCalled();
      }
    });

    describe('Mode switching cleanup', () => {
      it('starts the optional quiz review with the Socratic initial prompt and original source', async () => {
        deps.plugin.agentService.query = jest.fn().mockImplementation(() => createMockStream([{ type: 'done' }]));
        const finalTurn = {
          id: 'quiz-final', role: 'assistant' as const, content: '완료', timestamp: Date.now(),
          quizReviewAvailable: true,
          quizReviewSourceInstruction: 'Use only this selected source as ground truth: @db.md',
          quizReviewEnableWebSearch: true,
        };
        deps.state.addMessage(finalTurn);

        await controller.startQuizReview('quiz-final');

        const query = deps.plugin.agentService.query as jest.Mock;
        const prompt = query.mock.calls[0][0] as string;
        expect(prompt).toContain("Mark's digital teaching twin");
        expect(prompt).toContain('SOURCE MATERIAL: Use only this selected source as ground truth: @db.md');
        expect(prompt).toContain('이 Quiz에서 헷갈린 개념을 소크라테스식 질문으로 복습해 주세요.');
        expect(query.mock.calls[0][3]).toMatchObject({ readOnly: true });
        expect(query.mock.calls[0][3]).toMatchObject({ enableWebSearch: true });
        expect(finalTurn.quizReviewAvailable).toBe(false);
      });

      it('reviews the quiz message whose button was clicked instead of the latest quiz', async () => {
        deps.plugin.agentService.query = jest.fn().mockImplementation(() => createMockStream([{ type: 'done' }]));
        const clickedQuiz = {
          id: 'quiz-clicked', role: 'assistant' as const, content: '완료 A', timestamp: Date.now(),
          quizReviewAvailable: true,
          quizReviewSourceInstruction: 'SOURCE A: @course-a.md',
        };
        const latestQuiz = {
          id: 'quiz-latest', role: 'assistant' as const, content: '완료 B', timestamp: Date.now(),
          quizReviewAvailable: true,
          quizReviewSourceInstruction: 'SOURCE B: @course-b.md',
        };
        deps.state.addMessage(clickedQuiz);
        deps.state.addMessage(latestQuiz);

        await controller.startQuizReview(clickedQuiz.id);

        const prompt = (deps.plugin.agentService.query as jest.Mock).mock.calls[0][0] as string;
        expect(prompt).toContain('SOURCE MATERIAL: SOURCE A: @course-a.md');
        expect(prompt).not.toContain('SOURCE B: @course-b.md');
        expect(clickedQuiz.quizReviewAvailable).toBe(false);
        expect(latestQuiz.quizReviewAvailable).toBe(true);
      });

      it('explains why a stored quiz cannot be reviewed while another learning session is active', async () => {
        const finalTurn = {
          id: 'quiz-final', role: 'assistant' as const, content: '완료', timestamp: Date.now(),
          quizReviewAvailable: true,
          quizReviewSourceInstruction: 'source',
        };
        deps.state.addMessage(finalTurn);
        deps.state.quizSession = { totalQuestions: 5, currentQuestion: 2, scopeLabel: '다른 퀴즈' };
        (Notice as any).messages.length = 0;

        await (controller as any).startQuizReview(finalTurn.id);

        expect((Notice as any).messages.at(-1)).toMatch(/진행 중/);
        expect(finalTurn.quizReviewAvailable).toBe(true);
        expect(deps.plugin.agentService.query).not.toHaveBeenCalled();
      });

      it('clears active quiz state and answer panel before starting socratic mode', async () => {
        const { inputWrapper, messagesEl, container, attachQuizPanel } = createMockChatContainer();
        const showSocraticBanner = jest.fn();

        deps = createMockDeps({
          getMessagesEl: () => messagesEl,
          showSocraticBanner,
          getWebSearchToggle: () => ({ isEnabled: jest.fn().mockReturnValue(true) }),
        });
        controller = new InputController(deps);
        deps.state.quizSession = {
          totalQuestions: 5,
          currentQuestion: 2,
          scopeLabel: '기존 퀴즈',
        };
        inputWrapper.style.display = 'none';
        attachQuizPanel();

        deps.plugin.agentService.query = jest.fn().mockImplementation(() => createMockStream([{ type: 'done' }]));

        await controller.sendMessage({
          content: '학습 모드로 전환',
          socraticSessionInit: {
            scopeLabel: '학습 범위',
            focusText: '트랜잭션',
            sourceInstruction: 'The following note is the source material for the dialogue: @db.md',
          },
        });

        expect((deps.plugin.agentService.query as jest.Mock).mock.calls[0][3]).toMatchObject({ readOnly: true, enableWebSearch: true });

        const prompt = (deps.plugin.agentService.query as jest.Mock).mock.calls[0][0] as string;
        expect(prompt).not.toContain('You are continuing an active quiz.');
        expect(deps.state.quizSession).toBeNull();
        expect(deps.state.socraticSession?.scopeLabel).toBe('학습 범위');
        expect(deps.state.socraticSession?.sourceInstruction).toBe('The following note is the source material for the dialogue: @db.md');
        expect(deps.state.socraticSession?.supportLevel).toBe(1);
        expect(showSocraticBanner).toHaveBeenCalledWith(
          '학습 범위',
          '트랜잭션',
          expect.any(Function),
          expect.any(Function)
        );
        expect(container.querySelector('.ocop-quiz-answer-panel')).toBeNull();
        expect(inputWrapper.style.display).toBe('');
      });

      it('keeps Socratic continuation prompts grounded and adapts support when stuck', async () => {
        deps.plugin.agentService.query = jest.fn().mockImplementation(() => createMockStream([{ type: 'done' }]));
        deps.state.socraticSession = {
          maxDepth: 20,
          currentDepth: 2,
          scopeLabel: '/socratic · 현재 노트 · db.md · 전체 범위',
          focusText: 'CTE vs VIEW',
          sourceInstruction: 'The following note is the source material for the dialogue: @db.md',
          supportLevel: 1,
          isSummaryPhase: false,
        };

        await controller.sendMessage({ content: '모르겠어요' });

        expect((deps.plugin.agentService.query as jest.Mock).mock.calls[0][3]).toMatchObject({ readOnly: true, enableWebSearch: false });

        const prompt = (deps.plugin.agentService.query as jest.Mock).mock.calls[0][0] as string;
        expect(prompt).toContain('[SOCRATIC SESSION');
        expect(prompt).toContain('Mark\'s digital teaching twin');
        expect(prompt).toContain('@db.md');
        expect(prompt).toContain('CTE vs VIEW');
        expect(prompt).toContain('Current mode: rescue');
        expect(prompt).toContain('Do not run a twenty-questions game');
        expect(deps.state.socraticSession?.supportLevel).toBe(2);
      });

      it('clears active socratic state before starting quiz mode', async () => {
        const hideSocraticBanner = jest.fn();

        deps = createMockDeps({
          hideSocraticBanner,
        });
        controller = new InputController(deps);
        deps.state.socraticSession = {
          maxDepth: 20,
          currentDepth: 4,
          scopeLabel: '기존 학습',
          focusText: '정규화',
          isSummaryPhase: false,
        };
        deps.plugin.agentService.query = jest.fn().mockImplementation(() => createMockStream([{ type: 'done' }]));

        await controller.sendMessage({
          content: '새 퀴즈 시작',
          quizSessionInit: {
            totalQuestions: 3,
            scopeLabel: '새 퀴즈',
            focusText: 'PK',
          },
        });

        const prompt = (deps.plugin.agentService.query as jest.Mock).mock.calls[0][0] as string;
        expect(prompt).not.toContain('[SOCRATIC SESSION');
        expect(deps.state.socraticSession).toBeNull();
        expect(hideSocraticBanner).toHaveBeenCalled();
        expect(deps.state.quizSession).toEqual({
          totalQuestions: 3,
          currentQuestion: 1,
          scopeLabel: '새 퀴즈',
          focusText: 'PK',
          difficulty: undefined,
          sourceInstruction: undefined,
        });
      });
    });
  });

  describe('In-flight turn exclusion from replayed history', () => {
    it('does not replay the in-flight user message or the assistant placeholder', async () => {
      deps.plugin.agentService.query = jest.fn().mockImplementation(() => createMockStream([{ type: 'done' }]));
      deps.state.addMessage({
        id: 'earlier-user',
        role: 'user',
        content: '정규화가 뭐야?',
        timestamp: Date.now(),
      });
      deps.state.addMessage({
        id: 'earlier-assistant',
        role: 'assistant',
        content: '중복을 줄이는 설계입니다.',
        timestamp: Date.now(),
      });

      await controller.sendMessage({ content: '3정규형은?' });

      const history = (deps.plugin.agentService.query as jest.Mock).mock.calls[0][2] as typeof deps.state.messages;
      expect(history.map(msg => msg.id)).toEqual(['earlier-user', 'earlier-assistant']);
      // The earlier conversation must survive — dropping the in-flight pair is the
      // whole change, and taking too much here would erase the context instead.
      expect(history).toHaveLength(2);
      expect(deps.state.messages).toHaveLength(4);
    });

    it('sends a quiz-controlled question to the CLI exactly once, in its expanded form', async () => {
      deps.plugin.agentService.query = jest.fn().mockImplementation(() => createMockStream([{ type: 'done' }]));
      deps.state.quizSession = {
        totalQuestions: 5,
        currentQuestion: 1,
        scopeLabel: '/quiz · 현재 노트 · db.md · 5문제 · 중 · 전체 범위',
        difficulty: '중',
        sourceInstruction: 'Use only the current note as ground truth source material: @db.md',
      };

      await controller.sendMessage({ content: '외래키가 뭔가요' });

      const [prompt, , history] = (deps.plugin.agentService.query as jest.Mock).mock.calls[0] as [
        string,
        unknown,
        typeof deps.state.messages,
      ];
      const replayed = history.map(msg => msg.content).join('\n');
      expect(prompt).toContain('You are continuing an active quiz');
      expect(prompt).toContain('외래키가 뭔가요');
      expect(replayed).not.toContain('외래키가 뭔가요');
    });
  });

  describe('Plan mode', () => {
    it('clears stale plan file path when starting plan mode in plan permission', async () => {
      (deps.plugin.agentService.query as jest.Mock).mockReturnValue(
        createMockStream([{ type: 'done' }])
      );
      deps.plugin.settings.permissionMode = 'plan';
      inputEl.value = 'Plan this';

      await controller.sendPlanModeMessage();

      expect(deps.plugin.agentService.setCurrentPlanFilePath).toHaveBeenCalledWith(null);
    });

    it('sends plan mode request prefix without switching permission', async () => {
      deps.plugin.agentService.query = jest.fn().mockImplementation((prompt: string) => {
        expect(prompt).toContain('User requested plan mode. Call EnterPlanMode before responding.');
        return createMockStream([{ type: 'done' }]);
      });
      deps.plugin.settings.permissionMode = 'ask';
      inputEl.value = 'Plan this';

      await controller.sendPlanModeMessage();

      expect(deps.plugin.settings.permissionMode).toBe('ask');
      expect(deps.state.planModeState).toBeNull();
      expect(deps.state.messages[0].content).toBe('Plan this');
    });

    it('routes queued messages through plan mode when permissionMode is plan', async () => {
      jest.useFakeTimers();
      try {
        deps.plugin.settings.permissionMode = 'plan';
        deps.state.queuedMessage = { content: 'Queued plan', images: undefined, editorContext: null };

        const sendPlanModeSpy = jest
          .spyOn(controller as any, 'sendMessageWithPlanMode')
          .mockResolvedValue(undefined);
        const sendSpy = jest.spyOn(controller, 'sendMessage').mockResolvedValue(undefined);

        (controller as any).processQueuedMessage();
        jest.runAllTimers();
        await Promise.resolve();

        expect(sendPlanModeSpy).toHaveBeenCalledWith(
          expect.objectContaining({ content: 'Queued plan' })
        );
        expect(sendSpy).not.toHaveBeenCalled();
      } finally {
        jest.useRealTimers();
      }
    });

    it('activates plan permission mode after EnterPlanMode is pending', async () => {
      deps.plugin.agentService.query = jest.fn().mockImplementation(() => createMockStream([{ type: 'done' }]));
      deps.plugin.settings.permissionMode = 'ask';
      inputEl.value = 'Original request';

      await controller.handleEnterPlanMode();
      expect(deps.state.planModeActivationPending).toBe(true);

      await controller.sendMessage();

      expect(deps.plugin.settings.permissionMode).toBe('plan');
      expect(deps.plugin.saveSettings).toHaveBeenCalled();
      expect(deps.state.planModeState?.isActive).toBe(true);
      expect(deps.state.planModeState?.agentInitiated).toBe(true);
    });

    it('should send hidden plan mode message without rendering user bubble', async () => {
      (deps.plugin.agentService.query as jest.Mock).mockReturnValue(
        createMockStream([{ type: 'done' }])
      );
      deps.plugin.settings.permissionMode = 'plan';
      const imageContextManager = deps.getImageContextManager()!;

      await (controller as any).sendMessageWithPlanMode({
        content: 'Revise plan',
        hidden: true,
        images: [],
      });

      expect(deps.state.messages[0].hidden).toBe(true);
      expect(deps.renderer.addMessage).toHaveBeenCalledTimes(1);
      expect(imageContextManager.clearImages).not.toHaveBeenCalled();
    });

    it.each([
      ['failed', [{ type: 'text', content: 'partial plan' }, { type: 'error', content: 'provider failed' }]],
      ['interrupted', [{ type: 'text', content: 'partial plan' }, { type: 'done' }]],
    ] as const)('does not generate a title after a %s first plan turn', async (kind, chunks) => {
      const mockTitleService = {
        generateTitle: jest.fn().mockResolvedValue(undefined),
        cancel: jest.fn(),
      };
      deps.getTitleGenerationService = () => mockTitleService as any;
      deps.state.currentConversationId = 'conv-plan';
      deps.plugin.settings.enableAutoTitleGeneration = true;
      deps.plugin.settings.permissionMode = 'plan';
      deps.plugin.agentService.query = jest.fn().mockImplementation(async function* () {
        for (const chunk of chunks) {
          yield chunk;
          if (kind === 'interrupted' && chunk.type === 'text') {
            deps.state.cancelRequested = true;
          }
        }
      });
      deps.streamController.handleStreamChunk = jest.fn().mockImplementation(async (chunk: any, msg: any) => {
        if (chunk.type === 'text') msg.content += chunk.content;
      });

      await (controller as any).sendMessageWithPlanMode({ content: 'Plan this' });

      expect(deps.state.messages.at(-1)?.requestOutcome).toBe(kind);
      expect(mockTitleService.generateTitle).not.toHaveBeenCalled();
      expect(deps.plugin.updateConversation).not.toHaveBeenCalledWith(
        'conv-plan',
        { titleGenerationStatus: 'pending' }
      );
    });

    it('restores ask, not agent, when exiting plan mode with no prior mode recorded', async () => {
      // lastNonPlanPermissionMode unset is the fallback path — it must never silently
      // escalate to agent (full write access, no blanket-write consent gate).
      deps.plugin.settings.permissionMode = 'plan';
      deps.plugin.settings.lastNonPlanPermissionMode = undefined;

      await (controller as any).exitPlanPermissionMode();

      expect(deps.plugin.settings.permissionMode).toBe('ask');
    });

    it('returns to Ask and clears runtime Agent authority when a plan ends', async () => {
      // Reproduces the adversarial sequence: a plan region is still draining (having
      // captured 'ask', since plan always resolves read-only) when its own approval
      // callback restores 'agent'. The write-authority counter and capture below are the
      // REAL plugin machinery (src/main.ts), not a mock, so this exercises the actual
      // interaction between `exitPlanPermissionMode` and `recapturePermissionMode`.
      const plugin = new ObsidianCopilotPlugin(
        { workspace: { getLeavesOfType: jest.fn().mockReturnValue([]) } } as any,
        { id: 'obsidian-ai-tutor', version: '0.0.0' } as any
      );
      plugin.settings = {
        ...DEFAULT_SETTINGS,
        selectedProvider: 'codex',
        permissionMode: 'plan',
        lastNonPlanPermissionMode: 'agent',
        enableInlineBash: true,
      };
      (plugin as any).saveSettings = jest.fn().mockResolvedValue(undefined);

      deps.plugin = plugin as any;
      deps.setBashExpansionActive = (active: boolean) => plugin.setBashExpansionActive(active);
      controller = new InputController(deps);

      // The write-authority region this plan request opened is still open.
      plugin.setBashExpansionActive(true);
      expect(plugin.getCapturedPermissionMode()).toBe('ask');

      // Plan approval is not a reusable Agent grant. A later Agent transition
      // has to ask again, even while this read-only region finishes draining.
      await (controller as any).exitPlanPermissionMode();

      expect(plugin.settings.permissionMode).toBe('ask');
      expect(plugin.settings.blanketWriteAcknowledged).toEqual([]);
      expect(plugin.getCapturedPermissionMode()).toBe('ask');

      // The region is still open; draining it clears the capture as normal.
      plugin.setBashExpansionActive(false);
      expect(plugin.getCapturedPermissionMode()).toBeNull();
    });
  });

  describe('Title generation', () => {
    it('keeps only the fallback title for Agy without starting AI title generation', async () => {
      const mockTitleService = {
        generateTitle: jest.fn().mockResolvedValue(undefined),
        cancel: jest.fn(),
      };
      deps = createMockDeps({
        getTitleGenerationService: () => mockTitleService as any,
      });
      deps.plugin.settings.selectedProvider = 'agy' as any;
      deps.plugin.settings.enableAutoTitleGeneration = true;
      deps.state.currentConversationId = 'conv-agy';
      deps.plugin.agentService.query = jest.fn().mockImplementation(() => createMockStream([
        { type: 'text', content: 'Response' },
        { type: 'done' },
      ]));
      deps.streamController.handleStreamChunk = jest.fn().mockImplementation(async (chunk: any, msg: any) => {
        if (chunk.type === 'text') msg.content = chunk.content;
      });
      controller = new InputController(deps);

      await controller.sendMessage({ content: 'Hello Agy' });

      expect(deps.plugin.renameConversation).toHaveBeenCalledWith('conv-agy', 'Test Title');
      expect(mockTitleService.generateTitle).not.toHaveBeenCalled();
      expect(deps.plugin.updateConversation).not.toHaveBeenCalledWith(
        'conv-agy',
        { titleGenerationStatus: 'pending' }
      );
    });

    it('should set pending status and fallback title after first exchange', async () => {
      const mockTitleService = {
        generateTitle: jest.fn().mockResolvedValue(undefined),
        cancel: jest.fn(),
      };
      const welcomeEl = { style: { display: '' } } as any;
      const fileContextManager = {
        startSession: jest.fn(),
        getCurrentNotePath: jest.fn().mockReturnValue(null),
        shouldSendCurrentNote: jest.fn().mockReturnValue(false),
        markCurrentNoteSent: jest.fn(),
        transformContextMentions: jest.fn().mockImplementation((text: string) => text),
      };
      const imageContextManager = createMockImageContextManager();

      deps = createMockDeps({
        getWelcomeEl: () => welcomeEl,
        getFileContextManager: () => fileContextManager as any,
        getImageContextManager: () => imageContextManager as any,
        getTitleGenerationService: () => mockTitleService as any,
      });
      deps.state.currentConversationId = 'conv-1';

      // Mock the agent query to return a text response
      (deps.plugin.agentService.query as jest.Mock).mockReturnValue(
        createMockStream([
          { type: 'text', content: 'Hello, how can I help?' },
          { type: 'done' },
        ])
      );

      // Mock handleStreamChunk to populate assistant content
      (deps.streamController.handleStreamChunk as jest.Mock).mockImplementation(async (chunk, msg) => {
        if (chunk.type === 'text') {
          msg.content = chunk.content;
        }
      });

      inputEl = deps.getInputEl() as ReturnType<typeof createMockInputEl>;
      inputEl.value = 'Hello world';
      controller = new InputController(deps);

      await controller.sendMessage();

      // After first exchange (2 messages), should set pending status (only when titleService available and content exists)
      expect(deps.plugin.updateConversation).toHaveBeenCalledWith('conv-1', { titleGenerationStatus: 'pending' });
      expect(deps.plugin.renameConversation).toHaveBeenCalledWith('conv-1', 'Test Title');
    });

    it('should find messages by role, not by index', async () => {
      const welcomeEl = { style: { display: '' } } as any;
      const fileContextManager = {
        startSession: jest.fn(),
        getCurrentNotePath: jest.fn().mockReturnValue(null),
        shouldSendCurrentNote: jest.fn().mockReturnValue(false),
        markCurrentNoteSent: jest.fn(),
        transformContextMentions: jest.fn().mockImplementation((text: string) => text),
      };
      const imageContextManager = createMockImageContextManager();

      deps = createMockDeps({
        getWelcomeEl: () => welcomeEl,
        getFileContextManager: () => fileContextManager as any,
        getImageContextManager: () => imageContextManager as any,
      });
      deps.state.currentConversationId = 'conv-1';

      (deps.plugin.agentService.query as jest.Mock).mockReturnValue(
        createMockStream([{ type: 'done' }])
      );

      inputEl = deps.getInputEl() as ReturnType<typeof createMockInputEl>;
      inputEl.value = 'Test message';
      controller = new InputController(deps);

      await controller.sendMessage();

      // Verify messages are found by role
      const userMsg = deps.state.messages.find(m => m.role === 'user');
      const assistantMsg = deps.state.messages.find(m => m.role === 'assistant');
      expect(userMsg).toBeDefined();
      expect(assistantMsg).toBeDefined();
    });

    it('should call title generation service when available', async () => {
      const mockTitleService = {
        generateTitle: jest.fn().mockResolvedValue(undefined),
        cancel: jest.fn(),
      };
      const welcomeEl = { style: { display: '' } } as any;
      const fileContextManager = {
        startSession: jest.fn(),
        getCurrentNotePath: jest.fn().mockReturnValue(null),
        shouldSendCurrentNote: jest.fn().mockReturnValue(false),
        markCurrentNoteSent: jest.fn(),
        transformContextMentions: jest.fn().mockImplementation((text: string) => text),
      };
      const imageContextManager = createMockImageContextManager();

      deps = createMockDeps({
        getWelcomeEl: () => welcomeEl,
        getFileContextManager: () => fileContextManager as any,
        getImageContextManager: () => imageContextManager as any,
        getTitleGenerationService: () => mockTitleService as any,
      });
      deps.state.currentConversationId = 'conv-1';

      (deps.plugin.agentService.query as jest.Mock).mockReturnValue(
        createMockStream([
          { type: 'text', content: 'Response text' },
          { type: 'done' },
        ])
      );

      // Mock handleStreamChunk to populate assistant content
      (deps.streamController.handleStreamChunk as jest.Mock).mockImplementation(async (chunk, msg) => {
        if (chunk.type === 'text') {
          msg.content = chunk.content;
        }
      });

      inputEl = deps.getInputEl() as ReturnType<typeof createMockInputEl>;
      inputEl.value = 'Hello world';
      controller = new InputController(deps);

      await controller.sendMessage();

      // Title service should be called with user and assistant content
      expect(mockTitleService.generateTitle).toHaveBeenCalled();
      const callArgs = mockTitleService.generateTitle.mock.calls[0];
      expect(callArgs[0]).toBe('conv-1'); // conversationId
      expect(callArgs[1]).toContain('Hello world'); // user content
    });

    it('should not overwrite user-renamed title in callback', async () => {
      const mockTitleService = {
        generateTitle: jest.fn().mockResolvedValue(undefined),
        cancel: jest.fn(),
      };
      const welcomeEl = { style: { display: '' } } as any;
      const fileContextManager = {
        startSession: jest.fn(),
        getCurrentNotePath: jest.fn().mockReturnValue(null),
        shouldSendCurrentNote: jest.fn().mockReturnValue(false),
        markCurrentNoteSent: jest.fn(),
        transformContextMentions: jest.fn().mockImplementation((text: string) => text),
      };
      const imageContextManager = createMockImageContextManager();

      deps = createMockDeps({
        getWelcomeEl: () => welcomeEl,
        getFileContextManager: () => fileContextManager as any,
        getImageContextManager: () => imageContextManager as any,
        getTitleGenerationService: () => mockTitleService as any,
      });
      deps.state.currentConversationId = 'conv-1';

      (deps.plugin.agentService.query as jest.Mock).mockReturnValue(
        createMockStream([
          { type: 'text', content: 'Response' },
          { type: 'done' },
        ])
      );

      (deps.streamController.handleStreamChunk as jest.Mock).mockImplementation(async (chunk, msg) => {
        if (chunk.type === 'text') {
          msg.content = chunk.content;
        }
      });

      // Mock getConversationById to return a conversation with different title (user renamed)
      (deps.plugin.getConversationById as jest.Mock).mockReturnValue({
        id: 'conv-1',
        title: 'User Custom Title', // User renamed it
      });

      inputEl = deps.getInputEl() as ReturnType<typeof createMockInputEl>;
      inputEl.value = 'Test';
      controller = new InputController(deps);

      await controller.sendMessage();

      // Get the callback and simulate it being called
      const callback = mockTitleService.generateTitle.mock.calls[0][3];
      await callback('conv-1', { success: true, title: 'AI Generated Title' });

      // Should clear status since user manually renamed (not apply AI title)
      expect(deps.plugin.updateConversation).toHaveBeenCalledWith('conv-1', { titleGenerationStatus: undefined });
    });

    it('should not set pending status when titleService is null', async () => {
      const welcomeEl = { style: { display: '' } } as any;
      const fileContextManager = {
        startSession: jest.fn(),
        getCurrentNotePath: jest.fn().mockReturnValue(null),
        shouldSendCurrentNote: jest.fn().mockReturnValue(false),
        markCurrentNoteSent: jest.fn(),
        transformContextMentions: jest.fn().mockImplementation((text: string) => text),
      };
      const imageContextManager = createMockImageContextManager();

      deps = createMockDeps({
        getWelcomeEl: () => welcomeEl,
        getFileContextManager: () => fileContextManager as any,
        getImageContextManager: () => imageContextManager as any,
        getTitleGenerationService: () => null, // No title service
      });
      deps.state.currentConversationId = 'conv-1';

      (deps.plugin.agentService.query as jest.Mock).mockReturnValue(
        createMockStream([
          { type: 'text', content: 'Response' },
          { type: 'done' },
        ])
      );

      (deps.streamController.handleStreamChunk as jest.Mock).mockImplementation(async (chunk, msg) => {
        if (chunk.type === 'text') {
          msg.content = chunk.content;
        }
      });

      inputEl = deps.getInputEl() as ReturnType<typeof createMockInputEl>;
      inputEl.value = 'Test message';
      controller = new InputController(deps);

      await controller.sendMessage();

      // Should NOT set pending status when no titleService
      const updateCalls = (deps.plugin.updateConversation as jest.Mock).mock.calls;
      const pendingCall = updateCalls.find((call: [string, { titleGenerationStatus?: string }]) =>
        call[1]?.titleGenerationStatus === 'pending'
      );
      expect(pendingCall).toBeUndefined();
    });

    it('should not set pending status when assistantText is empty', async () => {
      const mockTitleService = {
        generateTitle: jest.fn().mockResolvedValue(undefined),
        cancel: jest.fn(),
      };
      const welcomeEl = { style: { display: '' } } as any;
      const fileContextManager = {
        startSession: jest.fn(),
        getCurrentNotePath: jest.fn().mockReturnValue(null),
        shouldSendCurrentNote: jest.fn().mockReturnValue(false),
        markCurrentNoteSent: jest.fn(),
        transformContextMentions: jest.fn().mockImplementation((text: string) => text),
      };
      const imageContextManager = createMockImageContextManager();

      deps = createMockDeps({
        getWelcomeEl: () => welcomeEl,
        getFileContextManager: () => fileContextManager as any,
        getImageContextManager: () => imageContextManager as any,
        getTitleGenerationService: () => mockTitleService as any,
      });
      deps.state.currentConversationId = 'conv-1';

      // Return empty stream - no text content
      (deps.plugin.agentService.query as jest.Mock).mockReturnValue(
        createMockStream([{ type: 'done' }])
      );

      // Don't populate assistant content (leave it empty)
      (deps.streamController.handleStreamChunk as jest.Mock).mockImplementation(async () => {});

      inputEl = deps.getInputEl() as ReturnType<typeof createMockInputEl>;
      inputEl.value = 'Test message';
      controller = new InputController(deps);

      await controller.sendMessage();

      // Should NOT call title service when assistantText is empty
      expect(mockTitleService.generateTitle).not.toHaveBeenCalled();

      // Should NOT set pending status when assistantText is empty
      const updateCalls = (deps.plugin.updateConversation as jest.Mock).mock.calls;
      const pendingCall = updateCalls.find((call: [string, { titleGenerationStatus?: string }]) =>
        call[1]?.titleGenerationStatus === 'pending'
      );
      expect(pendingCall).toBeUndefined();
    });

    it('should NOT call title generation service when enableAutoTitleGeneration is false', async () => {
      const mockTitleService = {
        generateTitle: jest.fn().mockResolvedValue(undefined),
        cancel: jest.fn(),
      };
      const welcomeEl = { style: { display: '' } } as any;
      const fileContextManager = {
        startSession: jest.fn(),
        getCurrentNotePath: jest.fn().mockReturnValue(null),
        shouldSendCurrentNote: jest.fn().mockReturnValue(false),
        markCurrentNoteSent: jest.fn(),
        transformContextMentions: jest.fn().mockImplementation((text: string) => text),
      };
      const imageContextManager = createMockImageContextManager();

      deps = createMockDeps({
        getWelcomeEl: () => welcomeEl,
        getFileContextManager: () => fileContextManager as any,
        getImageContextManager: () => imageContextManager as any,
        getTitleGenerationService: () => mockTitleService as any,
      });
      // Disable auto title generation
      deps.plugin.settings.enableAutoTitleGeneration = false;
      deps.state.currentConversationId = 'conv-1';

      (deps.plugin.agentService.query as jest.Mock).mockReturnValue(
        createMockStream([
          { type: 'text', content: 'Response text' },
          { type: 'done' },
        ])
      );

      (deps.streamController.handleStreamChunk as jest.Mock).mockImplementation(async (chunk, msg) => {
        if (chunk.type === 'text') {
          msg.content = chunk.content;
        }
      });

      inputEl = deps.getInputEl() as ReturnType<typeof createMockInputEl>;
      inputEl.value = 'Hello world';
      controller = new InputController(deps);

      await controller.sendMessage();

      // Title service should NOT be called when setting is disabled
      expect(mockTitleService.generateTitle).not.toHaveBeenCalled();

      // Should NOT set pending status
      const updateCalls = (deps.plugin.updateConversation as jest.Mock).mock.calls;
      const pendingCall = updateCalls.find((call: [string, { titleGenerationStatus?: string }]) =>
        call[1]?.titleGenerationStatus === 'pending'
      );
      expect(pendingCall).toBeUndefined();

      // Should still set fallback title
      expect(deps.plugin.renameConversation).toHaveBeenCalledWith('conv-1', 'Test Title');
    });
  });
});

describe('InputController study goal preparation', () => {
  const makeFile = (path: string) => Object.assign(new TFile(), { path });

  it('clears an old Brief binding when a Brief-free Quiz starts in the same conversation', async () => {
    const context = makeFile('Study/Old/STUDY_CONTEXT.md');
    const deps = createMockDeps();
    const plugin = deps.plugin as any;
    plugin.getActiveConversation = jest.fn().mockReturnValue({ id: 'conv-1', studyGoalId: 'old-goal' });
    plugin.storage = { loadState: jest.fn().mockResolvedValue({ studyGoalBindings: [{
      id: 'old-goal', briefPath: 'Old.md', folderPath: 'Study/Old', contextPath: context.path,
    }] }) };
    plugin.app = { vault: {
      adapter: { basePath: '/vault' }, getAbstractFileByPath: (p: string) => p === context.path ? context : null,
      read: jest.fn(async () => '## 학습 개념 근거\n<!-- tutor-concepts:start -->\nOLD BRIEF CONCEPT\n<!-- tutor-concepts:end -->'),
    } };
    plugin.agentService.query = jest.fn(async function* () { yield { type: 'text', content: '다음 문제' }; yield { type: 'done' }; });
    const controller = new InputController(deps);

    await controller.sendMessage({ content: '기본 학습 시작', quizSessionInit: {
      totalQuestions: 1, scopeLabel: '기본 학습', difficulty: '중', sourceInstruction: 'ordinary source',
    } as any });

    expect(plugin.updateConversation).toHaveBeenCalledWith('conv-1', { studyGoalId: undefined });
    expect((plugin.agentService.query as jest.Mock).mock.calls[0][0]).not.toContain('OLD BRIEF CONCEPT');
  });

  it('keeps the Quiz goal binding when its Socratic review starts', async () => {
    const deps = createMockDeps();
    const plugin = deps.plugin as any;
    plugin.getActiveConversation = jest.fn().mockReturnValue({ id: 'conv-1', studyGoalId: 'goal-1' });
    plugin.storage = { loadState: jest.fn().mockResolvedValue({ studyGoalBindings: [] }) };
    plugin.agentService.query = jest.fn(async function* () { yield { type: 'text', content: '복습 질문' }; yield { type: 'done' }; });
    const controller = new InputController(deps);
    const finalTurn = {
      id: 'quiz-final', role: 'assistant' as const, content: '완료', timestamp: Date.now(),
      quizReviewAvailable: true, quizReviewSourceInstruction: 'source @Course.md', quizReviewStudyGoalId: 'goal-1',
    };
    deps.state.addMessage(finalTurn);

    await expect(controller.startQuizReview(finalTurn.id)).resolves.toBe(true);

    expect(plugin.updateConversation).not.toHaveBeenCalledWith('conv-1', { studyGoalId: undefined });
    expect(finalTurn.quizReviewAvailable).toBe(false);
  });

  it('refuses to review a Quiz from another goal without unbinding the current goal', async () => {
    const deps = createMockDeps();
    const plugin = deps.plugin as any;
    plugin.getActiveConversation = jest.fn().mockReturnValue({ id: 'conv-1', studyGoalId: 'goal-b' });
    plugin.agentService.query = jest.fn(async function* () { yield { type: 'done' }; });
    const controller = new InputController(deps);
    const quizA = {
      id: 'quiz-a', role: 'assistant' as const, content: '완료', timestamp: Date.now(),
      quizReviewAvailable: true, quizReviewSourceInstruction: 'source A', quizReviewStudyGoalId: 'goal-a',
    };
    deps.state.addMessage(quizA);
    (Notice as any).messages.length = 0;

    await expect(controller.startQuizReview('quiz-a')).resolves.toBe(true);

    expect(plugin.agentService.query).not.toHaveBeenCalled();
    expect(plugin.updateConversation).not.toHaveBeenCalledWith('conv-1', { studyGoalId: undefined });
    expect(quizA.quizReviewAvailable).toBe(false);
    expect((Notice as any).messages.at(-1)).toMatch(/다른 학습 목표/);
  });

  it('retires earlier Quiz review offers when a new learning session starts', async () => {
    const deps = createMockDeps();
    const plugin = deps.plugin as any;
    plugin.agentService.query = jest.fn(async function* () { yield { type: 'text', content: '1/3번 문제' }; yield { type: 'done' }; });
    const controller = new InputController(deps);
    const quizA = {
      id: 'quiz-a', role: 'assistant' as const, content: '완료', timestamp: Date.now(),
      quizReviewAvailable: true, quizReviewSourceInstruction: 'source A',
    };
    deps.state.addMessage(quizA);

    await controller.sendMessage({ content: 'quiz B', quizSessionInit: { totalQuestions: 3, scopeLabel: 'B' } });

    expect(quizA.quizReviewAvailable).toBe(false);
  });

  it('keeps earlier Quiz review offers when the new learning session fails to start', async () => {
    const deps = createMockDeps();
    const plugin = deps.plugin as any;
    plugin.agentService.query = jest.fn(async function* () { yield { type: 'error', content: 'provider down' }; });
    const controller = new InputController(deps);
    const quizA = {
      id: 'quiz-a', role: 'assistant' as const, content: '완료', timestamp: Date.now(),
      quizReviewAvailable: true, quizReviewSourceInstruction: 'source A',
    };
    deps.state.addMessage(quizA);

    await controller.sendMessage({ content: 'quiz B', quizSessionInit: { totalQuestions: 3, scopeLabel: 'B' } });

    expect(quizA.quizReviewAvailable).toBe(true);
  });

  it('does not attach the note open in the editor to a Quiz review turn', async () => {
    const deps = createMockDeps();
    const plugin = deps.plugin as any;
    plugin.agentService.query = jest.fn(async function* () { yield { type: 'text', content: '복습 질문' }; yield { type: 'done' }; });
    deps.getFileContextManager = () => ({
      startSession: jest.fn(), getCurrentNotePath: jest.fn().mockReturnValue('Other/Unrelated.md'),
      shouldSendCurrentNote: jest.fn().mockReturnValue(true),
      transformContextMentions: jest.fn((text: string) => text),
      getResolvedMentionPaths: jest.fn().mockReturnValue([]),
    }) as any;
    const controller = new InputController(deps);
    deps.state.addMessage({
      id: 'quiz-final', role: 'assistant', content: '완료', timestamp: Date.now(),
      quizReviewAvailable: true, quizReviewSourceInstruction: 'source @Course.md',
    });

    await controller.startQuizReview('quiz-final');

    expect((plugin.agentService.query as jest.Mock).mock.calls[0][0]).not.toContain('Other/Unrelated.md');
  });

  it('restores a Quiz review when starting it throws', async () => {
    const deps = createMockDeps();
    const controller = new InputController(deps);
    jest.spyOn(controller, 'sendMessage').mockRejectedValue(new Error('save failed'));
    const finalTurn = {
      id: 'quiz-final', role: 'assistant' as const, content: '완료', timestamp: Date.now(),
      quizReviewAvailable: true, quizReviewSourceInstruction: 'source',
    };
    deps.state.addMessage(finalTurn);

    await expect(controller.startQuizReview(finalTurn.id)).rejects.toThrow('save failed');

    expect(finalTurn.quizReviewAvailable).toBe(true);
  });

  it('refuses to queue a learning session start while a reply is streaming', async () => {
    const deps = createMockDeps();
    const controller = new InputController(deps);
    deps.state.isStreaming = true;

    await controller.sendMessage({ content: 'quiz prompt', quizSessionInit: { totalQuestions: 3, scopeLabel: 'quiz' } });

    expect(deps.state.queuedMessage).toBeNull();
    expect(deps.state.quizSession).toBeNull();
  });

  it('keeps a Quiz review retryable when its first turn fails', async () => {
    const deps = createMockDeps();
    const plugin = deps.plugin as any;
    plugin.agentService.query = jest.fn(async function* () { yield { type: 'error', content: 'provider down' }; });
    const controller = new InputController(deps);
    const finalTurn = {
      id: 'quiz-final', role: 'assistant' as const, content: '완료', timestamp: Date.now(),
      quizReviewAvailable: true, quizReviewSourceInstruction: 'source @Course.md',
    };
    deps.state.addMessage(finalTurn);

    await expect(controller.startQuizReview(finalTurn.id)).resolves.toBe(false);

    expect(finalTurn.quizReviewAvailable).toBe(true);
  });

  it('lets the toolbar decide Web for a review of a Quiz that did not require Web', async () => {
    const deps = createMockDeps({ getWebSearchToggle: () => ({ isEnabled: jest.fn().mockReturnValue(true) }) });
    const plugin = deps.plugin as any;
    plugin.agentService.query = jest.fn(async function* () { yield { type: 'text', content: '복습 질문' }; yield { type: 'done' }; });
    const controller = new InputController(deps);
    deps.state.addMessage({
      id: 'quiz-final', role: 'assistant', content: '완료', timestamp: Date.now(),
      quizReviewAvailable: true, quizReviewSourceInstruction: 'source', quizReviewEnableWebSearch: false,
    });

    await controller.startQuizReview('quiz-final');

    expect((plugin.agentService.query as jest.Mock).mock.calls[0][3]).toMatchObject({ enableWebSearch: true });
  });

  it.each(['/quiz', '/socratic'])('does not open %s setup while a reply is streaming', async (command) => {
    const deps = createMockDeps();
    const controller = new InputController(deps);
    const openModal = jest.spyOn(LearningSetupModal.prototype, 'openAndWait').mockResolvedValue(null);
    deps.state.isStreaming = true;
    (Notice as any).messages.length = 0;

    await controller.sendMessage({ content: command });

    expect(openModal).not.toHaveBeenCalled();
    expect(deps.state.queuedMessage).toBeNull();
    expect((Notice as any).messages.at(-1)).toMatch(/응답이 끝난 뒤/);
    openModal.mockRestore();
  });

  it('sends a bare Brief mention as ordinary chat instead of opening a Quiz', async () => {
    const brief = makeFile('Briefs/Goal.md');
    const deps = createMockDeps();
    const plugin = deps.plugin as any;
    plugin.app = {
      vault: { getAbstractFileByPath: jest.fn(() => brief) },
      metadataCache: { getFileCache: jest.fn(() => ({ frontmatter: { tags: ['StudyBrief'] } })) },
    };
    deps.getFileContextManager = () => ({
      startSession: jest.fn(), getCurrentNotePath: jest.fn().mockReturnValue(null),
      shouldSendCurrentNote: jest.fn().mockReturnValue(false),
      transformContextMentions: jest.fn((text: string) => text),
      getResolvedMentionPaths: jest.fn().mockReturnValue([{ start: 0, end: 15, path: brief.path }]),
    }) as any;
    plugin.agentService.query = jest.fn(async function* () { yield { type: 'done' }; });
    const openModal = jest.spyOn(LearningSetupModal.prototype, 'openAndWait').mockResolvedValue(null);
    const controller = new InputController(deps);

    await controller.sendMessage({ content: '@Briefs/Goal.md' });

    expect(openModal).not.toHaveBeenCalled();
    expect(plugin.agentService.query).toHaveBeenCalled();
    openModal.mockRestore();
  });

  it.each(['quiz', 'socratic'] as const)('refreshes changed goal concepts in a real %s continuation request', async (mode) => {
    const context = makeFile('Study/Goal/STUDY_CONTEXT.md');
    const deps = createMockDeps();
    const plugin = deps.plugin as any;
    plugin.getActiveConversation = jest.fn().mockReturnValue({ id: 'conv-1', studyGoalId: 'goal-1' });
    plugin.storage = { loadState: jest.fn().mockResolvedValue({ studyGoalBindings: [{
      id: 'goal-1', briefPath: 'Brief.md', folderPath: 'Study/Goal', contextPath: context.path,
    }] }) };
    plugin.app = { vault: {
      adapter: { basePath: '/vault' }, getAbstractFileByPath: (p: string) => p === context.path ? context : null,
      read: jest.fn(async () => '## 학습 개념 근거\n<!-- tutor-concepts:start -->\nREFRESHED CONCEPT FROM DISK\n<!-- tutor-concepts:end -->'),
    } };
    deps.state.messages.push({ id: 'q1', role: 'assistant', content: '기존 질문', timestamp: Date.now() } as any);
    if (mode === 'quiz') deps.state.quizSession = {
      totalQuestions: 2, currentQuestion: 1, scopeLabel: 'quiz', difficulty: '중',
      sourceInstruction: 'selected @Course.md\n\n[Goal concepts]\nOLD CONCEPT',
    } as any;
    else deps.state.socraticSession = {
      maxDepth: 20, currentDepth: 1, scopeLabel: 'socratic', focusText: '확률', supportLevel: 1,
      isSummaryPhase: false, sourceInstruction: 'selected @Course.md\n\n[Goal concepts]\nOLD CONCEPT',
    } as any;
    const query = jest.fn(async function* (_prompt: string) { yield { type: 'text', content: '이어지는 학습 응답' }; });
    plugin.agentService.query = query;

    await new InputController(deps).sendMessage({ content: '다음으로' });

    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0][0]).toContain('REFRESHED CONCEPT FROM DISK');
    expect(query.mock.calls[0][0]).not.toContain('OLD CONCEPT');
  });

  it('includes the requested focus in both sufficiency and proposal judgments', async () => {
    const brief = makeFile('Brief.md');
    const context = makeFile('Study/STUDY_CONTEXT.md');
    const contents = new Map([[brief.path, '목표: 관련 개념'], [context.path,
      '## 학습 개념 근거\n<!-- tutor-concepts:start -->\nY 주제 개념만 있음\n<!-- tutor-concepts:end -->']]);
    const vault = {
      adapter: { basePath: '/vault' },
      getAbstractFileByPath: (p: string) => p === brief.path ? brief : p === context.path ? context : null,
      read: jest.fn(async (file: TFile) => contents.get(file.path) ?? ''),
      process: jest.fn(async (file: TFile, transform: (value: string) => string) => { contents.set(file.path, transform(contents.get(file.path) ?? '')); }),
    };
    const deps = createMockDeps();
    (deps.plugin as any).app = { vault };
    const prompts: string[] = [];
    const query = jest.fn(async function* (prompt: string) {
      prompts.push(prompt);
      if (prompt.includes('BRIEF_JSON')) {
        yield { type: 'text', content: JSON.stringify(prompt.includes('"X 주제"')
          ? { sufficient: false, summary: 'X 주제가 없어 보충합니다.' }
          : { sufficient: true, summary: '다른 주제 개념은 충분합니다.' }) };
      } else {
        yield { type: 'text', content: JSON.stringify({ concepts: 'X 주제 개념' }) };
      }
    });
    (deps.plugin as any).agentService.query = query;
    await (new InputController(deps) as any).prepareStudyGoal({
      briefPath: brief.path, folderPath: 'Study', contextPath: context.path,
    }, { mode: 'quiz', focusText: 'X 주제', sourceInstruction: '@Course.md', hasSourceNotes: true, totalQuestions: 1,
      difficulty: '중', questionStyle: 'material' });

    expect(prompts).toHaveLength(2);
    expect(prompts[0]).toContain('X 주제');
    expect(prompts[1]).toContain('X 주제');
  });

  it('uses the modal built empty-folder scope with prepared concepts as the only evidence', async () => {
    const brief = makeFile('Briefs/Goal.md');
    const context = makeFile('Study/Goal/STUDY_CONTEXT.md');
    let content = '# 학습 맥락\n학생 메모';
    const vault = {
      adapter: { basePath: '/vault' },
      getMarkdownFiles: () => [brief],
      getAbstractFileByPath: (p: string) => p === brief.path ? brief : p === context.path ? context : p === 'Study/Goal' ? { path: p } : null,
      read: jest.fn(async (file: TFile) => file.path === brief.path ? '목표: 확률' : content),
      process: jest.fn(async (_file: TFile, transform: (value: string) => string) => { content = transform(content); }),
    };
    const modal = new LearningSetupModal({ vault } as any, brief.path, 'quiz');
    (modal as any).briefPath = brief.path;
    (modal as any).studyFolderPath = 'Study/Goal';
    (modal as any).studyContextPath = context.path;
    (modal as any).learningScope = 'folder';
    (modal as any).selectedFolderPaths = new Set(['Study/Goal']);
    const result = (modal as any).buildResult();
    const deps = createMockDeps();
    (deps.plugin as any).app = { vault };
    const answers = [
      { sufficient: false, summary: '기초 개념을 보충합니다.' },
      { concepts: '확률은 불확실성을 나타낸다.' },
    ];
    (deps.plugin as any).agentService.query = jest.fn(async function* () {
      yield { type: 'text', content: JSON.stringify(answers.shift() ?? {}) };
    });

    const prepared = await (new InputController(deps) as any).prepareStudyGoal({
      briefPath: brief.path, folderPath: 'Study/Goal', contextPath: context.path,
    }, result);

    expect(result.hasSourceNotes).toBe(false);
    expect(prepared.sourceInstruction).toContain('No selected course notes. Use prepared concept evidence only.');
    expect(prepared.sourceInstruction).not.toContain('Please inform the user');
    expect(prepared.sourceInstruction).toContain('확률은 불확실성을 나타낸다.');
  });

  it('reads back a 2500 character base plus a 1000 character supplement without truncation', async () => {
    const context = makeFile('Study/STUDY_CONTEXT.md');
    const base = '기'.repeat(2500);
    const supplement = '보'.repeat(1000);
    let content = `## 학습 개념 근거\n<!-- tutor-concepts:start -->\n${base}\n<!-- tutor-concepts:end -->`;
    const vault = {
      getAbstractFileByPath: (p: string) => p === context.path ? context : { path: p },
      process: jest.fn(async (_file: TFile, transform: (value: string) => string) => { content = transform(content); }),
      read: jest.fn(async () => content),
    };
    const deps = createMockDeps();
    (deps.plugin as any).app = { vault };
    await (new InputController(deps) as any).appendStudyContext(context.path, 'Study', supplement, '', base);
    expect((new InputController(deps) as any).extractPreparedConcepts(content)).toContain(supplement);
    expect((new InputController(deps) as any).extractPreparedConcepts(content)).toHaveLength(3501);
  });

  it('keeps full saved concepts for verification and bounds only the learning instruction', async () => {
    const brief = makeFile('Brief.md');
    const context = makeFile('Study/STUDY_CONTEXT.md');
    const concepts = '개념'.repeat(1750);
    const document = `## 점검 체크리스트\n- [ ] checklist student text\n\n## 문제 기록\nproblem scratchpad student text\n\n## 학습 개념 근거\n<!-- tutor-concepts:start -->\n${concepts}\n<!-- tutor-concepts:end -->`;
    const vault = {
      adapter: { basePath: '/vault' },
      getAbstractFileByPath: (p: string) => p === brief.path ? brief : p === context.path ? context : null,
      read: jest.fn(async (file: TFile) => file.path === brief.path ? 'goal' : document),
    };
    const deps = createMockDeps();
    (deps.plugin as any).app = { vault };
    (deps.plugin as any).agentService.query = jest.fn(async function* () {
      yield { type: 'text', content: JSON.stringify({ sufficient: true, summary: '재사용합니다.' }) };
    });
    const prepared = await (new InputController(deps) as any).prepareStudyGoal({
      briefPath: brief.path, folderPath: 'Study', contextPath: context.path,
    }, { mode: 'quiz', sourceInstruction: 'No markdown files found in selected folders: Study.',
      totalQuestions: 1, difficulty: '중', questionStyle: 'material' });

    expect(prepared.sourceInstruction).toContain(JSON.stringify(concepts.slice(-3000)));
    expect(prepared.sourceInstruction).not.toContain(JSON.stringify(concepts));
    expect(prepared.sourceInstruction).not.toContain('checklist student text');
    expect(prepared.sourceInstruction).not.toContain('problem scratchpad student text');
    expect((new InputController(deps) as any).extractPreparedConcepts(document)).toHaveLength(3500);
  });

  it('keeps the full new supplement in the learning instruction when old concepts fill the bound', async () => {
    const brief = makeFile('Brief.md');
    const context = makeFile('Study/STUDY_CONTEXT.md');
    const base = '기'.repeat(2500);
    const supplement = '보'.repeat(1000);
    const contents = new Map([[brief.path, 'goal'], [context.path,
      `## 학습 개념 근거\n<!-- tutor-concepts:start -->\n${base}\n<!-- tutor-concepts:end -->`]]);
    const vault = {
      adapter: { basePath: '/vault' },
      getAbstractFileByPath: (p: string) => p === brief.path ? brief : p === context.path ? context : null,
      read: jest.fn(async (file: TFile) => contents.get(file.path) ?? ''),
      process: jest.fn(async (file: TFile, transform: (value: string) => string) => {
        contents.set(file.path, transform(contents.get(file.path) ?? ''));
      }),
    };
    const deps = createMockDeps();
    const plugin = deps.plugin as any;
    plugin.app = { vault };
    deps.state.currentConversationId = 'conv-1';
    const responses = [
      { sufficient: false, summary: '요청한 주제를 보충합니다.' },
      { concepts: supplement },
    ];
    const dispatchedPrompts: string[] = [];
    plugin.agentService.query = jest.fn(async function* (prompt: string) {
      dispatchedPrompts.push(prompt);
      const response = dispatchedPrompts.length <= 2
        ? JSON.stringify(responses.shift())
        : '학습 질문';
      yield { type: 'text', content: response };
      if (dispatchedPrompts.length > 2) yield { type: 'done' };
    });
    const controller = new InputController(deps);
    const prepared = await (controller as any).prepareStudyGoal({
      briefPath: brief.path, folderPath: 'Study', contextPath: context.path,
    }, { mode: 'quiz', sourceInstruction: 'No markdown files found in selected folders: Study.',
      totalQuestions: 1, difficulty: '중', questionStyle: 'material' });
    await controller.sendMessage({
      content: prepared.prompt,
      quizSessionInit: { totalQuestions: 1, scopeLabel: 'Brief Quiz', difficulty: '중',
        sourceInstruction: prepared.sourceInstruction } as any,
    });

    expect(dispatchedPrompts).toHaveLength(3);
    expect(dispatchedPrompts[2]).toContain(supplement);
    expect(dispatchedPrompts[2]).toContain(base.slice(-1999));
    expect(dispatchedPrompts[2]).not.toContain(base);
  });

  it('notifies when a Brief setup result arrives during streaming', async () => {
    (Notice as any).messages.length = 0;
    const deps = createMockDeps();
    deps.state.isStreaming = true;
    const controller = new InputController(deps);
    const result = {
      mode: 'quiz', prompt: 'unused', displayContent: 'Quiz', totalQuestions: 1,
      difficulty: '중', questionStyle: 'material', sourceInstruction: '', enableWebSearch: false,
      studyGoal: { briefPath: 'Brief.md', folderPath: 'Study', contextPath: 'Study/STUDY_CONTEXT.md' },
    } as any;

    await (controller as any).sendLearningSetupResult(result, {});

    expect((Notice as any).messages.at(-1)).toMatch(/이미.*진행|진행 중/);
    expect(deps.plugin.agentService.query).not.toHaveBeenCalled();
  });

  it('rejects a deleted Brief before asking for Agent mode or a destination', async () => {
    const deps = createMockDeps();
    (deps.plugin as any).app = { vault: { getAbstractFileByPath: jest.fn().mockReturnValue(null) } };
    const controller = new InputController(deps);
    const confirm = jest.spyOn(controller as any, 'confirmStudyGoalSetup');
    const prepare = jest.spyOn(controller as any, 'prepareStudyGoal');

    await (controller as any).sendLearningSetupResult({
      mode: 'quiz', prompt: 'unused', displayContent: 'Quiz', totalQuestions: 2,
      difficulty: '중', questionStyle: 'material', sourceInstruction: 'prepared', enableWebSearch: false,
      studyGoal: { briefPath: 'Briefs/Removed.md', folderPath: 'Study/Goal', contextPath: 'Study/Goal/STUDY_CONTEXT.md' },
    }, {});

    expect(confirm).not.toHaveBeenCalled();
    expect(prepare).not.toHaveBeenCalled();
    expect(deps.plugin.agentService.query).not.toHaveBeenCalled();
  });

  it.each(['toolbar', 'slash'] as const)('routes %s learning setup through the same InputController setup dispatcher', async (entry) => {
    const deps = createMockDeps();
    const plugin = deps.plugin as any;
    plugin.settings.selectedProvider = 'copilot';
    plugin.settings.permissionMode = 'agent';
    plugin.settings.blanketWriteAcknowledged = ['copilot'];
    const goal = { id: 'goal-1', briefPath: 'Brief.md', folderPath: 'Study', contextPath: 'Study/STUDY_CONTEXT.md' };
    const brief = makeFile(goal.briefPath);
    const context = makeFile(goal.contextPath);
    plugin.app = { vault: {
      adapter: { basePath: '/vault' },
      getAbstractFileByPath: (path: string) => path === brief.path ? brief : path === context.path ? context : null,
      read: jest.fn(async (file: TFile) => file.path === brief.path ? 'goal' : '## 학습 개념 근거\n<!-- tutor-concepts:start -->\n확률의 기초\n<!-- tutor-concepts:end -->'),
      process: jest.fn(),
    } };
    plugin.storage = { loadState: jest.fn().mockResolvedValue({ studyGoalBindings: [goal] }), updateState: jest.fn().mockResolvedValue(undefined) };
    plugin.getActiveConversation = jest.fn().mockReturnValue({ id: 'conv-1' });
    plugin.updateConversation = jest.fn().mockResolvedValue(undefined);
    const query = jest.fn(async function* (prompt: string, _model?: unknown, _images?: unknown, _options?: unknown) {
      yield { type: 'text', content: prompt.includes('BRIEF_JSON') ? JSON.stringify({ sufficient: true, summary: '재사용' }) : 'started' };
    });
    plugin.agentService.query = query;
    const modalResult = {
      mode: 'quiz', prompt: 'existing Brief-free flow', displayContent: 'Quiz', totalQuestions: 1,
      difficulty: '중', questionStyle: 'material', sourceInstruction: 'selected notes', enableWebSearch: false,
      studyGoal: { briefPath: goal.briefPath, folderPath: goal.folderPath, contextPath: goal.contextPath, existingId: goal.id },
    };
    const modal = jest.spyOn(LearningSetupModal.prototype, 'openAndWait').mockResolvedValue(modalResult as any);
    const controller = new InputController(deps);

    if (entry === 'toolbar') await dispatchLearningSetup(controller, 'quiz');
    else await controller.sendMessage({ content: '/quiz' });

    expect(modal).toHaveBeenCalledTimes(1);
    expect(query).toHaveBeenCalledTimes(2);
    expect(query.mock.calls[1][0]).toContain('확률의 기초');
    expect(deps.state.quizSession?.currentQuestion).toBe(1);
    modal.mockRestore();
  });

  it.each(['quiz', 'socratic'] as const)('wires the real question panel, Agent permission transition, scoped write, and %s learning query', async (mode) => {
    const noticeMessages = (Notice as unknown as { messages: string[] }).messages;
    noticeMessages.length = 0;
    const previousDocument = (global as any).document;
    const document = makeStudyPanelDocument();
    (global as any).document = document;
    const container = createStudyQuestionContainer();
    const messagesEl = Object.assign(new StudyPanelElement('div'), { parentElement: container });
    const brief = makeFile('Briefs/Goal.md');
    const context = makeFile('Study/Goal/STUDY_CONTEXT.md');
    const files = new Map([[brief.path, brief]]);
    let content = '';
    const vault = {
      adapter: { basePath: '/vault' },
      getAbstractFileByPath: (path: string) => path === 'Study/Goal' ? { path } : files.get(path) ?? null,
      read: jest.fn(async (file: TFile) => file.path === brief.path ? '목표: 확률 기초' : content),
      createFolder: jest.fn(),
      create: jest.fn(async (path: string, initial: string) => { const file = makeFile(path); files.set(path, file); content = initial; return file; }),
      process: jest.fn(async (_file: TFile, update: (latest: string) => string) => { content = update(content); }),
    };
    const deps = createMockDeps({ getMessagesEl: () => messagesEl as any });
    const plugin = deps.plugin as any;
    plugin.app = { vault };
    plugin.settings.selectedProvider = 'claude';
    plugin.settings.permissionMode = 'ask';
    plugin.settings.blanketWriteAcknowledged = [];
    plugin.getPermissionAuthorityEpoch = () => 7;
    plugin.storage = {
      loadState: jest.fn().mockResolvedValue({ studyGoalBindings: [] }),
      updateState: jest.fn().mockResolvedValue(undefined),
    };
    plugin.getActiveConversation = jest.fn().mockReturnValue({ id: 'conv-1' });
    plugin.updateConversation = jest.fn().mockResolvedValue(undefined);
    const query = jest.fn(async function* (prompt: string, _model?: unknown, _images?: unknown, _options?: unknown) {
      if (prompt.includes('ASSESSMENT_JSON')) yield { type: 'text', content: JSON.stringify({ concepts: '확률은 불확실성을 수로 나타낸다.', unresolved: ['시험 규칙'] }) };
      else if (prompt.includes('BRIEF_JSON')) yield { type: 'text', content: JSON.stringify({ sufficient: false, summary: '보충이 필요합니다.' }) };
      else yield { type: 'text', content: '학습 답변' };
    });
    plugin.agentService.query = query;

    const permissionHost: any = {
      createDiv: () => ({
        children: [] as any[],
        createSpan: () => ({ empty: jest.fn(), setText: jest.fn(), addClass: jest.fn(), removeClass: jest.fn() }),
        createDiv: () => ({ addClass: jest.fn(), removeClass: jest.fn(), setText: jest.fn() }),
        empty: jest.fn(), addClass: jest.fn(), removeClass: jest.fn(), setAttribute: jest.fn(), removeAttribute: jest.fn(),
        addEventListener: jest.fn(),
      }),
    };
    const settings = plugin.settings;
    const permissionToggle = new PermissionToggle(permissionHost, {
      getSettings: () => settings,
      getPermissionAuthorityEpoch: () => 7,
      isBashExpansionInFlight: () => false,
      confirmBlanketWrite: async (provider: string) => { settings.blanketWriteAcknowledged.push(provider); return true; },
      onPermissionModeChange: async (mode: string) => { settings.permissionMode = mode; },
    } as any);
    deps.requestStudyAgentMode = (provider, epoch) => requestStudyAgentMode(permissionToggle, provider as any, epoch);

    const controller = new InputController(deps);
    const pending = (controller as any).sendLearningSetupResult({
      mode, prompt: 'stale', displayContent: mode === 'quiz' ? 'Quiz' : 'Socratic', totalQuestions: 2, difficulty: '중',
      questionStyle: 'material', sourceInstruction: 'selected note @Course.md', hasSourceNotes: true, enableWebSearch: false,
      studyGoal: { briefPath: brief.path, folderPath: 'Study/Goal', contextPath: context.path },
    }, {});
    expect(container.querySelector('.ocop-ask-panel-question')?.textContent).toContain('Agent 모드');
    expect(query).not.toHaveBeenCalled();
    expect(vault.process).not.toHaveBeenCalled();
    expect(plugin.storage.updateState).not.toHaveBeenCalled();
    answerStudyQuestion(container, 'Agent로 전환');
    for (let attempt = 0; attempt < 20 && !container.querySelector('.ocop-ask-panel'); attempt += 1) {
      await new Promise(resolve => setTimeout(resolve, 0));
    }
      expect(container.querySelector('.ocop-ask-panel-question')?.textContent).toContain('저장하고 진행하겠습니다');
    expect(query).not.toHaveBeenCalled();
    expect(vault.process).not.toHaveBeenCalled();
    answerStudyQuestion(container, context.path);
    await pending;

    expect(settings.permissionMode).toBe('agent');
    expect(settings.blanketWriteAcknowledged).toContain('claude');
    expect(vault.process).toHaveBeenCalledTimes(1);
    expect(vault.create).toHaveBeenCalledWith(context.path, '# 학습 맥락\n');
    expect(content).toContain('확률은 불확실성을 수로 나타낸다.');
    expect(noticeMessages.some(message => message.includes('개념을 보충했습니다.')
      && message.includes('출처 미확인') && message.includes('시험 규칙'))).toBe(true);
    expect(plugin.storage.updateState).toHaveBeenCalled();
    expect(plugin.updateConversation).toHaveBeenCalledWith('conv-1', { studyGoalId: expect.any(String) });
    expect(query).toHaveBeenCalledTimes(3);
    expect(query.mock.calls[0][3]).toMatchObject({ readOnly: true, enableWebSearch: false });
    expect(query.mock.calls[1][3]).toMatchObject({ readOnly: true, enableWebSearch: false });
    expect(query.mock.calls[2][0]).toContain('확률은 불확실성을 수로 나타낸다.');
    expect(query.mock.calls[2][3]).toMatchObject({ readOnly: true, enableWebSearch: false });
    expect(plugin.agentService.resetSession).toHaveBeenCalledTimes(4);
    expect(plugin.agentService.setSessionId).toHaveBeenCalledTimes(2);

    if (mode === 'quiz') await controller.sendMessage({ content: '답을 제출합니다' });
    const continuationPrompt = query.mock.calls[3]?.[0] ?? '';
    expect(continuationPrompt.includes('확률은 불확실성을 수로 나타낸다.')).toBe(mode === 'quiz');
    expect(Boolean((query.mock.calls[3]?.[3] as any)?.readOnly)).toBe(mode === 'quiz');
    (global as any).document = previousDocument;
  });

  it('uses the real question panel Escape path to cancel a new destination without writing, binding, or dispatch', async () => {
    const previousDocument = (global as any).document;
    const document = makeStudyPanelDocument();
    (global as any).document = document;
    const container = createStudyQuestionContainer();
    const messagesEl = Object.assign(new StudyPanelElement('div'), { parentElement: container });
    const deps = createMockDeps({ getMessagesEl: () => messagesEl as any });
    const plugin = deps.plugin as any;
    plugin.settings.selectedProvider = 'codex';
    plugin.settings.permissionMode = 'agent';
    plugin.settings.blanketWriteAcknowledged = ['codex'];
    plugin.getPermissionAuthorityEpoch = () => 1;
    plugin.app = { vault: { adapter: { basePath: '/vault' }, getAbstractFileByPath: (p: string) => p === 'Brief.md' ? makeFile(p) : null, read: jest.fn(), process: jest.fn() } };
    plugin.agentService.query = jest.fn(async function* () { yield { type: 'text', content: '{}' }; });
    plugin.storage = { loadState: jest.fn().mockResolvedValue({ studyGoalBindings: [] }), updateState: jest.fn() };
    const pending = (new InputController(deps) as any).sendLearningSetupResult({
      mode: 'quiz', prompt: 'initial', displayContent: 'quiz', totalQuestions: 1, difficulty: '중',
      questionStyle: 'material', sourceInstruction: '', enableWebSearch: false,
      studyGoal: { briefPath: 'Brief.md', folderPath: 'Study', contextPath: 'Study/STUDY_CONTEXT.md' },
    }, {});
    const panel = container.querySelector('.ocop-ask-panel');
    expect(panel).toBeTruthy();
    panel!.dispatchEvent({ type: 'keydown', key: 'Escape', preventDefault: jest.fn(), stopPropagation: jest.fn() });
    await pending;

    expect(plugin.app.vault.process).not.toHaveBeenCalled();
    expect(plugin.storage.updateState).not.toHaveBeenCalled();
    expect(plugin.agentService.query).not.toHaveBeenCalled();
    expect(deps.state.messages).toHaveLength(0);
    (global as any).document = previousDocument;
  });

  it('keeps Ask when the student declines through the real question panel', async () => {
    const previousDocument = (global as any).document;
    const document = makeStudyPanelDocument();
    (global as any).document = document;
    const container = createStudyQuestionContainer();
    const deps = createMockDeps({ getMessagesEl: () => Object.assign(new StudyPanelElement('div'), { parentElement: container }) as any });
    const plugin = deps.plugin as any;
    plugin.settings.selectedProvider = 'claude';
    plugin.settings.permissionMode = 'ask';
    plugin.settings.blanketWriteAcknowledged = [];
    plugin.getPermissionAuthorityEpoch = () => 1;
    plugin.storage = { loadState: jest.fn().mockResolvedValue({ studyGoalBindings: [] }), updateState: jest.fn() };
    plugin.app = { vault: { adapter: { basePath: '/vault' }, getAbstractFileByPath: (path: string) => path === 'Brief.md' ? makeFile(path) : null, read: jest.fn(), process: jest.fn() } };
    plugin.agentService.query = jest.fn();
    const pending = (new InputController(deps) as any).sendLearningSetupResult({
      mode: 'quiz', prompt: 'initial', displayContent: 'quiz', totalQuestions: 1, difficulty: '중',
      questionStyle: 'material', sourceInstruction: '', enableWebSearch: false,
      studyGoal: { briefPath: 'Brief.md', folderPath: 'Study', contextPath: 'Study/STUDY_CONTEXT.md' },
    }, {});
    expect(container.querySelector('.ocop-ask-panel-question')?.textContent).toContain('Agent 모드');
    answerStudyQuestion(container, '취소', 1);
    await pending;

    expect(plugin.settings.permissionMode).toBe('ask');
    expect(plugin.agentService.query).not.toHaveBeenCalled();
    expect(plugin.app.vault.process).not.toHaveBeenCalled();
    expect(plugin.storage.updateState).not.toHaveBeenCalled();
    expect(deps.state.messages).toHaveLength(0);
    (global as any).document = previousDocument;
  });

  it('invalidates a real panel approval when provider authority changes while it is open', async () => {
    const previousDocument = (global as any).document;
    const document = makeStudyPanelDocument();
    (global as any).document = document;
    const container = createStudyQuestionContainer();
    const deps = createMockDeps({ getMessagesEl: () => Object.assign(new StudyPanelElement('div'), { parentElement: container }) as any });
    const plugin = deps.plugin as any;
    plugin.settings.selectedProvider = 'claude';
    plugin.settings.permissionMode = 'ask';
    plugin.settings.blanketWriteAcknowledged = [];
    let epoch = 3;
    plugin.getPermissionAuthorityEpoch = () => epoch;
    const query = jest.fn();
    plugin.agentService.query = query;
    const pending = (new InputController(deps) as any).sendLearningSetupResult({
      mode: 'quiz', prompt: 'initial', displayContent: 'quiz', totalQuestions: 1, difficulty: '중',
      questionStyle: 'material', sourceInstruction: '', enableWebSearch: false,
      studyGoal: { briefPath: 'Brief.md', folderPath: 'Study', contextPath: 'Study/STUDY_CONTEXT.md' },
    }, {});
    epoch += 1;
    answerStudyQuestion(container, 'Agent로 전환');
    await pending;

    expect(plugin.settings.permissionMode).toBe('ask');
    expect(query).not.toHaveBeenCalled();
    expect(deps.state.messages).toHaveLength(0);
    (global as any).document = previousDocument;
  });

  it('reuses an existing local goal in effective Agent without opening a question panel', async () => {
    const previousDocument = (global as any).document;
    const document = makeStudyPanelDocument();
    (global as any).document = document;
    const container = createStudyQuestionContainer();
    const messagesEl = Object.assign(new StudyPanelElement('div'), { parentElement: container });
    const deps = createMockDeps({ getMessagesEl: () => messagesEl as any });
    const plugin = deps.plugin as any;
    plugin.settings.selectedProvider = 'codex';
    plugin.settings.permissionMode = 'agent';
    plugin.settings.blanketWriteAcknowledged = ['codex'];
    plugin.getPermissionAuthorityEpoch = () => 3;
    const brief = makeFile('Brief.md');
    const context = makeFile('Study/STUDY_CONTEXT.md');
    const contextText = '## 학습 개념 근거\n<!-- tutor-concepts:start -->\n확률은 불확실성을 나타낸다.\n<!-- tutor-concepts:end -->';
    plugin.app = { vault: {
      adapter: { basePath: '/vault' },
      getAbstractFileByPath: (path: string) => path === 'Brief.md' ? brief : path === context.path ? context : null,
      read: jest.fn(async (file: TFile) => file.path === brief.path ? 'goal' : contextText), process: jest.fn(),
    } };
    plugin.storage = {
      loadState: jest.fn().mockResolvedValue({ studyGoalBindings: [{ id: 'goal-1', briefPath: brief.path, folderPath: 'Study', contextPath: context.path }] }),
      updateState: jest.fn().mockResolvedValue(undefined),
    };
    plugin.getActiveConversation = jest.fn().mockReturnValue({ id: 'conv-1' });
    plugin.updateConversation = jest.fn().mockResolvedValue(undefined);
    plugin.agentService.query = jest.fn(async function* () { yield { type: 'text', content: JSON.stringify({ sufficient: true, summary: '재사용합니다.' }) }; });

    await (new InputController(deps) as any).sendLearningSetupResult({
      mode: 'socratic', prompt: 'stale', displayContent: 'socratic', sourceInstruction: 'selected notes',
      studyGoal: { briefPath: brief.path, folderPath: 'Study', contextPath: context.path, existingId: 'goal-1' },
    }, {});

    expect(container.querySelector('.ocop-ask-panel')).toBeNull();
    expect(plugin.app.vault.process).not.toHaveBeenCalled();
    expect(plugin.storage.updateState).toHaveBeenCalled();
    expect((plugin.agentService.query as jest.Mock).mock.calls.at(-1)[0]).toContain('확률은 불확실성을 나타낸다.');
    expect((plugin.agentService.query as jest.Mock).mock.calls.at(-1)[3]).toMatchObject({ readOnly: true });
    (global as any).document = previousDocument;
  });

  it.each(['unsupported', 'write failure', 'readback failure'] as const)('keeps selected note evidence available on %s', async (caseName) => {
    const brief = makeFile('Brief.md');
    const context = makeFile('Study/STUDY_CONTEXT.md');
    let content = 'student note';
    let reads = 0;
    const proposed = caseName === 'unsupported' ? '' : '기초 확률 개념';
    const vault = {
      adapter: { basePath: '/vault' },
      getAbstractFileByPath: (path: string) => path === brief.path || path === context.path ? path === brief.path ? brief : context : { path },
      read: jest.fn(async (file: TFile) => {
        if (file.path === brief.path) return '목표: 확률';
        reads += 1;
        if (caseName === 'readback failure' && reads > 1) return 'student note';
        return content;
      }),
      process: jest.fn(async (_file: TFile, update: (text: string) => string) => {
        if (caseName === 'write failure') throw new Error('disk full');
        content = update(content);
      }),
    };
    const deps = createMockDeps({ getWebSearchToggle: () => ({ isEnabled: () => false }) });
    const plugin = deps.plugin as any;
    plugin.settings.selectedProvider = 'codex';
    plugin.settings.permissionMode = 'agent';
    plugin.settings.blanketWriteAcknowledged = ['codex'];
    plugin.storage = {
      loadState: jest.fn().mockResolvedValue({ studyGoalBindings: [{ id: 'goal-1', briefPath: brief.path, folderPath: 'Study', contextPath: context.path }] }),
      updateState: jest.fn().mockResolvedValue(undefined),
    };
    plugin.getActiveConversation = jest.fn().mockReturnValue({ id: 'conv-1' });
    plugin.updateConversation = jest.fn().mockResolvedValue(undefined);
    plugin.app = { vault };
    const responses = [
      { sufficient: false, summary: '기초 확인이 필요합니다.' },
      { concepts: proposed, unresolved: ['행사 일정'] },
    ];
    const query = jest.fn(async function* (prompt: string, _model?: unknown, _images?: unknown, _options?: unknown) {
      yield { type: 'text', content: responses.length ? JSON.stringify(responses.shift()) : 'learning started' };
    });
    plugin.agentService.query = query;
    const controller = new InputController(deps);

    await (controller as any).sendLearningSetupResult({
      mode: 'quiz', prompt: 'Use explicitly selected @Course.md', displayContent: 'Quiz', totalQuestions: 2,
      difficulty: '중', questionStyle: 'material', focusText: '확률',
      sourceInstruction: 'Use explicitly selected @Course.md', hasSourceNotes: true, enableWebSearch: false,
      studyGoal: { briefPath: brief.path, folderPath: 'Study', contextPath: context.path, existingId: 'goal-1' },
    }, {});

    expect(query).toHaveBeenNthCalledWith(1, expect.any(String), undefined, [], { readOnly: true, enableWebSearch: false });
    expect(query).toHaveBeenNthCalledWith(2, expect.any(String), undefined, [], { readOnly: true, enableWebSearch: false });
    expect(vault.process).toHaveBeenCalledTimes(caseName === 'unsupported' ? 0 : 1);
    expect(query).toHaveBeenCalledTimes(3);
    expect(query.mock.calls[2][0]).toContain('@Course.md');
    expect(proposed.length > 0 && query.mock.calls[2][0].includes(proposed)).toBe(false);
    expect(query.mock.calls[2][3]).toMatchObject({ readOnly: true, enableWebSearch: false });
    // A goal document without a concept section still guides the session through its own text.
    expect(query.mock.calls[2][0]).toContain('목표: 확률');
    expect(query.mock.calls[2][0].includes('저장되지 않은 개념은 쓰지 않고')).toBe(caseName !== 'unsupported');
  });

  it.each(['success', 'failure'] as const)('writes completion summary through the scoped Vault process on %s', async (outcome) => {
    const context = makeFile('Study/Goal/STUDY_CONTEXT.md');
    let content = '# Study\n\n## 학습 개념 근거\n<!-- tutor-concepts:start -->\n개념\n<!-- tutor-concepts:end -->';
    const vault = {
      adapter: { basePath: '/vault' },
      getAbstractFileByPath: jest.fn((path: string) => path === context.path ? context : null),
      process: jest.fn(async (_file: TFile, update: (text: string) => string) => {
        if (outcome === 'failure') throw new Error('disk full');
        content = update(content);
      }),
      read: jest.fn(async () => content),
    };
    const deps = createMockDeps();
    const plugin = deps.plugin as any;
    plugin.app = { vault };
    plugin.storage = { loadState: jest.fn().mockResolvedValue({ studyGoalBindings: [{
      id: 'goal-1', briefPath: 'Brief.md', folderPath: 'Study/Goal', contextPath: context.path,
    }] }) };
    plugin.getActiveConversation = jest.fn().mockReturnValue({ studyGoalId: 'goal-1' });
    const controller = new InputController(deps);

    await (controller as any).saveStudyCompletionSummary({ mode: 'quiz', topic: '확률', questionCount: 2 }, 'goal-1');

    expect(vault.process).toHaveBeenCalledTimes(1);
    expect(content.includes('## 학습 완료')).toBe(outcome === 'success');
  });

  it('asks for Agent authority and a new Brief destination before preparing', async () => {
    const deps = createMockDeps();
    (deps.plugin as any).settings.selectedProvider = 'claude';
    (deps.plugin as any).settings.permissionMode = 'ask';
    (deps.plugin as any).getPermissionAuthorityEpoch = jest.fn().mockReturnValue(4);
    const question = jest.fn(async (input: { questions: Array<{ question: string }> }) => {
      const text = input.questions[0].question;
      return { [text]: text.includes('Agent 모드') ? 'Agent로 전환' : 'Study/Custom/CONTEXT.md' };
    });
    const switchMode = jest.fn(async (provider: string, epoch: number) => {
      expect(provider).toBe('claude');
      expect(epoch).toBe(4);
      (deps.plugin as any).settings.permissionMode = 'agent';
      (deps.plugin as any).settings.blanketWriteAcknowledged = ['claude'];
      return true;
    });
    deps.requestStudyAgentMode = switchMode;
    const controller = new InputController(deps);
    jest.spyOn(controller, 'handleAskUserQuestion').mockImplementation(question as any);
    const prepare = jest.spyOn(controller as any, 'prepareStudyGoal').mockResolvedValue(null);

    await (controller as any).sendLearningSetupResult({
      mode: 'quiz', prompt: 'initial', displayContent: 'quiz', totalQuestions: 1,
      difficulty: '중', questionStyle: 'material', sourceInstruction: 'selected notes', enableWebSearch: false,
      studyGoal: { briefPath: 'Briefs/Goal.md', folderPath: 'Study/Old', contextPath: 'Study/Old/STUDY_CONTEXT.md' },
    }, {});

    expect(question).toHaveBeenCalledTimes(2);
    expect(switchMode).toHaveBeenCalledTimes(1);
    expect(prepare).toHaveBeenCalledWith(expect.objectContaining({
      folderPath: 'Study/Custom', contextPath: 'Study/Custom/CONTEXT.md',
    }), expect.anything());
  });

  it('does not prepare a Brief when the Agent transition is declined', async () => {
    const deps = createMockDeps();
    (deps.plugin as any).settings.selectedProvider = 'claude';
    (deps.plugin as any).settings.permissionMode = 'ask';
    deps.requestStudyAgentMode = jest.fn();
    const controller = new InputController(deps);
    jest.spyOn(controller, 'handleAskUserQuestion').mockResolvedValue({
      '이 Brief의 학습 맥락을 저장하려면 Agent 모드가 필요합니다. 기존 제공자 동의를 거쳐 Agent 모드로 전환할까요?': '취소',
    });
    const prepare = jest.spyOn(controller as any, 'prepareStudyGoal');

    await (controller as any).sendLearningSetupResult({
      mode: 'quiz', prompt: 'initial', displayContent: 'quiz', totalQuestions: 1,
      difficulty: '중', questionStyle: 'material', sourceInstruction: 'selected notes', enableWebSearch: false,
      studyGoal: { briefPath: 'Briefs/Goal.md', folderPath: 'Study', contextPath: 'Study/STUDY_CONTEXT.md' },
    }, {});

    expect(deps.requestStudyAgentMode).not.toHaveBeenCalled();
    expect(prepare).not.toHaveBeenCalled();
    expect(deps.state.messages).toHaveLength(0);
  });

  it('drops an approval when provider authority changes while the question is open', async () => {
    const deps = createMockDeps();
    (deps.plugin as any).settings.selectedProvider = 'claude';
    (deps.plugin as any).settings.permissionMode = 'ask';
    let epoch = 4;
    (deps.plugin as any).getPermissionAuthorityEpoch = () => epoch;
    deps.requestStudyAgentMode = jest.fn();
    const controller = new InputController(deps);
    jest.spyOn(controller, 'handleAskUserQuestion').mockImplementation(async (input) => {
      epoch += 1;
      return { [input.questions[0].question]: 'Agent로 전환' };
    });
    const prepare = jest.spyOn(controller as any, 'prepareStudyGoal');

    await (controller as any).sendLearningSetupResult({
      mode: 'quiz', prompt: 'initial', displayContent: 'quiz', totalQuestions: 1,
      difficulty: '중', questionStyle: 'material', sourceInstruction: 'selected notes', enableWebSearch: false,
      studyGoal: { briefPath: 'Briefs/Goal.md', folderPath: 'Study', contextPath: 'Study/STUDY_CONTEXT.md' },
    }, {});

    expect(deps.requestStudyAgentMode).not.toHaveBeenCalled();
    expect(prepare).not.toHaveBeenCalled();
  });

  it('reuses a locally confirmed goal without asking for its destination again', async () => {
    const deps = createMockDeps();
    (deps.plugin as any).settings.selectedProvider = 'copilot';
    (deps.plugin as any).settings.permissionMode = 'agent';
    (deps.plugin as any).settings.blanketWriteAcknowledged = ['copilot'];
    const controller = new InputController(deps);
    const ask = jest.spyOn(controller, 'handleAskUserQuestion');
    const prepare = jest.spyOn(controller as any, 'prepareStudyGoal').mockResolvedValue(null);

    await (controller as any).sendLearningSetupResult({
      mode: 'socratic', prompt: 'initial', displayContent: 'socratic', sourceInstruction: 'selected notes',
      studyGoal: { briefPath: 'Briefs/Goal.md', folderPath: 'Study/Goal', contextPath: 'Study/Goal/STUDY_CONTEXT.md', existingId: 'goal-1' },
    }, {});

    expect(ask).not.toHaveBeenCalled();
    expect(prepare).toHaveBeenCalledWith(expect.objectContaining({ existingId: 'goal-1' }), expect.anything());
  });

  it('does not activate learning or dispatch when goal binding persistence fails', async () => {
    const deps = createMockDeps();
    const updateState = jest.fn().mockRejectedValue(new Error('disk full'));
    (deps.plugin as any).storage = { loadState: jest.fn().mockResolvedValue({ studyGoalBindings: [] }), updateState };
    (deps.plugin as any).getActiveConversation = jest.fn().mockReturnValue({ id: 'conv-1' });
    (deps.plugin as any).updateConversation = jest.fn().mockResolvedValue(undefined);
    const controller = new InputController(deps);

    await controller.sendMessage({
      content: 'start quiz',
      quizSessionInit: { totalQuestions: 2, scopeLabel: 'quiz', sourceInstruction: 'concepts' },
      studyGoal: { briefPath: 'Brief.md', folderPath: 'Study', contextPath: 'Study/STUDY_CONTEXT.md' },
    });

    expect(deps.state.quizSession).toBeNull();
    expect(deps.state.socraticSession).toBeNull();
    expect(deps.state.messages).toHaveLength(0);
    expect((deps.plugin.agentService.query as jest.Mock)).not.toHaveBeenCalled();
  });

  it('cancels preparation through the controller and always restores busy state', async () => {
    const brief = makeFile('Briefs/Goal.md');
    const context = makeFile('Study/Goal/STUDY_CONTEXT.md');
    const files = new Map([[brief.path, brief], [context.path, context]]);
    let release!: () => void;
    const wait = new Promise<void>((resolve) => { release = resolve; });
    const query = jest.fn(async function* () {
      await wait;
      yield { type: 'text', content: JSON.stringify({ sufficient: true, summary: 'reuse' }) };
    });
    const process = jest.fn();
    const deps = createMockDeps();
    (deps.plugin as any).settings.selectedProvider = 'claude';
    (deps.plugin as any).settings.permissionMode = 'agent';
    (deps.plugin as any).settings.blanketWriteAcknowledged = ['claude'];
    (deps.plugin as any).app = { vault: {
      adapter: { basePath: '/vault' },
      getAbstractFileByPath: (path: string) => files.get(path) ?? null,
      read: jest.fn(async (file: TFile) => file.path === brief.path ? 'goal' : '## 학습 개념 근거\n<!-- tutor-concepts:start -->\n확률 개념\n<!-- tutor-concepts:end -->'),
      process, create: jest.fn(), createFolder: jest.fn(),
    } };
    (deps.plugin as any).agentService.query = query;
    const setBusy = deps.setBashExpansionActive as jest.Mock;
    const controller = new InputController(deps);
    const pending = (controller as any).sendLearningSetupResult({
      mode: 'quiz', prompt: 'initial', displayContent: 'quiz', totalQuestions: 1,
      difficulty: '중', questionStyle: 'material', sourceInstruction: 'selected notes', enableWebSearch: false,
      studyGoal: { briefPath: brief.path, folderPath: 'Study/Goal', contextPath: context.path, existingId: 'goal-1' },
    }, {});

    for (let attempt = 0; attempt < 20 && !query.mock.calls.length; attempt += 1) await new Promise((resolve) => setTimeout(resolve, 0));
    expect(deps.state.isStreaming).toBe(true);
    controller.cancelStreaming();
    release();
    await pending;

    expect(process).not.toHaveBeenCalled();
    expect(deps.state.messages).toHaveLength(0);
    expect(deps.state.isStreaming).toBe(false);
    expect(setBusy).toHaveBeenNthCalledWith(1, true);
    expect(setBusy).toHaveBeenLastCalledWith(false);
    expect(query).toHaveBeenCalledTimes(1);
  });

  it.each(['quiz', 'socratic'] as const)('reuses sufficient context without writing and rebuilds %s evidence scope', async (mode) => {
    const context = makeFile('Study/Goal/STUDY_CONTEXT.md');
    const brief = makeFile('Briefs/Goal.md');
    const files = new Map([[brief.path, brief], [context.path, context]]);
    const vault = {
      adapter: { basePath: '/vault' },
      getAbstractFileByPath: (path: string) => files.get(path) ?? null,
      read: jest.fn(async (file: TFile) => file.path === brief.path ? 'goal' : '## 학습 개념 근거\n\n<!-- tutor-concepts:start -->\n조건부확률은 조건이 주어진 사건의 확률이다.\n<!-- tutor-concepts:end -->'),
      process: jest.fn(), createFolder: jest.fn(), create: jest.fn(),
    };
    const deps = createMockDeps();
    const query = jest.fn(async function* () {
      yield { type: 'text', content: JSON.stringify({ sufficient: true, summary: '기초 개념을 재사용합니다.' }) };
    });
    (deps.plugin as any).app = { vault };
    (deps.plugin as any).agentService.query = query;
    const controller = new InputController(deps);
    const original = {
      mode, prompt: 'stale prompt', displayContent: mode, totalQuestions: 3,
      difficulty: '중', questionStyle: 'material', sourceInstruction: 'Use selected notes: @Course.md', hasSourceNotes: true, enableWebSearch: false,
    } as any;

    const prepared = await (controller as any).prepareStudyGoal({
      briefPath: brief.path, folderPath: 'Study/Goal', contextPath: context.path,
    }, original);

    expect(query).toHaveBeenCalledWith(expect.stringContaining('BRIEF_JSON'), undefined, [], {
      readOnly: true, enableWebSearch: false,
    });
    expect(vault.process).not.toHaveBeenCalled();
    expect(prepared.prompt).not.toBe('stale prompt');
    expect(prepared.prompt).toContain('Use selected notes: @Course.md');
    expect(prepared.sourceInstruction).toContain('조건부확률은 조건이 주어진 사건의 확률이다.');
    expect(prepared.sourceInstruction).not.toContain('@Briefs/Goal.md');
  });

  it('rejects an out-of-folder context path before provider access', async () => {
    const deps = createMockDeps();
    const query = jest.fn();
    (deps.plugin as any).app = { vault: { adapter: { basePath: '/vault' }, getAbstractFileByPath: jest.fn(() => makeFile('Brief.md')) } };
    (deps.plugin as any).agentService.query = query;
    const controller = new InputController(deps);
    const result = await (controller as any).prepareStudyGoal({
      briefPath: 'Brief.md', folderPath: 'Study', contextPath: 'Outside/STUDY_CONTEXT.md',
    }, { mode: 'socratic' });

    expect(result).toBeNull();
    expect(query).not.toHaveBeenCalled();
  });

  it('refuses to overwrite a concept section changed during preparation', async () => {
    const context = makeFile('Study/STUDY_CONTEXT.md');
    const latest = `Student note\n\n## 학습 개념 근거\n\n<!-- tutor-concepts:start -->\n학생이 수정한 내용\n<!-- tutor-concepts:end -->`;
    const process = jest.fn(async (_file: TFile, transform: (value: string) => string) => transform(latest));
    const deps = createMockDeps();
    (deps.plugin as any).app = { vault: {
      getAbstractFileByPath: jest.fn((path: string) => path === 'Study' ? { path } : path === context.path ? context : null),
      process,
      read: jest.fn(),
    } };
    const controller = new InputController(deps);

    await expect((controller as any).appendStudyContext(context.path, 'Study', 'stale tutor proposal')).rejects.toThrow('개념 영역이 바뀌었습니다');
    expect(process).toHaveBeenCalledTimes(1);
    expect((deps.plugin as any).app.vault.read).not.toHaveBeenCalled();
  });

  it('supplements the unchanged concept section and preserves its earlier concepts', async () => {
    const context = makeFile('Study/STUDY_CONTEXT.md');
    let content = `Student note\n\n## 학습 개념 근거\n\n<!-- tutor-concepts:start -->\n기존 개념\n<!-- tutor-concepts:end -->`;
    const vault = {
      getAbstractFileByPath: jest.fn((path: string) => path === 'Study' ? { path } : path === context.path ? context : null),
      process: jest.fn(async (_file: TFile, transform: (value: string) => string) => { content = transform(content); }),
      read: jest.fn(async () => content),
    };
    const deps = createMockDeps();
    (deps.plugin as any).app = { vault };
    const controller = new InputController(deps);

    await (controller as any).appendStudyContext(context.path, 'Study', '보충 개념', '', '기존 개념');

    expect(content).toContain('기존 개념');
    expect(content).toContain('보충 개념');
  });

  it('adds the student checklist and problem scratchpad only when creating a new context document', async () => {
    const context = makeFile('Study/STUDY_CONTEXT.md');
    let content = '';
    let exists = false;
    const vault = {
      getAbstractFileByPath: jest.fn((path: string) => path === 'Study' ? ({ path }) : exists && path === context.path ? context : null),
      create: jest.fn(async () => { exists = true; content = '# 학습 맥락\n'; return context; }),
      process: jest.fn(async (_file: TFile, transform: (value: string) => string) => { content = transform(content); }),
      read: jest.fn(async () => content),
    };
    const deps = createMockDeps();
    (deps.plugin as any).app = { vault };
    const controller = new InputController(deps);

    await (controller as any).appendStudyContext(context.path, 'Study', '확률 개념');
    expect(content.match(/## 점검 체크리스트/g) ?? []).toHaveLength(1);
    expect(content.match(/## 문제 기록/g) ?? []).toHaveLength(1);
    expect(content).toContain('- [ ] Brief 적용 후 Agent 전환 질문이 떴다');
    expect(content).toContain('날짜, 무엇을 했는지, 무슨 일이 생겼는지, 사용한 AI 제공자/모드');
    expect(content).toContain('설정 → 문제 기록 → "최근 오류 복사"');

    await (controller as any).appendStudyContext(context.path, 'Study', '추가 개념', '', '확률 개념');
    expect(content.match(/## 점검 체크리스트/g) ?? []).toHaveLength(1);
    expect(content.match(/## 문제 기록/g) ?? []).toHaveLength(1);
    expect((controller as any).extractPreparedConcepts(content)).not.toContain('## 문제 기록');

    const existing = makeFile('Study/Existing.md');
    let existingContent = '# 학생 문서\n\n학생 내용';
    const existingVault = {
      getAbstractFileByPath: (path: string) => path === 'Study' ? ({ path }) : path === existing.path ? existing : null,
      process: jest.fn(async (_file: TFile, transform: (value: string) => string) => { existingContent = transform(existingContent); }),
      read: jest.fn(async () => existingContent),
    };
    (deps.plugin as any).app.vault = existingVault;
    await (controller as any).appendStudyContext(existing.path, 'Study', '학생 문서 개념');
    expect(existingContent).not.toContain('## 점검 체크리스트');
    expect(existingContent).not.toContain('## 문제 기록');
    expect(existingContent).toContain('학생 내용');
  });


  it('uses Brief Web permission for preparation without changing the global toggle', async () => {
    let enabled = false;
    const setEnabled = jest.fn((value: boolean) => { enabled = value; });
    const deps = createMockDeps({ getWebSearchToggle: () => ({ isEnabled: () => enabled, setEnabled }) });
    const plugin = deps.plugin as any;
    plugin.settings.selectedProvider = 'copilot';
    plugin.settings.permissionMode = 'agent';
    plugin.settings.blanketWriteAcknowledged = ['copilot'];
    plugin.storage = { loadState: jest.fn().mockResolvedValue({ studyGoalBindings: [] }), updateState: jest.fn() };
    plugin.getActiveConversation = jest.fn().mockReturnValue(null);
    const controller = new InputController(deps);
    const result = {
      mode: 'quiz' as const, prompt: 'initial', displayContent: 'quiz', totalQuestions: 5,
      difficulty: '상' as const, questionStyle: 'application' as const, sourceInstruction: 'prepared',
      enableWebSearch: true,
      studyGoal: { briefPath: 'Briefs/Goal.md', folderPath: 'skhynix', contextPath: 'skhynix/STUDY_CONTEXT.md', existingId: 'goal-1', webSearch: true },
    };
    const preparation = jest.spyOn(controller as any, 'prepareStudyGoal').mockResolvedValue(result);
    deps.plugin.agentService.query = jest.fn().mockImplementation(() => createMockStream([{ type: 'done' }]));

    await (controller as any).sendLearningSetupResult(result, {});

    expect(setEnabled).not.toHaveBeenCalled();
    expect(preparation).toHaveBeenCalledWith(expect.objectContaining({ webSearch: true }), expect.anything());
    expect((deps.plugin.agentService.query as jest.Mock).mock.calls[0][3]).toMatchObject({ enableWebSearch: true });

    deps.state.quizSession = null;
    await controller.sendMessage({ content: '일반 채팅' });

    expect((deps.plugin.agentService.query as jest.Mock).mock.calls[1][3]).toMatchObject({ enableWebSearch: false });
  });

  it('can start from Brief concept evidence alone and stores it in skhynix before the first quiz', async () => {
    const brief = makeFile('Brief.md');
    const documents = new Map<string, string>([[brief.path,
      '---\nstudy_folder: skhynix\n---\n## 학습 개념 근거\nAI는 넓은 분야이며 ML은 데이터에서 패턴을 학습합니다.']]);
    const fileRefs = new Map<string, TFile>([[brief.path, brief]]);
    let hasFolder = false;
    const vault = {
      adapter: { basePath: '/vault' },
      getAbstractFileByPath: (p: string) => p === 'skhynix' && hasFolder ? { path: p } : fileRefs.get(p) ?? null,
      createFolder: jest.fn(async () => { hasFolder = true; }),
      create: jest.fn(async (p: string, text: string) => {
        const file = makeFile(p);
        fileRefs.set(p, file);
        documents.set(p, text);
        return file;
      }),
      read: jest.fn(async (file: TFile) => documents.get(file.path) ?? ''),
      process: jest.fn(async (file: TFile, fn: (text: string) => string) => {
        documents.set(file.path, fn(documents.get(file.path) ?? ''));
      }),
    };
    const deps = createMockDeps();
    (deps.plugin as any).app = { vault };
    (deps.plugin as any).agentService.query = jest.fn(async function* () {
      yield { type: 'text', content: JSON.stringify({ sufficient: true, summary: '기초 개념을 재사용합니다.' }) };
    });

    const result = await (new InputController(deps) as any).prepareStudyGoal({
      briefPath: brief.path, folderPath: 'skhynix', contextPath: 'skhynix/STUDY_CONTEXT.md',
    }, {
      mode: 'quiz', prompt: 'stale', displayContent: 'quiz', totalQuestions: 5,
      difficulty: '상', questionStyle: 'application', sourceInstruction: 'No markdown files found in selected folders: skhynix.',
      enableWebSearch: true,
    });

    expect(vault.createFolder).toHaveBeenCalledWith('skhynix');
    expect(documents.get('skhynix/STUDY_CONTEXT.md')).toContain('ML은 데이터에서 패턴을 학습합니다');
    expect(result.sourceInstruction).toContain('ML은 데이터에서 패턴을 학습합니다');
    expect(result.prompt).toContain('apply concepts from the selected material to fresh scenarios');
  });

  it('appends each answered question exactly once to the confirmed folder without a new score ledger', async () => {
    const dest = 'skhynix/QUIZ_HISTORY.md';
    const quizHistory = makeFile(dest);
    const files = new Map<string, TFile>();
    const contents = new Map<string, string>();
    const vault = {
      adapter: { basePath: '/vault' },
      getAbstractFileByPath: jest.fn((p: string) => files.get(p) ?? null),
      create: jest.fn(async (p: string, body: string) => {
        files.set(p, quizHistory);
        contents.set(p, body);
        return quizHistory;
      }),
      process: jest.fn(async (file: TFile, transform: (text: string) => string) => {
        contents.set(file.path, transform(contents.get(file.path) ?? ''));
      }),
      read: jest.fn(async (file: TFile) => contents.get(file.path) ?? ''),
    };
    const deps = createMockDeps();
    const plugin = deps.plugin as any;
    plugin.app = { vault };
    plugin.getActiveConversation = jest.fn().mockReturnValue({ id: 'conversation-1', studyGoalId: 'goal-1' });
    plugin.storage = { loadState: jest.fn().mockResolvedValue({
      studyGoalBindings: [{ id: 'goal-1', briefPath: 'Brief.md', folderPath: 'skhynix', contextPath: 'skhynix/STUDY_CONTEXT.md' }],
    }) };
    const controller = new InputController(deps);
    const question = {
      messageId: 'assistant-question-1', questionNumber: 1, totalQuestions: 5,
      questionText: '## 1/5번 문제\n\n#### 어떤 경우가 분류인가?\n\nA. 정상/불량\nB. 수율 숫자',
    };
    const reply = { content: '### 정답 확인\n- 정답: A\n- 해설: 범주를 예측합니다.\n\n## 2/5번 문제\n다음 문제' };
    await (controller as any).saveStudyQuizAnswer(question, 'A', reply, 'conversation-1', 'goal-1');
    await (controller as any).saveStudyQuizAnswer(question, 'A', reply, 'conversation-1', 'goal-1');

    const saved = contents.get(dest) ?? '';
    expect(vault.create).toHaveBeenCalledTimes(1);
    expect(saved.match(/tutor-quiz:conversation-1:assistant-question-1/g)).toHaveLength(1);
    expect(saved).toContain('어떤 경우가 분류인가?');
    expect(saved).toContain('**첫 제출 답변:** A');
    expect(saved).toContain('범주를 예측합니다');
    expect(saved).not.toContain('## 2/5번 문제');
  });

  it('archives the quiz answer and completion summary to the conversation active when the answer was sent', async () => {
    const contextA = makeFile('Study/A/STUDY_CONTEXT.md');
    const contextB = makeFile('Study/B/STUDY_CONTEXT.md');
    const files = new Map<string, TFile>([[contextA.path, contextA], [contextB.path, contextB]]);
    const contents = new Map<string, string>([
      [contextA.path, '# A\n\n## 학습 개념 근거\n<!-- tutor-concepts:start -->\nA concepts\n<!-- tutor-concepts:end -->'],
      [contextB.path, '# B\n\n## 학습 개념 근거\n<!-- tutor-concepts:start -->\nB concepts\n<!-- tutor-concepts:end -->'],
    ]);
    const vault = {
      adapter: { basePath: '/vault' },
      getAbstractFileByPath: jest.fn((path: string) => files.get(path) ?? null),
      create: jest.fn(async (path: string, body: string) => {
        const file = makeFile(path);
        files.set(path, file);
        contents.set(path, body);
        return file;
      }),
      process: jest.fn(async (file: TFile, transform: (text: string) => string) => {
        contents.set(file.path, transform(contents.get(file.path) ?? ''));
      }),
      read: jest.fn(async (file: TFile) => contents.get(file.path) ?? ''),
    };
    const deps = createMockDeps();
    const plugin = deps.plugin as any;
    const conversationA = { id: 'conv-a', studyGoalId: 'goal-a' };
    const conversationB = { id: 'conv-b', studyGoalId: 'goal-b' };
    let activeConversation = conversationA;
    plugin.app = { vault };
    plugin.getConversationById = jest.fn((id: string) => id === 'conv-a' ? conversationA : conversationB);
    plugin.getActiveConversation = jest.fn(() => activeConversation);
    plugin.storage = { loadState: jest.fn().mockResolvedValue({ studyGoalBindings: [
      { id: 'goal-a', briefPath: 'Brief-A.md', folderPath: 'Study/A', contextPath: contextA.path },
      { id: 'goal-b', briefPath: 'Brief-B.md', folderPath: 'Study/B', contextPath: contextB.path },
    ] }) };
    deps.state.currentConversationId = 'conv-a';
    deps.state.quizSession = {
      totalQuestions: 1, currentQuestion: 1, scopeLabel: 'Quiz A', sourceInstruction: '@Course-A.md',
    };
    deps.state.addMessage({
      id: 'question-a', role: 'assistant', content: '', timestamp: Date.now(),
      contentBlocks: [{ type: 'text', content: '## 1/1번 문제\n\n#### A의 질문인가요?\n\nA. 예\nB. 아니요' }],
      quizQuestion: { current: 1, total: 1, multiSelect: false, freeText: false, options: [{ label: 'A', text: '예' }] },
    });
    deps.renderer.addMessage = jest.fn(() => ({ querySelector: () => ({ createEl: jest.fn(() => ({ dataset: {} })) }) } as any));
    deps.plugin.agentService.query = jest.fn().mockImplementation(async function* () {
      activeConversation = conversationB;
      deps.state.currentConversationId = 'conv-b';
      yield { type: 'done' };
    });
    const controller = new InputController(deps);

    await controller.sendMessage({ content: 'A' });

    expect(vault.create).toHaveBeenCalledWith('Study/A/QUIZ_HISTORY.md', expect.any(String));
    expect(contents.get('Study/A/QUIZ_HISTORY.md')).toContain('tutor-quiz:conv-a:question-a');
    expect(contents.get(contextA.path)).toContain('## 학습 완료');
    expect(contents.get(contextB.path)).not.toContain('## 학습 완료');
  });

  it('attaches the completed quiz message id to its live review button', async () => {
    const deps = createMockDeps();
    const controller = new InputController(deps);
    deps.state.quizSession = { totalQuestions: 1, currentQuestion: 1, scopeLabel: 'quiz' };
    deps.state.addMessage({
      id: 'question-1', role: 'assistant', content: '', timestamp: Date.now(),
      contentBlocks: [{ type: 'text', content: '## 1/1번 문제\n\n#### 질문인가요?\n\nA. 예\nB. 아니요' }],
      quizQuestion: { current: 1, total: 1, multiSelect: false, freeText: false, options: [{ label: 'A', text: '예' }] },
    });
    const button = { type: '', dataset: {} as Record<string, string> };
    const contentEl = { createEl: jest.fn(() => button) };
    deps.renderer.addMessage = jest.fn(() => ({ querySelector: () => contentEl }) as any);
    deps.plugin.agentService.query = jest.fn().mockImplementation(() => createMockStream([{ type: 'done' }]));

    await controller.sendMessage({ content: 'A' });

    const finalTurn = deps.state.messages.find(message => message.quizReviewAvailable);
    expect(finalTurn).toBeDefined();
    expect(button.dataset.messageId).toBe(finalTurn?.id);
  });

  it.each(['error', 'interrupted'] as const)('does not archive a quiz answer when provider outcome is %s', async (outcome) => {
    const history = makeFile('Study/QUIZ_HISTORY.md');
    const contents = new Map<string, string>();
    const vault = {
      adapter: { basePath: '/vault' },
      getAbstractFileByPath: jest.fn((filePath: string) => filePath === history.path && contents.has(filePath) ? history : null),
      create: jest.fn(async (filePath: string, initial: string) => { contents.set(filePath, initial); return history; }),
      process: jest.fn(async (_file: TFile, transform: (value: string) => string) => { contents.set(history.path, transform(contents.get(history.path) ?? '')); }),
      read: jest.fn(async () => contents.get(history.path) ?? ''),
    };
    const deps = createMockDeps();
    (deps.plugin as any).app = { vault };
    (deps.plugin as any).getActiveConversation = jest.fn().mockReturnValue({ id: 'conv-1', studyGoalId: 'goal-1' });
    (deps.plugin as any).storage = { loadState: jest.fn().mockResolvedValue({ studyGoalBindings: [{ id: 'goal-1', folderPath: 'Study' }] }) };
    deps.state.quizSession = { totalQuestions: 1, currentQuestion: 1, scopeLabel: 'quiz' };
    deps.state.addMessage({
      id: 'question-1', role: 'assistant', content: '', timestamp: Date.now(),
      contentBlocks: [{ type: 'text', content: '## 1/1번 문제\n\n#### 원본 질문인가요?\n\nA. 예\nB. 아니요' }],
      quizQuestion: { current: 1, total: 1, multiSelect: false, freeText: false, options: [{ label: 'A', text: '예' }] },
    });
    deps.plugin.agentService.query = jest.fn().mockImplementation(() => createMockStream([
      ...(outcome === 'interrupted' ? [{ type: 'text', content: 'partial feedback' }] : []),
      { type: outcome === 'error' ? 'error' : 'done', content: 'provider failed' },
    ]));
    if (outcome === 'interrupted') {
      deps.streamController.handleStreamChunk = jest.fn().mockImplementation(() => { deps.state.cancelRequested = true; });
    }
    const controller = new InputController(deps);

    await controller.sendMessage({ content: 'A' });

    expect(vault.process).not.toHaveBeenCalled();
  });

  it('appends a bounded proposal to the latest context and uses Web toggle even at medium Quiz difficulty', async () => {
    const brief = makeFile('Brief.md');
    const context = makeFile('Study/STUDY_CONTEXT.md');
    const files = new Map([[brief.path, brief], [context.path, context]]);
    const contents = new Map([[brief.path, 'untrusted brief'], [context.path, '학생이 작성한 메모']]);
    const vault = {
      adapter: { basePath: '/vault' },
      getAbstractFileByPath: (path: string) => path === 'Study' ? ({ path }) : files.get(path) ?? null,
      read: jest.fn(async (file: TFile) => contents.get(file.path) ?? ''),
      process: jest.fn(async (file: TFile, fn: (data: string) => string) => { contents.set(file.path, fn(contents.get(file.path) ?? '')); }),
      createFolder: jest.fn(), create: jest.fn(),
    };
    const deps = createMockDeps({ getWebSearchToggle: () => ({ isEnabled: () => true }) });
    const answers = [
      { sufficient: false, summary: '기초 개념을 보충합니다.' },
      { concepts: '표본공간은 가능한 결과의 집합이다.' },
    ];
    const query = jest.fn(async function* () {
      yield { type: 'text', content: JSON.stringify(answers.shift()) };
    });
    (deps.plugin as any).app = { vault };
    (deps.plugin as any).agentService.query = query;
    const controller = new InputController(deps);
    const result = await (controller as any).prepareStudyGoal({
      briefPath: brief.path, folderPath: 'Study', contextPath: context.path,
    }, {
      mode: 'quiz', prompt: 'stale', displayContent: 'quiz', totalQuestions: 2,
      difficulty: '중', questionStyle: 'material', sourceInstruction: 'Selected course evidence', hasSourceNotes: true, enableWebSearch: false,
    });

    expect(query).toHaveBeenNthCalledWith(1, expect.any(String), undefined, [], { readOnly: true, enableWebSearch: false });
    expect(query).toHaveBeenNthCalledWith(2, expect.any(String), undefined, [], { readOnly: true, enableWebSearch: true });
    expect(vault.process).toHaveBeenCalledTimes(1);
    expect(contents.get(context.path)).toContain('학생이 작성한 메모');
    expect(contents.get(context.path)).toContain('표본공간은 가능한 결과의 집합이다.');
    expect(result.sourceInstruction).toContain('Selected course evidence');
    expect(result.prompt).toContain('개념을 보충했습니다.');
  });
});

describe('InputController goal binding and goal documents', () => {
  const makeFile = (path: string) => Object.assign(new TFile(), { path });

  it.each([
    ['without a goal', {}],
    ['for another goal', { studyGoal: { existingId: 'goal-b', briefPath: 'B.md', folderPath: 'B', contextPath: 'B/STUDY_CONTEXT.md' } }],
  ])('restores the earlier goal when a new learning session %s fails to start, so its Quiz review still works', async (_label, extra) => {
    const deps = createMockDeps();
    const plugin = deps.plugin as any;
    const conversation: any = { id: 'conv-1', studyGoalId: 'goal-a' };
    plugin.getActiveConversation = jest.fn(() => conversation);
    plugin.updateConversation = jest.fn(async (_id: string, updates: object) => { Object.assign(conversation, updates); });
    plugin.storage = { loadState: jest.fn().mockResolvedValue({ studyGoalBindings: [] }), updateState: jest.fn() };
    plugin.agentService.query = jest.fn(async function* () { yield { type: 'error', content: 'provider down' }; });
    const controller = new InputController(deps);
    const quizA = {
      id: 'quiz-a', role: 'assistant' as const, content: '완료', timestamp: Date.now(),
      quizReviewAvailable: true, quizReviewSourceInstruction: 'source A', quizReviewStudyGoalId: 'goal-a',
    };
    deps.state.addMessage(quizA);

    await controller.sendMessage({ content: 'quiz B', quizSessionInit: { totalQuestions: 3, scopeLabel: 'B' }, ...extra } as any);
    expect(conversation.studyGoalId).toBe('goal-a');

    plugin.agentService.query = jest.fn(async function* () { yield { type: 'text', content: '복습 질문' }; yield { type: 'done' }; });
    await expect(controller.startQuizReview('quiz-a')).resolves.toBe(true);
    expect(plugin.agentService.query).toHaveBeenCalled();
    expect(conversation.studyGoalId).toBe('goal-a');
  });

  it('keeps the new goal and retires earlier reviews when the new learning session starts', async () => {
    const deps = createMockDeps();
    const plugin = deps.plugin as any;
    const conversation: any = { id: 'conv-1', studyGoalId: 'goal-a' };
    plugin.getActiveConversation = jest.fn(() => conversation);
    plugin.updateConversation = jest.fn(async (_id: string, updates: object) => { Object.assign(conversation, updates); });
    plugin.storage = { loadState: jest.fn().mockResolvedValue({ studyGoalBindings: [] }), updateState: jest.fn() };
    plugin.agentService.query = jest.fn(async function* () { yield { type: 'text', content: '1/3번 문제' }; yield { type: 'done' }; });
    const controller = new InputController(deps);
    const quizA = {
      id: 'quiz-a', role: 'assistant' as const, content: '완료', timestamp: Date.now(),
      quizReviewAvailable: true, quizReviewSourceInstruction: 'source A', quizReviewStudyGoalId: 'goal-a',
    };
    deps.state.addMessage(quizA);

    await controller.sendMessage({
      content: 'quiz B', quizSessionInit: { totalQuestions: 3, scopeLabel: 'B' },
      studyGoal: { existingId: 'goal-b', briefPath: 'B.md', folderPath: 'B', contextPath: 'B/STUDY_CONTEXT.md' },
    } as any);

    expect(conversation.studyGoalId).toBe('goal-b');
    expect(quizA.quizReviewAvailable).toBe(false);
  });

  it('adapts to how an untagged overview document says to prepare, without a fixed concept section', async () => {
    const overview = makeFile('Hackathon/Overview.md');
    const context = makeFile('Hackathon/Prep/STUDY_CONTEXT.md');
    const body = '# 해커톤 개요\n심사 기준: 문제 정의, 구현 완성도, 발표.\n준비 방식: 심사 기준별로 예상 질문에 답하는 발표 연습 위주로 준비한다.';
    let content = '';
    const vault = {
      adapter: { basePath: '/vault' },
      getAbstractFileByPath: (p: string) => p === overview.path ? overview : p === context.path ? context : p === 'Hackathon/Prep' ? { path: p } : null,
      read: jest.fn(async (file: TFile) => file.path === overview.path ? body : content),
      process: jest.fn(async (_file: TFile, transform: (value: string) => string) => { content = transform(content); }),
    };
    const deps = createMockDeps();
    (deps.plugin as any).app = { vault };
    const prompts: string[] = [];
    const answers = [{ sufficient: false, summary: '준비 자료가 없습니다.' }, { concepts: '' }];
    (deps.plugin as any).agentService.query = jest.fn(async function* (prompt: string) {
      prompts.push(prompt);
      yield { type: 'text', content: JSON.stringify(answers.shift() ?? {}) };
    });

    const prepared = await (new InputController(deps) as any).prepareStudyGoal({
      briefPath: overview.path, folderPath: 'Hackathon/Prep', contextPath: context.path,
    }, { mode: 'quiz', focusText: '', sourceInstruction: 'No eligible course notes selected.', hasSourceNotes: false,
      totalQuestions: 3, difficulty: '중', questionStyle: 'material' });

    expect(prompts[1]).toContain('Follow the preparation approach the Brief describes');
    expect(prepared).not.toBeNull();
    expect(prepared.sourceInstruction).toContain('[Goal document — how the student is preparing]');
    expect(prepared.sourceInstruction).toContain('발표 연습 위주로 준비한다');
    expect(prepared.prompt).toContain('목표 문서의 준비 방식에 맞춰 진행');
  });
});
