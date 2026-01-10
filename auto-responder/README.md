# VibeGo Auto-Responder

A Node.js service that automatically responds to Claude Code prompts based on configurable rules and LLM analysis.

## Overview

The Auto-Responder intercepts Claude Code notifications (questions, permission prompts) and can:
- Automatically approve safe operations (file reads, directory listings)
- Use an LLM to analyze prompts and decide how to respond
- Always notify for sensitive operations (deletions, bash commands, credentials)

## Architecture

```
Claude Code → Hook Scripts → Unix Socket → Auto-Responder Service
                                                    ↓
                                             Rule Engine → LLM Provider
                                                    ↓
                                            tmux send-keys
```

## Installation

### 1. Build the service

```bash
cd auto-responder
npm install
npm run build
```

### 2. Create configuration

```bash
mkdir -p ~/.config/vibego
cp config/config.example.yaml ~/.config/vibego/auto-responder.yaml
```

Edit the config to:
- Set your preferred LLM provider (claude/openai/ollama)
- Customize auto-respond patterns
- Set `dry_run: true` initially for testing

### 3. Set API keys (if using cloud LLM)

```bash
# For Claude
export ANTHROPIC_API_KEY="your-key-here"

# For OpenAI
export OPENAI_API_KEY="your-key-here"
```

Add to your `~/.zshrc` or `~/.zshenv` for persistence.

### 4. Install hook integration

Copy the hook helper:

```bash
cp hooks/auto-respond.sh ~/.claude/hooks/
chmod +x ~/.claude/hooks/auto-respond.sh
```

Modify your existing notification hooks to call auto-responder first. Add this to the beginning of `~/.claude/hooks/notify.sh`:

```bash
# Try auto-responder first
if echo "$EVENT_DATA" | ~/.claude/hooks/auto-respond.sh "AskUserQuestion"; then
  exit 0  # Handled by auto-responder
fi
```

### 5. Install as launchd daemon (optional)

```bash
# Create log directory
mkdir -p ~/.vibego/logs

# Copy plist (edit paths first if needed)
cp ../launchd/com.vibego.auto-responder.plist ~/Library/LaunchAgents/

# Load the service
launchctl load ~/Library/LaunchAgents/com.vibego.auto-responder.plist
```

## Usage

### Manual start

```bash
cd auto-responder
npm start
```

### Service management

```bash
# Start
launchctl load ~/Library/LaunchAgents/com.vibego.auto-responder.plist

# Stop
launchctl unload ~/Library/LaunchAgents/com.vibego.auto-responder.plist

# Check status
launchctl list | grep vibego

# View logs
tail -f ~/.vibego/logs/auto-responder.log
```

### Testing with dry run

Set `rules.dry_run: true` in config to see what the service would do without actually sending responses.

## Configuration

See `config/config.example.yaml` for all options. Key settings:

### LLM Provider

```yaml
llm:
  provider: "claude"  # claude | openai | ollama
```

### Auto-respond patterns

```yaml
rules:
  prompts:
    questions:
      auto_respond_patterns:
        - "Should I proceed\\?"
        - "Is this okay\\?"
```

### Safety patterns (never auto-respond)

```yaml
      always_notify_patterns:
        - "delete|remove|drop"
        - "password|secret|credential"
        - "production|prod"
```

## Security

- Unix socket with `0600` permissions (owner-only)
- `always_notify_patterns` cannot be bypassed by LLM
- API keys read from environment variables only
- Dry run mode for safe testing

## Troubleshooting

### Service not responding

1. Check if socket exists: `ls -la /tmp/vibego-responder.sock`
2. Check logs: `tail ~/.vibego/logs/auto-responder.log`
3. Verify the service is running: `launchctl list | grep vibego`

### LLM errors

1. Verify API key is set: `echo $ANTHROPIC_API_KEY`
2. Check network connectivity
3. The service falls back to rule-based decisions on LLM errors

### tmux issues

1. Ensure tmux is running
2. Verify session name matches config (`mobile` by default)
3. Check tmux target in logs
