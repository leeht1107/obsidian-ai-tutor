---
schema_version: 3
status: IN_PROGRESS
session_id: 2026-09-05-113100-student-ux-and-common-mcp
parent_session_id: 2026-09-04-232000-setup-and-mcp-retire
workstream_id: student-ux-and-common-mcp
plan: /Users/mark/Projects/Tools/obsidian-ai-tutor/goal-contract.md
previous_handoff: /Users/mark/Projects/Tools/obsidian-ai-tutor/.handoff/2026-09-04/232000_obsidian-ai-tutor_setup-and-mcp-retire_handoff.md
project: obsidian-ai-tutor
task: student-ux-and-common-mcp
scope: student-facing chat UX, then a shared MCP/skill setup students do not have to install themselves
pending_tasks: 3
session_handles:
  - provider: claude
    role: lead
    resumability: resumable
tier1_end: 78
---

# Session Handoff
Generated: 2026-09-05 11:31
Project: obsidian-ai-tutor | Task: student-ux-and-common-mcp

## Summary
- Done: MCP retirement committed; install/login flow built and driven through four independent review rounds; claude and copilot logins verified first-hand; @-mention highlighting, vault-folder mentions, and the folder-label work. Twelve commits, nothing pushed.
- State: Green — typecheck, lint, 973 tests, build. Deployed to the live vault and reloaded. Working tree clean apart from four files that must not be committed (below).
- Next: Decide the shared MCP/skill scope with Mark, then build it. Settings still need the basic/Advanced split from the original plan.
- Decisions: Folder labels show the full path over two lines — three shortening heuristics were tried and each failed on the real vault (see Dead Ends; do not retry them).

## Decision Changes
- [DEC-7] new: `@` lists files only; `@/` lists vault folders, ordered by closeness to the open note. Mixing them was tried and regressed the common case.
- [DEC-8] new: A mention's folder line shows the whole vault-relative path, wrapped to two lines. No abbreviation rule survived contact with the real vault.
- [DEC-9] changed: claude and copilot logins are VERIFIED, not inherited. Both drive headless. agy remains the only provider needing a terminal.

## Open Issues
- `.handoff/LATEST.md` and `CLAUDE.md` were dirty before any of this work and belong to someone else. Do not commit them.
- `main.js` / `styles.css` are tracked build artifacts, currently dirty because they were rebuilt and deployed. They have been left out of every commit this session; the repo convention appears to be updating them at release. Confirm with Mark before committing them.
- The chat box shows the full quoted path for a folder mention (`@"01. Projects/…/notes/"`). Mark finds it long. It cannot simply be shortened — the CLI resolves that path. The alternative is attaching folders as chips like files, with a short token in the text. Not started.

## Key Files
- @/Users/mark/Projects/Tools/obsidian-ai-tutor/.claude/artifacts/provider-model-ux-20260904/install-login-evidence.md — every CLI capability claim, with what was and was not executed
- @/Users/mark/Projects/Tools/obsidian-ai-tutor/src/core/setup/ — providerReadiness, providerLogin, nodeInstall, processTree, AutoSetupService
- @/Users/mark/Projects/Tools/obsidian-ai-tutor/src/ui/modals/SetupWizardModal.ts — the install/login wizard
- @/Users/mark/Projects/Tools/obsidian-ai-tutor/src/ui/components/file-context/mention/ — folderSearch, MentionDropdownController
- @/Users/mark/Projects/Tools/obsidian-ai-tutor/src/ui/components/MentionHighlighter.ts — input highlighting

## Next Steps
1. Put the shared-MCP scope question to Mark (it is the one open decision, asked twice and still unanswered) and build it. Details in Critical Context.
2. Split settings into basic vs Advanced — still pending from the original plan and the reason Mark asked for a light, beginner-friendly plugin.
3. Consider folder-as-chip so the chat box stops carrying a long path.
- Avoid (dead ends): the three folder-label heuristics below; do not reintroduce plugin-side MCP configuration.
- Provenance: this session; every CLI claim was executed on this machine.

## Resume Command
```bash
cd /Users/mark/Projects/Tools/obsidian-ai-tutor
npm run typecheck && npm run lint && npm test -- --runInBand   # expect 973 passing
# Deploy + reload after any change (approved; backup at scratchpad vault-plugin-backup-0.1.7-prev):
npm run build && cp main.js styles.css "/Users/mark/Documents/Obsidian/.obsidian/plugins/obsidian-ai-tutor/"
open "obsidian://adv-uri?commandid=app%3Areload"
```

<!-- === DETAIL === -->

## User's Request (DETAILED)

Mark wants the plugin light and usable by beginners. Students cannot install MCP
servers or skills themselves, so he wants a shared setup in settings, the way
Smart Composer does it. He is testing in the live vault and reporting what he
sees; several rounds this session were his corrections, and each was right.

## Critical Context

**The shared-MCP question, still unanswered. This is the blocking decision.**
The plugin's own MCP feature is gone, but each CLI keeps its own, and a thin
shim that calls `<cli> mcp add` is a far smaller thing than what was removed.
Verified on this machine:

| CLI | where its MCP config lives | reads the vault's `.mcp.json`? |
|---|---|---|
| claude | `mcp add --scope project` writes `.mcp.json` in the working directory | YES — and the vault already has one with `pg-multi` in it, so this path is live today |
| codex | `~/.codex/config.toml` only; 9 servers already configured there | no |
| copilot | `~/.copilot/mcp-config.json`; workspace `.mcp.json` documented but not picked up in testing | no |
| agy | `agy mcp add/remove/list/enable/disable`; scope unverified | untested |

The fork: vault-only (`.mcp.json`, costs nothing, claude only) versus also
writing each CLI's global config (covers all four, touches files outside the
vault on a student's machine). Mark has been asked twice and has not answered;
ask once more before building, because it decides the whole shape.

Slash commands are a separate thing and easier: they are prompt templates in
plugin settings, expanded before the CLI is called, and both the chat view and
the inline edit modal have the dropdown wired. Skills belong to the CLI. So
slash commands can be shipped to students through plugin settings, while
MCP and skills need the decision above.

**Login flows, all verified by running them.**
- `claude auth login` works headless. It opens the browser and completes on its
  own; the paste prompt is a fallback. It can be exercised safely by pointing
  `CLAUDE_CONFIG_DIR` at a temp directory — the real credentials stay untouched,
  which is how it was tested without risking the running session.
- `copilot login --device-code` works headless but prints NOTHING for the first
  10-35 seconds. A short probe with a `| head` pipeline read as "does not work"
  and nearly caused a working feature to be deleted on a reviewer's advice. Any
  timeout around it must be generous.
- `codex login --device-auth` prints a URL and a one-time code, no TTY needed.
- agy has no login command at all.

**The bug none of the reviews found.** claude prints its login link as an OSC 8
hyperlink (`ESC ] 8 ; ; uri BEL text ESC ] 8 ; ; BEL`), which contains the URL
twice with nothing between the copies. `stripAnsi` handled only CSI colour
codes, so the parser returned a 907-character string instead of the real
450-character URL and the button would have opened nothing. Both peer reviewers
read the source and missed it; running the CLI found it in one go.

## Progress (Full Timeline)

- [x] MCP feature removed and committed, with the borrowed-CSS breakage it caused repaired
- [x] Install/login flow: Node.js via brew/winget, CLI install, driven login, real readiness checks
- [x] Four rounds of two-peer independent review, ~20 findings, all fixed with regression tests
- [x] Provider badge tells the truth, including 확인 불가 for CLIs that cannot be asked
- [x] @-mentions highlighted in the input box (backdrop behind the textarea; IME-safe)
- [x] Provider-neutral, Korean placeholder and greeting
- [x] Vault folders mentionable with `@/`, ordered by closeness to the open note
- [ ] Shared MCP/skill setup — blocked on the scope decision
- [ ] Settings split into basic vs Advanced
- [ ] Folder mentions as chips instead of a long inline path

## Dead Ends (Negative Memory)

- Three folder-label shortening rules were tried and all failed on the real
  vault: a fixed two trailing segments (hid the subject, since every lecture
  project ends `lecture/WeekNN/notes`); growing until unique among the visible
  rows (collapsed when all rows came from one subject); growing until a folder
  name looked rare (picked `2026_1`, which occurs 3 times and means nothing,
  while the subject folder also occurs 3 times — frequency cannot separate
  them). The path is now shown whole over two lines. Do not attempt a fourth
  heuristic without new information.
- `.ocop-mention-folder` once carried `direction: rtl` to keep the tail of a
  path visible. It reverses the segments on screen and made a correct label
  display backwards. A test now fails if it returns.
- The obsidian test mock declares `onClose = jest.fn()` as a class field, which
  shadows the subclass method; call `Prototype.onClose.call(instance)` to test
  real teardown.
- Never claim a CLI cannot do something without spawning it. That mistake
  produced a wrong mockup earlier, and nearly deleted copilot login this session.

## Reproduction / Verification

```bash
cd /Users/mark/Projects/Tools/obsidian-ai-tutor
npm run typecheck && npm run lint && npm test -- --runInBand && npm run build
```
