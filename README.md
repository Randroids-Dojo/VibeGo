# VibeGo

Control Claude Code and Codex CLI on your Mac from your phone over local WiFi.

## Supported CLI Tools

| Tool | Notifications |
|------|---------------|
| **Claude Code** | Questions, permissions, task completion |
| **Codex CLI** | Task completion only* |

*Codex CLI currently only fires `agent-turn-complete` events. Question/permission notifications are not yet supported by Codex.

## How It Works

```
Phone (Termius) ──SSH──> Mac (tmux + Claude/Codex)
                                │
Phone (ntfy) <────────── notification hooks (tap to open Termius)
```

SSH into your Mac, auto-attach to a persistent tmux session, and get push notifications when the AI needs input or finishes.

## Quick Start

### Mac Setup

```bash
git clone https://github.com/anthropics/vibego.git
cd vibego
./setup.sh
```

The script installs dependencies (tmux, jq), configures notification hooks for your CLI tools (Claude Code and/or Codex), and sets up tmux auto-attach for SSH sessions.

**Required:** Enable Remote Login in System Settings → General → Sharing.

### Phone Setup

1. **Install apps:**
   - [Termius](https://termius.com) — SSH client (iOS & Android)
   - [ntfy](https://ntfy.sh) — push notifications (iOS & Android)

2. **Configure ntfy:**
   - Open ntfy → tap **+** → enter your topic name (shown by setup script)

3. **Configure Termius:**
   - Add new host: `username@ip` (shown by setup script)
   - Connect once to save

4. **Test:**
   - SSH into your Mac → auto-attaches to tmux
   - Run `claude` or `codex` in any project
   - Get notification when the AI needs input or finishes
   - **Tap notification → opens Termius directly**

## Notifications

### Claude Code
| Event | When |
|-------|------|
| **Question** | Claude asks you something |
| **Permission** | Claude needs approval to run a tool |
| **Task Complete** | Claude finished and is waiting |

### Codex CLI
| Event | When |
|-------|------|
| **Task Complete** | Codex finished a task |

Notifications show the project path and tmux window:
- `[ACTIVE] Dev/MyProject: ...` — you're viewing this window
- `[W1] Dev/OtherProject: ...` — from window 1, switch with `Ctrl+b 1`
- `Dev/MyProject: ...` (no prefix) — running outside tmux

## Multiple Sessions

Create multiple AI coding sessions in tmux windows:

| Action | Keys |
|--------|------|
| New window | `Ctrl+b c` |
| Switch to window N | `Ctrl+b N` (0-9) |
| Next/prev window | `Ctrl+b n` / `Ctrl+b p` |

**Using Ctrl in Termius:** Long-press on the keyboard area → select Ctrl → then press b, then window number.

## jj VCS Integration (Optional)

Work on the same project from multiple Claude Code sessions simultaneously without conflicts blocking your workflow.

[jj (Jujutsu)](https://github.com/jj-vcs/jj) is a Git-compatible VCS that:
- Records conflicts instead of blocking operations
- Enables multiple independent changes in parallel
- Auto-reconciles concurrent edits via operation log

### Setup

The setup script offers jj as an optional component, or install manually:

```bash
brew install jj
./scripts/jj-init-project.sh /path/to/your/project
source ~/.local/bin/jj-helpers.sh
```

### Multi-Session Workflow

```bash
# Window 0: Work on player feature
jj-task "add player dash ability"
# Claude Code works...

# Window 1: Work on enemy AI (same time, same repo)
jj-task "improve enemy pathfinding"
# Claude Code works...

# Later: See all active work
jj-tasks

# Reconcile when ready
jj-reconcile
```

### Key Commands

| Command | Description |
|---------|-------------|
| `jj-task "desc"` | Start new independent change |
| `jj-tasks` | See all active changes |
| `jj-conflicts` | Show changes with conflicts |
| `jj-sync` | Rebase onto latest main |
| `jj-reconcile` | Options for combining work |
| `jj-push` | Push to GitHub |

See [docs/jj-workflow.md](docs/jj-workflow.md) for full documentation.

## Auto-Responder (Optional)

Run an LLM agent that automatically responds to Claude Code prompts:

```bash
cd auto-responder
./setup.sh
```

The auto-responder can:
- **Auto-approve safe operations** (file reads, searches)
- **Use an LLM** (Claude/OpenAI/Ollama) to analyze prompts
- **Always notify** for sensitive operations (deletions, bash commands)

Configure rules in `~/.config/vibego/auto-responder.yaml`:

```yaml
rules:
  prompts:
    permissions:
      auto_respond_patterns:
        - "Read file"
        - "List directory"
      always_notify_patterns:
        - "Write|Edit|Delete"
        - "Bash|Execute"
```

See [auto-responder/README.md](auto-responder/README.md) for full documentation.

## Troubleshooting

**No notifications:** Test manually:
```bash
curl -X POST "https://ntfy.sh/YOUR-TOPIC" -d "test"
```

**tmux not auto-attaching:** Check `~/.zshrc` has the VibeGo section.

**Can't SSH:** Enable Remote Login in System Settings → General → Sharing.

## Credits

Inspired by [Claude Code on the Go](https://granda.org/en/2026/01/02/claude-code-on-the-go/)

- [ntfy.sh](https://ntfy.sh) — push notifications
- [tmux](https://github.com/tmux/tmux) — terminal multiplexing
- [jj (Jujutsu)](https://github.com/jj-vcs/jj) — Git-compatible VCS for concurrent workflows
