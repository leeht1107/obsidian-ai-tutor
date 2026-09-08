import { PermissionToggle } from '../../../../src/ui/components/InputToolbar';

/** Minimal Obsidian element stand-in — same shape used by ModelSelectorEffort.test.ts. */
const makeElement = (): any => {
  const attributes: Record<string, string> = {};
  const classes = new Set<string>();
  const el: any = {
    children: [] as any[],
    listeners: {} as Record<string, (e: any) => void>,
    style: {},
  };
  const add = (options?: any) => {
    const child = makeElement();
    child.elementOptions = options;
    el.children.push(child);
    return child;
  };
  el.createDiv = jest.fn(add);
  el.createSpan = jest.fn(add);
  el.createEl = jest.fn((_tag: string, options: any) => add(options));
  el.empty = jest.fn(() => { el.children.length = 0; });
  el.setText = jest.fn((text: string) => { el.elementOptions = { ...el.elementOptions, text }; });
  el.addClass = jest.fn((c: string) => { classes.add(c); });
  el.removeClass = jest.fn((c: string) => { classes.delete(c); });
  el.hasClass = jest.fn((c: string) => classes.has(c));
  el.setAttribute = jest.fn((n: string, v: string) => { attributes[n] = v; });
  el.getAttribute = jest.fn((n: string) => attributes[n] ?? null);
  el.removeAttribute = jest.fn((n: string) => { delete attributes[n]; });
  el.addEventListener = jest.fn((event: string, handler: (e: any) => void) => { el.listeners[event] = handler; });
  el.click = () => el.listeners.click?.({ stopPropagation: jest.fn() });
  el.clickAndSettle = async () => { await el.listeners.click?.({ stopPropagation: jest.fn() }); };
  return el;
};

const build = (overrides: any = {}) => {
  const settings: any = {
    model: 'auto',
    selectedProvider: 'copilot',
    thinkingBudget: 'off',
    permissionMode: 'ask',
    ...overrides,
  };
  let bashExpansionInFlight = false;
  let capturedPermissionMode: 'ask' | 'agent' | null = null;
  const callbacks: any = {
    getSettings: () => settings,
    onPermissionModeChange: jest.fn().mockImplementation(async (mode: string) => {
      settings.permissionMode = mode;
    }),
    isBashExpansionInFlight: () => bashExpansionInFlight,
    getCapturedPermissionMode: () => capturedPermissionMode,
  };
  const parent = makeElement();
  const toggle = new PermissionToggle(parent, callbacks);
  const container = parent.children[0];
  const labelEl = container.children[0];
  return {
    settings,
    callbacks,
    toggle,
    container,
    labelText: () => labelEl.elementOptions?.text,
    setBashExpansionInFlight: (value: boolean) => {
      bashExpansionInFlight = value;
      toggle.updateDisplay();
    },
    setCapturedPermissionMode: (mode: 'ask' | 'agent' | null) => {
      capturedPermissionMode = mode;
      toggle.updateDisplay();
    },
  };
};

describe('PermissionToggle - bash expansion busy lock', () => {
  it('toggle() while busy does not change permissionMode or call onPermissionModeChange', async () => {
    const { settings, callbacks, container, setBashExpansionInFlight } = build({ permissionMode: 'ask' });
    setBashExpansionInFlight(true);

    await container.clickAndSettle();

    expect(settings.permissionMode).toBe('ask');
    expect(callbacks.onPermissionModeChange).not.toHaveBeenCalled();
  });
});

describe('PermissionToggle - busy label shows the CAPTURED mode, not a fresh resolution', () => {
  it('reproduces the reviewer sequence: captured under agent, then a fresh resolution would give ask, label still reads Agent and stays disabled', () => {
    // Start as the in-flight work was authorized: agent, claude, already acknowledged —
    // resolveEffectivePermissionMode('agent', 'claude', ['claude']) is 'agent' at capture time.
    const { settings, toggle, container, labelText, setCapturedPermissionMode, setBashExpansionInFlight } = build({
      permissionMode: 'agent',
      selectedProvider: 'claude',
      blanketWriteAcknowledged: ['claude'],
    });
    setCapturedPermissionMode('agent');
    setBashExpansionInFlight(true);
    expect(labelText()).toBe('Agent');

    // The reviewer's exact move: provider switching stays enabled while streaming, and
    // switching away from claude and back (or a settings reload) drops the acknowledgement,
    // so a FRESH resolution against the current settings would now say 'ask' —
    // resolveEffectivePermissionMode('agent', 'claude', []) is 'ask'. The mode captured
    // when the in-flight work started must win over that fresh resolution regardless.
    settings.blanketWriteAcknowledged = [];
    toggle.updateDisplay();

    expect(labelText()).toBe('Agent');
    expect(container.getAttribute('aria-disabled')).toBe('true');
  });

  it('shows Ask, disabled, while busy under a captured ask mode', () => {
    const { labelText, container, setCapturedPermissionMode, setBashExpansionInFlight } = build({
      permissionMode: 'ask',
      selectedProvider: 'copilot',
    });
    setCapturedPermissionMode('ask');
    setBashExpansionInFlight(true);

    expect(labelText()).toBe('Ask');
    expect(container.getAttribute('aria-disabled')).toBe('true');
  });

  it('falls back to a fresh resolution when no captured mode is supplied (older callback shape)', () => {
    const { labelText, setBashExpansionInFlight } = build({
      permissionMode: 'agent',
      selectedProvider: 'copilot',
    });
    // getCapturedPermissionMode returns null here (default), so updateDisplay must fall
    // back to resolving from current settings rather than crash or show a stale value.
    setBashExpansionInFlight(true);

    expect(labelText()).toBe('Agent');
  });
});

describe('PermissionToggle - check-then-act race across the confirmBlanketWrite await', () => {
  // claude needs blanket-write consent by default (writesOutsideVault + not yet
  // acknowledged), which is the only path through toggle() that awaits anything before
  // its final write. That await is the race window a reviewer found: a write-capable
  // region (bash expansion / streaming request) can start and increment the counter
  // WHILE the student is still looking at the consent modal.

  it('reproduces the reviewer sequence end to end: the counter flips to in-flight while the modal is awaited; permissionMode stays unchanged and the provider is not acknowledged', async () => {
    const acknowledged: string[] = [];
    const { settings, callbacks, container, setBashExpansionInFlight } = build({
      permissionMode: 'ask',
      selectedProvider: 'claude',
      blanketWriteAcknowledged: acknowledged,
    });
    expect(callbacks.isBashExpansionInFlight()).toBe(false); // counter is 0 when toggle() starts

    // Mirrors the fixed ObsidianCopilotView.confirmBlanketWrite: the student accepts the
    // modal, but a long chat request incremented the write-authority counter while it was
    // open. The fixed callback re-checks isBashExpansionInFlight() after its own await and
    // refuses to record the acknowledgment.
    callbacks.confirmBlanketWrite = jest.fn().mockImplementation(async (provider: string) => {
      setBashExpansionInFlight(true); // counter 0 -> 1 during the "modal", before this resolves
      if (callbacks.isBashExpansionInFlight()) return false;
      acknowledged.push(provider);
      return true;
    });

    await container.clickAndSettle();

    expect(settings.permissionMode).toBe('ask');
    expect(callbacks.onPermissionModeChange).not.toHaveBeenCalled();
    expect(acknowledged).not.toContain('claude');
  });

  it('defense in depth: even if confirmBlanketWrite resolves accepted=true, toggle() re-checks busy after the await and refuses to write the mode', async () => {
    const { settings, callbacks, container, setBashExpansionInFlight } = build({
      permissionMode: 'ask',
      selectedProvider: 'claude',
      blanketWriteAcknowledged: [],
    });
    // Simulates a caller whose confirmBlanketWrite does NOT itself guard against the race
    // (e.g. acknowledgment already recorded on a previous click) — toggle()'s own re-check
    // must still catch it.
    callbacks.confirmBlanketWrite = jest.fn().mockImplementation(async () => {
      setBashExpansionInFlight(true);
      return true;
    });

    await container.clickAndSettle();

    expect(settings.permissionMode).toBe('ask');
    expect(callbacks.onPermissionModeChange).not.toHaveBeenCalled();
  });

  it('normal path still works: counter stays 0 across the await, consent accepted, mode becomes agent', async () => {
    const { settings, callbacks, container } = build({
      permissionMode: 'ask',
      selectedProvider: 'claude',
      blanketWriteAcknowledged: [],
    });
    callbacks.confirmBlanketWrite = jest.fn().mockResolvedValue(true);

    await container.clickAndSettle();

    expect(callbacks.onPermissionModeChange).toHaveBeenCalledWith('agent');
    expect(settings.permissionMode).toBe('agent');
  });
});
