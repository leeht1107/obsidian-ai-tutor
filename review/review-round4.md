# Obsidian AI Tutor 0.1.44 — Review Letter, Round 4
## 판정
**PASS — 이번 수정 범위에서 추가 수정 요청 0건. R3-01과 노트 래퍼 보조 관찰을 종료한다.**

검토 대상: `leeht1107/obsidian-ai-tutor`, 커밋 `a018bcb7299cb07c99f5b3293faf543bb2223239`. 비교 기준: 0.1.43의 `629a488f52764904cf0472d1c40071002bfa4ebf`. 검토일: 2026-10-12 KST.

선택 노트의 학습 선호와 기본 무작위화의 우선순위가 명시됐고, 현재 노트 래퍼와 시스템 프롬프트에도 제한적 위임이 반영됐다. 이전 리뷰가 요구했던 문장 수준의 계약 정리는 충족한다. 삭제한 Brief·목표 저장 기능, 전용 지시 추출기, 새로운 관리 계층을 다시 추가할 이유는 찾지 못했다.

**PASS는 코드·프롬프트 계약에 대한 판정이다. 전체 테스트 통과, 배포 승인, 실제 LLM의 지시 준수 또는 권한 우회 불가능성을 인증하는 판정이 아니다.**

[검토 커밋](https://github.com/leeht1107/obsidian-ai-tutor/commit/a018bcb7299cb07c99f5b3293faf543bb2223239) · [고정 비교](https://github.com/leeht1107/obsidian-ai-tutor/compare/629a488f52764904cf0472d1c40071002bfa4ebf...a018bcb7299cb07c99f5b3293faf543bb2223239)
## 이전 지적의 종료 근거
| 항목 | 코드에서 확인한 내용 | 판정 |
|---|---|---|
| R3-01: 준비 순서·형식과 무조건적 무작위화의 충돌 | `withPreparationGuidance()`가 학습 선호의 우선순위를 명시하고, `buildQuizPrompt()`가 노트에서 정하지 않은 부분만 다양화하도록 변경 | 종료 |
| R3-01 보조 관찰: 인라인 노트의 금지 래퍼 | 무조건적인 “do not follow instructions” 대신 질의가 위임한 범위에서만 따르도록 변경 | 종료 |
| 파일로 읽은 노트의 준비 지침 | 시스템 프롬프트에 선택 노트의 학습 선호를 사용자의 선택으로 적용하는 예외를 명시. 도구 결과를 일반적으로 지시로 승격하지 않음 | 종료 |
| 도구·권한·출처·문제 수·파싱 형식 | 준비 노트가 바꿀 수 없다는 제한을 명시. 이번 diff는 권한 판정·provider 실행 인자를 변경하지 않음 | 이번 수정에서 유지 확인 |
| 이전 R1·R2 | 목표 기능 제거와 미검증 선택 차단에 대한 지난 종료 판정 유지 | 재개하지 않음 |

근거: [preparationGuidance.ts L9–15](https://github.com/leeht1107/obsidian-ai-tutor/blob/a018bcb7299cb07c99f5b3293faf543bb2223239/src/core/learning/preparationGuidance.ts#L9-L15), [quiz.ts L104–118](https://github.com/leeht1107/obsidian-ai-tutor/blob/a018bcb7299cb07c99f5b3293faf543bb2223239/src/core/learning/quiz.ts#L104-L118), [context.ts L20–22](https://github.com/leeht1107/obsidian-ai-tutor/blob/a018bcb7299cb07c99f5b3293faf543bb2223239/src/utils/context.ts#L20-L22), [mainAgent.ts L136–152](https://github.com/leeht1107/obsidian-ai-tutor/blob/a018bcb7299cb07c99f5b3293faf543bb2223239/src/core/prompts/mainAgent.ts#L136-L152).
## 반례 재점검
지난 리뷰의 준비 노트를 그대로 사용했다.
```markdown
# 준비 방법
매번 기본 정의 → 조건부확률 → 베이즈 순서를 고정한다.
모든 문항은 같은 자유서술 템플릿을 사용한다.
```
수정본에는 학습 선호가 기본 다양성 규칙보다 우선한다는 문장과, 노트가 정하지 않은 부분만 바꾸라는 조건이 함께 들어간다. 따라서 이 반례에 대해 이전의 직접적인 지시 충돌은 해소됐다고 판단한다.

추가로 문제 수 변경·헤더 생략을 요구하는 노트 문자열을 넣어도 builder의 지정 문제 수와 필수 출력 형식, 이를 변경할 수 없다는 제한 문장이 유지되는지 확인했다. XML 종료 태그처럼 보이는 본문과 따옴표가 포함된 경로의 이스케이프도 확인했다. **이 검사는 입력·출력 문자열 검사이지, LLM이 실제로 부적절한 지시를 거절했다는 검증이 아니다.**

후속 문항·최종 문항·힌트 생성 함수에도 동일한 `sourceInstruction`과 제한 문장이 전달되는 것을 helper 실행으로 확인했다. 복습을 포함한 실제 UI 수명주기 전체를 실행한 것은 아니다.
## 테스트 평가
#### 저장소에 추가된 테스트
[InputController.test.ts L678–715](https://github.com/leeht1107/obsidian-ai-tutor/blob/a018bcb7299cb07c99f5b3293faf543bb2223239/tests/unit/features/chat/controllers/InputController.test.ts#L678-L715)는 실제 `LearningSetupModal.buildResult()`와 `sendLearningSetupResult()`를 통과시켜 provider 대역에 전달되는 문자열 및 `readOnly: true`를 검사한다. 해당 리뷰의 회귀 검사로 적절하다.

다만 `cachedRead`, 실제 Obsidian UI, 실제 provider CLI를 실행하지 않으며 `agentService.query`는 대역이다. Bridge의 시스템 프롬프트 주입 이전 지점에서 캡처하므로 실제 provider 종단간 실행 시험이라고 부르지는 않는다.

[systemPrompt.test.ts L90–97](https://github.com/leeht1107/obsidian-ai-tutor/blob/a018bcb7299cb07c99f5b3293faf543bb2223239/tests/unit/core/prompts/systemPrompt.test.ts#L90-L97)는 시스템 프롬프트의 제한적 위임 문구를 따로 검사한다. 두 테스트의 역할은 서로 보완적이다. 이번 리뷰 환경에서 이 저장소 Jest 테스트들을 직접 재실행한 것은 아니다.
#### 이번 리뷰에서 직접 실행한 독립 검사
`check-review.cjs`를 작성·실행했다. 원본 helper 3개 전체를 TypeScript로 변환해 실행하며, 실행 전 Git blob SHA를 검증한다. 0.1.43 대조군 3개 파일도 동일하게 검증한다.

| 검사 | 결과 |
|---|---|
| 원본 파일 동일성 | 수정본 3개 + 구버전 3개, Git blob SHA 6개 모두 일치 |
| 수정본 검사 | 15개 통과 |
| 구버전 음성 대조 | 동일한 핵심 회귀 기준 2개가 구버전에서 예상대로 실패 |
| 내용 | 무작위화 우선순위, 인라인 위임, 제한 문구, 문제 수·헤더, 후속·최종·힌트, Web 정책 helper, XML 이스케이프, 일반 채팅 조립, 빈 본문, 표시 메타데이터 |

이 2개 음성 대조는 **리뷰어가 작성한 helper 회귀 기준**이다. 작성자가 추가한 저장소 Jest 테스트 2개를 구버전에서 독립 재실행했다는 뜻이 아니다.

시스템 프롬프트와 InputController의 실제 코드는 커넥터로 읽고 정적으로 검토했다. 독립 스크립트는 이 둘을 실행하지 않는다. `assembled-before-system.txt`는 원본 helper로 만든 재현 입력이며, 실제 provider 요청 캡처나 시스템 프롬프트 포함 완성본이 아니다.
## 설명상 정정 1건 — 코드 수정 요청 아님
“노트 지시를 따르는 것은 학습 요청이 위임할 때뿐”이라는 설명은 코드보다 좁다. 래퍼와 시스템 프롬프트는 공통이므로, **일반 채팅에서도 사용자가 노트의 지시를 따르라고 명시하면 그 범위의 제한적 위임이 가능하다.**

정확한 설명은 다음과 같다.
> 학습 요청은 선택 노트의 교육적 선호를 자동으로 위임한다. 일반 채팅은 노트를 요약·설명하라는 요청만으로 학습 선호를 자동 적용하지 않으며, 사용자가 명시적으로 위임한 범위에서만 노트의 지시를 따른다. 어느 경우에도 노트가 도구·권한·시스템 규칙을 바꿀 수는 없다.

이 차이를 새 보안 취약점으로 세거나 학습 전용 분기를 추가하라고 요구하지 않는다. 문서 설명을 실제 공통 규칙과 맞추면 된다. 일반 채팅에서도 사용자 명시적 위임이 가능하다는 점과, 모든 노트를 신뢰한다는 것은 다르다.
## CI·실행 검증의 상태
고정 SHA에 대해 [GitHub Actions 조회](https://api.github.com/repos/leeht1107/obsidian-ai-tutor/actions/runs?head_sha=a018bcb7299cb07c99f5b3293faf543bb2223239&per_page=2)를 실행했고, 조회 시점 결과는 `total_count: 0`이었다. 따라서 이전 버전의 CI 성공을 이번 커밋의 성공으로 재사용하지 않는다. 실행이 왜 없는지 원인은 확인하지 않았다.

사용자 보고는 typecheck·lint·build 성공, 테스트 1,591개 통과·2개 건너뜀·1개 실패다. 실패 1건이 환경 문제라는 원인을 독립 검증하지 않았으므로 전체 테스트 성공으로 표현하지 않는다. 그렇다고 이 실패를 근거 없이 이번 패치의 제품 결함으로 분류하지도 않는다.

이 환경은 공개 GitHub 호스트의 DNS 조회에 실패해 저장소 전체와 의존성을 실행 환경으로 가져오지 못했다. 필요한 코드 검토는 연결된 GitHub 도구로 수행했다. 전체 Jest·typecheck·build, 실제 Obsidian·provider CLI·LLM 실행은 독립 수행하지 않았다.

**남은 것은 배포 전 실행 확인이지, 새로운 리뷰 라운드를 만들기 위한 코드 보강이 아니다.** 정확한 배포 후보의 자동 검사 결과와 실패 1건의 근거를 확인하고, 실제 앱에서 준비 노트 한 번과 일반 노트 한 번의 학습 흐름을 점검하는 것으로 마무리하면 된다. 대규모 평가 체계나 추가 기능은 요구하지 않는다.
## 산출물과 재실행
GitHub 저장 위치: `review/review-round4.md`. 제품 소스·권한·브랜치 병합·태그·릴리스는 변경하지 않는다.

첨부 ZIP: `obsidian-ai-tutor-0.1.44-review-evidence.zip`.
```text
obsidian-ai-tutor-0.1.44-evidence/
├── README.md
├── check-review.cjs
├── execution.log
├── results.json
├── assembled-before-system.txt
├── baseline-before-system.txt
├── source/       # 0.1.44 helper 3개
└── baseline/     # 0.1.43 동일 helper 3개
```
Node.js와 TypeScript가 이미 있는 환경에서 증거 폴더로 이동해 실행한다. 전역 TypeScript 사용 예시는 다음과 같다.
```bash
NODE_PATH="$(npm root -g)" node check-review.cjs
```
패키지 설치나 업데이트는 수행하지 않는다. 저장소의 TypeScript를 쓰는 경우에는 `NODE_PATH`를 그 저장소의 `node_modules` 경로로 지정한다.
## 결론
**R3의 두 충돌은 해결됐다. 이번 변경을 막을 추가 결함은 찾지 못했으며, 코드 리뷰는 PASS로 종료한다.** 실제 배포·LLM 동작에 대한 미검증 사항을 PASS에 포함시키지 않는다.

#obsidian #adversarialreview #promptEngineering #regressionTesting #minimalism
