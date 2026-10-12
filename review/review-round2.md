# Obsidian AI Tutor 0.1.42 — Adversarial Review
## 판정
**CHANGES REQUESTED — 수정 요청 P2 2건, 별도 미검증 보호 범위 1건.**

이전 0.1.41 리뷰의 구체적 P1 경로인 **“과거 Quiz A의 복습 버튼을 눌러 현재 목표 B의 연결을 해제”**는 0.1.42에서 차단되었다. 이 P1을 그대로 유지하지 않는다. 새 학습의 첫 턴이 성공하면 이전 복습 제안을 폐기하는 정책도 확인했다. 과거 퀴즈를 모두 복습 가능하게 만드는 별도 세션 관리나 대규모 문맥 분리 설계를 요구하지 않는다.

남은 수정 요청은 **실패한 학습 전환의 목표 상태 복원**과 **비동기 자료 검사와 제출 대상의 일치**다. 두 건 모두 코드 경로와 분리한 제어흐름 재현으로 확인했지만, 실제 Obsidian 앱에서 수행한 통합 재현은 아니다.
## 검토 대상과 검증 범위
| 항목 | 확인 내용 |
|---|---|
| 검토일 | 2026-10-12, KST |
| 저장소 | `leeht1107/obsidian-ai-tutor` |
| 기준 태그 | `0.1.42` |
| 고정 커밋 | `2e6ecdad9d1e9d6717a235f608b770312fc2bdaa` |
| 비교 기준 | `0.1.41`, `1936113a16df18f9d6e75be3b93948a63451a8ae` |
| 변경 범위 | 1개 커밋, 13개 파일. 주요 구현 변경은 InputController, LearningSetupModal, CopilotBridgeService와 Socratic 상태 타입 |
| CI | [38178570629](https://github.com/leeht1107/obsidian-ai-tutor/actions/runs/38178570629): Ubuntu·Windows 모두 Typecheck, Lint, Test, Build 성공 |
| Ubuntu 테스트 로그 | 113 suites 통과, 1 suite 건너뜀. 1,659 tests 통과, 2 tests 건너뜀 |
| Release workflow | [38178573033](https://github.com/leeht1107/obsidian-ai-tutor/actions/runs/38178573033): 성공 |
| 독립 검증 | 원본 소스의 메서드·분기를 옮긴 Node 제어흐름 재현. 주변 Vault·provider·UI·수명주기는 명시적 테스트 대역 |
| 수행하지 못한 검증 | 저장소 전체 Jest/typecheck/build 독립 재실행, 실제 Obsidian UI 및 실제 provider CLI 실행 |
| 변경 여부 | GitHub 및 사용자 로컬 저장소 수정 없음. 리뷰와 재현 산출물만 생성 |

전체 저장소를 실행 환경으로 가져오려는 네트워크 접근은 실패했다. 따라서 CI 결과를 직접 수행한 테스트처럼 표현하지 않는다. 함께 제공하는 `reproduce-boundaries.mjs`는 **실제 앱 전체가 아니라, 읽은 코드의 상태 전이와 비동기 경계를 검증하는 분리 재현**이다.

[고정 커밋](https://github.com/leeht1107/obsidian-ai-tutor/commit/2e6ecdad9d1e9d6717a235f608b770312fc2bdaa) · [변경 비교](https://github.com/leeht1107/obsidian-ai-tutor/compare/0.1.41...0.1.42)
## R1 · P2 — 새 학습이 시작에 실패해도 이전 목표가 바뀌어, 보존된 복습 버튼을 사용할 수 없다
#### 위치
[InputController.ts L955–987: 첫 응답 전에 목표를 변경·해제](https://github.com/leeht1107/obsidian-ai-tutor/blob/2e6ecdad9d1e9d6717a235f608b770312fc2bdaa/src/features/chat/controllers/InputController.ts#L955-L987)

[InputController.ts L219–263: 복습 목표 불일치 시 제안을 소비하고 거부](https://github.com/leeht1107/obsidian-ai-tutor/blob/2e6ecdad9d1e9d6717a235f608b770312fc2bdaa/src/features/chat/controllers/InputController.ts#L219-L263)

[InputController.ts: 실패 정리와 성공 시 이전 복습 폐기](https://github.com/leeht1107/obsidian-ai-tutor/blob/2e6ecdad9d1e9d6717a235f608b770312fc2bdaa/src/features/chat/controllers/InputController.ts#L1330-L1405)

[main.ts L582–587: 실제 updateConversation은 메모리 객체를 즉시 변경](https://github.com/leeht1107/obsidian-ai-tutor/blob/2e6ecdad9d1e9d6717a235f608b770312fc2bdaa/src/main.ts#L582-L587)
#### 재현 시나리오
같은 대화에서 목표 A에 연결된 Quiz A를 완료한다. 이어서 Brief 없이 새 Quiz를 시작하거나, 다른 목표 B의 Quiz를 시작한다. 첫 provider 요청이 오류를 반환한다. 그 뒤 이전 Quiz A의 복습 버튼을 누른다.

0.1.42의 실제 제어흐름은 다음과 같다.
```text
Quiz A 완료
  activeGoal = A
  quizA.quizReviewAvailable = true

새 학습 시작 시도 — provider 응답보다 먼저 실행
  Brief 없는 학습: activeGoal = undefined
  목표 B 학습:     activeGoal = B

첫 응답 실패
  quizSession = null
  quizA.quizReviewAvailable = true    ← 기존 테스트가 확인하는 값
  activeGoal은 복원되지 않음

Quiz A 복습 클릭
  quizA.quizReviewAvailable = false
  A != activeGoal → 거부
  복습 provider 호출 = 0
```
#### 실제 문제와 영향
“새 학습 시작에 실패하면 이전 복습 제안을 유지한다”는 새 분기는 플래그만 유지한다. 복습 가능 여부를 결정하는 목표 연결은 이미 바뀌어 있어서 **실제로 누를 수 있는 복습 기능을 보존하지 못한다**.

이전 P1의 “A 복습이 B를 지운다”와는 다른 문제다. 이번에는 **실패한 B 시작이 A 연결을 먼저 바꾸고, 새 목표 일치 검사 때문에 A 복습이 영구 소비되는 조합**이다. 첫 요청의 provider 오류라는 일상적인 실패 조건에서 발생할 수 있으므로 P2로 분류한다.
#### 검증 결과
분리 재현에서 Brief 없는 전환과 목표 B 전환을 각각 실행했다. 두 경우 모두 실패 직후 복습 플래그는 `true`였으나, 버튼 처리 후 복습 요청은 0회였고 플래그는 `false`가 되었다. 실제 Obsidian 또는 실제 네트워크 오류 주입을 수행했다는 뜻은 아니다.

기존 `keeps earlier Quiz review offers when the new learning session fails to start` 테스트는 목표 A 연결을 가진 대화를 구성하지 않고 플래그만 확인한다. [해당 테스트와 주변 신규 테스트](https://github.com/leeht1107/obsidian-ai-tutor/blob/2e6ecdad9d1e9d6717a235f608b770312fc2bdaa/tests/unit/features/chat/controllers/InputController.test.ts#L2160-L2325)
#### 최소 수정 방향
첫 턴의 실패·중단·시작 전 예외가 기존 목표와 복습 제안을 일관되게 보존하도록, **목표 변경의 확정 시점 또는 실패 복원**을 기존 `sendMessage()` 안에서 정리한다. 복원 시에는 원래 대화인지 확인하여 다른 대화의 새 상태를 덮어쓰지 않아야 한다.

새 목표·복습 관리자나 별도 저장 계층은 필요하지 않다. 플래그만 복원하는 패치 역시 충분하지 않다.
#### 수용 기준
- [ ] 목표 A의 완료 Quiz가 있는 상태에서 Brief 없는 새 학습과 목표 B 새 학습의 첫 요청을 각각 실패시킨다.
- [ ] `updateConversation` 테스트 대역은 실제 구현처럼 대화 객체를 변경한다.
- [ ] 실패 뒤 A 복습 버튼을 실제 `startQuizReview()`로 눌렀을 때 A 문맥의 provider 요청이 시작된다. 플래그 `true`만 검사하지 않는다.
- [ ] 반대로 새 학습이 성공하면 이전 제안은 계속 폐기된다. 다른 목표로 진행한 뒤 과거 A 복습이 현재 B 연결을 지우는 경로는 다시 열지 않는다.
## R2 · P2 — 자료 검사 중 선택이 바뀌면, 검사하지 않은 빈 노트가 학습 근거로 통과한다
#### 위치
[LearningSetupModal.ts L315–353: start와 비동기 빈 노트 검사](https://github.com/leeht1107/obsidian-ai-tutor/blob/2e6ecdad9d1e9d6717a235f608b770312fc2bdaa/src/ui/modals/LearningSetupModal.ts#L315-L353)

[LearningSetupModal.ts L157–232: 검사 중에도 변경 가능한 체크박스·범위 선택](https://github.com/leeht1107/obsidian-ai-tutor/blob/2e6ecdad9d1e9d6717a235f608b770312fc2bdaa/src/ui/modals/LearningSetupModal.ts#L157-L232)

[LearningSetupModal.ts L505–550: 현재 선택을 다시 읽어 hasSourceNotes 산출](https://github.com/leeht1107/obsidian-ai-tutor/blob/2e6ecdad9d1e9d6717a235f608b770312fc2bdaa/src/ui/modals/LearningSetupModal.ts#L505-L550)
#### 재현 시나리오
내용 있는 `A.md`와 빈 `B.md`를 준비한다. A만 선택해 시작을 누른다. A의 `cachedRead()`가 아직 끝나지 않은 동안 B를 체크하고 A 체크를 해제한다. A 읽기가 끝나도록 한다.
```text
buildScope()                  → 검사 대상 [A.md]
await findEmptyNotes([A.md])   → 파일 읽기 대기
사용자가 선택 변경             → 현재 선택 [B.md]
buildResult()                 → 제출 대상 [B.md]
B는 emptyNotePaths에 없음       → hasSourceNotes = true
finish(result)                → 빈 B로 시작
```
`starting`은 중복 `start()` 호출만 차단한다. 체크박스와 범위 변경 콜백은 이 값을 검사하거나 비활성화하지 않는다. 따라서 **검사한 선택과 제출한 선택이 다를 수 있다**.
#### 검증 결과
A의 읽기를 Promise로 지연시키는 분리 재현에서, 실제 검사 목록은 `['A.md']`, 제출 목록은 `['B.md']`였고 빈 B가 `hasSourceNotes: true`로 통과했다. 실제 UI의 발생 빈도는 측정하지 않았다. 안정된 선택 상태의 빈 노트·공백 노트·frontmatter만 있는 노트는 정상적으로 차단되는 대조군도 확인했다.

이것은 기존 빈 노트 검사가 전혀 작동하지 않는다는 주장이 아니다. **이번에 도입한 비동기 검사와 가변 UI 상태 사이의 새 경쟁 조건**이다.
#### 최소 수정 방향
시작 시점의 선택을 고정하여 **동일한 선택을 검사하고 제출**하거나, 검사 중 범위·노트·Brief 변경을 막고 변경된 선택은 다시 검증하도록 한다. 검사를 마친 뒤 가변 선택 집합으로 결과를 새로 만드는 현재 순서만 정리하면 된다.

상시 노트 감시, 체크박스마다 파일 재검사, 별도 검증 서비스는 필요하지 않다.
#### 수용 기준
- [ ] `cachedRead()`가 아직 해결되지 않은 상태에서 실제 노트·범위 변경 콜백을 실행하는 테스트를 추가한다.
- [ ] 검증하지 않은 새 노트가 제출 결과에 포함되지 않는다. 시작 시점의 A 선택을 고정하거나, 변경된 선택을 재검증·거부하는 방식 모두 가능하다.
- [ ] 빈 노트만 선택한 경우는 거부하고, 유효한 노트가 섞인 경우는 빈 노트만 제외한다.
- [ ] 시작 중복 클릭·취소·재시도에도 `starting`과 검사 대상이 일관된다.
## 이전 지적사항 재판정
| 0.1.41 항목 | 0.1.42 판정 | 확인 범위 |
|---|---|---|
| 과거 Quiz A 복습이 현재 목표 B를 해제 | **구체적 P1 경로 해소** | 목표 불일치 복습을 provider 호출 전에 거부. 새 학습 첫 턴 성공 시 이전 복습 제안 폐기 |
| 복습 중 무관한 현재 노트·선택 영역 자동 첨부 | **해당 자동 첨부 경로 개선** | `quizReview` 세션은 자동 current-note 및 기본 editor selection을 붙이지 않음. 모든 과거 대화가 격리되었다는 포괄적 증명은 아님 |
| 복습 시작 예외 시 제안 소실 | **제한된 범위 개선 확인** | `finally` 추가. 세션 생성 이전 예외와 정리된 provider 실패 경로 복원. 세션 할당 후 스트림 진입 전의 모든 예외까지 통합 검증한 것은 아님 |
| 빈 Markdown도 근거 인정 | **안정된 선택에서는 해결, R2 경쟁 조건 존재** | Start 시 읽기 실패·공백·frontmatter-only 필터가 도입됨 |
| 구형 Copilot에서 allowlist 누락 | **명시적 readOnly:true 요청에 한해 개선** | 학습·inline edit·title 요청 차단. 일반 Ask/Plan 보호 범위는 아래와 같이 별도 관찰 |

근거: [startQuizReview](https://github.com/leeht1107/obsidian-ai-tutor/blob/2e6ecdad9d1e9d6717a235f608b770312fc2bdaa/src/features/chat/controllers/InputController.ts#L219-L263), [current-note 처리](https://github.com/leeht1107/obsidian-ai-tutor/blob/2e6ecdad9d1e9d6717a235f608b770312fc2bdaa/src/features/chat/controllers/InputController.ts#L1070-L1085), [editor selection 처리](https://github.com/leeht1107/obsidian-ai-tutor/blob/2e6ecdad9d1e9d6717a235f608b770312fc2bdaa/src/features/chat/controllers/InputController.ts#L1173-L1185).
## 별도 관찰 — Copilot 일반 Ask/Plan까지 차단한 것은 아니다
새 capability 검사는 다음 조건이다.
```ts
if (queryOptions?.readOnly && !capabilities.availableTools) {
  // error 후 return
}
```
[CopilotBridgeService.ts L845–904](https://github.com/leeht1107/obsidian-ai-tutor/blob/2e6ecdad9d1e9d6717a235f608b770312fc2bdaa/src/core/agent/CopilotBridgeService.ts#L845-L904)

이 조건은 `queryOptions.readOnly === true`인 요청을 차단한다. 하지만 일반 Ask 요청은 학습 요청이 아니면 해당 플래그가 `false`일 수 있고, Plan은 `planMode: true`로 표시될 수 있다. 이미 계산한 `permissionMode`가 읽기 전용인지와 새 조건의 범위가 다르다. `--available-tools`가 없을 때 도구 목록을 생략하는 기존 코드도 남아 있다.

**확인한 것:** 새 플러그인 측 거부 조건이 일반 Ask/Plan 전체를 포함하지 않는다.

**확인하지 못한 것:** 이 조건 차이가 실제 CLI 파일 쓰기 우회로 이어지는지. CLI 자체의 승인 정책이 별도로 쓰기를 막을 수 있다.

따라서 이를 **검증된 보안 취약점이나 새 P1로 올리지 않으며, 위 P2 2건과 구분**한다. 이전 리뷰의 “effective read-only 전체에 대한 fail-closed” 수용 기준은 완전히 충족했다고 표현할 수 없다. 그 범위가 의도라면 기존 `permissionMode`를 기준으로 조건을 통일하고, 일반 Ask·Plan·학습 세 경우의 실제 dispatch 검사를 추가하는 작은 수정이 적절하다.
## 독립 재현 결과 해석
첨부 `reproduce-boundaries.mjs`는 11개 검사를 실행했다. 대조군 7개, 문제 상태를 재현하는 검사 3개(R1의 두 전환·R2), 보호 조건 관찰 1개다. 모두 예상한 제어흐름을 확인했다.

**이 스크립트의 PASS는 제품 PASS가 아니다.** R1/R2 검사는 잘못된 상태가 실제로 발생함을 예상값으로 검증한다. 원본 저장소의 테스트, 실제 Obsidian UI, provider CLI가 통과했다는 의미가 아니다. 주변 코드의 축약·테스트 대역 범위는 스크립트 상단과 각 클래스에 표시했다.
```text
R1 / Brief 없는 전환
  실패 직후 복습 제안 보존: true
  복습 버튼 클릭 후 provider 호출: 0
  제안 최종 소비: true

R1 / 목표 B 전환
  실패 직후 복습 제안 보존: true
  복습 버튼 클릭 후 provider 호출: 0
  제안 최종 소비: true

R2
  검사한 노트: [A.md]
  제출한 노트: [B.md]
  B의 실제 본문: 빈 문자열
  시작 허용: true
```
## 추가 로그 관찰과 범위 제한
Ubuntu CI의 `npm ci` 로그에는 취약점 집계 경고도 있었다. 세부 advisory, 개발 의존성 여부, 배포 번들 도달성을 이번 작업에서 분석하지 않았으므로 이 숫자를 제품의 실제 악용 가능성으로 해석하거나 새로운 릴리스 차단 근거로 사용하지 않았다. 의존성 버전은 이번 diff에서 갱신되지 않았다. `npm audit fix --force` 같은 무차별 변경을 권하지 않는다.

CI의 의도된 오류 주입 테스트에서 출력된 `console.error`를 실제 테스트 실패로 집계하지 않았다.
## 마무리 기준
R1과 R2를 기존 경계에서 수정하고, 실제 저장소 테스트에 위 사용자 흐름을 반영한 뒤 Ubuntu·Windows CI와 해당 Obsidian 흐름을 확인하면 된다. 이 리뷰는 새 기능·세션 관리자·복습 관리자·검증 계층을 추가하라는 요청이 아니다.

**요약: 이전 P1 경로는 닫혔다. 다만 실패한 목표 전환과 비동기 선택 변경에 대한 P2 2건이 남아 있어 이번 판정은 CHANGES REQUESTED다.**

#obsidian #adversarialreview #typescript #regressiontesting #stateManagement #async
