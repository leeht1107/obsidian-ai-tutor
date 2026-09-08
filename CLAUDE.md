<!-- ssot:managed:start -->
## Project Bootstrap

- Purpose: Build and publish an ultra-thin direct multi-CLI Obsidian plugin.
- Scope: `obsidian-ai-tutor` only; source baseline remains read-only.
- Key constraints: No shared provider runtime; MCP is retired; students are the users; a CLI capability is claimed only after the CLI was run and the result observed.

## Current State

- Objective: `goal-contract.md`.
- Status: Released `0.1.15`. `main` == `origin/main` at `e2f0af0`; 91 suites / 1250 tests; tree
  clean; CI green on both `ubuntu-latest` and `windows-latest`. Unlike 0.1.14 the bundle really
  changed: the student error log now records the failures the student is actually shown. Every
  setup failure (Node install, CLI install, login, re-check) is logged from `SetupWizardModal` —
  the seam, because the setup services also run background probes nobody sees — and the copilot
  path lost its three gaps (no CLI configured, synchronous `spawn` throw, the outer `query` catch).
  A cancel is deliberately never logged, so an empty log still means "the student was never shown a
  failure". `ErrorLog.ts` also gained a shared `recordError` export, a serialised append (one
  service writes from chat, titles, inline edit and refine, and two failures in a tick used to lose
  one), a path-boundary `maskHome`, home masking inside the message, and `scrubCredentialPatterns`
  for credential-shaped text the plugin never configured — upstream redaction only knows configured
  values. Five advisor-sol rounds drove that list; each finding landed with a test that failed
  first. One pre-existing flake, unrelated and not introduced here: `native provider streaming ›
  delivers each chunk as it is produced` fails under parallel `npx jest` and passes under the
  project's `--runInBand` (verified 3/3 on a clean tree).
- Next likely action: Mark updates via BRAT to 0.1.15, then the manual Windows check this release
  exists for — hide or uninstall the CLI, run the setup wizard to failure, close it, and confirm
  the install failure appears under Settings → 문제 기록 → 최근 오류 복사. macOS green proves nothing
  about the Windows shim paths. Then collect student error logs (vault
  `.ai-tutor/logs/errors.jsonl`) on Windows. Standing asks remain: PowerShell/cmd hardening,
  Settings/UI UX, quiz/socratic improvements.

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
