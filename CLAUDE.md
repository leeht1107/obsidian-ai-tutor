<!-- ssot:managed:start -->
## Project Bootstrap

- Purpose: Build and publish an ultra-thin direct multi-CLI Obsidian plugin.
- Scope: `obsidian-ai-tutor` only; source baseline remains read-only.
- Key constraints: No shared provider runtime; MCP is retired; students are the users; a CLI capability is claimed only after the CLI was run and the result observed.

## Current State

- Objective: `goal-contract.md`.
- Status: Released `0.1.8`. `main` == `origin/main` at `671eb3b`; 73 suites / 1095 tests green; tree
  clean. The Ask/Agent toggle now sets a measured permission flag on all four CLIs — a lock for
  claude/codex in Ask, a key for agy/copilot in Agent — codex's toggle is no longer disabled, claude
  joins agy in requiring one written write-consent, and a CLI that exits 0 having said nothing is
  reported as failed instead of showing an empty answer. Reviewed by two peers, deployed to the vault.
  KNOWN FALSE in the plan: copilot Agent was never blocked in the plugin, so the registry's copilot
  argv row is inert — `query()` bypasses the builder for copilot (DEC-26 in the living handoff).
- Next likely action: Mark runs the manual four-CLI pass from the plan's `## 검증` table after
  reloading the plugin; only a failure there reopens the work. Then his four standing asks —
  PowerShell/cmd hardening, a student error-report channel, Settings/UI UX proposals, and
  quiz/socratic improvements.

## Current Sources of Truth

- Living handoff: `.handoff/2026-09-06/141500_obsidian-ai-tutor_ask-agent-toggle_handoff.md`
- NOTE: `.handoff/` and `.claude/` are gitignored. Both live on this machine only, so a fresh clone resolves neither.
- Active plan: `.claude/artifacts/ask-agent-toggle-20260906-1020/plan.md` — implemented; its `## 검증` manual table is the only step left. Objective contract stays `goal-contract.md`
- Relevant artifacts: `.claude/artifacts/ask-agent-toggle-20260906-1020/` (locked contract, measured flag table, plan, scratchpad, and the `ai-review-20260906-1307/` peer reports) and `.claude/artifacts/provider-settings-20260905-2100/` (earlier CLI capability measurements) — gitignored, on this disk only

## Context Chain

- Previous handoff: `.handoff/2026-09-06/123500_obsidian-ai-tutor_ask-agent-toggle_handoff.md` (planning half of the same task)
- History index: `.handoff/LATEST.md` (this project's handoff registry, newest first)

## Resume Guidance

1. Read the living handoff in full, including its Critical Context and Dead Ends.
2. Run its verification commands before changing anything.
<!-- ssot:managed:end -->
