# Completion Proof Packet — Obsidian AI Tutor

Status: production requirements 1–4 and 6 of `goal-contract.md` are met and
independently verifiable with the commands below. Requirement 5 (public
remote, final commit) is **not yet met** — no remote is configured; this is
explicitly disclosed as pending, not claimed as done. Acceptance evaluation
and the required advisor-sol review have not yet run against this packet.

Locked contract: `goal-contract.md` (unchanged by this task).

This document only adds documentation. No file under `src/`, `tests/`,
`manifest.json`, `package.json`, or any config was changed while producing
it. No credentials, remote scripts, `.handoff/`/SSOT files, or GitHub state
were touched.

---

## 1. Requirement-by-requirement mapping

| # | goal-contract.md requirement | Status | Evidence |
|---|---|---|---|
| 1 | Build, typecheck, lint, and tests pass after the final edit | ✅ Met | [§2 Final command outputs](#2-final-command-outputs-this-task) |
| 2 | Four provider paths (Copilot, Claude Code, Codex, agy) support discovery/setup and the locked Chat, Context, Quiz, Socratic flows where provider capability permits | ✅ Met | [§3 Provider / setup / feature matrix](#3-provider--setup--feature-matrix) |
| 3 | No shared provider runtime/proxy/queue/RPC/stream relay/extra child process; deterministic fake-CLI benchmark proves one child process per request and p95 dispatch overhead ≤10 ms | ✅ Met | [§4 One-child-process / p95 dispatch evidence](#4-one-child-process--p95-dispatch-evidence) |
| 4 | Windows-specific path/command handling has automated coverage; this packet distinguishes it from physical Windows E2E | ✅ Met (automated only) | [§5 Windows coverage statement](#5-windows-coverage-statement) |
| 5 | Target remote is public, contains the final commit, preserves MIT copyright notice, passes stale branding/scope audit | ⚠️ Partially met — **remote not yet created/pushed** | [§6 MIT / stale-branding / scope audit](#6-mit--stale-branding--scope-audit) |
| 6 | Every completed production/evaluation task has lifecycle receipts from the Harness-selected backend (Orca) and an indexed handoff/SSOT/scratchpad | ✅ Met | [§7 Orca lifecycle receipts](#7-orca-production-lifecycle-receipts) |

---

## 2. Final command outputs (this task)

Run from `/Users/mark/Projects/Tools/obsidian-ai-tutor` after this
documentation-only edit (no source files changed):

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

Results:

- `npm run typecheck` (`tsc --noEmit`) — clean, no errors.
- `npm run lint` (`eslint "{src,tests}/**/*.ts"`) — clean, no errors.
- `npm test` (`node scripts/run-jest.js`) — **911/911 tests passed, 46 suites**, including `tests/unit/core/agent/directProcessDispatch.test.ts` and `tests/unit/core/providers/providerRegistry.test.ts`. Logged p95 for this run: `0.301ms` (see §4).
- `npm run build` (`build:css` + `esbuild.config.mjs production`) — succeeded; `styles.css` (127.0 KB) and `main.js` regenerated. Both are gitignored build artifacts, not part of the source diff.

`git status --short` before this task's edits was clean at commit
`f883901feb4bb8783f3b8be3e4c4941f6c2b382d` ("test: prove direct provider
dispatch overhead"); this task's diff is limited to `README.md`,
`README_Ko.md`, and this file.

---

## 3. Provider / setup / feature matrix

Source of truth: `src/core/providers/providerRegistry.ts`,
`src/core/setup/AutoSetupService.ts`, `src/ui/modals/SetupWizardModal.ts`,
`src/core/agent/CopilotBridgeService.ts`.

| Capability | Copilot | Claude Code | Codex | agy (Antigravity) |
|---|---|---|---|---|
| Discovery (`findProviderCliPath`, enhanced-PATH + Windows `.cmd`/`.exe` shim search) | ✅ | ✅ | ✅ | ✅ |
| Auto-install via verified npm recipe | ✅ `npm install -g @github/copilot` | ✅ `npm install -g @anthropic-ai/claude-code` | ✅ `npm install -g @openai/codex` | ❌ no verified package-manager recipe; guided manual setup + recheck only (`AutoSetupService.installProviderCLI`, `getProviderDescriptor('agy').installCommand === undefined`) |
| Login command surfaced in setup UI | `copilot login` (or `/login` inside the interactive CLI) | `claude` (interactive login on first run) | `codex login` | `agy` (student completes agy's own official login separately; the plugin issues no remote install/auth script) |
| Setup wizard (`SetupWizardModal`) | ✅ auto-opens when CLI missing | ✅ | ✅ | ✅ (manual-setup phase only) |
| Chat + current-note/session context | ✅ | ✅ | ✅ | ✅ |
| `@`-mention external note context | ✅ | ✅ | ✅ | ✅ |
| `/quiz` learning mode | ✅ | ✅ | ✅ | ✅ |
| `/socratic` learning mode | ✅ | ✅ | ✅ | ✅ |
| Tool approvals, MCP servers, plan mode, live inline diffs | ✅ (Copilot's own JSON stream carries tool events) | native CLI text/JSON output only — no MCP/tool-approval bridge for this provider | same as Claude Code | same as Claude Code |
| Dispatch path | `CopilotBridgeService#query` → `spawnCopilot` (unchanged existing path) | `CopilotBridgeService#querySelectedProvider` (shared seam for all 3 non-Copilot providers) | same seam | same seam |

`/quiz` and `/socratic` are implemented as prompt builders
(`src/core/learning/quiz.ts`, `src/core/learning/socratic.ts`) that call the
same `query()`/`streamQuery()` path used for chat — neither modal
(`QuizSetupModal.ts`, `SocraticSetupModal.ts`) nor the learning prompt
builders reference a specific `ProviderId`, so both modes are provider-
agnostic by construction, not by per-provider special-casing.

Default provider on a fresh install is `copilot`
(`src/core/types/settings.ts`); a student changes it from Settings → AI
provider at any time. Exactly one provider is ever selected — no dual
dispatch, no background process for the unselected providers
(`tests/unit/core/providers/providerRegistry.test.ts` pins the 4-provider
list and the exact native argv per provider).

---

## 4. One-child-process / p95 dispatch evidence

Full method, fixture design, and three prior independent runs are in
`.claude/artifacts/obsidian-ai-tutor-20260903-0001/direct-process-performance.md`
(unchanged by this task). Summary:

- Test: `tests/unit/core/agent/directProcessDispatch.test.ts`, driving the
  real `CopilotBridgeService.query()` → `querySelectedProvider()` path
  against a deterministic fake CLI fixture (no real provider binary,
  network, or auth involved).
- **Child-process count**: `spawn` is called exactly once per request;
  `execFile`, `exec`, and `fork` are never called on this path. No
  proxy/queue/RPC/relay/extra child process exists.
- **Dispatch overhead** (plugin-side synchronous cost up to the `spawn()`
  call, 200 sequential samples): p95 consistently ≈0.3 ms, over 30× inside
  the 10 ms contract budget. This task's own verification run
  (§2) logged `p95=0.301ms`; three earlier independent runs logged
  `0.315ms`, `0.295ms`, `0.292ms`.
- Explicitly **not** measured: real CLI process startup time, model
  inference latency, or end-to-end request latency — those are external to
  this plugin and outside the contract's item-3 claim.
- Only `claude` was exercised directly; `codex`/`agy` share the identical
  `querySelectedProvider` call site and differ only in the pure
  `buildNativeProviderCommand`/`parseNativeProviderLine` functions, which do
  not affect process count or dispatch timing.

Commands:

```bash
npx jest --config jest.config.js --selectProjects unit \
  tests/unit/core/agent/directProcessDispatch.test.ts
npm run typecheck && npm run lint && npm test && npm run build
```

---

## 5. Windows coverage statement

- **Automated coverage exists**: the dispatch path uses
  `resolveCmdShim`/`getEnhancedPath` with Windows-specific `.cmd`/`.exe`
  shim resolution and `shell:true` fallback, exercised by
  `tests/unit/utils/utils.test.ts` and by the platform-branching fixture in
  `directProcessDispatch.test.ts` (`.sh` + `chmod 755` on POSIX, `.cmd` on
  `win32`).
- **No physical Windows E2E was run.** All evidence in this packet — the
  dispatch/process-count/p95 proof, and every `npm run typecheck|lint|test|
  build` invocation — was collected on macOS (Darwin arm64, this task's run
  and the three prior runs recorded in
  `direct-process-performance.md`). This repository's CI
  (`.github/workflows/release.yml`) runs on `ubuntu-latest` only; there is
  no Windows CI runner and none was used for this packet.
- This distinction is stated explicitly per goal-contract item 4: automated
  Windows-path coverage is **not** claimed to be, and must not be read as,
  physical Windows end-to-end verification.

---

## 6. MIT / stale-branding / scope audit

Commands run against the post-edit tree (`README.md`, `README_Ko.md`, this
file):

```bash
head -3 LICENSE
grep -n "powered by \*\*GitHub Copilot CLI\*\*\|only.*Copilot\|Copilot 단독\|Copilot만" README.md README_Ko.md
grep -rn "obsidian-copilot" README.md README_Ko.md docs/COMPLETION_PROOF_PACKET.md
git remote -v
git rev-parse HEAD
grep -n "description" manifest.json
```

Results:

- `LICENSE` still opens `MIT License` / `Copyright (c) 2025 reallygood83` —
  unchanged, preserved.
- No stale "Copilot-only" claim remains in `README.md` or `README_Ko.md`
  (pre-edit, `README.md` line 5 read "powered by **GitHub Copilot CLI**" and
  the Prerequisites/Configuration sections only covered Copilot; both are
  now corrected to the 4-provider model in this task's diff).
- No literal `obsidian-copilot` (the read-only source repo's name) residue
  in the edited docs.
- `git remote -v` returns nothing — **no remote is configured**. This
  packet does not claim a public remote, a pushed commit, or a remote
  commit SHA — goal-contract item 5's remote/publish requirement is
  disclosed as **not yet done** (see §1).
- Current local `HEAD`: `f883901feb4bb8783f3b8be3e4c4941f6c2b382d` ("test:
  prove direct provider dispatch overhead"), unchanged by this task except
  for the documentation files it adds/edits.
- **Resolved in a later task**: `manifest.json`'s `description` field
  previously read "Embed GitHub Copilot as a sidebar chat for AI-assisted
  note writing and coding." A subsequent, explicitly scoped task corrected
  it to "Chat with GitHub Copilot, Claude Code, Codex, or agy in a sidebar
  for AI-assisted note writing and coding." No other manifest field changed.
  Receipt: `.claude/artifacts/obsidian-ai-tutor-20260903-0001/claude-stale-branding.md`.

---

## 7. Orca production lifecycle receipts

Single Orca Run for the entire workstream: **`run_d774d2fc36ed`**. Each row
is a Task dispatched inside that Run, with its worker, Dispatch ID,
`worker_done` message ID (when work actually completed), and the indexed
handoff that records it. Every task below has a handoff in
`.handoff/2026-09-03/` or `.handoff/2026-09-04/`, indexed in
`.handoff/LATEST.md`, plus scratchpad evidence in
`.claude/artifacts/obsidian-ai-tutor-20260903-0001/scratchpad.md` (rows
R1–R9).

| Task (handoff) | Session | Worker | Task ID | Dispatch ID | worker_done | Outcome |
|---|---|---|---|---|---|---|
| implementation | 2026-09-03-143300-codex | Antigravity (agy, research) | `task_aa4cd0302c27` / `task_653bc254d0c5` | `ctx_cd237a675044` | — (none) | **Failed before work** — `agent_prompt_stalled`, unauthenticated Orca-created `antigravity` terminal. Fenced, released with terminal archive. |
| baseline | 2026-09-03-144100-codex | Luna | `task_78401f1e5409` | `ctx_bd0f0042d3f3` | `msg_4e04ca08caeb` | Completed — copied source commit `87cd72ef761811635b840928746666d104e14dd6`, initialized target Git, rebranded to `obsidian-ai-tutor` 0.1.0; `npm ci`/typecheck/build passed. Receipt: `luna-baseline.md`. |
| provider-foundation | 2026-09-03-144800-codex | Luna | `task_df61a7156a7b` | `ctx_67661703585a` | `msg_ee271dab982a` | Completed — direct multi-provider foundation, commit `ac70b42`. Receipt: `luna-provider-foundation.md`. |
| worker-runtime-blocker | 2026-09-03-145300-codex | Luna (Codex) | `task_590e9f377e83` | `ctx_4d951266d8d0` | — (none) | **Failed before work** — Codex worker endpoint `unexpected status 404 Not Found` on `https://chatgpt.com/backend-api/codex/responses`. Fenced, retained as identity-unproven. |
| worker-runtime-blocker (Terra fallback) | 2026-09-03-145300-codex | Terra (Codex) | `task_a0b3436b5e17` | `ctx_b329ce4b615b` | — (none) | **Failed before work** — identical Codex endpoint 404. Fenced, retained as identity-unproven. |
| learning-ux | 2026-09-04-150400-codex | Claude (fallback producer) | `task_e92d97d2ed4c` | `ctx_9b146a889afa` | `msg_4f6d06c5c790` | Completed — Quiz/Socratic 힌트/모르겠어요 shortcuts, commit `6a66efb`. Receipt: `claude-learning-ux.md`. |
| performance-proof | 2026-09-04-151300-codex | Claude | `task_1a2ed9c76252` | `ctx_559b90e0ed0a` | `msg_d1222729d6e1` | Completed — deterministic one-child/p95 evidence, commit `f883901`. Receipt: `direct-process-performance.md`. |
| completion-docs (this task) | current | Claude | `task_25500d88e933` | `ctx_55df5ae5ce60` | recorded by the coordinator at send time | This packet + README revisions. Task receipt: `.claude/artifacts/obsidian-ai-tutor-20260903-0001/claude-completion-docs.md`. |

### Luna/Terra failure fallback disclosure (goal-contract stop-rule clause)

Two independent Codex-backed workers — Luna and Terra — each failed
**before any task input executed** on the `worker-runtime-blocker` task,
both with the identical `unexpected status 404 Not Found` response from the
Codex worker backend (`https://chatgpt.com/backend-api/codex/responses`).
Neither reached product work; neither sent `worker_done`. Both dispatches
(`ctx_4d951266d8d0`, `ctx_b329ce4b615b`) were fenced and released as
`identity_unproven` per the receipt-boundary rule — no untracked local
substitute was used to bypass this. Per goal-contract's stop rule ("If
Claude is unavailable ... use Terra for equivalent independent acceptance
evaluation and record the fallback"), the coordinator then dispatched
**Claude** as the production fallback for the two subsequent tasks
(`learning-ux`, `performance-proof`, and this `completion-docs` task); each
Claude dispatch produced a full `worker_done` receipt and passed independent
verification (typecheck/lint/test/build). The Luna/Terra failures are
retained as environment evidence, not silently dropped.

### agy authentication limitation

agy (Antigravity) research/production was **receipt-blocked** for this
entire workstream: an Orca-created `antigravity` terminal reported no
signed-in session and stalled before reaching an authenticated prompt
(`ctx_cd237a675044`, `implementation` task). No later task in this Run
retried agy as a worker. Consequently:

- agy's provider descriptor in `providerRegistry.ts` has **no verified
  package-manager install recipe** and `status: 'manual-setup'` — this was
  a deliberate design constraint (per goal-contract: "script-only agy setup
  is guided manual setup with recheck"), not an accidental gap.
  `tests/unit/core/providers/providerRegistry.test.ts` pins this invariant.
  See §3.
- This packet does **not** claim agy authentication was ever available or
  verified end-to-end in this workstream. Discovery, argv construction, and
  the shared dispatch seam are covered by the deterministic-fixture test in
  §4 (which does not require a real agy login); a real, authenticated agy
  session was never exercised by this workstream's automated evidence.

---

## 8. Residual risk statement

- **Public remote (goal-contract item 5) is not done.** `git remote -v` is
  empty; no push has occurred; there is no remote commit SHA to report.
  This must happen only after acceptance and the required advisor-sol
  review, per `goal-contract.md`'s Constraints and this task's own
  instruction not to claim a remote push.
- **No physical Windows E2E** has been run at any point in this workstream
  (§5) — only automated, cross-platform-branching unit coverage exists.
- **agy has never been authenticated or exercised end-to-end** in this
  workstream (§7) — its setup remains guided-manual, and its native-CLI
  output parsing (`parseNativeProviderLine` for `agy`) is covered only by
  the shared deterministic-fixture dispatch test, not a real agy session.
- **Acceptance evaluation and the advisor-sol review required by
  goal-contract.md have not yet run** against the current state (provider
  foundation + learning UX + performance proof + this documentation). This
  packet is the input to that review, not a substitute for it.
- Dispatch-overhead evidence (§4) is a single-machine, single-OS
  measurement (macOS, Darwin arm64) across all four recorded runs; it is
  not a CI-matrix or multi-host benchmark.
- `manifest.json`'s Copilot-only description (§6) was corrected in a
  follow-up task; see §6 for the resolution and its receipt.
