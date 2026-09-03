# **Addendum — Cross-platform Provider Setup Requirement**

## **Setup Goal**

학생은 자신이 구독 중인 AI provider를 선택하고 가능한 경우 **one-click setup**으로 CLI를 설치한 뒤 공식 로그인 절차만 완료하면 Obsidian에서 바로 사용할 수 있어야 한다.

지원 OS:

- macOS
  - Apple Silicon
  - Intel Mac이 공식 CLI에서 지원되는 경우 포함
- Windows
  - Windows 10/11
  - PowerShell 기반 설치 가능성을 우선 검토

Linux는 이번 MVP의 필수 지원 대상이 아니다.

## **Provider Setup UX**

학생에게 다음과 같이 보인다.

```text
Choose your AI

GitHub Copilot    [Set up]
Claude            [Set up]
ChatGPT / Codex   [Set up]
Antigravity       [Set up]
```

학생은 **하나의 provider만 설치해도 plugin 전체를 사용할 수 있다.**

모든 CLI 설치를 요구하지 않는다.

## **One-click Definition**

“One-click setup”은 다음을 의미한다.

1. Plugin이 OS를 감지한다.
2. Provider CLI 설치 여부를 확인한다.
3. 해당 OS에서 공식적으로 권장되고 안전한 non-admin 설치 방법이 명확하면 plugin이 설치 command를 실행한다.
4. CLI 설치 후 공식 login command 또는 browser-auth flow를 안내한다.
5. 인증 완료 후 plugin이 CLI availability를 재검사한다.
6. 성공하면 `Ready` 상태로 전환한다.

예:

```text
Claude
✓ CLI installed
✓ Login verified

[Start Chat]
```

## **Safe Fallback**

자동 설치가 불확실하거나 실패하면 **silent failure하지 않는다.**

다음 UX로 fallback한다.

```text
Claude CLI를 자동으로 설치할 수 없습니다.

1. 아래 명령을 실행하세요.
   [ command                     ][Copy]

2. 로그인을 완료하세요.
   [ login command               ][Copy]

[Check again]
```

즉:

```text
Auto install
	↓ 실패
Guided manual install
```

은 동일한 setup flow 안에 포함된다.

## **OS-specific Installer Architecture**

Provider setup을 hard-code하지 않고 recipe 형태로 분리한다.

개념 예:

```ts
interface ProviderSetupRecipe {
	providerId: string;

	detect(os): Promise<SetupStatus>;

	install?: {
		macos?: InstallMethod;
		windows?: InstallMethod;
	};

	loginInstructions(os): LoginInstruction[];

	verify(): Promise<ProviderStatus>;
}
```

예상 구조:

```text
ProviderSetupService
├── CopilotSetupRecipe
├── ClaudeSetupRecipe
├── CodexSetupRecipe
└── AgySetupRecipe
```

각 provider별로 다음을 조사하고 구현한다.

- official install method
- macOS install command
- Windows install command
- required runtime
- PATH behavior
- login command
- browser-auth behavior
- verification command
- update command
- uninstall command은 MVP에서 불필요

## **Important Constraint**

특정 provider가 macOS와 Windows에서 동일한 package manager를 사용한다고 가정하지 않는다.

예:

```text
macOS
├── npm
├── Homebrew
└── official binary

Windows
├── npm
├── WinGet
├── PowerShell installer
└── official binary
```

중 실제 공식 지원 경로를 local agent가 조사하여 가장 단순하고 안정적인 방법을 선택한다.

## **Installation Priority**

설치 방식 우선순위:

1. Provider 공식 권장 설치법
2. Cross-platform 공식 package
3. OS-native 공식 package manager
4. Guided manual install

다음은 피한다.

- unofficial installers
- curl | shell을 검증 없이 실행
- sudo 자동 실행
- 관리자 권한 자동 획득
- registry 직접 수정
- 인증 token 직접 접근
- browser cookie 접근

## **Node/npm Dependency**

현재 Copilot setup은 npm을 사용한다.

Multi-provider 버전에서는:

모든 provider가 Node/npm을 필요로 한다고 가정하지 않는다.

각 provider별 prerequisite를 독립적으로 검사한다.

예:

```text
Copilot
→ Node/npm 필요

Claude
→ 실제 공식 설치 방식 확인

Codex
→ 실제 공식 설치 방식 확인

agy
→ 실제 공식 설치 방식 확인
```

공통 runtime을 억지로 설치하지 않는다.

## **Provider Status**

Settings 및 first-run setup에서 다음 상태를 구분한다.

```text
✓ Ready
○ Not installed
⚠ Login required
⚠ Setup incomplete
✕ Unsupported on this OS
```

가능하면 tooltip 또는 작은 설명을 제공한다.

## **First-run Behavior**

Plugin 최초 실행 시 모든 CLI를 자동 설치하지 않는다.

먼저:

```text
어떤 AI를 사용하시나요?

[GitHub Copilot]
[Claude]
[ChatGPT / Codex]
[Antigravity]
```

를 보여준다.

학생이 선택한 provider에 대해서만 setup을 시작한다.

다른 provider는 Settings에서 언제든 추가할 수 있다.

## **MVP Success Criterion**

macOS와 Windows 학생 각각이:

```text
Plugin 설치
→ 자신이 가진 provider 선택
→ Setup
→ 필요한 CLI 설치
→ 공식 로그인
→ Ready
→ 현재 강의노트와 Chat
```

까지 터미널 지식 없이 또는 최소한의 copy/paste만으로 완료할 수 있어야 한다.

자동 설치가 불가능한 provider라도 **동일한 wizard 안에서 guided setup이 끝나면 MVP 성공으로 간주한다.**

## **Local-Agent Verification Requirement**

구현 전에 현재 `leeht1107/obsidian-copilot` 전체 코드를 직접 읽고 다음을 검증한다.

1. 기존 `SetupWizardModal`과 `AutoSetupService`를 일반화할 수 있는지
2. provider abstraction과 setup abstraction을 분리해야 하는지
3. macOS와 Windows에서 각각 실제 공식 CLI 설치법이 무엇인지
4. CLI login 상태를 안전하게 확인할 수 있는 공식 command가 있는지
5. CLI별 cold-start latency가 실제로 어느 정도인지
6. 기존 Quiz/Socratic/MCP 기능이 provider abstraction 후 regression하지 않는지

추측으로 installer command를 작성하지 않는다.

공식 문서 또는 해당 CLI 자체의 `--help` / version output을 기준으로 검증한다.