---
schema_version: 3
status: IN_PROGRESS
session_id: 2026-09-04-232000-setup-and-mcp-retire
parent_session_id: 2026-09-04-204900-provider-model-ux
workstream_id: setup-and-mcp-retire
plan: /Users/mark/Projects/Tools/obsidian-ai-tutor/goal-contract.md
previous_handoff: /Users/mark/Projects/Tools/obsidian-ai-tutor/.handoff/2026-09-04/204900_obsidian-ai-tutor_provider-model-ux_handoff.md
project: obsidian-ai-tutor
task: setup-and-mcp-retire
scope: retire the plugin MCP feature, then build an install/login flow that is actually automated
pending_tasks: 3
session_handles:
  - provider: claude
    role: lead
    resumability: resumable
tier1_end: 64
---

# Session Handoff
Generated: 2026-09-04 23:20
Project: obsidian-ai-tutor | Task: setup-and-mcp-retire | Scope: retire plugin MCP, build a real install/login flow

## Summary
- Done: Five commits landed — provider model/effort capability, native CLI streaming, drag-to-add-context, folder picker fix, @-mention readability. Nothing pushed.
- State: MCP removal is COMPLETE and green (typecheck, lint, 871/871 tests), uncommitted. The tracked build artifacts main.js and styles.css were reverted and do NOT contain it, so rebuild before deploying.
- Next: Commit the MCP removal with named paths, then redraw the install mockup and build the install/login flow using the corrected findings below.
- Decisions: MCP is retired outright (user: "은퇴다"). Login CAN be driven from Obsidian for claude and codex — an earlier claim that it could not was wrong and is corrected here.

## Decision Changes
- [DEC-4] new: The plugin's MCP feature is removed entirely. Rendering of `mcp__server__tool` tool calls a CLI makes on its own is KEPT.
- [DEC-5] changed: "Login cannot be automated" is FALSE. codex and claude both drive a browser login when spawned headless.
- [DEC-6] new: Provider readiness must come from a real login check, not from the presence of a binary.

## Open Issues
- CORRECTION (23:40): this handoff first said the tree was red with 4 typecheck errors and 10 failing tests. The subagent finished after it was written; all three gates now pass and 871 tests are green. Do not go looking for those failures.
- `main.js` and `styles.css` were reverted to their committed state, so they predate the MCP removal. Run `npm run build` before copying anything into the vault.
- `.handoff/LATEST.md` and `CLAUDE.md` were already modified before this session began; they are NOT this session's work. Do not commit them.
- Another pane was asked to add context-usage parsing in `CopilotBridgeService.parseNativeProviderLine`. Expect a conflict there.

## Key Files
- @/Users/mark/Projects/Tools/obsidian-ai-tutor/tests/unit/features/chat/controllers/InputController.test.ts — 4 typecheck errors, all `getMcpServerSelector` / `plugin.mcpService` leftovers
- @/Users/mark/Projects/Tools/obsidian-ai-tutor/tests/unit/features/chat/services/TitleGenerationService.test.ts — failing, MCP leftovers
- @/Users/mark/Projects/Tools/obsidian-ai-tutor/src/core/setup/AutoSetupService.ts — npm install already works; add node install + login here
- @/Users/mark/Projects/Tools/obsidian-ai-tutor/src/ui/modals/SetupWizardModal.ts — the wizard to rebuild
- @/Users/mark/Projects/Tools/obsidian-ai-tutor/src/features/chat/ObsidianCopilotView.ts — `createProviderSelector`, where the false "준비됨" badge lives
- @/Users/mark/Projects/Tools/obsidian-ai-tutor/.claude/artifacts/provider-model-ux-20260904/cli-capability-evidence.md — all probe evidence

## Next Steps
1. Verify the MCP removal yourself (typecheck, lint, `npm test -- --runInBand`, then `npm run build`), and commit it with named paths (`🔥 remove:`). ~50 source and test files plus 18 deletions; do not sweep in `.handoff/LATEST.md` or `CLAUDE.md`.
2. Redraw the setup mockup — cards 3 and 6 of the existing PNG are WRONG (see Critical Context).
3. Build the install/login flow, then run `/ai-review with advisor-sol` in a loop until it passes.
- Avoid (dead ends): Do not claim a CLI cannot do something without running it — that error is what produced the wrong mockup. Do not reintroduce any plugin-side MCP configuration.
- Provenance: This session; all CLI findings were probed on this machine.

## Resume Command
```bash
# Step 1 — Verify state (run this first):
npm run typecheck 2>&1 | grep -c "error TS"; git status --porcelain=v1 | wc -l
# Expected: 0 — the MCP removal is finished and green, just uncommitted.
# Backup branch: backup/mcp-retire-20260904-2305
# Step 2 — Load context (read this handoff IN FULL):
# Current Handoff: @/Users/mark/Projects/Tools/obsidian-ai-tutor/.handoff/2026-09-04/232000_obsidian-ai-tutor_setup-and-mcp-retire_handoff.md
# Evidence:        @/Users/mark/Projects/Tools/obsidian-ai-tutor/.claude/artifacts/provider-model-ux-20260904/cli-capability-evidence.md
# Step 3 — Execute:
# Finish the MCP removal to green, then rebuild the install flow.
```

<!-- === DETAIL === -->

## User's Request (DETAILED)

Mark wants the plugin light, flexible, and friendly to students and beginners. Settings must be simple; anything complex but necessary goes under an Advanced group. He decided MCP is retired outright. He pushed back hard — correctly — on a claim that install and login could not be automated, and wants the install flow to actually install Node.js and actually drive login rather than printing instructions. His standing instruction: run `/ai-review with advisor-sol` in a loop until it passes.

## Critical Context

**The corrected install/login findings. These were all probed on this machine; the earlier "cannot be automated" claim was wrong.**

| CLI | install | login, spawned headless from Obsidian | login status check |
|---|---|---|---|
| claude | `npm install -g @anthropic-ai/claude-code` | WORKS — opens browser, returns a code the user pastes back; the plugin can take that code in a text field and write it to the child's stdin | `claude auth status` prints JSON with `loggedIn`, `email` |
| codex | `npm install -g @openai/codex` | WORKS and fully self-completes — starts a callback server on localhost:1455, opens the browser, finishes without any paste | `codex login status` prints `Logged in using ChatGPT` |
| agy | none — no npm package, manual only | FAILS — `CLI error: bubbletea: error opening TTY: could not open TTY`. agy genuinely needs a real terminal window | no login subcommand; `agy models` succeeding implies an authenticated account (inferred, not proven) |
| copilot | `npm install -g @github/copilot` | UNTESTED | UNTESTED |

Probe used: spawn with `stdio: ['pipe','pipe','pipe']`, close stdin, capture output, kill after 6s. Neither claude nor codex complained about a missing TTY.

**Node.js install.** `brew install node` works on macOS without sudo and brew is detectable on PATH. `winget install OpenJS.NodeJS.LTS` is the Windows equivalent but was NOT verified — no Windows machine here. When neither package manager exists, open nodejs.org in the browser; do not automate the brew bootstrap, which needs `curl | bash` and sudo.

**The existing mockup is wrong.** `.claude/artifacts/provider-model-ux-20260904/setup-flow-mockup.png` card 3 says the plugin cannot install Node.js and card 6 says login is the user's job in a terminal. Both are false for the common cases. Cards 1, 2, 5 and 7 remain accurate. Redraw before showing it to Mark again.

**The readiness badge lies.** `createProviderSelector` marks a provider "준비됨" from `findProviderCliPath`, i.e. the binary exists. A logged-out CLI still shows green and fails only at send time. Replace with the real status commands above, or drop the badge and list only installed providers.

**PATH.** Obsidian is a GUI app and does not inherit a shell PATH; `/usr/bin:/bin` has no npm. `getEnhancedPath()` in `src/utils/env.ts` already covers homebrew, nvm, fnm, volta, asdf and the Windows locations, and `findNpmPath()` uses it. Reuse it; do not re-derive PATH.

## Progress (Full Timeline)

- [x] Provider model/effort controls driven by verified CLI capability — commit 48ef246
- [x] Native CLI output streams incrementally instead of buffering to exit — commit b47c76b
- [x] Drag a note onto the chat box to add it as context — commit b99a74e
- [x] Folder button opens a real picker via `@electron/remote` — commit bfe4273
- [x] @-mention readable in picker and marked in sent messages — commit 3921b11
- [x] MCP feature removal — 18 files deleted via `trash`, ~50 edited; typecheck, lint and 871/871 tests green; UNCOMMITTED
- [ ] Commit the MCP removal
- [ ] Redraw the setup mockup with the corrected findings
- [ ] Build the install/login flow
- [ ] Simplify settings into basic vs Advanced
- [ ] `/ai-review with advisor-sol` loop until it passes

## Dead Ends (Negative Memory)

- Asserted that browser OAuth cannot be automated from Obsidian without testing it → wrong; both codex and claude work headless → always spawn the CLI and read what it prints before making a capability claim.
- Live macOS click and keystroke automation failed three times (focus never reached Obsidian). `open "obsidian://adv-uri?commandid=app%3Areload"` DOES work for reloading the plugin — use that.
- `osascript` driving Terminal.app timed out with AppleEvent error -1712; unresolved, and it is the only path left for agy's login.
- Splitting a commit by reverting one part, committing, then restoring works well here and kept each commit green.

## Reproduction / Verification

```bash
cd /Users/mark/Projects/Tools/obsidian-ai-tutor
npm run typecheck && npm run lint && npm test -- --runInBand && npm run build
# Deploy to the live vault and reload (approved by Mark, backup at scratchpad vault-plugin-backup-0.1.7):
cp main.js styles.css /Users/mark/Documents/Obsidian/.obsidian/plugins/obsidian-ai-tutor/
open "obsidian://adv-uri?commandid=app%3Areload"
```

## Late addition — what the MCP removal actually touched

Removed end to end: McpService/McpServerManager/McpStorage, the three Mcp modals, the
preset gallery and settings section, the toolbar MCP selector, MCP @-mentions, the
`enabledMcpServers`/`mcpMentions`/`disableMcp` query options, `getMcpServersInstructions()`
in the main prompt, the quiz's auto-enable-context7 call (the web-search half was kept),
and the vault auto-install of a recommended bundle into `.copilot/mcp.json`.

Deliberately KEPT and verified still present: `MCP_ICON_MARKER` and the `mcp__` branch in
`toolIcons.ts`, `toolNames.ts` parsing, the MCP badge in `ToolCallRenderer.ts`, and
`normalizeMcpToolName` — the CLIs still run their own MCP servers, so those tool calls
must keep rendering.

Left alone on purpose, flag for Mark: the settings page still has an "Obsidian MCP"
skill-suggestion chip pointing at github.com/MarkusPfworlds/copilot-obsidian-mcp. That is
part of a separate install-a-skill-from-URL feature, not the plugin's own MCP config, so
it was out of scope. Ask whether it should go too.

An existing `.copilot/mcp.json` in a user's vault is not deleted by this change; it simply
stops being read. Mark's own vault has one.
