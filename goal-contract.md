# Goal Contract: Obsidian AI Tutor

## Objective

Create and publish the public `leeht1107/obsidian-ai-tutor` Obsidian plugin by
using the latest `leeht1107/obsidian-copilot` baseline, implementing the
approved PRD and ADDENDUM phases 0–6 as an ultra-thin direct multi-CLI product.

## Verification

1. Build, typecheck, lint, and the existing plus new tests pass after the final edit.
2. The four provider paths (Copilot, Claude Code, Codex, and agy) support
   discovery/setup and the locked Chat, Context, Quiz, and Socratic flows where
   the provider capability permits them.
3. The implementation has no shared provider runtime, proxy, queue, RPC hop,
   stream relay, or extra provider child process. The deterministic fake-CLI
   benchmark proves one child process per request and dispatch overhead p95 is
   at most 10 ms.
4. Windows-specific path and command handling has automated coverage; the
   Completion Proof Packet explicitly distinguishes it from physical Windows E2E.
5. The target remote is public, contains the final commit, preserves the MIT
   copyright notice, and passes stale branding/scope audit.
6. Every completed production/evaluation task has lifecycle receipts from the
   Harness-selected backend and an indexed handoff, SSOT checkpoint, and
   applicable scratchpad evidence.

## Constraints

- Source repository is read-only; all new state and mutations are in this target.
- Keep the implementation surgical: provider-ID-to-native-handler selection only,
  never a universal runtime abstraction.
- Do not extract or persist tokens, cookies, or OAuth credentials.
- Package-manager recipes may automate installation; script-only agy setup is
  guided manual setup with recheck.
- `advisor-sol` is a read-only advisor, never the sole evaluator or producer.
- If Claude is unavailable (including 529), use Terra for equivalent independent
  acceptance evaluation and record the fallback and receipt.

## Iteration Policy

Work serially through a fresh backend Run. For each task, preserve its receipt,
verify the specific changed behavior, checkpoint continuity, and then select the
next highest-impact unmet criterion. After `candidate_ready`, only demonstrated
acceptance blockers consume a repair attempt; repairs 1–3 are automatic.

## Stop Rule

Stop and surface a snapshot if official provider behavior cannot be verified,
safe authentication is unavailable, a new external authority is required, the
selected backend cannot produce lifecycle receipts, or the fourth post-candidate
repair is needed. Resume only after the stated blocker is resolved or Mark makes
the required decision.

## Completion Proof Packet

Locked contract; final command outputs after the last edit; diff and stale-signal
audit; provider/setup matrix; fake-CLI performance result; Windows coverage
statement; backend lifecycle receipts; handoff/SSOT lineage; public remote commit
SHA; and explicit residual-risk statement.

## Runtime

Codex native goal state, with Orca selected as the current Harness lifecycle
backend. If Harness later selects cmux, use cmux's equivalent receipt lifecycle.
