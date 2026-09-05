---
schema_version: 3
status: IN_PROGRESS
session_id: 2026-09-05-183000-provider-connection-ux
parent_session_id: 2026-09-05-113100-student-ux-and-common-mcp
workstream_id: student-ux-and-common-mcp
tier1_end: 81
plan: /Users/mark/Projects/Tools/obsidian-ai-tutor/goal-contract.md
previous_handoff: /Users/mark/Projects/Tools/obsidian-ai-tutor/.handoff/2026-09-05/113100_obsidian-ai-tutor_student-ux-and-common-mcp_handoff.md
project: obsidian-ai-tutor
task: provider-connection-ux
scope: null
pending_tasks: 3
session_handles:
  - provider: claude
    role: lead
    resumability: resumable
  - provider: codex
    role: advisor-astra (3 rounds) + ai-review peer
    resumability: not_resumable
    evidence: /Users/mark/Projects/Tools/obsidian-ai-tutor/.claude/artifacts/student-ux-and-common-mcp-20260905-1200/advisors/
  - provider: gemini
    role: ai-review peer
    resumability: not_resumable
    evidence: /Users/mark/Projects/Tools/obsidian-ai-tutor/.claude/artifacts/student-ux-and-common-mcp-20260905-1200/reviews/
---

# Session Handoff
Generated: 2026-09-05 18:30
Project: obsidian-ai-tutor | Task: provider-connection-ux | Scope: full session

## Summary
- Done: Shared MCP built, reviewed twice, then removed on Mark's instruction; Context7 dropped from the quiz; the setup wizard made reachable; agy login detection added; three Windows defects fixed; the copilot "새 대화마다 에러" bug found and fixed.
- State: Green — typecheck, lint, 1005 tests (3 consecutive clean runs), build. Deployed to the live vault and reloaded. Nothing committed this session.
- Next: Move the provider login state out of the chat popover and into Settings. Design is settled and evidenced; Mark has NOT yet said yes.
- Decisions: "Connected" means a credential exists, not that it is currently valid — this is exactly what Smart Composer does, and it costs nothing.

## Decision Changes
- [DEC-10] retired: Shared MCP removed entirely. It reached only claude and copilot, so it was never "shared"; its only consumer was the quiz, and that dependency was dropped too.
- [DEC-11] new: Quiz 상 difficulty no longer mentions @context7. Web search remains and works on all four CLIs; `enableExternalTools` only ever toggled web search anyway.
- [DEC-12] changed: agy CAN be asked about login. The old claim rested on trying `agy auth status` alone; `agy models` asks the account.
- [DEC-13] new: copilot genuinely cannot be asked — confirmed three ways, including copilot scanning its own binary.
- [DEC-14] new (PENDING MARK'S YES): login state moves from the chat popover to Settings as `연결됨 / 연결 필요`, judged by credential presence.

## Open Issues
- **The next step is not approved yet.** Mark's last words were "이해가 안 간다 / 너무 복잡하다", then he asked for this handoff and plan mode. Do not start building DEC-14 until he approves the plan.
- **Nothing is committed** (18 modified + 6 new). `main.js` / `styles.css` are tracked build artifacts, dirty from deployment, kept out of every commit — Mark has not ruled on them. `.handoff/LATEST.md` and `CLAUDE.md` belong to another session; never commit them.
- Dead key `sharedMcpServers: ''` left in `/Users/mark/Documents/Obsidian/.copilot/settings.json` — harmless residue, removal unanswered.
- Windows is unverified throughout; no Windows machine was available.

## Key Files
- @/Users/mark/Projects/Tools/obsidian-ai-tutor/src/core/setup/providerReadiness.ts — probes, labels, observed outcomes
- @/Users/mark/Projects/Tools/obsidian-ai-tutor/src/core/agent/CopilotBridgeService.ts — spawn paths, session flags, outcome recording
- @/Users/mark/Projects/Tools/obsidian-ai-tutor/src/features/chat/ObsidianCopilotView.ts — the provider popover that DEC-14 empties
- @/Users/mark/Projects/Tools/obsidian-ai-tutor/src/features/settings/ObsidianCopilotSettings.ts — where the connection rows go
- @/Users/mark/Projects/Tools/obsidian-ai-tutor/.claude/artifacts/student-ux-and-common-mcp-20260905-1200/ — scratchpad, three advisor rounds, review reports

## Next Steps
1. Present the DEC-14 plan and get an explicit yes. Mark twice called the explanation too complex; lead with what changes on his screen.
2. On approval: Settings grows one row per provider (`연결됨` / `연결 필요` + a button opening the existing SetupWizardModal for that provider); the chat popover stops probing and shows provider + model/effort only.
3. Ask about committing — 24 files are uncommitted.

- Avoid (dead ends): do not reintroduce shared MCP; do not use `gh auth status` or `/user` to judge copilot login; do not spend credits to fill a badge.
- Provenance: 3 advisor records and 4 review reports in Tier 2 Provenance Index.

## Resume Command
```bash
# Step 1 — Verify state (run this first):
cd /Users/mark/Projects/Tools/obsidian-ai-tutor
npm run typecheck && npm run lint && npm test -- --runInBand
# Expected: clean typecheck, clean lint, 1005 passing in 63 suites

# Step 2 — Load context (read the handoff IN FULL, not a Tier-1 slice):
# Plan:             @/Users/mark/Projects/Tools/obsidian-ai-tutor/goal-contract.md
# Previous Handoff: @/Users/mark/Projects/Tools/obsidian-ai-tutor/.handoff/2026-09-05/113100_obsidian-ai-tutor_student-ux-and-common-mcp_handoff.md
# Current Handoff:  @/Users/mark/Projects/Tools/obsidian-ai-tutor/.handoff/2026-09-05/183000_obsidian-ai-tutor_provider-connection-ux_handoff.md

# Step 3 — Execute:
# Put the DEC-14 plan to Mark in plain language and wait for an explicit yes before editing anything.
```

<!-- === DETAIL === -->

## User's Request (DETAILED)

Mark wants the plugin light and usable by beginners: simple settings visible,
complex ones under Advanced, and independent review before anything is called
ready. He tests in the live vault and reports what he sees; almost every
correction he made this session was right.

Three of his instructions drove the whole session:

1. The shared-MCP scope question (vault-only vs writing each CLI's global
   config). He chose vault-only, then asked whether a shared `.mcp.json` would
   clash with a student's existing setup, then whether it would even run on a
   student's Windows or Mac machine. Those questions dismantled the feature.
2. "직접 타이핑을 하도록 해서 공통으로 만들 수 있다면 용인할 수 있다 (advanced 기능)" —
   he accepted a raw JSON textarea under Advanced. Later, on learning the feature
   reached only two of four CLIs, he said "그럼 공용 mcp가 아니자나" and then
   "좋아. 빼자". Both the feature and the quiz's Context7 dependency were removed.
3. On the copilot badge he pushed back repeatedly: "copilot은 아직도 확인 불가야",
   "로그인됨 이렇게 확인할 방법 없나", "gh auth status나 /user에서 출력이 있으면
   로그인됨 아니야", and finally "골치 아프네. 더 좋은 방안 생각해봐". His own
   proposal — verify in Settings, let the chat show only what Settings confirmed —
   is what DEC-14 records.

## Problem Context (WHY)

The plugin drives four external CLIs as child processes. Three can be asked
whether they are logged in; copilot cannot. The chat popover therefore showed
`확인 불가` for copilot, which Mark read as an error on his own working default
provider. Several rounds went into filling that one badge, and the design kept
changing under him — which is itself why this handoff exists.

Separately, the shared-MCP feature was built on an assumption that did not
survive measurement: that a config the plugin writes would reach whichever CLI
a student had selected.

## Goal (WHAT)

A student installs the plugin and either it works or it tells them what to do,
without reading a status word they have to interpret. Success: setup and login
live in one place (Settings); the chat is for choosing a provider and model.

## Decision Deltas

| Decision ID | Status | Previous | Current | Reason | Source Ref |
|---|---|---|---|---|---|
| DEC-10 | retired | Shared MCP shipped under Advanced | Removed entirely | Reached 2 of 4 CLIs; its only consumer (quiz Context7) was dropped | Mark: "좋아. 빼자" |
| DEC-11 | new | 상 quiz said "@context7 or web search" | Web search only | Context7 reached only 2 of 4 CLIs, so quiz quality varied by provider | `src/core/learning/quiz.ts` |
| DEC-12 | changed | agy has no auth surface | `agy models` reports login | Old claim tested only `agy auth status` | `advisors/` + `tests/unit/core/setup/agyReadiness.test.ts` |
| DEC-13 | new | — | copilot cannot be asked, period | Verified by empty-HOME comparison, by copilot's own binary scan, and by `copilot help commands` | `advisors/astra3-packet.md` |
| DEC-14 | new, PENDING | Badge in the chat popover | Connection state in Settings | Mark's proposal; advisor rounds 2 and 3 both rejected paying credits or claiming unconfirmed readiness | `advisors/astra3-remove-badge.md` |

## Solution (HOW)

- Before: the chat popover spawned three CLIs on every open to fill a badge, and
  copilot — which cannot be asked — showed `확인 불가`.
- After (DEC-14, not yet built): Settings owns setup. One row per provider with
  `연결됨` / `연결 필요` and a button opening the existing SetupWizardModal for
  that provider. The chat popover spawns nothing and shows provider + model only.
- Why changed: the badge answered a question students never ask. The only moment
  login state matters is when a request fails, and the bridge already classifies
  copilot's auth failure specifically.

## Key Files (Full)
- @/Users/mark/Projects/Tools/obsidian-ai-tutor/src/core/setup/providerReadiness.ts — added `AGY_MODELS_PROBE`, `resolveProbeCommand`, `providerSetupEntry`, `ObservedOutcome` + `observedOutcomeLabel` + `recordProviderOutcome`; probe spawn now uses the Windows shim, sets `windowsHide`, and cannot reject
- @/Users/mark/Projects/Tools/obsidian-ai-tutor/src/core/agent/CopilotBridgeService.ts — `sessionArgs()` (the `--session-id` fix), outcome recording on both spawn paths, `windowsHide`, shared-MCP wiring removed
- @/Users/mark/Projects/Tools/obsidian-ai-tutor/src/core/agent/copilotOutcome.ts — NEW; the single place that recognises copilot's auth-failure string, plus `copilotRequestOutcome`
- @/Users/mark/Projects/Tools/obsidian-ai-tutor/src/core/providers/providerRegistry.ts — Windows resolution order is now `.exe`, `.cmd`, extensionless
- @/Users/mark/Projects/Tools/obsidian-ai-tutor/src/features/chat/ObsidianCopilotView.ts — popover opens the wizard for an unusable provider and renders the observed-outcome badge; this is what DEC-14 strips back
- @/Users/mark/Projects/Tools/obsidian-ai-tutor/src/features/settings/ObsidianCopilotSettings.ts — setup button is always enabled and opens the wizard with the selected provider; shared-MCP block removed
- @/Users/mark/Projects/Tools/obsidian-ai-tutor/src/ui/modals/SetupWizardModal.ts — accepts an optional target provider and jumps straight to it
- @/Users/mark/Projects/Tools/obsidian-ai-tutor/src/core/storage/StorageService.ts — `PluginState.providerOutcomes` (machine state in `data.json`, deliberately NOT the vault-shared settings file)
- @/Users/mark/Projects/Tools/obsidian-ai-tutor/tests/unit/core/setup/providerLogin.test.ts — replaced a flat 400ms wait with a poll; this was the intermittent suite failure

## Evidence Index
- Plan (canonical): `/Users/mark/Projects/Tools/obsidian-ai-tutor/goal-contract.md` — the workstream contract
- Previous handoff: `/Users/mark/Projects/Tools/obsidian-ai-tutor/.handoff/2026-09-05/113100_obsidian-ai-tutor_student-ux-and-common-mcp_handoff.md`
- Scratchpad (task evidence): `/Users/mark/Projects/Tools/obsidian-ai-tutor/.claude/artifacts/student-ux-and-common-mcp-20260905-1200/scratchpad.md` — 16 rows, R1–R16; every CLI capability claim in this handoff traces to one
- Advisor rounds: `/Users/mark/Projects/Tools/obsidian-ai-tutor/.claude/artifacts/student-ux-and-common-mcp-20260905-1200/advisors/` — three advisor-astra packets and verdicts, copied out of the volatile session scratchpad
- Review reports: `/Users/mark/Projects/Tools/obsidian-ai-tutor/.claude/artifacts/student-ux-and-common-mcp-20260905-1200/reviews/` — the final removal round and the badge round, both peers
- Session working directory: `/private/tmp/claude-501/-Users-mark-Projects-Tools-obsidian-ai-tutor/f3cad1d6-ac8a-4e00-84a7-945ed818c9ad/scratchpad/` — CLI probe transcripts, the obsidian-copilot source excerpts, and the `/tmp/ai-review-*` directories. **not preserved**: raw CLI transcripts and peer JSONL were left in place. They hold the byte-level output behind the capability claims; the claims themselves are all restated in the scratchpad rows, which were copied.
- advisor-fable transcript: `/private/tmp/claude-501/-Users-mark-Projects-Tools-obsidian-ai-tutor/f3cad1d6-ac8a-4e00-84a7-945ed818c9ad/tasks/a7772a70ade2d08c9.output` — **not preserved**: it is the full subagent JSONL and reading it overflows context. Its verdict is restated in Critical Context below.

## Provenance Index
- codex (gpt-6-astra, medium, read-only) advisor-astra ×3 — resumability: not_resumable; evidence: `/Users/mark/Projects/Tools/obsidian-ai-tutor/.claude/artifacts/student-ux-and-common-mcp-20260905-1200/advisors/`
- claude advisor-fable ×1 — resumability: not_resumable; evidence: verdict restated in Critical Context, transcript not preserved
- codex + gemini ai-review peers ×6 rounds — resumability: not_resumable; evidence: `/Users/mark/Projects/Tools/obsidian-ai-tutor/.claude/artifacts/student-ux-and-common-mcp-20260905-1200/reviews/`
- copilot (session 6592a0c0-2d65-462e-9bab-699a71d02152) — resumability: resumable; asked directly, at Mark's instruction, whether it has a non-interactive auth-status command; it scanned its own binary and answered no

## Progress (Full Timeline)
- [x] Shared MCP: parse/validate/warn/deliver, two review rounds 🆕
- [x] Shared MCP removed entirely, three review rounds to convergence 🆕
- [x] Context7 removed from the quiz's 상 difficulty 🆕
- [x] Setup wizard made reachable from settings and the provider popover 🆕
- [x] agy login detection via `agy models` 🆕
- [x] Windows: `.exe` before `.cmd`, `windowsHide`, probe uses the shim, probe cannot reject 🆕
- [x] copilot `--session-id` fix — new chats no longer fail 🆕
- [x] Flaky `providerLogin` test fixed; 1005 tests pass three runs running 🆕
- [~] copilot connection state — DONE: last-request outcome badge shipped. REMAINING: DEC-14 moves it to Settings, pending approval
- [ ] Commit. Nothing from this session is committed.

## Critical Context

**The next session's first job is a conversation, not code.** Mark said "이해가
안 간다" and "너무 복잡하다" about the last two explanations. Lead with what
changes on his screen: the login state moves out of the chat menu into Settings;
the chat menu becomes provider + model only. Everything about credentials,
keychains and credits is the reason, not the pitch.

**Why "연결됨" is honest without spending anything.** Smart Composer's own
`PlanConnectionsSection.tsx` computes `isClaudeConnected = !!provider?.oauth?.accessToken`
— it checks that a stored token exists and never validates it, so its badge does
NOT go disabled when a login expires. Mark asked exactly this. Matching that bar
costs nothing: claude/codex/agy have free probes that do better (they check
validity), and copilot's stored credential is visible via
`security find-generic-password -s copilot-cli`, which returns silently, needs no
permission prompt, and correctly returns nothing for a nonexistent service.
Windows has a different credential store and is unverified — fall back to the
last-request outcome there.

**advisor-fable's plan refinement (transcript not preserved).** It returned KEEP
on the badge plan with four corrections, all applied: persist to `data.json`
machine state with a timestamp and no decay; keep `ObservedOutcome` a separate
type from `LoginState` so a future edit to one enum cannot weaken the "never
claim unconfirmed readiness" invariant; leave `isReadyState` untouched; and — the
correction to my own draft — there are TWO spawn paths, both needing ok/failed,
with `auth-failed` allowed only on the copilot path.

**advisor-astra ruled three times and reversed itself once.** Round 1 kept shared
MCP; Mark overrode it and removed the feature. Round 2 chose historical wording
(`최근 요청 성공`, never `로그인됨`) and rejected paid verification at "~1.5
credits". Round 3 was told the measured cost is 0.35 and that the keychain check
does not prompt — it accepted both corrections and still recommended removing the
badge, because neither a stored credential nor a past success establishes current
login. Read `advisors/astra3-remove-badge.md` before reopening this.

**Never claim a CLI cannot do something without running it.** This cost real time
twice this session. `agy` was recorded as having "no auth surface whatsoever" on
the strength of `agy auth status` alone; `agy models` answers. And I told Mark
`/user` produces no output, having only tested it headlessly — it is a real
interactive command ("Manage GitHub user list"), just not a login check and not
reachable without a TTY.

**Peer reviews caught two defects I introduced.** Windows resolution briefly put
the extensionless npm bash script ahead of the `.cmd` shim, which would have
broken every npm-installed CLI on Windows, and my own test masked it by never
placing an extensionless file beside the shim. And outcome recording initially
fired only when a non-zero exit also wrote to stderr, so a silently-dying CLI left
a stale success badge — the exact thing the feature exists to prevent. Both fixed
with tests; do not regress them.

## Dead Ends (Negative Memory)

- Tried shared MCP as a vault `.mcp.json` → copilot does not read a workspace
  `.mcp.json` or `.github/mcp.json` even inside a git repo, despite documenting
  both → instead the config was passed inline as a CLI argument; then the whole
  feature was removed.
- Tried covering all four CLIs with shared MCP → codex registers a server via
  `-c mcp_servers.X.url=` and shows it enabled, but `codex exec` exposes no MCP
  tools at all, not even ones already configured globally; agy has no spawn-time
  flag → only claude and copilot ever worked. Do not retry without new evidence.
- Tried `gh auth status` as a copilot login check → different credential entirely
  (`gh:github.com` vs `copilot-cli` keychain entries; the user's gh token has no
  Copilot scope yet copilot works) and copilot does not require gh, so every
  student without gh would read as logged out.
- Tried `copilot -p "/user"` and `/env` → not client-side commands headlessly;
  they are sent to the model and burn credits. Tried driving the interactive TUI
  through a pseudo-terminal twice → it does not render.
- Tried a fixed 400ms wait for a child process in `providerLogin.test.ts` → enough
  alone, not enough under full-suite load; it was the intermittent failure, and I
  first blamed the wrong file → replaced with a poll.
- `nohup ... &` inside the Bash tool dies when the call returns, and sourcing
  `ai-review-run.sh` from zsh fails ("requires bash", exit 127) → run it as
  `bash -lc "source ... && run_ai_review_lifecycle ..."` with the harness's own
  background mode; a foreground call also exceeds the 10-minute cap and SIGTERMs
  the second peer mid-run.

## Reproduction / Verification

```bash
cd /Users/mark/Projects/Tools/obsidian-ai-tutor
npm run typecheck && npm run lint && npm test -- --runInBand && npm run build
# Expected: clean, clean, 1005 passing in 63 suites, build OK

# Deploy + reload (approved; do this after any change — Mark tests live):
npm run build && cp main.js styles.css "/Users/mark/Documents/Obsidian/.obsidian/plugins/obsidian-ai-tutor/"
open "obsidian://adv-uri?commandid=app%3Areload"

# The copilot session fix, verified against the real CLI:
U=$(python3 -c "import uuid;print(uuid.uuid4())")
copilot --resume="$U" -p "hi"      # fails: No session, task, or name matched
copilot --session-id="$U" -p "hi"  # succeeds, and a second call with the same id recalls context
```
