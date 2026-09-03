<!-- ssot:managed:start -->
## Project Bootstrap

- Purpose: Build and publish an ultra-thin direct multi-CLI Obsidian plugin.
- Scope: `obsidian-ai-tutor` only; source baseline remains read-only.
- Key constraints: No shared provider runtime; backend lifecycle receipts are required.

## Current State

- Objective: `goal-contract.md`.
- Status: Provider foundation is verified and committed at `ac70b42`; receipt-backed learning-UX production is blocked because both Luna and Terra workers hit the same Codex endpoint 404 before work.
- Next likely action: Restore a receipt-capable worker endpoint or authenticated alternate surface before a fresh bounded learning-UX task. agy remains receipt-blocked on Orca authentication/startup.

## Current Sources of Truth

- Living handoff: `.handoff/2026-09-03/145300_obsidian-ai-tutor_worker-runtime-blocker_handoff.md`
- Active plan: `goal-contract.md`
- Relevant artifacts: `.claude/artifacts/obsidian-ai-tutor-20260903-0001/`

## Resume Guidance

1. Read the living handoff in full.
2. Run its receipt-verification commands before any new worker dispatch.
<!-- ssot:managed:end -->
