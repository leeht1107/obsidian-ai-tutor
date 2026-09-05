---
schema_version: 3
status: IN_PROGRESS
session_id: 2026-09-04-204900-provider-model-ux
parent_session_id: 2026-09-04-194700-brat-0.1.7
workstream_id: provider-model-ux
plan: /Users/mark/Projects/Tools/obsidian-ai-tutor/goal-contract.md
previous_handoff: /Users/mark/Projects/Tools/obsidian-ai-tutor/.handoff/2026-09-04/194700_obsidian-ai-tutor_brat-0.1.7_handoff.md
project: obsidian-ai-tutor
task: provider-model-ux
scope: compact provider/model/effort controls for direct CLI providers
pending_tasks: 1
session_handles:
  - provider: claude
    role: lead
    resumability: resumable
    evidence: /Users/mark/.local/state/claude/relay/relay-6aH3P9
tier1_end: 57
---

# Session Handoff
Generated: 2026-09-04 20:49
Project: obsidian-ai-tutor | Task: provider-model-ux | Scope: compact provider/model/effort controls for direct CLI providers
## Summary
- Done: Version `0.1.7` shipped provider-specific model overrides to BRAT.
- State: Mark's current in-Obsidian screenshot shows a left-anchored popup but an unsatisfactory provider/model layout; Claude has a bare `opus` selector, no effort control, and Codex exposes stale models only.
- Next: Claude Opus high must make the smallest tested UI-and-command-path correction so provider, real supported model, and verified effort choices are clear and left-aligned.
- Decisions: Keep the direct local-CLI wrapper; no daemon, proxy, shared runtime, polling, remote catalog, or student-machine hardcoding.
## Decision Changes
- [DEC-1] changed: Replace generic native-model presentation with provider-aware, actually dispatchable model controls.
- [DEC-2] new: Surface an effort selector only where the installed CLI has a verified command/config capability; never present an inert choice.
- [DEC-3] changed: Preserve the existing useful toolbar controls while compacting and left-aligning provider popover and primary controls.
## Open Issues
- Verify installed model/effort capability before editing; do not release or change BRAT version without a new Mark instruction.
## Key Files
- @/Users/mark/Projects/Tools/obsidian-ai-tutor/src/core/providers/providerRegistry.ts — direct provider command construction
- @/Users/mark/Projects/Tools/obsidian-ai-tutor/src/components/InputToolbar.ts — toolbar and provider picker UI
- @/Users/mark/Projects/Tools/obsidian-ai-tutor/.claude/artifacts/provider-model-ux-20260904/live-feedback.png — preserved current visual feedback
## Next Steps
1. Read this handoff in full, inspect the current source, and prove each local CLI's model/effort invocation before designing controls.
2. Add focused failing regressions, then make the smallest provider-aware model/effort and left-alignment correction.
3. Run focused tests plus full typecheck, lint, production build, and a fresh live Obsidian visual check; obtain independent review before proposing release.
- Avoid (dead ends): Do not fake a dynamic catalog, retain the old generic `CLI default` dead-end, or remove history/new-chat/quiz/learning/attachment/web/MCP/permission controls to make room.
- Provenance: 1 prior Orca run and preserved screenshot evidence in Tier 2.
## Resume Command
```bash
# Step 1 — Verify state (run this first):
test -f /Users/mark/Projects/Tools/obsidian-ai-tutor/src/components/InputToolbar.ts && command -v claude && command -v codex && command -v agy
# Expected: all three CLI paths and exit status 0.
# Step 2 — Load context (read the handoff IN FULL, not a Tier-1 slice):
# Plan:             @/Users/mark/Projects/Tools/obsidian-ai-tutor/goal-contract.md
# Previous Handoff: @/Users/mark/Projects/Tools/obsidian-ai-tutor/.handoff/2026-09-04/194700_obsidian-ai-tutor_brat-0.1.7_handoff.md
# Current Handoff:  @/Users/mark/Projects/Tools/obsidian-ai-tutor/.handoff/2026-09-04/204900_obsidian-ai-tutor_provider-model-ux_handoff.md
# Step 3 — Execute:
Inspect the installed CLI help and the current provider picker before authoring a focused regression.
```

<!-- === DETAIL === -->

## User's Request (DETAILED)

Mark explicitly requested a relay to Claude Opus high to correct the real UI, not another aspirational mockup. His current screenshot says the provider popup and toolbar remain visually poor even after `0.1.7`: the provider group must be left-aligned, provider rows must be compact and intelligible, choosing Claude must offer usable `opus`/`sonnet`/`haiku` model selection plus effort, and choosing Codex must expose current `5.6` series rather than only `gpt-5.4`/`o3` where the installed CLI supports it. Preserve the good existing controls (history, new chat, quiz, learning mode, attachment, web, MCP, permission) and improve only the cramped area.

## Problem Context (WHY)

`0.1.7` persisted a model override per provider and dispatched it for Claude/Codex/agy. The visual implementation presents native selection too generically: it has a detached model button, no capability-driven effort control, and stale static model suggestions. The screenshot also makes the popup feel like a large centered stack rather than a compact left-anchored menu associated with the selected provider.

## Goal (WHAT)

Students can choose an installed/logged-in provider and, inline, choose a real compatible model; where a verified effort capability exists, they can choose effort. A selection immediately affects the next direct local CLI invocation. The UI remains a two-row compact toolbar, clear at narrow width, left-aligned where it expresses current choice, and does not assume Mark's account, paths, or available models.

## Decision Deltas

| Decision ID | Status | Previous | Current | Reason | Source Ref |
|---|---|---|---|---|---|
| DEC-1 | changed | Generic native selector with concise static options/direct input | Provider-aware, verified model options and dispatch | Mark reported stale/nonfunctional choices | User screenshot 2026-09-04 |
| DEC-2 | new | Thinking hidden for native providers | Expose effort only when actual CLI invocation can honor it | Mark explicitly needs effort controls without fake UI | User request 2026-09-04 |
| DEC-3 | changed | Visual repair focused on CSS row structure | Compact left-aligned controls without deleting existing features | Current layout remains cramped | Preserved screenshot |

## Solution (HOW)

- Before: provider selection stored an ID and native model selection stored an optional ID; no portable effort path was wired.
- After: discover or maintain only provider-specific, documented/locally verified options; persist model and capability-backed effort separately, pass them only to the selected direct CLI, and make unavailable capabilities explicit rather than inert.
- Why changed: the current interaction makes students unable to determine or use their available model/effort controls.

## Key Files (Full)

- @/Users/mark/Projects/Tools/obsidian-ai-tutor/src/components/InputToolbar.ts — inspect current menu/popover DOM and accessible controls first.
- @/Users/mark/Projects/Tools/obsidian-ai-tutor/src/ObsidianCopilotView.ts — check selection callbacks and persisted settings synchronization.
- @/Users/mark/Projects/Tools/obsidian-ai-tutor/src/core/providers/providerRegistry.ts — add only verified direct command flags.
- @/Users/mark/Projects/Tools/obsidian-ai-tutor/src/core/agent/CopilotBridgeService.ts — confirm selected values reach query dispatch.
- @/Users/mark/Projects/Tools/obsidian-ai-tutor/src/settings/Settings.ts — locate the existing provider override schema; do not introduce environment-specific settings.
- @/Users/mark/Projects/Tools/obsidian-ai-tutor/src/styles.css — scope layout changes narrowly to toolbar/provider picker selectors.

## Evidence Index

- Plan (canonical): @/Users/mark/Projects/Tools/obsidian-ai-tutor/goal-contract.md — project constraints and release objective.
- Previous handoff: @/Users/mark/Projects/Tools/obsidian-ai-tutor/.handoff/2026-09-04/194700_obsidian-ai-tutor_brat-0.1.7_handoff.md — shipped baseline and verification.
- Scratchpad (task evidence): @/Users/mark/Projects/Tools/obsidian-ai-tutor/.claude/artifacts/provider-toolbar-visual-repair-20260904/scratchpad.md — prior visual and model dispatch evidence.
- Artifact: @/Users/mark/Projects/Tools/obsidian-ai-tutor/.claude/artifacts/provider-model-ux-20260904/live-feedback.png — durable copy of Mark's latest actual UI screenshot; copied from the volatile paste path.
- Session working directory: @/Users/mark/Projects/Tools/obsidian-ai-tutor — current source and test surface.

## Provenance Index

- Orca Run `run_2c3655d8a820`, Luna task `task_0cf1716dc5d0` — resumability: not_resumable; evidence: @/Users/mark/Projects/Tools/obsidian-ai-tutor/.handoff/2026-09-04/194700_obsidian-ai-tutor_brat-0.1.7_handoff.md

## Progress (Full Timeline)

- [x] `0.1.7` released with direct provider model overrides, 932-test verification, and BRAT assets.
- [x] Mark supplied fresh live UI feedback after installing the release.
- [~] Provider/model/effort UX correction — evidence captured; implementation deliberately transferred to Claude Opus high.
- [ ] Focused regression, implementation, independent review, and live visual verification.

## Critical Context

- Karpathy boundary: no dynamic background catalog or provider abstraction layer. Agy account discovery is permitted only on explicit picker open and must remain session-local; no polling.
- Model labels are not proof. Read installed `claude --help`, `codex exec --help`, and `agy --help` before passing flags. Existing known evidence: all support `--model`; `agy models` lists account-visible IDs only on request. Claude effort may be `--effort`; verify. Do not infer Codex effort from UI terminology.
- User expects current service marks, but existing assets use pinned MIT Lobe Icons with provenance; do not claim they are official assets or add runtime icon fetches.
- Live macOS computer-use click actions have failed focus verification twice. Screenshots are valid visual evidence, but do not claim clicks succeeded without a verified result.
- User asked to revise, not to publish. Commit/release/version update is outside this handoff unless subsequently authorized.

## Dead Ends (Negative Memory)

- Tried hiding native model/thinking controls to avoid misleading generic UI → failed: Mark needs actual model/effort selection → replace with capability-backed provider-specific controls.
- Tried a mockup-led redesign that removed familiar controls → failed: it regressed useful UI → retain current shell and make surgical toolbar changes.
- Tried remote/dynamic catalog behavior → rejected: it adds overhead and environment coupling → query only local direct CLI when a user explicitly opens a picker.

## Reproduction / Verification

```bash
cd /Users/mark/Projects/Tools/obsidian-ai-tutor
claude --help | rg -- '--model|--effort'
codex exec --help | rg -- '--model|effort'
agy --help | rg -- '--model|--effort'
agy models
npm test -- --runInBand
npm run typecheck && npm run lint && npm run build && git diff --check
```
