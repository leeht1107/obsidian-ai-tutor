/**
 * Tests for ObsidianCopilotPlugin's write-authority counter (src/main.ts).
 *
 * The counter backs `setBashExpansionActive` / `isBashExpansionInFlight`, shared by
 * slash-command inline bash (chat input, inline edit) and streaming provider requests.
 * It must survive two of those overlapping: whichever finishes first must not unlock
 * the Ask/Agent toggle while the other is still running.
 */
import { DEFAULT_SETTINGS, type ObsidianCopilotSettings } from '@/core/types/settings';
import ObsidianCopilotPlugin from '@/main';

function buildPlugin(settingsOverrides: Partial<ObsidianCopilotSettings> = {}): ObsidianCopilotPlugin {
  const app: any = {
    workspace: {
      getLeavesOfType: jest.fn().mockReturnValue([]),
    },
  };
  const manifest: any = { id: 'obsidian-ai-tutor', version: '0.0.0' };
  const plugin = new ObsidianCopilotPlugin(app, manifest);
  // onload() is what normally populates settings; tests bypass it so a real request
  // (which would await loadSettings() first) does not race an unset `this.settings`.
  plugin.settings = { ...DEFAULT_SETTINGS, ...settingsOverrides };
  return plugin;
}

describe('ObsidianCopilotPlugin - write-authority counter', () => {
  it('starts settled', () => {
    const plugin = buildPlugin();
    expect(plugin.isBashExpansionInFlight()).toBe(false);
  });

  it('stays locked while two overlapping expansions are in flight, and unlocks only once both settle', () => {
    const plugin = buildPlugin();

    // e.g. a chat-input slash command and an inline-edit slash command overlapping.
    plugin.setBashExpansionActive(true);
    expect(plugin.isBashExpansionInFlight()).toBe(true);

    plugin.setBashExpansionActive(true);
    expect(plugin.isBashExpansionInFlight()).toBe(true);

    // The first one to finish must not unlock the toggle while the second still runs.
    plugin.setBashExpansionActive(false);
    expect(plugin.isBashExpansionInFlight()).toBe(true);

    plugin.setBashExpansionActive(false);
    expect(plugin.isBashExpansionInFlight()).toBe(false);
  });

  it('does not underflow below settled on an extra false call', () => {
    const plugin = buildPlugin();
    plugin.setBashExpansionActive(false);
    expect(plugin.isBashExpansionInFlight()).toBe(false);

    plugin.setBashExpansionActive(true);
    expect(plugin.isBashExpansionInFlight()).toBe(true);
  });
});

describe('ObsidianCopilotPlugin - captured permission mode', () => {
  it('is null while settled', () => {
    const plugin = buildPlugin();
    expect(plugin.getCapturedPermissionMode()).toBeNull();
  });

  it('captures the effective mode on the 0 -> 1 edge and clears it back to null at 0', () => {
    const plugin = buildPlugin({ selectedProvider: 'codex', permissionMode: 'agent' });

    plugin.setBashExpansionActive(true);
    expect(plugin.getCapturedPermissionMode()).toBe('agent');

    plugin.setBashExpansionActive(false);
    expect(plugin.getCapturedPermissionMode()).toBeNull();
  });

  it('resolves the CONSENT-AWARE mode at capture time, not the raw setting', () => {
    // permissionMode is 'agent', but claude still awaits blanket-write consent, so the
    // effective (and captured) mode must read 'ask' — the same predicate the toolbar and
    // CLI dispatch use, not the raw stored setting.
    const plugin = buildPlugin({
      selectedProvider: 'claude',
      permissionMode: 'agent',
      blanketWriteAcknowledged: [],
    });

    plugin.setBashExpansionActive(true);
    expect(plugin.getCapturedPermissionMode()).toBe('ask');
  });

  it('does not let a second, overlapping region overwrite the first capture', () => {
    const plugin = buildPlugin({ selectedProvider: 'codex', permissionMode: 'agent' });

    // First region starts under 'agent' and captures it.
    plugin.setBashExpansionActive(true);
    expect(plugin.getCapturedPermissionMode()).toBe('agent');

    // Settings change, then a second, overlapping region starts (counter 1 -> 2, not
    // 0 -> 1). The already-running first region's captured mode must survive.
    plugin.settings.permissionMode = 'ask';
    plugin.setBashExpansionActive(true);
    expect(plugin.getCapturedPermissionMode()).toBe('agent');

    // The second region settling first (counter 2 -> 1) must not clear the capture
    // while the first region is still in flight.
    plugin.setBashExpansionActive(false);
    expect(plugin.getCapturedPermissionMode()).toBe('agent');

    // Only once both have settled (counter 1 -> 0) does it clear.
    plugin.setBashExpansionActive(false);
    expect(plugin.getCapturedPermissionMode()).toBeNull();
  });

  it('re-captures fresh on the NEXT 0 -> 1 edge once the counter has fully drained', () => {
    const plugin = buildPlugin({ selectedProvider: 'codex', permissionMode: 'agent' });

    plugin.setBashExpansionActive(true);
    plugin.setBashExpansionActive(false);
    expect(plugin.getCapturedPermissionMode()).toBeNull();

    plugin.settings.permissionMode = 'ask';
    plugin.setBashExpansionActive(true);
    expect(plugin.getCapturedPermissionMode()).toBe('ask');
  });
});

describe('ObsidianCopilotPlugin - recapturePermissionMode', () => {
  it('is a no-op while settled — there is no stale capture to correct', () => {
    const plugin = buildPlugin({ selectedProvider: 'codex', permissionMode: 'agent' });
    plugin.recapturePermissionMode();
    expect(plugin.getCapturedPermissionMode()).toBeNull();
  });

  it('overwrites the captured mode from CURRENT settings while a region is open', () => {
    const plugin = buildPlugin({ selectedProvider: 'codex', permissionMode: 'ask' });

    plugin.setBashExpansionActive(true);
    expect(plugin.getCapturedPermissionMode()).toBe('ask');

    // A legitimate mid-flight authority change (e.g. plan approval) lands.
    plugin.settings.permissionMode = 'agent';
    plugin.recapturePermissionMode();

    expect(plugin.getCapturedPermissionMode()).toBe('agent');
  });

  it('repaints every mounted view when it refreshes the capture', () => {
    const plugin = buildPlugin({ selectedProvider: 'codex', permissionMode: 'ask' });
    plugin.setBashExpansionActive(true);
    const leaf = { view: { refreshPermissionToggle: jest.fn() } };
    (plugin.app.workspace.getLeavesOfType as jest.Mock).mockReturnValue([leaf]);

    plugin.settings.permissionMode = 'agent';
    plugin.recapturePermissionMode();

    expect(leaf.view.refreshPermissionToggle).toHaveBeenCalledTimes(1);
  });
});

describe('ObsidianCopilotPlugin - multi-leaf permission toggle repaint', () => {
  it('repaints every mounted leaf, not just the first, on a counter transition', () => {
    const plugin = buildPlugin();
    const leafA = { view: { refreshPermissionToggle: jest.fn() } };
    const leafB = { view: { refreshPermissionToggle: jest.fn() } };
    (plugin.app.workspace.getLeavesOfType as jest.Mock).mockReturnValue([leafA, leafB]);

    plugin.setBashExpansionActive(true);

    expect(leafA.view.refreshPermissionToggle).toHaveBeenCalledTimes(1);
    expect(leafB.view.refreshPermissionToggle).toHaveBeenCalledTimes(1);
  });
});
