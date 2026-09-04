import * as fs from 'fs';
import * as path from 'path';

import { getEnhancedPath } from '../../utils/env';

export type ProviderId = 'copilot' | 'claude' | 'codex' | 'agy';
export type ProviderStatus = 'ready' | 'not-installed' | 'manual-setup' | 'unsupported';

export interface ProviderDescriptor {
  id: ProviderId;
  label: string;
  command: string;
  loginCommand: string;
  installCommand?: string;
  windowsInstallCommand?: string;
  status: ProviderStatus;
}

/** UI-bound selection table. Providers intentionally retain their native CLI contracts. */
export const PROVIDERS: readonly ProviderDescriptor[] = [
  { id: 'copilot', label: 'GitHub Copilot', command: 'copilot', loginCommand: 'copilot login', installCommand: 'npm install -g @github/copilot', windowsInstallCommand: 'npm install -g @github/copilot', status: 'ready' },
  { id: 'claude', label: 'Claude Code', command: 'claude', loginCommand: 'claude', installCommand: 'npm install -g @anthropic-ai/claude-code', windowsInstallCommand: 'npm install -g @anthropic-ai/claude-code', status: 'ready' },
  { id: 'codex', label: 'OpenAI Codex', command: 'codex', loginCommand: 'codex login', installCommand: 'npm install -g @openai/codex', windowsInstallCommand: 'npm install -g @openai/codex', status: 'ready' },
  { id: 'agy', label: 'Antigravity (agy)', command: 'agy', loginCommand: 'agy', status: 'manual-setup' },
];

export function getProviderDescriptor(id: ProviderId): ProviderDescriptor {
  return PROVIDERS.find((provider) => provider.id === id) ?? PROVIDERS[0];
}

export function buildNativeProviderCommand(id: ProviderId, prompt: string): { command: string; args: string[] } {
  switch (id) {
    case 'claude': return { command: 'claude', args: ['-p', prompt, '--output-format', 'stream-json', '--verbose'] };
    case 'codex': return { command: 'codex', args: ['exec', '--json', prompt] };
    case 'agy': return { command: 'agy', args: ['-p', prompt] };
    case 'copilot': return { command: 'copilot', args: ['-p', prompt] };
  }
}

export function findProviderCliPath(id: ProviderId, customPath = ''): string | null {
  if (customPath.trim()) return isFile(customPath.trim()) ? customPath.trim() : null;
  const descriptor = getProviderDescriptor(id);
  const delimiter = process.platform === 'win32' ? ';' : ':';
  const names = process.platform === 'win32'
    ? [descriptor.command, `${descriptor.command}.cmd`, `${descriptor.command}.exe`]
    : [descriptor.command];
  for (const dir of getEnhancedPath().split(delimiter)) {
    for (const name of names) {
      const candidate = path.join(dir, name);
      if (isFile(candidate)) return candidate;
    }
  }
  return null;
}

function isFile(candidate: string): boolean {
  try { return fs.statSync(candidate).isFile(); } catch { return false; }
}
