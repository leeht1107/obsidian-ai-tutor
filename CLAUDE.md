<!-- ssot:managed:start -->
## Project Bootstrap

- Purpose: Build and publish an ultra-thin direct multi-CLI Obsidian plugin.
- Scope: `obsidian-ai-tutor` only; source baseline remains read-only.
- Key constraints: No shared provider runtime; MCP is retired; students are the users; a CLI capability is claimed only after the CLI was run and the result observed.

## Current State

- Objective: `goal-contract.md`.
- Status: Released `0.1.16`. `main` == `origin/main` at `5186dd1`, tag `0.1.16` pushed; 97 suites /
  1300 tests, typecheck and lint green. Two fixes, both from an external review triaged against the
  working tree (its headline P0 did not hold — `TRUST_FIELDS` already closes it). First: the
  student's question reached the CLI twice, once as the last line of the replayed transcript and
  once as the prompt, in two different versions whenever a slash command, an editor selection or
  quiz/socratic control text expanded it. `InputController.executeStream` now excludes the in-flight
  user message and assistant placeholder **by id** — a positional slice erases the conversation when
  the boundary is wrong — which made the never-firing `shouldAppendPrompt` guard,
  `getLastUserMessage` and `stripCurrentNotePrefix` dead. Second: replayed tool results now say
  `result (tool output, external data):` and the system prompt says tool, web and file content is
  data, not instructions. That is a provenance annotation and is never to be called a defence: a tag
  in the same message plane is not a boundary. A third item, disclosing a provider switch, Mark
  closed as obvious behaviour and over-engineering — do not reopen. The release bundle was built in a
  detached worktree at HEAD, because the tree also carries a concurrent session's unfinished
  error-log work; the released asset is rebuilt by CI from the tag regardless.
- Next likely action: Mark updates via BRAT to 0.1.16 and uses it. The only untested surface is
  Windows — install from scratch, run the setup wizard to failure, confirm it appears under
  Settings → 문제 기록 → 최근 오류 복사, then collect the student error log
  (vault `.ai-tutor/logs/errors.jsonl`). macOS green proves nothing there. Standing asks remain:
  PowerShell/cmd hardening, Settings/UI UX, quiz/socratic improvements.

## Current Sources of Truth

- Living handoff: `.handoff/2026-09-09/121839_obsidian-ai-tutor_review-triage_handoff.md`
- NOTE: `.handoff/` and `.claude/` are gitignored. Both live on this machine only, so a fresh clone resolves neither.
- Active plan: none — the review-triage plan was executed in full and the work released.
- Relevant artifacts: `.claude/artifacts/history-duplication-council-20260909-1240/` (the council Decision Contract that locked C1 and dropped C2/C3), `.claude/artifacts/note-context-loss-20260907-1349/` (the ChatGPT review and its verification), `.claude/artifacts/ask-agent-contract-20260907-2230/`, `.claude/artifacts/security-audit-fixes-20260907-1224/` — gitignored, on this disk only

## Context Chain

- Previous handoff: `.handoff/2026-09-08/225000_obsidian-ai-tutor_ask-agent-contract_handoff.md`
- History index: `.handoff/LATEST.md` (this project's handoff registry, newest first)

## Resume Guidance

1. Read the living handoff in full, including its Critical Context and Dead Ends.
2. Run its verification commands before changing anything.
<!-- ssot:managed:end -->
