/**
 * Anthropic's xlsx, docx and pptx skills call `soffice` by bare name
 * (xlsx/scripts/recalc.py: "soffice not found on PATH"). A .dmg or Windows
 * installer puts LibreOffice in a fixed folder and never on PATH, so the
 * plugin finds that folder and adds it to the PATH its CLIs get.
 */
import * as os from 'os';
import * as path from 'path';

import { findLibreOffice, libreOfficeInstallPrompt, libreOfficeProgramDirs } from '@/core/setup/libreOffice';
import { getEnhancedPath } from '@/utils/env';

describe('libreOfficeProgramDirs', () => {
  it('names the app bundle folder on macOS', () => {
    expect(libreOfficeProgramDirs('darwin', {}, '/Users/s')).toEqual([
      '/Applications/LibreOffice.app/Contents/MacOS',
      path.join('/Users/s', 'Applications/LibreOffice.app/Contents/MacOS'),
    ]);
  });
  it('names Program Files on Windows', () => {
    const dirs = libreOfficeProgramDirs('win32', { ProgramFiles: 'C:\\Program Files', 'ProgramFiles(x86)': 'C:\\Program Files (x86)' }, 'C:\\Users\\s');
    expect(dirs[0]).toBe(path.join('C:\\Program Files', 'LibreOffice', 'program'));
    expect(dirs[1]).toBe(path.join('C:\\Program Files (x86)', 'LibreOffice', 'program'));
  });
});

describe('findLibreOffice', () => {
  it('finds the macOS app without running anything', () => {
    const exists = (p: string) => p === '/Applications/LibreOffice.app/Contents/MacOS/soffice';
    expect(findLibreOffice({ platform: 'darwin', env: { PATH: '/usr/bin' }, home: '/Users/s', exists })).toBe('/Applications/LibreOffice.app/Contents/MacOS');
  });
  it('accepts soffice already on PATH (Homebrew)', () => {
    const exists = (p: string) => p === '/opt/homebrew/bin/soffice';
    expect(findLibreOffice({ platform: 'darwin', env: { PATH: '/usr/bin:/opt/homebrew/bin' }, home: '/Users/s', exists })).toBe('/opt/homebrew/bin');
  });
  it('reports missing', () => {
    expect(findLibreOffice({ platform: 'darwin', env: { PATH: '/usr/bin' }, home: '/Users/s', exists: () => false })).toBeNull();
  });
});

describe('getEnhancedPath', () => {
  it('lets the CLI find soffice from a GUI LibreOffice install', () => {
    const entries = getEnhancedPath().split(path.delimiter);
    const expected = libreOfficeProgramDirs(process.platform, process.env, os.homedir())[0];
    expect(entries).toContain(expected);
  });
});

describe('libreOfficeInstallPrompt', () => {
  it.each(['darwin', 'win32'] as const)('gives the %s agent the guide, the stop rules and a check', (platform) => {
    const prompt = libreOfficeInstallPrompt(platform);
    expect(prompt).toContain('이미 설치돼 있는지');
    expect(prompt).toContain('--version');
  });
  it('sends a Mac agent to the official .dmg and forbids Homebrew', () => {
    const prompt = libreOfficeInstallPrompt('darwin');
    expect(prompt).toContain('docs/libreoffice-mac.md');
    expect(prompt).toContain('Homebrew는 새로 설치하지 마');
  });
  it('sends a Windows agent to winget', () => {
    const prompt = libreOfficeInstallPrompt('win32');
    expect(prompt).toContain('docs/libreoffice-windows.md');
    expect(prompt).toContain('winget install --id TheDocumentFoundation.LibreOffice -e');
  });
});
