<!-- ssot:managed:start -->
## Project Bootstrap

- Purpose: Build and publish an ultra-thin direct multi-CLI Obsidian plugin.
- Scope: `obsidian-ai-tutor` only; source baseline remains read-only.
- Key constraints: No shared provider runtime; MCP is retired; students are the users; a CLI capability is claimed only after the CLI was run and the result observed.

## Current State

- Objective: `goal-contract.md`.
- Status: Released `0.1.18`. `main` == `origin/main` at `aca17a7`; the 0.1.18 release job
  published main.js / manifest.json / styles.css. 100 suites / 1336 tests, typecheck, lint and
  build green. Two workstreams shipped together. First, the first-run setup wizard is now
  multi-select: everything a student ticks is installed one at a time, the logins are walked
  afterwards one by one, and which CLI becomes the default is asked once, at the end — the queue
  never writes `selectedProvider` while it runs, because doing it per entry makes whichever CLI
  was processed last the default. The single-provider `target` path its four other call sites use
  is untouched and its tests pass unmodified; Settings gained a 설치 마법사 button because the
  chooser is otherwise unreachable after first run. Second, the concurrent error-log work: every
  Notice-delivered blocking failure now goes through one `reportBlockingFailure` seam, the
  streaming chat paths log beside their own error chunks with a tripwire test counting the 13
  sites, and a cancel is still never recorded so an empty log keeps meaning the student was never
  blocked. Three advisor-sol rounds, a two-peer ai-review, and an advisor-fable round each found
  real defects — most of them in the *repair* of the previous round's finding, all in the same
  place: stopping a package manager. `killTree` only signals, and on Windows it merely spawns
  `taskkill /T /F`, so both install services now resolve `done` from the child's own exit; when
  only the 3s grace answers, the result says the stop was unconfirmed, the queue refuses to spawn
  anything else for the rest of the session, and it asks for an Obsidian restart. Tag `0.1.17`
  exists on origin with no release: its job failed on a test of mine that read the real machine's
  PATH (fixed in `0e0e46e`), and a new version was cut rather than a published tag moved.
- Next likely action: Mark updates via BRAT to 0.1.18 and installs on Windows, which is
  deliberately unverified — he accepted that risk and chose the error log as the instrument
  instead. Collect the student's `.ai-tutor/logs/errors.jsonl` (or Settings → 문제 기록 → 최근
  오류 복사) and fix from what it says. Standing asks remain: PowerShell/cmd hardening,
  Settings/UI UX, quiz/socratic improvements.

## Current Sources of Truth

- Living handoff: `.handoff/2026-09-10/000500_obsidian-ai-tutor_setup-wizard_handoff.md`
- NOTE: `.handoff/` and `.claude/` are gitignored. Both live on this machine only, so a fresh clone resolves neither.
- Active plan: none — the multi-select wizard plan was executed in full and released as 0.1.18.
- Relevant artifacts: `.claude/artifacts/setup-wizard-multi-provider-20260909-2230/` (three advisor-sol
  rounds with receipts, both ai-review rounds, and the task scratchpad),
  `.claude/artifacts/history-duplication-council-20260909-1240/`,
  `.claude/artifacts/note-context-loss-20260907-1349/` — gitignored, on this disk only

## Resume Guidance

1. Read the living handoff in full, including its Critical Context and Dead Ends.
2. Run its verification commands before changing anything.
<!-- ssot:managed:end -->
