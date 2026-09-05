<!-- ssot:managed:start -->
## Project Bootstrap

- Purpose: Build and publish an ultra-thin direct multi-CLI Obsidian plugin.
- Scope: `obsidian-ai-tutor` only; source baseline remains read-only.
- Key constraints: No shared provider runtime; MCP is retired; students are the users; a CLI capability is claimed only after the CLI was run and the result observed.

## Current State

- Objective: `goal-contract.md`.
- Status: In progress past `0.1.7`. Six commits landed on local `main` (`2c3640e`): the skill chips now point at real Anthropic skill folders and install whole, Ask/Agent is enforced per CLI from measured behaviour, `codex exec` no longer fails in a non-Git vault, and the streaming redraw cost is gone. Typecheck, lint, 72 suites / 1063 tests green; deployed to the live vault; nothing pushed.
- Next likely action: Mark's four open asks — PowerShell/cmd hardening, a student error-report channel, Settings/UI UX proposals, and quiz/socratic improvements. Then decide on pushing.

## Current Sources of Truth

- Living handoff: `.handoff/2026-09-06/004500_obsidian-ai-tutor_latency-and-windows_handoff.md`
- NOTE: `.handoff/` and `.claude/` are gitignored. Both live on this machine only, so a fresh clone resolves neither.
- Active plan: `goal-contract.md`
- Relevant artifacts: `.claude/artifacts/provider-settings-20260905-2100/` (CLI capability measurements, 13 ai-review rounds, scratchpad) — gitignored, on this disk only

## Context Chain

- Previous handoff: `.handoff/2026-09-05/213000_obsidian-ai-tutor_provider-settings_handoff.md`
- History index: `.handoff/LATEST.md` (this project's handoff registry, newest first)

## Resume Guidance

1. Read the living handoff in full, including its Critical Context and Dead Ends.
2. Run its verification commands before changing anything.
<!-- ssot:managed:end -->
