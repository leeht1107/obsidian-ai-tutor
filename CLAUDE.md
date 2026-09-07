<!-- ssot:managed:start -->
## Project Bootstrap

- Purpose: Build and publish an ultra-thin direct multi-CLI Obsidian plugin.
- Scope: `obsidian-ai-tutor` only; source baseline remains read-only.
- Key constraints: No shared provider runtime; MCP is retired; students are the users; a CLI capability is claimed only after the CLI was run and the result observed.

## Current State

- Objective: `goal-contract.md`.
- Status: Released `0.1.11`. `main` == `origin/main` at `aa5b8f8`; 81 suites / 1151 tests green; tree
  clean; CI green on both `ubuntu-latest` and `windows-latest`. Since 0.1.8: the Windows shell was
  removed from every dispatch path, credentials moved to device-local storage, a student error log
  was added, and two adversarial reviews were answered claim by claim. 0.1.11 fixes a student-visible
  context bug — switching provider mid-conversation dropped the transcript and the current note,
  because `sessionId` is a copilot-only concept that was gating history replay for every provider,
  and the current note was announced once per conversation and never again.
  KNOWN FALSE in the older plan: copilot Agent was never blocked in the plugin, so the registry's
  copilot argv row is inert — `query()` bypasses the builder for copilot (DEC-26).
- Next likely action: Mark reloads the plugin and runs the active plan's 5-row manual table (row 3 —
  a copilot turn then back to claude — is the path just fixed). Then: run the plugin on Windows and
  hand back `<configDir>/plugins/obsidian-ai-tutor/logs/errors.jsonl`, and decide when to run the
  provider capability matrix. Standing asks remain: PowerShell/cmd hardening, Settings/UI UX,
  quiz/socratic improvements.

## Current Sources of Truth

- Living handoff: `.handoff/2026-09-07/140325_obsidian-ai-tutor_note-context-loss_handoff.md`
- NOTE: `.handoff/` and `.claude/` are gitignored. Both live on this machine only, so a fresh clone resolves neither.
- Active plan: `.claude/artifacts/note-context-loss-20260907-1349/plan.md` — the fixes are implemented; its `## 검증` manual table and its `§2` capability-matrix design are what remain. Objective contract stays `goal-contract.md`
- Relevant artifacts: `.claude/artifacts/note-context-loss-20260907-1349/` (plan, scratchpad), `.claude/artifacts/security-audit-fixes-20260907-1224/` (the 0.1.9 plan, `review-outcome.md`, the two peer reports, and advisor-astra's verdict), and `.claude/artifacts/ask-agent-toggle-20260906-1020/` (the measured Ask/Agent flag table) — gitignored, on this disk only

## Context Chain

- Previous handoff: `.handoff/2026-09-07/133000_obsidian-ai-tutor_security-audit-response_handoff.md` (the 0.1.9 security work this session continued from)
- History index: `.handoff/LATEST.md` (this project's handoff registry, newest first)

## Resume Guidance

1. Read the living handoff in full, including its Critical Context and Dead Ends.
2. Run its verification commands before changing anything.
<!-- ssot:managed:end -->
