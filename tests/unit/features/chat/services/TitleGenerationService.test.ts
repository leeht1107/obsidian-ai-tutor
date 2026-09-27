import { TitleGenerationService } from '@/features/chat/services/TitleGenerationService';

describe('TitleGenerationService', () => {
  it('generates titles and uses the title model override', async () => {
    const streamQuery = jest.fn().mockImplementation(
      () => (async function* () {
        yield '"Runtime Safe Title"';
      })()
    );

    const plugin = {
      settings: {
        titleGenerationModel: 'gpt-5.4-mini',
      },
      agentService: {
        streamQuery,
      },
      setBashExpansionActive: jest.fn(),
    } as any;

    const isolatedStreamQuery = jest.fn().mockImplementation(
      () => (async function* () {
        yield '"Runtime Safe Title"';
      })()
    );
    const service = new TitleGenerationService(plugin, () => ({
      streamQuery: isolatedStreamQuery,
      cancel: jest.fn(),
    }) as any);
    const callback = jest.fn().mockResolvedValue(undefined);

    await service.generateTitle('conv-1', 'First prompt', 'Assistant response', callback);

    expect(streamQuery).not.toHaveBeenCalled();
    expect(isolatedStreamQuery).toHaveBeenCalledWith(
      expect.stringContaining('Generate a title for this conversation:'),
      {
        skipResume: true,
        model: 'gpt-5.4-mini',
        readOnly: true,
        enableWebSearch: false,
      }
    );
    expect(callback).toHaveBeenCalledWith('conv-1', {
      success: true,
      title: 'Runtime Safe Title',
    });
  });

  it('does not start a provider request for Agy title generation', async () => {
    const serviceFactory = jest.fn(() => ({
      streamQuery: jest.fn(),
      cancel: jest.fn(),
    }));
    const plugin = {
      settings: {
        selectedProvider: 'agy',
        titleGenerationModel: '',
      },
      setBashExpansionActive: jest.fn(),
    } as any;
    const service = new TitleGenerationService(plugin, serviceFactory as any);
    const callback = jest.fn().mockResolvedValue(undefined);

    await service.generateTitle('conv-agy', 'prompt', 'response', callback);

    expect(serviceFactory).not.toHaveBeenCalled();
    expect(plugin.setBashExpansionActive).not.toHaveBeenCalled();
    expect(callback).toHaveBeenCalledWith('conv-agy', {
      success: false,
      error: expect.stringContaining('Web-off cannot be enforced'),
    });
  });

  it('locks the write-authority toggle while the title stream runs and releases it when done', async () => {
    // Title generation runs the same agentService.streamQuery child-process path as
    // chat/inline-edit/instruction-refine, so it must hold the counter the toggle reads.
    let busy = false;
    let busyMidStream: boolean | null = null;
    const streamQuery = jest.fn().mockImplementation(
      () => (async function* () {
        busyMidStream = busy;
        yield '"Title"';
      })()
    );

    const plugin = {
      settings: {},
      agentService: { streamQuery },
      setBashExpansionActive: jest.fn((active: boolean) => { busy = active; }),
    } as any;

    const service = new TitleGenerationService(plugin, () => ({
      streamQuery,
      cancel: jest.fn(),
    }) as any);
    const callback = jest.fn().mockResolvedValue(undefined);

    await service.generateTitle('conv-1', 'prompt', 'response', callback);

    expect(busyMidStream).toBe(true);
    expect(busy).toBe(false);
    expect(plugin.setBashExpansionActive).toHaveBeenNthCalledWith(1, true);
    expect(plugin.setBashExpansionActive).toHaveBeenNthCalledWith(2, false);
  });

  it('releases the toggle even when the title stream throws', async () => {
    const streamQuery = jest.fn().mockImplementation(
      () => (async function* () {
        throw new Error('CLI crashed');
        // eslint-disable-next-line no-unreachable
        yield 'unreachable';
      })()
    );

    const plugin = {
      settings: {},
      agentService: { streamQuery },
      setBashExpansionActive: jest.fn(),
    } as any;

    const service = new TitleGenerationService(plugin, () => ({
      streamQuery,
      cancel: jest.fn(),
    }) as any);
    const callback = jest.fn().mockResolvedValue(undefined);

    await service.generateTitle('conv-1', 'prompt', 'response', callback);

    expect(callback).toHaveBeenCalledWith('conv-1', { success: false, error: 'CLI crashed' });
    expect(plugin.setBashExpansionActive).toHaveBeenNthCalledWith(1, true);
    expect(plugin.setBashExpansionActive).toHaveBeenNthCalledWith(2, false);
  });
});
