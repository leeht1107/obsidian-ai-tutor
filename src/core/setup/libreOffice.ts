/**
 * LibreOffice for the doc skills.
 *
 * Anthropic's xlsx, docx and pptx skills run `soffice` by bare name. The
 * plugin installs nothing (Mark, 2026-11-12: no runtime installs); it only
 * checks whether LibreOffice is there, adds its folder to the PATH the CLIs
 * get, and hands the student's own agent a request to install it.
 */
import * as fs from 'fs';
import * as path from 'path';

export const LIBREOFFICE_GUIDE_URLS = {
  darwin: 'https://github.com/leeht1107/obsidian-ai-tutor/blob/main/docs/libreoffice-mac.md',
  win32: 'https://github.com/leeht1107/obsidian-ai-tutor/blob/main/docs/libreoffice-windows.md',
} as const;

/** The folders a standard (GUI) LibreOffice install puts soffice in. */
export function libreOfficeProgramDirs(platform: NodeJS.Platform, env: NodeJS.ProcessEnv, home: string): string[] {
  if (platform === 'win32') {
    const programFiles = env.ProgramFiles || 'C:\\Program Files';
    const programFilesX86 = env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
    return [path.join(programFiles, 'LibreOffice', 'program'), path.join(programFilesX86, 'LibreOffice', 'program')];
  }
  if (platform === 'darwin') {
    return ['/Applications/LibreOffice.app/Contents/MacOS', path.join(home, 'Applications/LibreOffice.app/Contents/MacOS')];
  }
  return [];
}

export interface FindLibreOfficeInput {
  platform: NodeJS.Platform;
  env: NodeJS.ProcessEnv;
  home: string;
  exists?: (file: string) => boolean;
}

/** The folder holding soffice, or null. Checks files only; never runs a program. */
export function findLibreOffice(input: FindLibreOfficeInput): string | null {
  const exists = input.exists ?? ((file: string) => fs.existsSync(file));
  const exe = input.platform === 'win32' ? 'soffice.exe' : 'soffice';
  const delimiter = input.platform === 'win32' ? ';' : ':';
  const onPath = (input.env.PATH ?? input.env.Path ?? '').split(delimiter).filter(Boolean);
  for (const dir of [...libreOfficeProgramDirs(input.platform, input.env, input.home), ...onPath]) {
    if (exists(path.join(dir, exe))) return dir;
  }
  return null;
}

/**
 * What the agent button puts in the chat box. Agent mode runs commands
 * without asking (claude runs with bypassPermissions), so these rules are
 * the only guard: check first, official installer only, no Homebrew, stop at
 * any password or permission window, prove it with --version.
 */
export function libreOfficeInstallPrompt(platform: 'darwin' | 'win32'): string {
  if (platform === 'darwin') {
    return `LibreOffice를 설치해 줘. 나는 프로그래밍 초보야.

먼저 이 안내서를 읽어 줘:
${LIBREOFFICE_GUIDE_URLS.darwin}

1. 이미 설치돼 있는지 먼저 확인해. 있으면 설치하지 말고 알려 줘.
2. 내 Mac이 Apple 칩인지 Intel 칩인지 확인하고, LibreOffice 공식 사이트(libreoffice.org)에서 맞는 .dmg를 받아 '응용 프로그램' 폴더에 넣어 줘.
3. Homebrew는 새로 설치하지 마. 다른 프로그램도 설치하지 마.
4. 비밀번호를 입력하거나 '열기'를 눌러야 하면 멈추고, 내가 어디서 뭘 눌러야 하는지 한국어로 알려 줘.
5. 다 끝나면 /Applications/LibreOffice.app/Contents/MacOS/soffice --version 결과를 보여 주고, 성공했는지 한 줄로 말해 줘.`;
  }
  return `LibreOffice를 설치해 줘. 나는 프로그래밍 초보야.

먼저 이 안내서를 읽어 줘:
${LIBREOFFICE_GUIDE_URLS.win32}

1. 이미 설치돼 있는지 먼저 확인해. 있으면 설치하지 말고 알려 줘.
2. winget으로 설치해 줘: winget install --id TheDocumentFoundation.LibreOffice -e
3. winget이 없으면 직접 설치하지 말고, LibreOffice 공식 사이트(libreoffice.org)의 Windows 64비트 설치 파일을 쓰는 방법을 알려 줘.
4. '이 앱이 디바이스를 변경하도록 허용하시겠어요?' 창이 뜨면 멈추고, 내가 '예'를 눌러야 한다고 한국어로 알려 준 뒤 기다려 줘.
5. 다 끝나면 "C:\\Program Files\\LibreOffice\\program\\soffice.exe" --version 결과를 보여 주고, 성공했는지 한 줄로 말해 줘.`;
}
