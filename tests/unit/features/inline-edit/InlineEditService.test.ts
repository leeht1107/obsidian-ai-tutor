/**
 * Tests for InlineEditService isolation, clarification continuity, and cancellation.
 */
import { InlineEditService } from '@/features/inline-edit/InlineEditService';

function buildPlugin() {
  return {
    agentService: {
      streamQuery: jest.fn(),
      cancel: jest.fn(),
    },
    settings: { selectedProvider: 'copilot' },
    setBashExpansionActive: jest.fn(),
  } as any;
}

function buildAgent(streamQueryImpl: () => AsyncGenerator<string>) {
  return {
    streamQuery: jest.fn().mockImplementation(streamQueryImpl),
    cancel: jest.fn(),
  };
}

describe('InlineEditService - isolated provider ownership', () => {
  it('uses its isolated bridge instead of the main chat agentService', async () => {
    let busy = false;
    let busyMidStream: boolean | null = null;
    const plugin = buildPlugin();
    plugin.setBashExpansionActive.mockImplementation((active: boolean) => { busy = active; });
    const agent = buildAgent(() => (async function* () {
      busyMidStream = busy;
      yield '<replacement>done</replacement>';
    })());
    const service = new InlineEditService(plugin, () => agent as any);

    const result = await service.continueConversation('refine this');

    expect(result).toEqual({ success: true, editedText: 'done' });
    expect(plugin.agentService.streamQuery).not.toHaveBeenCalled();
    expect(agent.streamQuery).toHaveBeenCalledWith(
      expect.stringContaining('refine this'),
      { allowedTools: undefined, readOnly: true, skipResume: true }
    );
    expect(busyMidStream).toBe(true);
    expect(busy).toBe(false);
    expect(plugin.setBashExpansionActive).toHaveBeenNthCalledWith(1, true);
    expect(plugin.setBashExpansionActive).toHaveBeenNthCalledWith(2, false);
  });

  it('forwards an explicit slash allowlist only to the isolated bridge', async () => {
    const plugin = buildPlugin();
    const agent = buildAgent(() => (async function* () {
      yield '<replacement>done</replacement>';
    })());
    const service = new InlineEditService(plugin, () => agent as any);

    await service.editText({
      mode: 'selection',
      instruction: 'edit',
      notePath: 'notes/a.md',
      selectedText: 'old',
      allowedTools: ['Read'],
    });

    expect(plugin.agentService.streamQuery).not.toHaveBeenCalled();
    expect(agent.streamQuery).toHaveBeenLastCalledWith(
      expect.any(String),
      { allowedTools: ['Read'], readOnly: true, skipResume: true }
    );
  });

  it('replays a bounded local clarification transcript on the next turn', async () => {
    const plugin = buildPlugin();
    let call = 0;
    const agent = buildAgent(() => (async function* () {
      call += 1;
      if (call === 1) {
        yield 'Which section?';
      } else {
        yield '<replacement>new section</replacement>';
      }
    })());
    const service = new InlineEditService(plugin, () => agent as any);

    const first = await service.editText({
      mode: 'selection',
      instruction: 'rewrite this',
      notePath: 'notes/a.md',
      selectedText: 'old section',
    });
    expect(first).toEqual({ success: true, clarification: 'Which section?' });

    const second = await service.continueConversation('Section 2');
    expect(second).toEqual({ success: true, editedText: 'new section' });

    const secondPrompt = agent.streamQuery.mock.calls[1][0] as string;
    expect(secondPrompt).toContain('<inline_edit_conversation>');
    expect(secondPrompt).toContain('old section');
    expect(secondPrompt).toContain('rewrite this');
    expect(secondPrompt).toContain('Assistant:\nWhich section?');
    expect(secondPrompt).toContain('User:\nSection 2');
    expect(plugin.agentService.streamQuery).not.toHaveBeenCalled();
  });

  it('does not commit a failed clarification reply into the local transcript', async () => {
    const plugin = buildPlugin();
    let call = 0;
    const agent = buildAgent(() => (async function* () {
      call += 1;
      if (call === 1) {
        yield 'Which section?';
        return;
      }
      if (call === 2) {
        throw new Error('provider failed');
      }
      yield '<replacement>new section</replacement>';
    })());
    const service = new InlineEditService(plugin, () => agent as any);

    const first = await service.editText({
      mode: 'selection',
      instruction: 'rewrite this',
      notePath: 'notes/a.md',
      selectedText: 'old section',
    });
    expect(first).toEqual({ success: true, clarification: 'Which section?' });

    const failed = await service.continueConversation('Section 2');
    expect(failed).toEqual({ success: false, error: 'provider failed' });

    const retry = await service.continueConversation('Section 3');
    expect(retry).toEqual({ success: true, editedText: 'new section' });

    const retryPrompt = agent.streamQuery.mock.calls[2][0] as string;
    expect(retryPrompt).toContain('Assistant:\nWhich section?');
    expect(retryPrompt).toContain('User:\nSection 3');
    expect(retryPrompt).not.toContain('User:\nSection 2');
  });

  it('releases the toggle even when the isolated stream throws', async () => {
    const plugin = buildPlugin();
    const agent = buildAgent(() => (async function* () {
      throw new Error('CLI crashed');
      // eslint-disable-next-line no-unreachable
      yield 'unreachable';
    })());
    const service = new InlineEditService(plugin, () => agent as any);

    const result = await service.continueConversation('refine this');

    expect(result).toEqual({ success: false, error: 'CLI crashed' });
    expect(plugin.setBashExpansionActive).toHaveBeenNthCalledWith(1, true);
    expect(plugin.setBashExpansionActive).toHaveBeenNthCalledWith(2, false);
  });

  it('cancels the owned provider immediately instead of only setting a local abort flag', () => {
    const plugin = buildPlugin();
    const agent = buildAgent(() => (async function* () {
      yield 'unused';
    })());
    const service = new InlineEditService(plugin, () => agent as any);

    service.cancel();

    expect(agent.cancel).toHaveBeenCalledTimes(1);
    expect(plugin.agentService.cancel).not.toHaveBeenCalled();
  });
});
