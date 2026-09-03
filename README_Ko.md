# Obsidian AI Tutor 학생용 설치 가이드

이 문서는 처음 설치하는 학생도 그대로 따라할 수 있게 만든 한글 가이드입니다.

이 플러그인은 **GitHub Copilot, Claude Code, Codex, agy(Antigravity)** 중
**하나**를 골라 사용합니다. 어떤 것을 고르든 채팅, 노트 문맥 연결, `/quiz`,
`/socratic` 학습 모드는 동일하게 동작합니다. 선생님이 특정 provider를
지정했다면 그 provider만 설치하면 됩니다.

## 0. 시작하기 전에 꼭 확인할 것

이 플러그인은 다음 조건이 필요합니다.

- 데스크톱용 Obsidian
- Node.js
- 아래 네 provider 중 하나
  - GitHub Copilot: GitHub 계정 + Copilot 사용 권한
  - Claude Code: Anthropic Claude Code CLI 계정
  - Codex: OpenAI Codex CLI 계정
  - agy(Antigravity): agy 자체 계정 (설치/로그인은 안내형 수동 절차)

중요:

- 저장소가 `private` 이면 학생이 URL만 알아서는 설치할 수 없습니다.
- 선생님이 학생에게 GitHub 저장소 접근 권한을 먼저 줘야 합니다.
- 권한이 없으면 BRAT 설치 단계에서 저장소를 열 수 없습니다.

## 1. 준비물

### 1-1. Obsidian 설치

공식 다운로드:

- https://obsidian.md/download

설치 방법:

- Windows: `Download for Windows` 를 눌러 설치 파일(`.exe`)을 받아 실행합니다.
- macOS: `Download for Mac` 을 눌러 설치 파일(`.dmg`)을 받아 실행합니다.

설치가 끝나면 Obsidian을 한 번 실행하세요.

### 1-2. 사용할 provider 하나 고르기

이 플러그인은 아래 네 provider 중 정확히 하나를 골라 사용합니다. 둘 이상을
설치해 두고 나중에 설정에서 바꿔가며 써도 되지만, 한 번에 요청을 보내는
provider는 항상 하나뿐입니다.

| Provider | 필요한 것 |
|---|---|
| GitHub Copilot | GitHub 계정 + Copilot 사용 권한 |
| Claude Code | Anthropic 계정 |
| Codex | OpenAI 계정 |
| agy (Antigravity) | agy 자체 계정, 수동 설치/로그인 |

- 학교나 조직 계정이라면 관리자 정책에 따라 일부 모델이 보이지 않을 수 있습니다.
- 조직 계정이라면 관리자가 특정 CLI 사용을 막아두었을 수도 있습니다.
- AI 사용량/과금/한도는 각 provider(GitHub, Anthropic, OpenAI, Antigravity)가 직접 관리합니다. 이 플러그인에 보이는 사용량은 선택한 provider CLI 응답에서 관찰된 로컬 값일 뿐이며, 실제 남은 크레딧/청구 금액을 보장하지 않습니다.

학습 모드 (provider와 무관하게 동일하게 동작):

- `/quiz`: 선택한 현재 노트, 여러 노트, 폴더를 근거로 한 번에 한 문제씩 퀴즈를 냅니다.
- `/socratic`: 선택한 노트 범위 안에서 한국어 AI 조교처럼 대화합니다. 잘 이해한 학생에게는 더 어려운 전이/반례 질문을 주고, 막히는 학생에게는 힌트, 예시, 비유, 짧은 부분 풀이로 다시 생각할 수 있게 돕습니다.

## 2. Node.js 설치

공식 다운로드:

- https://nodejs.org/en/download/

권장:

- LTS 버전 설치
- 이 플러그인 기준으로는 Node.js 22 이상 권장

### Windows

1. 위 사이트를 엽니다.
2. `LTS` 버전을 선택합니다.
3. Windows 설치 파일을 다운로드합니다.
4. 설치 파일을 실행합니다.
5. 기본 옵션 그대로 `Next` 를 눌러 설치합니다.
6. 설치가 끝나면 `명령 프롬프트` 또는 `PowerShell` 을 엽니다.
7. 아래 명령으로 설치를 확인합니다.

```bash
node --version
npm --version
```

### macOS

1. 위 사이트를 엽니다.
2. `LTS` 버전을 선택합니다.
3. Mac 설치 파일을 다운로드합니다.
4. 설치 파일을 실행합니다.
5. 기본 옵션으로 설치를 완료합니다.
6. `Terminal` 을 엽니다.
7. 아래 명령으로 설치를 확인합니다.

```bash
node --version
npm --version
```

정상이라면 버전 번호가 표시됩니다.

## 3. Provider CLI 설치 및 로그인

앞에서 고른 provider 하나만 아래에서 따라 하면 됩니다. 나머지는 나중에 필요할 때 추가로 설치해도 됩니다.

### 3-1. GitHub Copilot

- 이 플러그인은 `copilot` 단독 CLI를 사용합니다. `gh copilot` 과는 다릅니다.
- GitHub 공식 문서는 npm, Windows WinGet, macOS/Linux Homebrew 설치를 안내합니다. 이 플러그인의 자동 설치는 모든 OS에서 쓸 수 있는 npm 방식을 사용합니다.

설치:

```bash
npm install -g @github/copilot
```

Windows에서 WinGet을 쓰고 싶다면:

```powershell
winget install GitHub.Copilot
```

macOS/Linux에서 Homebrew를 쓰고 싶다면:

```bash
brew install copilot-cli
```

로그인:

```bash
copilot login
```

먼저 `copilot` 명령으로 대화형 CLI를 실행했다면, CLI 안에서 `/login` 을 입력해도 됩니다.

설치/로그인 확인:

```bash
copilot --help
copilot version
```

공식 설치 안내: https://docs.github.com/copilot/how-tos/copilot-cli/install-copilot-cli

### 3-2. Claude Code

설치:

```bash
npm install -g @anthropic-ai/claude-code
```

로그인:

```bash
claude
```

처음 실행하면 대화형으로 로그인 절차가 안내됩니다.

### 3-3. Codex

설치:

```bash
npm install -g @openai/codex
```

로그인:

```bash
codex login
```

### 3-4. agy (Antigravity)

- agy는 이 플러그인이 자동으로 설치해주는 npm 패키지가 없습니다. **안내형 수동 설치**만 지원합니다.
- agy 자체의 공식 설치 절차를 먼저 완료한 뒤, 터미널에서 아래 명령이 정상 동작하는지 확인하세요.

```bash
agy
```

- 정상 동작이 확인되면 Obsidian 플러그인 설정에서 provider를 agy로 선택하고 "설치 완료 확인"을 누르면 됩니다.
- 이 플러그인은 agy를 위해 원격 설치 스크립트를 실행하지 않습니다.

### 공통 문제: 명령을 찾을 수 없다고 나올 때

- 터미널을 완전히 닫았다가 다시 열어보세요.
- 그래도 안 되면 Node.js 설치가 제대로 되었는지 다시 확인하세요.
- Mac/Linux에서 npm 권한 오류가 나면 먼저 npm 전역 설치 위치를 사용자 폴더로 바꾸거나 Homebrew 설치를 고려하세요. `sudo npm install -g ...` 은 마지막 방법으로만 사용하세요.

## 4. Obsidian에서 BRAT 설치

BRAT 소개:

- https://tfthacker.com/BRAT

### BRAT 설치 방법

1. Obsidian을 엽니다.
2. `설정(Settings)` 으로 들어갑니다.
3. `커뮤니티 플러그인(Community plugins)` 으로 이동합니다.
4. 커뮤니티 플러그인을 사용할 수 있게 켭니다.
5. 검색창에서 `BRAT` 을 검색합니다.
6. 설치 후 활성화합니다.

## 5. BRAT으로 Obsidian AI Tutor 설치

중요:

- 저장소가 private 이면 학생 계정이 해당 GitHub 저장소를 열 수 있어야 합니다.
- 선생님이 미리 collaborator 또는 team 권한을 줘야 합니다.

설치 순서:

1. Obsidian에서 `명령 팔레트` 를 엽니다.
   - Windows: `Ctrl + P`
   - macOS: `Cmd + P`
2. `BRAT: Add a beta plugin for testing` 를 실행합니다.
3. 저장소 주소를 입력합니다.

```text
https://github.com/leeht1107/obsidian-ai-tutor
```

선생님이 수업용 fork 주소를 따로 알려준 경우에는 그 주소를 사용하세요. BRAT은 실제 릴리스 파일이 올라간 저장소 URL을 넣어야 합니다.

4. BRAT이 설치를 완료하면 `설정 -> 커뮤니티 플러그인` 으로 다시 이동합니다.
5. `Obsidian AI Tutor` 을 찾아 활성화합니다.

## 6. Provider 선택하기

플러그인을 처음 켜면 현재 선택된 provider(기본값: GitHub Copilot)의 CLI가
없을 경우 초기 설정 마법사가 자동으로 열립니다. 다른 provider를 쓰고
싶다면:

1. `설정 -> Obsidian AI Tutor` 로 이동합니다.
2. **AI provider** 드롭다운에서 Copilot / Claude Code / Codex / agy 중 하나를 고릅니다.
3. 선택한 provider의 CLI가 아직 없으면 설치 안내와 "설치 완료 확인" 버튼이 나타납니다. 3장의 해당 provider 절차를 따라가면 됩니다.
4. 요청은 항상 선택된 provider 하나로만 전송됩니다. 두 provider가 동시에 실행되지 않습니다.

## 7. 첫 실행 전에 확인할 것

플러그인을 켜기 전에 아래를 다시 확인하세요 (선택한 provider에 맞는 명령으로).

```bash
node --version
npm --version
```

그리고 선택한 provider의 CLI 확인/로그인 명령(3장 참고)이 모두 정상이어야 합니다.

## 8. 플러그인 첫 실행

1. Obsidian 왼쪽 리본에서 Obsidian AI Tutor 아이콘을 클릭합니다.
2. 오른쪽 사이드바에 채팅 창이 열리는지 확인합니다.
3. 아무 노트나 하나 열어 둡니다.
4. 채팅창에 간단히 질문합니다.

명령 팔레트에서 찾고 싶다면 아래 검색어로 찾으면 됩니다.

- `Obsidian AI Tutor`
- `Obsidian AI Tutor: Open chat view`
- `Obsidian AI Tutor: Inline edit`

예시:

```text
이 노트 내용을 3줄로 요약해줘.
```

정상이라면 현재 노트가 기본 문맥으로 붙은 상태에서 선택한 provider의 답변이 나옵니다.

## 9. 자주 하는 작업

### 현재 노트 기반으로 질문하기

- 노트를 열어 둔 상태에서 바로 질문하면 됩니다.
- 현재 열린 노트는 기본 문맥으로 자동 반영됩니다.

### 다른 노트도 함께 참고시키기

- 채팅 입력창에 `@` 를 입력합니다.
- 원하는 노트 파일을 선택합니다.
- 선택한 파일이 추가 문맥으로 함께 전달됩니다.

### 선택한 문장만 고치기

- 노트에서 문장을 드래그해 선택합니다.
- Inline Edit 기능을 실행합니다.
- 예: `더 자연스럽게 고쳐줘`, `학생 발표용 문체로 바꿔줘`

## 10. 문제 해결

### `node` 또는 `npm` 명령이 안 됩니다

- Node.js 설치가 끝난 뒤 터미널을 다시 열어보세요.
- 그래도 안 되면 Node.js를 다시 설치하세요.

### provider CLI 명령이 안 됩니다

- 3장에서 고른 provider의 설치 명령을 다시 실행하세요.
- 설치 후 터미널을 다시 열어보세요.
- Mac/Linux 권한 오류라면 `sudo` 를 바로 쓰기보다 npm 전역 설치 위치 수정 또는 Homebrew 설치를 먼저 시도하세요.
- 그래도 수업 중 바로 해결해야 한다면 Mac/Linux에서만 마지막 방법으로 `sudo npm install -g ...` 을 사용할 수 있습니다.
- agy는 자동 설치가 없으므로, agy 자체 공식 설치 절차부터 다시 확인하세요.

### 로그인은 했는데 플러그인이 응답하지 않습니다

- 먼저 터미널에서 선택한 provider의 확인 명령이 정상인지 확인하세요 (예: `copilot --help`, `claude --help`, `codex --help`, `agy`).
- 해당 provider 계정으로 정상 로그인했는지 확인하세요.
- 설정에서 선택된 AI provider가 방금 로그인한 CLI와 일치하는지 확인하세요.

### BRAT에서 저장소를 찾지 못합니다

- 저장소가 private 이면 접근 권한이 있어야 합니다.
- 선생님이 GitHub에서 학생 계정을 collaborator 또는 team 으로 추가했는지 확인해야 합니다.

### Obsidian에서 플러그인이 안 보입니다

- BRAT 설치 후 `커뮤니티 플러그인` 목록을 새로고침하세요.
- 그래도 안 보이면 Obsidian을 완전히 종료 후 다시 실행하세요.

## 11. 공식 링크 모음

- Node.js 다운로드: https://nodejs.org/en/download/
- Obsidian 다운로드: https://obsidian.md/download
- GitHub Copilot CLI 설치: https://docs.github.com/copilot/how-tos/copilot-cli/install-copilot-cli
- GitHub Copilot AI Credits/과금: https://docs.github.com/en/copilot/concepts/billing
- Claude Code / Codex / agy: 각 서비스의 공식 설치·로그인 절차를 따르세요 (설치 명령은 위 3장 참고).
- BRAT 소개: https://tfthacker.com/BRAT

## 12. 가장 짧은 설치 체크리스트

아래 순서대로 하면 됩니다 (괄호 안은 provider별로 다른 부분).

1. Obsidian 설치
2. Node.js 설치
3. 원하는 provider 하나 설치 (예: `npm install -g @github/copilot`)
4. 그 provider로 로그인 (예: `copilot login`)
5. Obsidian에서 BRAT 설치
6. BRAT으로 `https://github.com/leeht1107/obsidian-ai-tutor` 추가
7. `Obsidian AI Tutor` 활성화
8. 설정에서 AI provider가 3~4단계에서 설치한 provider와 같은지 확인
9. 노트를 열고 질문해 보기
