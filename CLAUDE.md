<!-- ssot:managed:start -->
## Project Bootstrap

- Purpose: Build and publish an ultra-thin direct multi-CLI Obsidian plugin.
- Scope: `obsidian-ai-tutor` only; source baseline remains read-only.
- Key constraints: No shared provider runtime; backend lifecycle receipts are required.

## Current State

- Objective: `goal-contract.md`.
- Status: In progress. `0.1.7` is released, but fresh in-Obsidian feedback found the provider/model layout inadequate: provider controls need a compact left-aligned interaction, native choices must show real compatible models, and effort must be exposed only when direct CLI capability is verified.
- Next likely action: Claude Opus high continues the `provider-model-ux` handoff. Do not release until focused regressions, full checks, independent review, and a live visual check confirm the change.

## Current Sources of Truth

- Living handoff: `.handoff/2026-09-04/204900_obsidian-ai-tutor_provider-model-ux_handoff.md`
- Active plan: `goal-contract.md`
- Relevant artifacts: `.claude/artifacts/obsidian-ai-tutor-20260903-0001/`

## Resume Guidance

1. Read the living handoff in full.
2. Run its receipt-verification commands before any new worker dispatch.
<!-- ssot:managed:end -->
