#!/bin/bash
# VibeGo Auto-Responder Hook Helper
# Called by notify.sh and notify-idle.sh to check if auto-responder should handle the event
#
# Usage: echo "$EVENT_DATA" | auto-respond.sh <event_type>
# Returns: exit 0 if handled, exit 1 if not handled (should notify user)

SOCKET_PATH="/tmp/vibego-responder.sock"
TIMEOUT_SEC=10

# Event type passed as argument
EVENT_TYPE="${1:-unknown}"

# Read event data from stdin
EVENT_DATA=$(cat)

# Check if socket exists
if [ ! -S "$SOCKET_PATH" ]; then
  # Auto-responder not running, fall through to notification
  exit 1
fi

# Get tmux context
TMUX_SESSION=""
TMUX_WINDOW=""
TMUX_PANE_ID=""

if [ -n "$TMUX_PANE" ]; then
  TMUX_SESSION=$(tmux display-message -p '#{session_name}' 2>/dev/null || echo "")
  TMUX_WINDOW=$(tmux display-message -p '#{window_index}' 2>/dev/null || echo "0")
  TMUX_PANE_ID="$TMUX_PANE"
fi

# Build request payload using jq
REQUEST=$(jq -n \
  --arg event_type "$EVENT_TYPE" \
  --arg session "$TMUX_SESSION" \
  --arg window "$TMUX_WINDOW" \
  --arg pane "$TMUX_PANE_ID" \
  --arg cwd "$(pwd)" \
  --arg timestamp "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --argjson event_data "$EVENT_DATA" \
  '{
    event_type: $event_type,
    event_data: $event_data,
    tmux: {
      session: $session,
      window: $window,
      pane: $pane
    },
    cwd: $cwd,
    timestamp: $timestamp
  }')

# Send to auto-responder service via Unix socket
# Using nc (netcat) with Unix socket support
# Returns: {"handled": true/false, "action": "auto_respond|notify|ignore"}
RESPONSE=$(echo "$REQUEST" | nc -U -w "$TIMEOUT_SEC" "$SOCKET_PATH" 2>/dev/null)

# Check if we got a response
if [ -z "$RESPONSE" ]; then
  # No response, service might be down
  exit 1
fi

# Check if service handled it
HANDLED=$(echo "$RESPONSE" | jq -r '.handled // false')

if [ "$HANDLED" = "true" ]; then
  # Service handled it, exit successfully (skip notification)
  exit 0
fi

# Service didn't handle it, fall through to notification
exit 1
