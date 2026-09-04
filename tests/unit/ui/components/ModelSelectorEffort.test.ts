import { getProviderEffortLevels, type ProviderModelOption } from '../../../../src/core/providers/providerRegistry';
import { ModelSelector } from '../../../../src/ui/components/InputToolbar';

/** Minimal Obsidian element stand-in whose `empty()` actually clears, so re-renders are observable. */
const makeElement = (): any => {
  const attributes: Record<string, string> = {};
  const classes = new Set<string>();
  const el: any = {
    children: [] as any[],
    listeners: {} as Record<string, (e: any) => void>,
    style: {},
    elementOptions: undefined as any,
  };
  const add = (options: any) => {
    const child = makeElement();
    child.elementOptions = options;
    el.children.push(child);
    return child;
  };
  el.createDiv = jest.fn(add);
  el.createSpan = jest.fn(add);
  el.createEl = jest.fn((_tag: string, options: any) => add(options));
  el.empty = jest.fn(() => { el.children.length = 0; });
  el.addClass = jest.fn((c: string) => { classes.add(c); });
  el.removeClass = jest.fn((c: string) => { classes.delete(c); });
  el.hasClass = jest.fn((c: string) => classes.has(c));
  el.toggleClass = jest.fn((c: string, on: boolean) => { if (on) classes.add(c); else classes.delete(c); });
  el.setAttribute = jest.fn((n: string, v: string) => { attributes[n] = v; });
  el.getAttribute = jest.fn((n: string) => attributes[n] ?? null);
  el.removeAttribute = jest.fn((n: string) => { delete attributes[n]; });
  el.addEventListener = jest.fn((event: string, handler: (e: any) => void) => { el.listeners[event] = handler; });
  el.click = () => el.listeners.click?.({ stopPropagation: jest.fn() });
  el.clickAndSettle = async () => { await el.listeners.click?.({ stopPropagation: jest.fn() }); };
  return el;
};

/** Every text node rendered anywhere under `el`. */
const texts = (el: any): string[] => {
  const out: string[] = [];
  const walk = (n: any) => {
    if (n.elementOptions?.text) out.push(n.elementOptions.text);
    (n.children ?? []).forEach(walk);
  };
  walk(el);
  return out;
};
/** The clickable node whose own subtree renders `text` — labels live on child spans. */
const findClickable = (el: any, text: string): any => {
  let hit: any = null;
  const walk = (n: any) => {
    if (!hit && n.listeners?.click && texts(n).includes(text)) { hit = n; return; }
    (n.children ?? []).forEach(walk);
  };
  walk(el);
  if (!hit) throw new Error(`no clickable node rendering "${text}"`);
  return hit;
};

const CODEX_MODELS: ProviderModelOption[] = [
  { id: 'gpt-5.6-terra', label: 'GPT-5.6-Terra', efforts: ['low', 'medium', 'high', 'xhigh', 'max'] },
  { id: 'gpt-5.4', label: 'GPT-5.4', efforts: ['low', 'medium', 'high', 'xhigh'] },
];

const build = (overrides: any = {}) => {
  const settings: any = {
    model: 'auto',
    selectedProvider: 'codex',
    thinkingBudget: 'off',
    permissionMode: 'agent',
    providerModels: {},
    providerEfforts: {},
    ...overrides,
  };
  const callbacks: any = {
    getSettings: () => settings,
    onModelChange: jest.fn().mockResolvedValue(undefined),
    onThinkingBudgetChange: jest.fn(),
    onPermissionModeChange: jest.fn(),
    onProviderModelChange: jest.fn().mockImplementation(async (p: string, m: string) => { settings.providerModels[p] = m; }),
    onProviderEffortChange: jest.fn().mockImplementation(async (p: string, e: string) => {
      if (e) settings.providerEfforts[p] = e; else delete settings.providerEfforts[p];
    }),
    getNativeProviderModels: jest.fn().mockResolvedValue(CODEX_MODELS),
  };
  const parent = makeElement();
  const selector = new ModelSelector(parent, callbacks);
  const container = parent.children[0];
  return { settings, callbacks, selector, container, dropdown: () => container.children[1] };
};

describe('native model + effort control', () => {
  it('does not claim discovery failed before the CLI was ever asked', () => {
    // The dropdown is revealed on hover but discovery runs on click, so the un-asked state
    // must read as "not asked yet", never as a failure the CLI did not produce.
    const { dropdown } = build();
    const shown = texts(dropdown()).join(' | ');
    expect(shown).toContain('클릭하면');
    expect(shown).not.toContain('받지 못했습니다');
  });

  it('reports a real failure only after discovery actually ran and came back empty', async () => {
    const { callbacks, selector, dropdown } = build();
    callbacks.getNativeProviderModels.mockResolvedValue([]);
    await (selector as any).loadNativeModelsIfNeeded();
    const shown = texts(dropdown()).join(' | ');
    expect(shown).toContain('받지 못했습니다');
    expect(shown).not.toContain('클릭하면');
  });

  it('offers effort only for a model whose own levels are known', async () => {
    const { selector, dropdown, settings } = build();
    await (selector as any).loadNativeModelsIfNeeded();
    // Nothing chosen yet -> no effort row at all.
    expect(texts(dropdown())).not.toContain('추론 강도');

    settings.providerModels.codex = 'gpt-5.4';
    selector.renderOptions();
    expect(texts(dropdown())).toContain('추론 강도');
    // gpt-5.4 tops out at xhigh; `max` must not be offered for it.
    expect(texts(dropdown())).toContain('xhigh');
    expect(texts(dropdown())).not.toContain('max');
  });

  it('refuses to guess levels for a hand-typed model id', async () => {
    const { selector, dropdown, settings } = build();
    await (selector as any).loadNativeModelsIfNeeded();
    settings.providerModels.codex = 'some-model-typed-by-hand';
    selector.renderOptions();
    expect(texts(dropdown())).not.toContain('추론 강도');
    expect(texts(dropdown()).join(' | ')).toContain('모델을 고르면');
  });

  it('drops a carried-over level the newly chosen model cannot honor', async () => {
    const { selector, dropdown, settings, callbacks } = build();
    await (selector as any).loadNativeModelsIfNeeded();
    settings.providerModels.codex = 'gpt-5.6-terra';
    settings.providerEfforts.codex = 'max';
    selector.renderOptions();

    // Switch to gpt-5.4, which has no `max`.
    await findClickable(dropdown(), 'gpt-5.4').clickAndSettle();

    expect(callbacks.onProviderEffortChange).toHaveBeenCalledWith('codex', '');
    expect(settings.providerEfforts.codex).toBeUndefined();
  });

  it('keeps a carried-over level the newly chosen model still supports', async () => {
    const { selector, dropdown, settings, callbacks } = build();
    await (selector as any).loadNativeModelsIfNeeded();
    settings.providerModels.codex = 'gpt-5.6-terra';
    settings.providerEfforts.codex = 'high';
    selector.renderOptions();

    await findClickable(dropdown(), 'gpt-5.4').clickAndSettle();

    expect(callbacks.onProviderEffortChange).not.toHaveBeenCalledWith('codex', '');
    expect(settings.providerEfforts.codex).toBe('high');
  });

  it('closes the dropdown after a choice so the user can type', async () => {
    // The dropdown overlays the message box, so leaving it open blocks the next keystroke.
    // Hover alone re-opens it, hence the explicit dismissed state rather than just is-open.
    const { selector, container, dropdown, settings } = build();
    await (selector as any).loadNativeModelsIfNeeded();
    settings.providerModels.codex = 'gpt-5.6-terra';
    selector.renderOptions();

    container.children[0].click();               // open
    expect(container.hasClass('is-open')).toBe(true);

    await findClickable(dropdown(), 'high').clickAndSettle();   // choose an effort
    expect(container.hasClass('is-open')).toBe(false);
    expect(container.hasClass('is-dismissed')).toBe(true);
  });

  it('closes after choosing a model too', async () => {
    const { selector, container, dropdown } = build();
    await (selector as any).loadNativeModelsIfNeeded();
    container.children[0].click();
    await findClickable(dropdown(), 'gpt-5.4').clickAndSettle();
    expect(container.hasClass('is-open')).toBe(false);
    expect(container.hasClass('is-dismissed')).toBe(true);
  });

  it('lets hover open it again once the pointer leaves', async () => {
    const { selector, container, dropdown } = build();
    await (selector as any).loadNativeModelsIfNeeded();
    container.children[0].click();
    await findClickable(dropdown(), 'gpt-5.4').clickAndSettle();
    expect(container.hasClass('is-dismissed')).toBe(true);

    container.listeners.mouseleave?.({});
    expect(container.hasClass('is-dismissed')).toBe(false);
  });

  it('offers agy effort only while no model is pinned', async () => {
    // agy encodes the level in the model id and aborts if given both, so a pinned model
    // must remove the effort row rather than present a combination the CLI rejects.
    const AGY: ProviderModelOption[] = [
      { id: 'gemini-3.8-flash-high', label: 'Gemini 3.8 Flash (High)', efforts: [] },
      { id: 'gemini-3.8-flash-low', label: 'Gemini 3.8 Flash (Low)', efforts: [] },
    ];
    const h = build({ selectedProvider: 'agy' });
    h.callbacks.getNativeProviderModels.mockResolvedValue(AGY);
    await (h.selector as any).loadNativeModelsIfNeeded();

    // No model pinned -> effort applies to agy's own default model, so offer it.
    expect(texts(h.dropdown())).toContain('추론 강도');
    expect(texts(h.dropdown())).toContain('high');

    h.settings.providerModels.agy = 'gemini-3.8-flash-high';
    h.selector.renderOptions();
    expect(texts(h.dropdown())).not.toContain('추론 강도');
    expect(texts(h.dropdown()).join(' | ')).toContain('모델 이름에 추론 강도가 포함');
  });

  it('drops a stored agy level as soon as a model is pinned', async () => {
    const AGY: ProviderModelOption[] = [{ id: 'gemini-3.8-flash-low', label: 'Gemini 3.8 Flash (Low)', efforts: [] }];
    const h = build({ selectedProvider: 'agy', providerEfforts: { agy: 'high' } });
    h.callbacks.getNativeProviderModels.mockResolvedValue(AGY);
    await (h.selector as any).loadNativeModelsIfNeeded();

    await findClickable(h.dropdown(), 'gemini-3.8-flash-low').clickAndSettle();
    expect(h.callbacks.onProviderEffortChange).toHaveBeenCalledWith('agy', '');
    expect(h.settings.providerEfforts.agy).toBeUndefined();
  });

  it('never offers a level outside the provider list its CLI validated', async () => {
    const { selector, dropdown, settings } = build();
    await (selector as any).loadNativeModelsIfNeeded();
    settings.providerModels.codex = 'gpt-5.6-terra';
    selector.renderOptions();
    const allowed = new Set<string>([...getProviderEffortLevels('codex'), 'CLI 기본', '추론 강도']);
    const chips = texts(dropdown()).filter((t) => allowed.has(t) || /^(ultra|none|minimal)$/.test(t));
    expect(chips).not.toContain('ultra');
    expect(chips).not.toContain('none');
  });
});
