# Obsidian AI Tutor

[![GitHub](https://img.shields.io/badge/GitHub-Obsidian--AI--Tutor-blue?style=for-the-badge&logo=github)](https://github.com/leeht1107/obsidian-ai-tutor)

Your AI assistant inside Obsidian — choose **one** official CLI and talk to it
right from the sidebar. Supported providers: **GitHub Copilot**, **Claude
Code**, **Codex**, and **agy (Antigravity)**.

Have meaningful conversations with your codebase or your notes. Your chosen
provider reads your files and current note, keeps conversation history, and
helps you write and study better — all directly within the Obsidian sidebar.

---

## 🌟 Key Features

*   **💬 Chat with Context**: Chat with your selected provider right in your sidebar.
*   **🧠 Context-Aware**: The provider knows about your current note and conversation history.
*   **⚡ Ultra-thin dispatch**: One native CLI process per request — no shared provider runtime, proxy, queue, or relay in between.
*   **📎 Smart Attachments**: Reference other notes using `@` to give the assistant more context.
*   **🧑‍🏫 Learning Modes**: Use `/quiz` for source-grounded checks and `/socratic` for a Korean digital teaching twin that adapts between challenge, coaching, and rescue-style scaffolding. Both work the same way regardless of which provider is selected.
*   **✏️ Inline Edits**: Select text and ask the assistant to rewrite, summarize, or fix it in place.

Copilot keeps its full existing feature surface (tool approvals, MCP, plan
mode, live diffs). Claude Code, Codex, and agy use the same chat, context,
Quiz, and Socratic flows through their own native CLI output — see the
[provider matrix](#-provider--setup-matrix) below for exactly what each
provider supports today.

---

## 🚀 Prerequisites

1.  **Install Node.js** (v22 or higher).
2.  **Pick one provider** and install + authenticate its official CLI:

| Provider | Install | Login | Notes |
|---|---|---|---|
| GitHub Copilot | `npm install -g @github/copilot` | `copilot login` | Standalone `copilot` CLI, not `gh copilot`. WinGet (Windows) / Homebrew (macOS/Linux) also work; the plugin's auto-install uses npm because it works cross-platform. |
| Claude Code | `npm install -g @anthropic-ai/claude-code` | `claude` (interactive login on first run) | |
| Codex | `npm install -g @openai/codex` | `codex login` | |
| agy (Antigravity) | No verified package-manager recipe yet | `agy` | Guided manual setup only — the plugin never runs a remote install script for agy. Recheck after you finish the CLI's own official install/login flow. |

3.  **Verify** the CLI you installed, e.g. for Copilot:
    ```bash
    copilot version
    copilot --help
    ```
    (Swap `copilot` for `claude`, `codex`, or `agy` depending on your choice.)

If npm reports a permissions error on macOS/Linux, prefer fixing your npm
global install location or using Homebrew first. Use `sudo npm install -g ...`
only as a last resort.

You only need to set up the one provider you plan to use. You can install and
authenticate a second or third provider later and switch between them at any
time in Settings.

---

## 📦 Installation

### Via BRAT (Recommended for Beta)

1.  Install **BRAT** from the Obsidian Community Plugins.
2.  Open command palette (`Cmd/Ctrl + P`) -> `BRAT: Add a beta plugin for testing`.
3.  Enter the repository URL: `https://github.com/leeht1107/obsidian-ai-tutor`.
    If your teacher or maintainer provides a class fork, use that fork URL instead.
4.  Enable "Obsidian AI Tutor" in Community Plugins settings.

### Manual Installation

1.  Clone this repository into your `.obsidian/plugins` folder.
2.  Run `npm install && npm run build`.
3.  Enable the plugin in Obsidian settings.

---

## 🎮 Usage

1.  **Choose your provider**: Open Settings -> Obsidian AI Tutor -> **AI provider**, and pick Copilot, Claude Code, Codex, or agy. The setup wizard (see below) walks you through installing and logging in to whichever one you pick.
2.  **Open Chat**: Click the robot icon in the left ribbon or run "Open chat view" command.
3.  **Ask Questions**: Type your question. Your selected provider answers based on the context.
4.  **Attach Files**: Type `@` to link specific notes or folders to the conversation.
5.  **Study from Notes**: Run `/socratic` to start a source-grounded Korean tutoring dialogue, or `/quiz` to generate one-question-at-a-time checks from the selected note scope.
6.  **Inline Edit**: Select text in any note -> Run "Inline edit" command -> Describe changes.

If the CLI for your selected provider isn't found, the plugin's setup wizard
opens automatically and offers to install it (where a verified
package-manager recipe exists) and walks you through that provider's own
login command.

---

## ⚙️ Configuration

*   **AI provider**: Choose exactly one of Copilot / Claude Code / Codex / agy. Only the selected provider is used for requests — switching does not start a second process or keep the previous one running.
*   **Provider CLI Path**: If a provider's CLI is not found automatically, enter the full path to its executable (e.g., `/usr/local/bin/copilot`).
*   **GitHub Token** (Copilot only, optional): Provide a `GH_TOKEN` if you prefer not to use the global auth session. This setting is never sent to the other three providers.
*   **AI Credits / Usage**: Each provider manages its own billing and usage limits (GitHub for Copilot, Anthropic for Claude Code, OpenAI for Codex, Antigravity for agy). Any usage shown by this plugin is based only on values observed locally from that provider's CLI responses, so it is not an authoritative credits, quota, billing, or remaining-balance view.

---

## 🧩 Provider / Setup Matrix

| Capability | Copilot | Claude Code | Codex | agy |
|---|---|---|---|---|
| Chat + Context | ✅ | ✅ | ✅ | ✅ |
| Quiz / Socratic learning modes | ✅ | ✅ | ✅ | ✅ |
| Auto-install (npm) | ✅ | ✅ | ✅ | ❌ guided manual only |
| Tool approvals, MCP, plan mode, live diffs | ✅ | native CLI output only | native CLI output only | native CLI output only |
| Dispatch model | 1 native CLI process per request, no shared runtime/proxy/relay | same | same | same |

See `docs/COMPLETION_PROOF_PACKET.md` for the underlying dispatch evidence
(one child process per request, sub-millisecond in-process overhead) and the
exact commands used to verify it.

---

## 📜 License

[MIT License](LICENSE)
