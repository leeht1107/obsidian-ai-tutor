---
schema_version: 3
status: IN_PROGRESS
session_id: 2026-09-05-213000-provider-settings
parent_session_id: 2026-09-05-183000-provider-connection-ux
workstream_id: student-ux-and-common-mcp
tier1_end: 82
plan: /Users/mark/Projects/Tools/obsidian-ai-tutor/goal-contract.md
previous_handoff: /Users/mark/Projects/Tools/obsidian-ai-tutor/.handoff/2026-09-05/183000_obsidian-ai-tutor_provider-connection-ux_handoff.md
project: obsidian-ai-tutor
task: provider-settings
scope: null
pending_tasks: 4
session_handles:
  - provider: claude
    role: lead
    resumability: resumable
  - provider: codex
    role: ai-review peer (3 runs, gpt-5.6-terra)
    resumability: not_resumable
    evidence: /Users/mark/Projects/Tools/obsidian-ai-tutor/.claude/artifacts/provider-settings-20260905-2100/reviews/
  - provider: gemini
    role: ai-review peer (3 runs, gemini-3.8-flash medium+high)
    resumability: not_resumable
    evidence: /Users/mark/Projects/Tools/obsidian-ai-tutor/.claude/artifacts/provider-settings-20260905-2100/reviews/
---

# Session Handoff
Generated: 2026-09-05 21:30
Project: obsidian-ai-tutor | Task: provider-settings | Scope: full session

## Summary
- Done: Login checking moved from the chat popover to Settings; three `/ai-review` rounds run and every REQUIRED finding fixed; the default-model row, the CLI-path row and skill installation all made provider-aware.
- State: Green — typecheck, lint, 69 suites / 1033 tests, build, deployed to the live vault. Nothing committed this session; 19 source/test files changed plus 6 new files.
- Next: Mark's open call on cutting the settings surface (see Open Issues), then commit the session with named paths per Critical Gates §6.
- Decisions: The chat popover spawns no CLI at all; Settings owns every check and every file write.

## Decision Changes
- [DEC-15] new: `ProviderConnection {state, at}` replaces `ObservedOutcome`. Settings decides it; a request that fails on **authentication** downgrades it; any other failure changes nothing.
- [DEC-16] new: copilot is judged by a stored credential (`security find-generic-password -s copilot-cli`, no `-w`). Windows returns `unknown` without spawning.
- [DEC-17] retired: "copilot cannot be asked, so the badge shows the last request outcome." The badge shows a connection state, and 확인 안 됨 is no longer rendered in chat.
- [DEC-18] new: skills install into the folder the SELECTED provider reads — copilot `.copilot/skills`, claude `.claude/skills`, agy `.agents/skills` (all in-vault), codex `$CODEX_HOME/skills` (machine-wide).
- [DEC-19] new: automatic installs never leave the vault and never overwrite a file this plugin did not write (ownership marker).

## Open Issues
- **Mark's decision, still open**: cut the settings surface. Both review peers independently recommended showing only the SELECTED provider's connection row in Quick Start (the other three collapsed), and deleting rows that do nothing. He was asked twice and moved on both times without answering; the second time he redirected to per-provider skills instead.
- **`Custom system prompt` silently does nothing for claude/codex/agy** — `buildNativeProviderCommand` never forwards it. Found by the gemini peer, not yet fixed.
- **`GitHub token` and `Custom variables`** only ever set Copilot environment variables; they are inert for the other three providers.
- **Windows is unverified on hardware.** No machine available. copilot connection reads `확인 안 됨` there until a request succeeds.
- The two skills already written into `<vault>/.agents/skills/` were written before the ownership marker existed, so the plugin now treats them as Mark's own: Remove will not delete them.

## Key Files
- @/Users/mark/Projects/Tools/obsidian-ai-tutor/src/core/setup/providerConnection.ts — new; connection state, labels, credential check
- @/Users/mark/Projects/Tools/obsidian-ai-tutor/src/features/settings/ObsidianCopilotSettings.ts — provider rows, model row, CLI path, skills section
- @/Users/mark/Projects/Tools/obsidian-ai-tutor/src/features/skills/ObsidianSkillsInstaller.ts — per-provider roots, ownership-guarded writes
- @/Users/mark/Projects/Tools/obsidian-ai-tutor/src/features/chat/ObsidianCopilotView.ts — popover now reads stored state only
- @/Users/mark/Projects/Tools/obsidian-ai-tutor/src/core/storage/StorageService.ts — serialised `updateState`, `providerConnections`

## Next Steps
1. Put the settings-cut decision to Mark as one gate (see Open Issues), then implement whichever shape he picks.
2. Fix or delete `Custom system prompt` for native providers — a settings row that silently does nothing is the exact class of bug this session kept finding.
3. Propose the commit: `git commit <named paths> -m "..."`, split by concern (connection move / provider-aware settings / skills). Nothing may be swept in — `main.js` and `styles.css` are build artifacts also modified.
4. Re-run `/ai-review` after the settings cut, per Mark's standing instruction.

- Avoid (dead ends): do not claim a CLI lacks a capability from `--help` alone — codex was wrongly declared skill-less that way; probe the binary and its config dir. Do not put a provider-specific early `return` inside `display()`; it silently truncated the whole settings screen.
- Provenance: 6 peer records (3 rounds × 2 providers) in Tier 2 Provenance Index.

## Resume Command
```
# Step 1 — Verify state (run this first):
cd /Users/mark/Projects/Tools/obsidian-ai-tutor && npm run typecheck && npm run lint && npm test -- --runInBand 2>&1 | tail -5
# Expected: typecheck and lint clean; "Test Suites: 69 passed", "Tests: 1033 passed"

# Step 2 — Load context (read the handoff IN FULL, not a Tier-1 slice):
# Plan:             @/Users/mark/Projects/Tools/obsidian-ai-tutor/goal-contract.md
# Previous Handoff: @/Users/mark/Projects/Tools/obsidian-ai-tutor/.handoff/2026-09-05/183000_obsidian-ai-tutor_provider-connection-ux_handoff.md
# Current Handoff:  @/Users/mark/Projects/Tools/obsidian-ai-tutor/.handoff/2026-09-05/213000_obsidian-ai-tutor_provider-settings_handoff.md

# Step 3 — Execute:
Ask Mark the one open gate — cut Quick Start to the selected provider's row and delete the inert rows, or keep the current shape — then implement his answer.
```

<!-- === DETAIL === -->

## User's Request (DETAILED)
Mark opened with an approved plan: move provider login checking out of the chat popover into Settings, because the popover spawned three CLIs on every open and copilot — his default — could not answer at all and rendered `확인 불가`, which he read as an error. Through the session he added, in his words:

- "윈도우도 실험할 수는 없지만 체크한 거 맞아?" — asking whether the Windows paths were actually verified.
- "설정에 ai provider 설정하면 default model도 provider에 따라 모델이 변경되어야 하는거 아냐? 지금 copilot 모델만 보이는데? 그리고 이 UX가 최선인가?"
- "설정에 대해서 심도 있는 /ai-review를 수행한다."
- "확인 안 됨은 이제 필요 없고 (color icon은 안되나)" — drop the unactionable badge text; colour the provider marks.
- "copilot 잔재가 너무 많은데, obsidian-markdown 같은 필수 스킬은 넣어주나 (default로)"
- "provider 별로 skill (or mcp)도 간편 설치할 수 있도록 할 수 있나?" — answered his own follow-up with "자동 설치면 좋은게 provider별로 자동설치가 바로 되냐고."
- "codex가 스킬이 왜 없어. 거짓말 하지마." — a direct correction of a wrong claim of mine.
- "copilot cli path는 왜 쓴거야?" and "skills & obsidian context에는 아무것도 안 열리는데. 위에서 뭘 한거야?"

Standing constraints: he decided MCP is retired and confirmed it again this session; reviews run until they pass; students are the audience.

## Problem Context (WHY)
The plugin began as Copilot-only and the leftovers are load-bearing in the wrong places. The popover asked every CLI whether it was logged in on each open. copilot has no status command, so it always answered `확인 불가`. Settings offered a Copilot-only model list and a Copilot-only CLI path regardless of the selected provider, and the bundled Obsidian skills were written to `.copilot/skills` — a folder the other three CLIs never read, so the feature reported success and did nothing.

## Goal (WHAT)
Settings owns installation, login and connection checking for all four providers; the chat toolbar only picks a provider and a model. No credits are spent. Success: the popover spawns no process, every settings row acts on the selected provider, and each review round's REQUIRED findings are fixed.

## Decision Deltas
| Decision ID | Status | Previous | Current | Reason | Source Ref |
|-------------|--------|----------|---------|--------|------------|
| DEC-14 | resolved | login state moves to Settings (pending Mark's yes) | implemented | Mark approved the plan at session start | previous handoff |
| DEC-15 | new | `ObservedOutcome` per request | `ProviderConnection {state, at}` | one concept, not two; non-auth failures must not read as logout | `src/core/setup/providerConnection.ts` |
| DEC-16 | new | copilot unaskable → `확인 불가` | credential existence via keychain | `copilot login --help`: token is stored in the system credential store | `checkCopilotCredential` |
| DEC-17 | retired | badge shows last request outcome | badge shows connection state | Mark: the wording read as an error | `connectionLabel` |
| DEC-18 | new | skills → `.copilot/skills` for everyone | per-provider skills root | each CLI reads its own folder; agy and codex print theirs | `providerSkillsRoot` |
| DEC-19 | new | install writes unconditionally | ownership marker + no auto-write outside the vault | both peers: BLOCKER | `writeBundledSkill` |

## Solution (HOW)
- Before: the popover probed CLIs on open; settings showed one Copilot-shaped row per concern; skills landed in `.copilot/skills`.
- After: settings checks all four providers on open and stores `providerConnections` in `data.json`; the popover renders that and spawns nothing; the model row, the CLI-path row and the skills section all follow `selectedProvider`; the bundled skills install once per provider, never outside the vault automatically, never over a file the plugin did not write.
- Why changed: the badge lied for copilot, the settings rows did nothing for three of four providers, and the first version of the skills feature could have destroyed hand-written skills in Mark's own vault.

## Key Files (Full)
- @/Users/mark/Projects/Tools/obsidian-ai-tutor/src/core/setup/providerConnection.ts — NEW. `ConnectionState`, `connectionLabel`, `applyRequestOutcome`, `resolveCheckedState`, `checkCopilotCredential`, `checkProviderConnection`.
- @/Users/mark/Projects/Tools/obsidian-ai-tutor/src/core/setup/providerReadiness.ts — spawn core extracted as `runProbeProcess`; label/entry helpers and the outcome API removed.
- @/Users/mark/Projects/Tools/obsidian-ai-tutor/src/core/storage/StorageService.ts — `providerConnections` and `skillsAutoInstalled` in `PluginState`; `updateState` serialised against concurrent read-modify-write.
- @/Users/mark/Projects/Tools/obsidian-ai-tutor/src/main.ts — `setProviderConnection`, `persistProviderConnections`, `installBundledSkillsOnce`; `saveSettings` no longer erases connections.
- @/Users/mark/Projects/Tools/obsidian-ai-tutor/src/features/settings/ObsidianCopilotSettings.ts — four provider rows, provider-aware model row, provider-aware CLI path, `renderSkillsSection`, per-render `AbortController`.
- @/Users/mark/Projects/Tools/obsidian-ai-tutor/src/features/skills/ObsidianSkillsInstaller.ts — `providerSkillsRoot`, `providerGlobalSkillsRoot`, `isMachineWideSkillsRoot`, `writeBundledSkill`, `isPluginOwnedSkill`, `shouldInstallBundledSkills`.
- @/Users/mark/Projects/Tools/obsidian-ai-tutor/src/features/chat/ObsidianCopilotView.ts — popover reads stored state; status text only when actionable; per-provider mark classes.
- @/Users/mark/Projects/Tools/obsidian-ai-tutor/src/ui/modals/SetupWizardModal.ts — `readConnectionState` replaces the login probe, so copilot reaches 로그인 or 준비 완료 instead of "확인할 수 없습니다".
- @/Users/mark/Projects/Tools/obsidian-ai-tutor/src/core/providers/providerRegistry.ts — `defaultModelSource`, `storeDefaultModel`, tilde expansion in `findProviderCliPath`.

## Evidence Index
- Plan (canonical): @/Users/mark/Projects/Tools/obsidian-ai-tutor/goal-contract.md — the release contract this work serves.
- Previous handoff: @/Users/mark/Projects/Tools/obsidian-ai-tutor/.handoff/2026-09-05/183000_obsidian-ai-tutor_provider-connection-ux_handoff.md
- Scratchpad (task evidence): @/Users/mark/Projects/Tools/obsidian-ai-tutor/.claude/artifacts/provider-settings-20260905-2100/scratchpad.md — five rows, written at handoff time rather than as the events happened; R1 records that gap itself.
- Reviews (copied out of `/tmp`, which is volatile): @/Users/mark/Projects/Tools/obsidian-ai-tutor/.claude/artifacts/provider-settings-20260905-2100/reviews/ — three rounds: `connection-move/`, `settings-deep-1/`, `settings-deep-2/`, each with the brief and both peer reports.
- CLI capability evidence (previous session, still current): @/Users/mark/Projects/Tools/obsidian-ai-tutor/.claude/artifacts/provider-model-ux-20260904/install-login-evidence.md — the captured install/login output for all four CLIs.

## Provenance Index
- codex ai-review peer (gpt-5.6-terra, medium then high) — resumability: not_resumable; evidence: @/Users/mark/Projects/Tools/obsidian-ai-tutor/.claude/artifacts/provider-settings-20260905-2100/reviews/
- gemini ai-review peer (gemini-3.8-flash, medium then high) — resumability: not_resumable; evidence: @/Users/mark/Projects/Tools/obsidian-ai-tutor/.claude/artifacts/provider-settings-20260905-2100/reviews/

## Progress (Full Timeline)
- [x] Move login checking from the chat popover into Settings; `ProviderConnection` replaces `ObservedOutcome` 🆕
- [x] `/ai-review` round 1 (connection move) and its two REQUIRED findings: serialise `updateState`; never let an inconclusive check overwrite a proven connection 🆕
- [x] Setup wizard asks for a connection, so copilot reaches the login flow it can actually drive 🆕
- [x] Provider-aware default model — bundled catalog for copilot, static list for claude, on-click CLI listing for codex and agy 🆕
- [x] Tilde expansion in `findProviderCliPath`; title-generation model limited to copilot 🆕
- [x] Chat badge shows only actionable states; provider marks carry brand colours 🆕
- [x] Per-provider skills: roots, auto-install once per provider, settings actions all follow the selection 🆕
- [x] `/ai-review` rounds 2 and 3 (settings, deep) and their BLOCKER: no automatic writes outside the vault, no overwriting files the plugin did not write 🆕
- [x] Socratic banner emoji clipping 🆕
- [~] Settings surface reduction — proposed twice and evidenced by both peers; Mark has not chosen
- [ ] `Custom system prompt` for native providers: forward it or delete the row
- [ ] Commit the session with named paths (§6)

## Critical Context
- **Nothing is committed.** `git status` shows 19 modified source/test files plus new files, on `main`, HEAD `975179b`. `main.js` and `styles.css` are tracked build artifacts and are also dirty — never sweep them in with `-a`.
- The vault the work is deployed to is `/Users/mark/Documents/Obsidian`; the deploy step is `npm run build && cp main.js styles.css "<vault>/.obsidian/plugins/obsidian-ai-tutor/"` followed by an Obsidian reload URI.
- Mark's selected provider changed during the session (agy at one point, codex in the last screenshot). Settings rows are per-provider, so a screenshot only shows the row set for whatever was selected then.
- `settings.model` is copilot's model; every other provider reads `settings.providerModels[id]`. `settings.copilotCliPath` is legacy and is kept in sync only for copilot.
- The keychain check deliberately omits `-w`: reading the secret would raise the macOS permission prompt.
- Review peers are launched through `~/.claude/skills/ai-review/scripts/ai-review-run.sh`; the deep profile requires `AI_REVIEW_PROFILE=deep AI_REVIEW_TIER_REASON=explicit-user-request` or preflight fails.

## Dead Ends (Negative Memory)
- Tried declaring a capability absent from `--help` output → failed: codex was called skill-less, but `~/.codex/skills/` exists and the binary embeds `$CODEX_HOME/skills/<skill-name>` → instead: probe the binary with `strings` and look for the config directory before asserting absence.
- Tried guarding a provider-specific section with an early `return` inside `display()` → failed: it removed Chat Behavior and Advanced from the screen entirely → instead: give the section its own method and return from there.
- Tried installing bundled skills unconditionally into the selected provider's folder → failed: both peers called it a BLOCKER, since it wrote outside the vault for codex and could overwrite hand-written skills → instead: ownership marker plus `isMachineWideSkillsRoot` guard.
- Tried replacing a multi-function block in a 640-line file with one regex → failed: it deleted three unrelated helpers and the repair duplicated 1500 lines → instead: `git checkout` that file and re-apply the edits anchored one function at a time.

## Reproduction / Verification
```bash
cd /Users/mark/Projects/Tools/obsidian-ai-tutor
npm run typecheck && npm run lint && npm test -- --runInBand
# Expected: 69 suites / 1033 tests passing

npm run build && cp main.js styles.css "/Users/mark/Documents/Obsidian/.obsidian/plugins/obsidian-ai-tutor/"
open "obsidian://adv-uri?commandid=app%3Areload"
```
Tests that pin this session's rules: `tests/unit/core/setup/providerConnection.test.ts`,
`tests/unit/core/storage/pluginState.test.ts`, `tests/unit/features/skills/skillOwnership.test.ts`,
`tests/unit/features/skills/providerSkillsRoot.test.ts`,
`tests/unit/core/providers/defaultModelChoice.test.ts`,
`tests/unit/core/providers/cliPathExpansion.test.ts`,
`tests/unit/features/chat/providerPopover.test.ts`.
