/**
 * Tests for MessageRenderer - Stored Message Rendering
 */

import type { ChatMessage } from '@/core/types';
import { MessageRenderer } from '@/features/chat/rendering/MessageRenderer';
import {
  renderStoredAsyncSubagent,
  renderStoredSubagent,
  renderStoredThinkingBlock,
  renderStoredToolCall,
  renderStoredWriteEdit,
} from '@/ui';

jest.mock('@/ui', () => ({
  renderStoredAsyncSubagent: jest.fn(),
  renderStoredSubagent: jest.fn(),
  renderStoredThinkingBlock: jest.fn(),
  renderStoredToolCall: jest.fn(),
  renderStoredWriteEdit: jest.fn(),
}));

function createMockElement() {
  const children: any[] = [];
  const classList = new Set<string>();

  const element: any = {
    children,
    classList: {
      add: (cls: string) => classList.add(cls),
      remove: (cls: string) => classList.delete(cls),
      contains: (cls: string) => classList.has(cls),
    },
    addClass: (cls: string) => classList.add(cls),
    removeClass: (cls: string) => classList.delete(cls),
    hasClass: (cls: string) => classList.has(cls),
    style: {},
    scrollTop: 0,
    scrollHeight: 0,
    textContent: '',
    empty: jest.fn(() => { children.length = 0; }),
    createDiv: (opts?: { cls?: string; text?: string }) => {
      const child = createMockElement();
      if (opts?.cls) child.addClass(opts.cls);
      if (opts?.text) child.textContent = opts.text;
      children.push(child);
      return child;
    },
    createSpan: (opts?: { cls?: string; text?: string }) => {
      const child = createMockElement();
      if (opts?.cls) child.addClass(opts.cls);
      if (opts?.text) child.textContent = opts.text;
      children.push(child);
      return child;
    },
    createEl: (tag: string, opts?: { cls?: string; text?: string }) => {
      const child = createMockElement();
      child.tagName = tag.toUpperCase();
      if (opts?.cls) child.addClass(opts.cls);
      if (opts?.text) child.textContent = opts.text;
      children.push(child);
      return child;
    },
    appendChild: (child: any) => { children.push(child); return child; },
    querySelector: jest.fn().mockReturnValue(null),
    querySelectorAll: jest.fn().mockReturnValue([]),
    setText: jest.fn((text: string) => { element.textContent = text; }),
    addEventListener: jest.fn(),
  };

  return element;
}

function createMockComponent() {
  return {
    registerDomEvent: jest.fn(),
    register: jest.fn(),
    addChild: jest.fn(),
    load: jest.fn(),
    unload: jest.fn(),
  };
}

describe('MessageRenderer', () => {
  it('renders welcome element and calls renderStoredMessage for each message', () => {
    const messagesEl = createMockElement();
    const mockComponent = createMockComponent();
    const renderer = new MessageRenderer({} as any, mockComponent as any, messagesEl);
    const renderStoredSpy = jest.spyOn(renderer, 'renderStoredMessage').mockImplementation(() => {});

    const messages: ChatMessage[] = [
      { id: 'm1', role: 'assistant', content: '', timestamp: Date.now(), toolCalls: [], contentBlocks: [] },
    ];

    const welcomeEl = renderer.renderMessages(messages, () => 'Hello');

    expect(messagesEl.empty).toHaveBeenCalled();
    expect(renderStoredSpy).toHaveBeenCalledTimes(1);
    expect(welcomeEl.hasClass('ocop-welcome')).toBe(true);
    expect(welcomeEl.children[0].textContent).toBe('Hello');
  });

  it('renders assistant content blocks using specialized renderers', () => {
    const messagesEl = createMockElement();
    const mockComponent = createMockComponent();
    const renderer = new MessageRenderer({} as any, mockComponent as any, messagesEl);
    const renderContentSpy = jest.spyOn(renderer, 'renderContent').mockResolvedValue(undefined);

    const msg: ChatMessage = {
      id: 'm1',
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      toolCalls: [
        { id: 'todo', name: 'TodoWrite', input: { items: [] } } as any,
        { id: 'edit', name: 'Edit', input: { file_path: 'notes/test.md' } } as any,
        { id: 'read', name: 'Read', input: { file_path: 'notes/test.md' } } as any,
      ],
      contentBlocks: [
        { type: 'thinking', content: 'thinking', durationSeconds: 2 } as any,
        { type: 'text', content: 'Text block' } as any,
        { type: 'tool_use', toolId: 'todo' } as any,
        { type: 'tool_use', toolId: 'edit' } as any,
        { type: 'tool_use', toolId: 'read' } as any,
        { type: 'subagent', subagentId: 'sub-1', mode: 'async' } as any,
        { type: 'subagent', subagentId: 'sub-2' } as any,
      ],
      subagents: [
        { id: 'sub-1', mode: 'async' } as any,
        { id: 'sub-2', mode: 'sync' } as any,
      ],
    };

    renderer.renderStoredMessage(msg);

    expect(renderStoredThinkingBlock).toHaveBeenCalled();
    expect(renderContentSpy).toHaveBeenCalledWith(expect.anything(), 'Text block');
    // TodoWrite is not rendered inline - only in bottom panel
    expect(renderStoredWriteEdit).toHaveBeenCalled();
    expect(renderStoredToolCall).toHaveBeenCalled();
    expect(renderStoredAsyncSubagent).toHaveBeenCalled();
    expect(renderStoredSubagent).toHaveBeenCalled();
  });
});

describe('stored quiz messages recovered on replay', () => {
  // Straight out of the vault: while codex glued its blocks together the header ended up
  // mid-line, so `parseQuizQuestionMeta` returned undefined at stream end and the saved
  // message carries `quizQuestion: undefined` forever. Reopening must recover both the
  // text the student reads and the panel they answer with.
  const GLUED = '[Solo] 노트를 읽고 작성합니다.## 1/5번 문제\n\n#### 질문\n\nA. 첫째\nB. 둘째';

  const storedMessage = (): ChatMessage => ({
    id: 'm-quiz',
    role: 'assistant',
    content: '',
    timestamp: Date.now(),
    toolCalls: [],
    contentBlocks: [{ type: 'text', content: GLUED } as any],
  });

  const flatten = (el: any): any[] => [el, ...el.children.flatMap((child: any) => flatten(child))];

  it('mounts the answer panel for a message saved without quizQuestion', () => {
    const messagesEl = createMockElement();
    const renderer = new MessageRenderer({} as any, createMockComponent() as any, messagesEl);
    const renderContentSpy = jest.spyOn(renderer, 'renderContent').mockResolvedValue(undefined);

    const msg = storedMessage();
    expect(msg.quizQuestion).toBeUndefined();
    renderer.renderStoredMessage(msg);

    // The student stops seeing a run-on line...
    const rendered = renderContentSpy.mock.calls[0][1];
    expect(rendered).not.toContain('작성합니다.##');
    expect(/^##\s*1\s*\/\s*5번 문제/m.test(rendered)).toBe(true);

    // ...and gets the clickable options plus the progress bar back.
    const all = flatten(messagesEl);
    expect(all.some((el) => el.hasClass('ocop-quiz-progress-fill'))).toBe(true);
    expect(all.filter((el) => el.hasClass('ocop-quiz-answer-btn')).length).toBe(2);

    // The recovered metadata is for this render only — the stored message is untouched,
    // so nothing rewrites the student's session file.
    expect(msg.quizQuestion).toBeUndefined();
  });

  it('draws the 힌트 and 모르겠어요 controls the live panel has', () => {
    const messagesEl = createMockElement();
    const renderer = new MessageRenderer({} as any, createMockComponent() as any, messagesEl);
    jest.spyOn(renderer, 'renderContent').mockResolvedValue(undefined);

    renderer.renderStoredMessage(storedMessage());

    const all = flatten(messagesEl);
    expect(all.some((el) => el.hasClass('ocop-quiz-quick-actions'))).toBe(true);
    // These exact classes are what ObsidianCopilotView's delegation listens for.
    expect(all.some((el) => el.hasClass('ocop-quiz-quick-action-btn ocop-quiz-hint-btn'))).toBe(true);
    expect(all.some((el) => el.hasClass('ocop-quiz-quick-action-btn ocop-quiz-stuck-btn'))).toBe(true);
    expect(all.some((el) => el.textContent === '💡 힌트')).toBe(true);
    expect(all.some((el) => el.textContent === '😵 모르겠어요')).toBe(true);
  });
});
