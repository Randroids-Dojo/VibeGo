# VibeGo

Control Claude Code on your Mac from your Android phone over local WiFi.

## How It Works

```
Android (ConnectBot) ──SSH──> Mac (tmux + Claude Code)
                                      │
Android (ntfy) <───────────── notification hooks
```

SSH into your Mac, auto-attach to a persistent tmux session, and get push notifications when Claude needs input.

## Quick Start

### Mac Setup

```bash
git clone https://github.com/anthropics/vibego.git
cd vibego
./setup.sh
```

The script installs dependencies (tmux, jq), configures Claude Code hooks, and sets up tmux auto-attach for SSH sessions.

**Required:** Enable Remote Login in System Settings → General → Sharing.

### Android Setup

1. **Install apps:**
   - [ConnectBot](https://play.google.com/store/apps/details?id=org.connectbot) — SSH client
   - [ntfy](https://play.google.com/store/apps/details?id=io.heckel.ntfy) — push notifications

2. **Configure ntfy:**
   - Open ntfy → tap **+** → enter your topic name (shown by setup script)

3. **Configure ConnectBot:**
   - Enter: `username@ip` (shown by setup script)
   - Connect once to save

4. **Test:**
   - SSH into your Mac → auto-attaches to tmux
   - Run `claude` in any project
   - Get notification when Claude needs input

## Notifications

Three types of notifications:

| Event | When |
|-------|------|
| **Question** | Claude asks you something |
| **Permission** | Claude needs approval to run a tool |
| **Idle** | Claude finished and is waiting |

Notifications show the project path and tmux window:
- `[ACTIVE] Dev/MyProject: ...` — you're viewing this window
- `[W1] Dev/OtherProject: ...` — from window 1, switch with `Ctrl+b 1`
- `Dev/MyProject: ...` (no prefix) — running outside tmux

## Multiple Sessions

Create multiple Claude Code sessions in tmux windows:

| Action | Keys |
|--------|------|
| New window | `Ctrl+b c` |
| Switch to window N | `Ctrl+b N` (0-9) |
| Next/prev window | `Ctrl+b n` / `Ctrl+b p` |

**Using Ctrl in ConnectBot:** Tap screen → tap Ctrl (left) → b → window number.

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
