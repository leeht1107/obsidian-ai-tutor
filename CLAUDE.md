<!-- ssot:managed:start -->
## Project Bootstrap

- Purpose: Build and publish an ultra-thin direct multi-CLI Obsidian plugin.
- Scope: `obsidian-ai-tutor` only; source baseline remains read-only.
- Key constraints: No shared provider runtime; MCP is retired; students are the users; a CLI capability is claimed only after the CLI was run and the result observed.

## Current State

- Objective: `goal-contract.md`.
- Status: Released `0.1.14`. `main` == `origin/main` at `25e9336`; 89 suites / 1231 tests; tree
  clean; CI green on both `ubuntu-latest` and `windows-latest`, Release workflow green. 0.1.14 is
  version metadata only — the only source change since 0.1.13 was a comment, so `main.js` and
  `styles.css` rebuild byte-identical and a BRAT update delivers no behavioural change. The work
  behind it is `tests/unit/core/agent/win32TeardownLimit.test.ts`, which now reproduces the win32
  `killTree` orphan limit on `windows-latest` (PASS, not skipped) and asserts the teardown seam by
  pid, so removing the `killTree` call cannot leave it green. Escape requires `detached: true` on
  the descendant AND a dead intermediate parent (DEC-14); the shipped "정지" wording stays as is.
- Next likely action: Mark updates via BRAT and confirms 0.1.14 — "nothing changed" is the expected
  result. Collect student error logs (vault `.ai-tutor/logs/errors.jsonl`, or the settings tab's 최근 오류 복사 button) on
  Windows. Standing asks remain: PowerShell/cmd hardening, Settings/UI UX, quiz/socratic
  improvements.

## Current Sources of Truth

- Living handoff: `.handoff/2026-09-08/225000_obsidian-ai-tutor_ask-agent-contract_handoff.md`
- NOTE: `.handoff/` and `.claude/` are gitignored. Both live on this machine only, so a fresh clone resolves neither.
- Active plan: `goal-contract.md` (the 0.1.14 plan was executed and deleted — DEC-17; the handoff carries its content)
- Relevant artifacts: `.claude/artifacts/ask-agent-contract-20260907-2230/` (scratchpad R1-R6, `ai-review-20260908-1454/` peer reports, advisor packets), `.claude/artifacts/note-context-loss-20260907-1349/`, `.claude/artifacts/security-audit-fixes-20260907-1224/` (the 0.1.9 plan, `review-outcome.md`, advisor-astra's verdict), and `.claude/artifacts/ask-agent-toggle-20260906-1020/` (measured Ask/Agent flag table) — gitignored, on this disk only

## Context Chain

- Previous handoff: `.handoff/2026-09-08/150500_obsidian-ai-tutor_ask-agent-contract_handoff.md`
- History index: `.handoff/LATEST.md` (this project's handoff registry, newest first)

## Resume Guidance

1. Read the living handoff in full, including its Critical Context and Dead Ends.
2. Run its verification commands before changing anything.
<!-- ssot:managed:end -->
