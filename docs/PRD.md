# **PRD — Obsidian AI Learning Chat**

## **1. Product Goal**

`leeht1107/obsidian-copilot`을 기반으로 기존의 강의노트 중심 AI 학습 UX를 유지하면서, 하나의 Obsidian plugin에서 사용자가 이미 구독하고 있는 여러 공식 AI CLI를 선택해 사용할 수 있도록 확장한다.

지원 목표:

- GitHub Copilot CLI
- Claude Code CLI
- OpenAI Codex CLI
- Google Antigravity CLI (`agy`)

핵심 원칙:

**One Obsidian learning UX, multiple official CLI subscriptions.**

Plugin은 각 서비스의 인증을 우회하거나 API를 직접 호출하지 않는다.

```text
Obsidian
	↓
Obsidian AI Learning Chat
	↓
Provider Adapter
	├── copilot
	├── claude
	├── codex
	└── agy
	↓
각 사용자의 공식 CLI 로그인/구독
```

## **2. Existing Baseline — Preserve, Do Not Rebuild**

현재 `obsidian-copilot`에 이미 존재하는 다음 기능은 **baseline**으로 취급한다.

- Sidebar chat
- Current-note context
- `@note`
- File/folder context
- Conversation history
- Model selector
- Thinking control
- Ask / Agent / Plan 관련 기능
- MCP infrastructure
- Inline edit
- `📝 퀴즈` launcher
- `🧠 학습 모드` launcher
- Quiz setup
  - Current note
  - Multiple notes
  - Folder
  - 3–10 questions
  - 하 / 중 / 상
  - Focus topic
- Quiz formats
  - Multiple choice
  - Multi-select
  - Short/free answer
  - True/false
- QuizAnswerPanel
  - Progress bar
  - Clickable answers
  - Keyboard navigation
  - A/B/C/D shortcut
  - Number shortcut
- Quiz feedback
  - 정오
  - 정답
  - 해설
  - 오개념 진단
  - 핵심 포인트
  - 회복 질문
  - Final score
  - Wrong-answer review
- Socratic mode
  - challenge
  - coach
  - rescue
  - consolidation
  - adaptive support level
- Copilot CLI first-run setup wizard

이번 프로젝트에서 위 기능을 새로 설계하지 않는다.

**Provider abstraction과 UX 개선 과정에서 기존 기능이 regression 되지 않아야 한다.**

## **3. Product Scope**

### **3.1 MVP**

MVP의 목적은 다음 하나다.

기존 `obsidian-copilot`의 Chat / Context / Quiz / Socratic 경험을 Claude, Codex, Copilot, agy에서도 최대한 동일하게 사용한다.

필수:

- Provider selection
- CLI detection
- CLI setup
- Current note context
- Context chips
- `@note`
- `@folder`
- Chat
- Quiz
- Socratic
- Existing QuizAnswerPanel
- Existing learning prompts

### **3.2 Flexible Capability**

Provider마다 지원 수준이 다르면 공통분모를 억지로 만들지 않는다.

```text
Feature                    Copilot Claude Codex agy

Chat                         ✓      ✓      ✓    ✓
Current note                 ✓      ✓      ✓    ✓
@note                        ✓      ✓      ✓    ✓
@folder                      ✓      ✓      ✓    ✓
Quiz                         ✓      ✓      ✓    ✓
Socratic                     ✓      ✓      ✓    ✓

Streaming                    native capability
Persistent session           native capability
MCP                          native capability
Skills                       native capability
Tool calling                 native capability
```

지원되지 않는 capability는 숨기거나 graceful fallback한다.

## **4. Provider Architecture**

기존 Copilot-specific runtime을 다음 구조로 분리한다.

```text
UI
│
├── Chat
├── Context
├── Learning
│   ├── Quiz
│   └── Socratic
│
└── ProviderService
	├── CopilotProvider
	├── ClaudeProvider
	├── CodexProvider
	└── AgyProvider
```

개념적 interface:

```ts
interface AIProvider {
	id: string;
	label: string;

	detect(): Promise<ProviderStatus>;

	send(request: ChatRequest): Promise<ChatResponse> | AsyncIterable<ChatEvent>;

	cancel?(): void;

	capabilities: {
		streaming: boolean;
		sessions: boolean;
		mcp: boolean;
		skills: boolean;
	};
}
```

중요:

Provider interface를 완벽하게 만드는 것보다 두 번째 provider가 실제로 동작하는 vertical slice를 먼저 만든다.

## **5. CLI Setup UX**

### **5.1 Decision**

**Setup 버튼을 넣는다.**

하지만 plugin 설치 즉시 모든 CLI를 자동 설치하지 않는다.

현재 Copilot처럼 사용자가 선택한 provider에 대해 **one-click setup을 제공**하는 구조로 일반화한다.

```text
AI Providers

GitHub Copilot     ✓ Ready
Claude             Setup
Codex              Setup
Antigravity        Setup
```

`Setup`을 눌렀을 때:

```text
Claude Setup

1. CLI 설치
2. 공식 로그인
3. 연결 확인

[Set up Claude]
```

### **5.2 Auto-install Policy**

자동 설치는 다음 조건을 만족할 때만 한다.

- 공식적으로 권장되는 CLI 설치 명령이 명확함
- 비관리자 권한으로 안전하게 실행 가능
- 현재 OS/environment에서 충분히 검증됨

그렇지 않으면:

```text
[Copy install command]
[설치 완료 확인]
```

방식으로 fallback한다.

### **5.3 Target UX**

학생이 터미널 설치 방법을 이해할 필요는 없다.

이상적인 흐름:

```text
Plugin 설치
	↓
Provider 선택
	↓
"Claude가 설치되어 있지 않습니다."
	↓
[Setup]
	↓
CLI 설치
	↓
공식 로그인 창/안내
	↓
[연결 확인]
	↓
✓ Ready
```

### **5.4 Non-goal**

Plugin이 다음을 직접 관리하지 않는다.

- OAuth token
- Browser cookie
- API key extraction
- Provider password
- Subscription quota
- Billing

## **6. Provider Selector**

Chat toolbar의 model selector보다 상위에 provider 개념을 둔다.

예:

```text
Claude ▼   Sonnet 4.6 ▼
```

또는 좁은 sidebar에서는:

```text
Claude / Sonnet 4.6 ▼
```

Provider를 바꾸면 해당 provider가 제공하는 model만 표시한다.

학생에게 model 선택이 과도하게 복잡할 경우:

```text
Provider: Claude ▼
Model: Auto
```

를 default로 한다.

## **7. Context UX — Hybrid Default**

현재 note를 항상 자동 포함하되, **무엇이 context인지 화면에 명시적으로 보여준다.**

```text
Context

[📄 05 Logistic Regression.md ×]
[📄 @Odds Ratio.md ×]
[📁 @Week05 ×]
```

원칙:

- Current note → 자동 포함
- `×` → 제거 가능
- `@note` → 추가
- `@folder` → 추가
- Provider 변경 → context 유지
- New chat → 현재 note 자동 재설정

학생이 항상 다음 질문에 답할 수 있어야 한다.

“지금 AI가 무엇을 보고 있지?”

## **8. Quiz — Existing UX Enhancement**

기존 Quiz architecture를 유지한다.

새로운 Quiz engine을 만들지 않는다.

### **8.1 Preserve**

기존:

```text
📝 퀴즈
	↓
Scope
Question count
Difficulty
Focus topic
	↓
QuizAnswerPanel
```

유지.

난이도:

```text
하
중
상
```

유지.

문제 format:

- 객관식
- 복수선택
- True/False
- 자유서술

유지.

### **8.2 Add Quick Actions to QuizAnswerPanel**

현재 답변 UI 아래에 작은 도움 버튼을 추가한다.

```text
┌──────────────────────────────┐
│ 2 / 5                       │
│ ████████░░                   │
│                              │
│ A. ...                       │
│ B. ...                       │
│ C. ...                       │
│ D. ...                       │
│                              │
│ [💡 힌트] [😵 모르겠어요]    │
└──────────────────────────────┘
```

#### **힌트**

`💡 힌트` 버튼:

- 정답은 공개하지 않는다.
- source-grounded hint 한 단계만 제공한다.
- 현재 문제는 유지한다.

내부적으로 별도 quiz engine을 만들 필요 없이 continuation prompt를 보낸다.

의도:

```text
Give one source-grounded hint for the current question.
Do not reveal the answer.
Do not advance to the next question.
```

#### **모르겠어요**

`😵 모르겠어요`:

- 정답 또는 핵심 개념을 짧게 설명한다.
- 현재 문제를 오답/도움 사용으로 기록할 수 있으면 기록한다.
- 이해 확인용 recovery question 또는 다음 문제로 이어간다.

Quiz prompt가 이미 오개념 진단과 회복 질문을 지원하므로 이를 재사용한다.

### **8.3 Next Question**

`다음 문제`는 **항상 노출하지 않는다.**

정답 feedback 이후에만 표시한다.

```text
### 정답 확인
...

[다음 문제 →]
```

현재처럼 AI가 feedback 뒤 곧바로 다음 문제까지 생성하는 방식과 비교하여 UX를 검토한다.

#### **Preferred direction**

가능하면:

```text
학생 답변
	↓
정답 feedback
	↓
[다음 문제 →]
	↓
다음 문제 generation
```

으로 분리한다.

장점:

- 학생이 해설을 읽을 시간 확보
- 다음 문제가 아래로 밀려 내려가지 않음
- Quiz가 실제 앱처럼 느껴짐
- 학생 스스로 pace 조절

단, 구현이 크게 복잡해지면 기존 자동-next behavior를 유지한다.

**Flexible requirement.**

### **8.4 Quiz Result UX**

현재 final answer가 Markdown으로 다음을 생성한다.

- Score
- Wrong-answer review
- misconception
- recovery question

가능하면 이를 전부 별도의 application state로 구조화하지 않고, Markdown 결과 위에 작은 summary header만 추가한다.

예:

```text
퀴즈 완료 🎉

4 / 5
████████████████░░ 80%

[틀린 문제 복습]
[같은 범위 다시 풀기]
```

#### **같은 범위 다시 풀기**

기존 QuizSetup state:

- scope
- difficulty
- question count
- focus

를 그대로 재사용하여 새로운 quiz를 시작한다.

이 기능은 구현비용 대비 UX 효과가 높다.

### **8.5 Wrong-Only Retry**

가능하면 P1:

```text
[틀린 개념만 다시 풀기]
```

를 제공한다.

LLM이 이미 final review에서 wrong-answer topic keyword를 생성하므로 이를 다음 quiz의 focus로 사용하는 방식을 우선한다.

복잡한 persistent mastery database는 만들지 않는다.

## **9. Socratic — Existing Adaptive Logic Enhancement**

현재 adaptive engine:

```text
challenge
	↕
coach
	↕
rescue
```

를 그대로 유지한다.

별도의 tutoring engine을 만들지 않는다.

### **9.1 Add Explicit Student Controls**

현재 시스템은 학생이 텍스트로:

```text
모르겠어요
힌트 주세요
정답 알려줘
```

라고 하면 rescue level을 높인다.

이를 버튼으로 노출한다.

```text
[💡 힌트] [😵 모르겠어요]
```

버튼은 새로운 logic을 만들지 않는다.

기존 `STUCK_PATTERNS`가 이해하는 입력을 보내는 shortcut이다.

예:

```text
💡 힌트
→ "힌트 주세요"

😵 모르겠어요
→ "모르겠어요. 조금 더 설명해 주세요."
```

따라서 매우 낮은 구현 복잡도로 UX를 개선할 수 있다.

### **9.2 Optional Challenge Button**

P1 후보:

```text
[🔥 더 어렵게]
```

학생이 개념을 이해했다고 느끼는 경우 support level을 challenge 쪽으로 유도한다.

내부 message:

```text
"이해한 것 같아요. 더 어려운 응용 문제를 주세요."
```

새 adaptive algorithm은 필요 없다.

### **9.3 Mode Visibility**

현재 내부 support level을 그대로 노출할 필요는 없다.

학생에게:

```text
Challenge / Coach / Rescue
```

같은 기술적 label을 보여주지 않는다.

대신 AI behavior만 adaptive하게 유지한다.

## **10. Learning UX Principle**

Quiz와 Socratic은 별개의 provider 기능이 아니다.

```text
                   Quiz
                    │
Notes → Learning Prompt → Provider
                    │
                 Socratic
```

따라서:

```text
Claude + Quiz
Codex + Quiz
Agy + Quiz
Copilot + Quiz
```

가 동일한 UX를 사용해야 한다.

Provider가 달라져도 학생은 학습 방식을 다시 배울 필요가 없어야 한다.

## **11. MCP**

현재 repo의 MCP infrastructure를 보존한다.

다만 multi-provider 전환 시 universal MCP abstraction을 새로 만들지 않는다.

정책:

```text
Provider가 native MCP 지원
	→ 연결 가능하면 연결

복잡함
	→ 해당 provider에서는 MCP 숨김
```

MCP는 **MVP blocker가 아니다.**

학생 기본 UI에서도 MCP라는 용어를 노출할 필요가 없다.

```text
Settings
	└── Advanced
		└── MCP
```

## **12. Skills**

Skills도 같은 원칙.

- Provider-native Skills가 간단히 발견/호출 가능 → 지원
- 별도 universal Skills engine 필요 → skip

Quiz/Socratic은 Skills로 옮기지 않는다.

이 둘은 제품의 built-in learning UX로 유지한다.

## **13. Memory Map**

현재 PRD에서는 제외한다.

이유:

이번 제품의 핵심 pain point가 아니다.

학생이 관련 note를 못 찾는 문제가 실제로 관찰되면 나중에:

```text
Related Notes
+ Probability.md
+ Odds Ratio.md
+ Classification.md
```

정도의 `Context Suggestions`만 추가한다.

Vector DB, embeddings, graph memory는 구현하지 않는다.

## **14. Progressive Disclosure**

### **Student Default UI**

기본 화면:

```text
┌────────────────────────────┐
│ Claude ▼                   │
│                            │
│ 📝 퀴즈   🧠 학습 모드      │
│                            │
│ Context                    │
│ [📄 Current note ×]        │
│ [📁 Week05 ×]              │
│                            │
│ 질문을 입력하세요...        │
└────────────────────────────┘
```

학생에게 필요 없는 설정은 숨긴다.

### **Advanced**

```text
Settings
	├── Providers
	├── Models
	├── MCP
	├── Skills
	└── Diagnostics
```

## **15. Setup Experience**

### **First Launch**

플러그인 자체는 정상 실행한다.

Provider status를 검사한다.

```text
Choose your AI

GitHub Copilot     [Setup]
Claude             [Setup]
ChatGPT / Codex    [Setup]
Antigravity        [Setup]
```

한 개만 설치되어 있어도 바로 사용할 수 있다.

모든 provider 설치를 요구하지 않는다.

### **Important**

**학생이 원하는 AI 하나만 준비하면 된다.**

이것이 핵심이다.

```text
"4개 CLI를 모두 설치하세요"
```

가 되어서는 안 된다.

## **16. Performance**

목표:

Thin wrapper가 해당 CLI를 terminal에서 직접 사용할 때보다 눈에 띄게 느려지지 않는다.

측정:

```text
direct CLI TTFT
vs
plugin TTFT
```

최적화 우선순위:

1. unnecessary process spawn 확인
2. context size 확인
3. history duplication 확인
4. provider session reuse 가능성 확인

처음부터 persistent daemon architecture를 만들지 않는다.

실제 latency가 문제일 때만 최적화한다.

## **17. Explicit Non-goals**

초기 구현에서 제외:

- 자체 LLM API gateway
- OAuth extraction
- cookie reuse
- universal agent runtime
- multi-agent orchestration
- vector DB
- semantic long-term memory
- Memory Map
- mastery database
- 자동 curriculum engine
- 모든 provider capability의 강제 통일
- 복잡한 provider-independent MCP implementation
- 모든 CLI 자동 설치를 한 번에 수행하는 installer

## **18. Implementation Sequence**

### **Phase 0 — Regression Baseline**

현재 Copilot 버전의 다음 동작을 test로 고정한다.

- Chat
- @ context
- Folder context
- Quiz setup
- Quiz difficulty
- MCQ answer UI
- Multi-select
- Free text
- Quiz final review
- Socratic
- Adaptive rescue
- MCP
- Setup wizard

### **Phase 1 — Provider Abstraction**

Copilot을 `CopilotProvider` 뒤로 이동한다.

**Behavior change = 0**이 목표.

### **Phase 2 — Second Provider**

가장 integration이 쉬운 Claude 또는 Codex 하나를 연결한다.

검증:

```text
Chat
Current note
@note
@folder
Quiz
Socratic
```

### **Phase 3 — Remaining Providers**

순차적으로:

- Copilot
- Claude
- Codex
- agy

완료.

### **Phase 4 — Setup Generalization**

현재 `SetupWizardModal`을:

```text
CopilotSetup
```

에서:

```text
ProviderSetup
```

으로 일반화한다.

단 provider별 installation recipe는 분리한다.

### **Phase 5 — Learning UX Polish**

낮은 비용 순으로:

1. Quiz `힌트`
2. Quiz `모르겠어요`
3. Socratic `힌트`
4. Socratic `모르겠어요`
5. Quiz 완료 → `같은 범위 다시 풀기`
6. 가능하면 feedback와 next-question 분리
7. 가능하면 wrong-only retry

### **Phase 6 — Optional Capabilities**

그 이후에만:

- MCP
- Skills
- provider-native session optimization

을 확장한다.

## **19. MVP Success Criteria**

학생이 다음 과정을 설명 없이 수행할 수 있다.

```text
1. Obsidian plugin 설치
2. 자신이 가진 AI provider 하나 선택
3. Setup
4. 공식 계정 로그인
5. 강의노트 열기
6. AI에게 질문
7. @note 또는 @folder 추가
8. Quiz 실행
9. 객관식 버튼으로 답변
10. 필요하면 힌트 사용
11. Socratic 학습 실행
12. 막히면 "모르겠어요" 버튼 사용
```

그리고 교수자는 같은 Obsidian 강의노트를 배포하면서 학생이 어느 provider를 사용하는지 신경 쓸 필요가 없어야 한다.

## **20. Decision Priority**

구현 중 선택이 필요하면:

```text
Student UX
	>
Reliability
	>
Existing feature preservation
	>
Low maintenance
	>
Speed
	>
Feature richness
	>
Architectural elegance
```

특히 다음 질문을 반복한다.

이 기능이 학생이 노트에서 AI로 학습하는 일을 더 쉽게 만드는가?

아니라면 구현하지 않는다.