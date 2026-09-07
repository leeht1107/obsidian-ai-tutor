<!-- ssot:managed:start -->
## Project Bootstrap

- Purpose: Build and publish an ultra-thin direct multi-CLI Obsidian plugin.
- Scope: `obsidian-ai-tutor` only; source baseline remains read-only.
- Key constraints: No shared provider runtime; MCP is retired; students are the users; a CLI capability is claimed only after the CLI was run and the result observed.

## Current State

- Objective: `goal-contract.md`.
- Status: Released `0.1.12`. `main` == `origin/main` at `5e88862`; 81 suites / 1174 tests green; tree
  clean; CI green on both `ubuntu-latest` and `windows-latest`. 0.1.12 isolates trust boundaries:
  vault storage moved from `.copilot/` to `.ai-tutor/`, trust permissions, CLI paths, env vars, and
  credentials reside strictly in device-local storage (`app.saveLocalStorage`). Zero adoption from
  untrusted vault files, unicode-unescaped key scanning, and fail-closed handling on malformed files.
  Verified through 6 rounds of adversarial review by `advisor-sol` (`gpt-5.6-sol`, `xhigh`, `PROCEED`).
- Next likely action: Mark updates via BRAT ("Check for updates") and tests 0.1.12. Collect student
  error logs (`<configDir>/plugins/obsidian-ai-tutor/logs/errors.jsonl`) on Windows. Standing asks
  remain: PowerShell/cmd hardening, Settings/UI UX, quiz/socratic improvements.

## Current Sources of Truth

- Living handoff: `.handoff/2026-09-07/140325_obsidian-ai-tutor_note-context-loss_handoff.md`
- NOTE: `.handoff/` and `.claude/` are gitignored. Both live on this machine only, so a fresh clone resolves neither.
- Active plan: `goal-contract.md`
- Relevant artifacts: `.claude/artifacts/note-context-loss-20260907-1349/` (plan, scratchpad), `.claude/artifacts/security-audit-fixes-20260907-1224/` (the 0.1.9 plan, `review-outcome.md`, peer reports, advisor-astra's verdict), and `.claude/artifacts/ask-agent-toggle-20260906-1020/` (measured Ask/Agent flag table) — gitignored, on this disk only

## Context Chain

- Previous handoff: `.handoff/2026-09-07/133000_obsidian-ai-tutor_security-audit-response_handoff.md`
- History index: `.handoff/LATEST.md` (this project's handoff registry, newest first)

## Resume Guidance

1. Read the living handoff in full, including its Critical Context and Dead Ends.
2. Run its verification commands before changing anything.
<!-- ssot:managed:end -->
