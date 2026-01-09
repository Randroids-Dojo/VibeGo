#!/bin/bash
# VibeGo Web Viewer - Stream tmux session to phone browser
# Usage: web-viewer.sh [start|stop|status]

set -e

# Configuration
PORT="${VIBEGO_WEB_PORT:-8765}"
LOG_DIR="$HOME/.vibego/logs"
LOG_FILE="$LOG_DIR/session.log"
PID_FILE="$LOG_DIR/web-viewer.pid"
HTML_FILE="$LOG_DIR/viewer.html"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
RESET='\033[0m'

get_local_ip() {
    ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || echo "localhost"
}

create_html_viewer() {
    cat > "$HTML_FILE" << 'HTMLEOF'
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>VibeGo Terminal</title>
    <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body {
            background: #1a1a2e;
            color: #eee;
            font-family: 'SF Mono', 'Menlo', 'Monaco', monospace;
            font-size: 12px;
            line-height: 1.4;
            padding: 10px;
            padding-bottom: 60px;
        }
        #header {
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            background: #16213e;
            padding: 8px 15px;
            display: flex;
            justify-content: space-between;
            align-items: center;
            z-index: 100;
            border-bottom: 1px solid #0f3460;
        }
        #header h1 {
            font-size: 14px;
            color: #e94560;
        }
        #status {
            font-size: 11px;
            color: #53bf9d;
        }
        #controls {
            position: fixed;
            bottom: 0;
            left: 0;
            right: 0;
            background: #16213e;
            padding: 10px;
            display: flex;
            gap: 10px;
            justify-content: center;
            border-top: 1px solid #0f3460;
        }
        button {
            background: #0f3460;
            color: #eee;
            border: none;
            padding: 8px 16px;
            border-radius: 5px;
            font-size: 12px;
            cursor: pointer;
        }
        button:active { background: #e94560; }
        button.active { background: #53bf9d; color: #1a1a2e; }
        #terminal {
            margin-top: 45px;
            white-space: pre-wrap;
            word-wrap: break-word;
            overflow-wrap: break-word;
        }
        .claude-msg { color: #53bf9d; }
        .user-msg { color: #e94560; }
        .tool-msg { color: #f39c12; }
        .dim { color: #666; }
    </style>
</head>
<body>
    <div id="header">
        <h1>VibeGo Terminal</h1>
        <span id="status">Connecting...</span>
    </div>
    <pre id="terminal"></pre>
    <div id="controls">
        <button id="autoScrollBtn" class="active" onclick="toggleAutoScroll()">Auto-scroll</button>
        <button onclick="clearTerminal()">Clear</button>
        <button onclick="location.reload()">Refresh</button>
    </div>

    <script>
        let autoScroll = true;
        let lastLength = 0;
        let lastUpdate = Date.now();

        function toggleAutoScroll() {
            autoScroll = !autoScroll;
            document.getElementById('autoScrollBtn').classList.toggle('active', autoScroll);
        }

        function clearTerminal() {
            document.getElementById('terminal').textContent = '';
            lastLength = 0;
        }

        function updateStatus(connected) {
            const status = document.getElementById('status');
            if (connected) {
                const ago = Math.round((Date.now() - lastUpdate) / 1000);
                status.textContent = `Live (${ago}s ago)`;
                status.style.color = '#53bf9d';
            } else {
                status.textContent = 'Disconnected';
                status.style.color = '#e94560';
            }
        }

        function colorize(text) {
            // Basic colorization for Claude Code output
            return text
                .replace(/^(Human:|User:)/gm, '<span class="user-msg">$1</span>')
                .replace(/^(Assistant:|Claude:)/gm, '<span class="claude-msg">$1</span>')
                .replace(/^(\s*[▶●◆→])/gm, '<span class="tool-msg">$1</span>')
                .replace(/(✓|✔)/g, '<span class="claude-msg">$1</span>')
                .replace(/(✗|✘|Error:|error:)/gi, '<span class="user-msg">$1</span>');
        }

        async function fetchLog() {
            try {
                const response = await fetch('/session.log?t=' + Date.now());
                if (response.ok) {
                    const text = await response.text();
                    if (text.length !== lastLength) {
                        const terminal = document.getElementById('terminal');
                        terminal.innerHTML = colorize(text);
                        lastLength = text.length;
                        lastUpdate = Date.now();
                        if (autoScroll) {
                            window.scrollTo(0, document.body.scrollHeight);
                        }
                    }
                    updateStatus(true);
                } else {
                    updateStatus(false);
                }
            } catch (e) {
                updateStatus(false);
            }
        }

        // Initial fetch and set up polling
        fetchLog();
        setInterval(fetchLog, 1000);
        setInterval(() => updateStatus(Date.now() - lastUpdate < 5000), 1000);
    </script>
</body>
</html>
HTMLEOF
}

start_capture() {
    # Create log directory
    mkdir -p "$LOG_DIR"

    # Check if tmux session exists
    if ! tmux has-session -t mobile 2>/dev/null; then
        echo -e "${RED}Error: tmux session 'mobile' not found${RESET}"
        echo "Start a tmux session first: tmux new -s mobile"
        exit 1
    fi

    # Clear old log
    > "$LOG_FILE"

    # Start capturing tmux output
    # Use pipe-pane to stream all pane output to file
    tmux pipe-pane -t mobile -o "cat >> '$LOG_FILE'"

    echo -e "${GREEN}Started capturing tmux output${RESET}"
}

stop_capture() {
    # Stop tmux pipe-pane
    tmux pipe-pane -t mobile 2>/dev/null || true
    echo -e "${YELLOW}Stopped capturing tmux output${RESET}"
}

start_server() {
    mkdir -p "$LOG_DIR"
    create_html_viewer

    # Check if server already running
    if [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
        echo -e "${YELLOW}Web server already running${RESET}"
        return
    fi

    # Start Python HTTP server
    cd "$LOG_DIR"
    python3 -m http.server "$PORT" --bind 0.0.0.0 > /dev/null 2>&1 &
    echo $! > "$PID_FILE"

    local ip=$(get_local_ip)
    echo -e "${GREEN}Web server started${RESET}"
    echo -e "View at: ${CYAN}http://${ip}:${PORT}/viewer.html${RESET}"
}

stop_server() {
    if [ -f "$PID_FILE" ]; then
        kill "$(cat "$PID_FILE")" 2>/dev/null || true
        rm -f "$PID_FILE"
        echo -e "${YELLOW}Web server stopped${RESET}"
    fi
}

show_status() {
    local ip=$(get_local_ip)

    echo -e "${CYAN}=== VibeGo Web Viewer Status ===${RESET}"
    echo

    # Check tmux capture
    if tmux show-options -t mobile pipe-pane 2>/dev/null | grep -q "cat"; then
        echo -e "Capture: ${GREEN}Running${RESET}"
    else
        echo -e "Capture: ${YELLOW}Not running${RESET}"
    fi

    # Check web server
    if [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
        echo -e "Server:  ${GREEN}Running on port ${PORT}${RESET}"
        echo -e "URL:     ${CYAN}http://${ip}:${PORT}/viewer.html${RESET}"
    else
        echo -e "Server:  ${YELLOW}Not running${RESET}"
    fi

    # Log file info
    if [ -f "$LOG_FILE" ]; then
        local size=$(du -h "$LOG_FILE" | cut -f1)
        local lines=$(wc -l < "$LOG_FILE" | tr -d ' ')
        echo -e "Log:     ${size} (${lines} lines)"
    fi
}

show_help() {
    echo "VibeGo Web Viewer - Stream tmux to phone browser"
    echo
    echo "Usage: web-viewer.sh [command]"
    echo
    echo "Commands:"
    echo "  start   Start capture and web server"
    echo "  stop    Stop capture and web server"
    echo "  status  Show current status"
    echo "  url     Print the viewer URL"
    echo "  help    Show this help"
    echo
    echo "Environment variables:"
    echo "  VIBEGO_WEB_PORT  HTTP port (default: 8765)"
}

case "${1:-status}" in
    start)
        start_capture
        start_server
        show_status
        ;;
    stop)
        stop_capture
        stop_server
        ;;
    status)
        show_status
        ;;
    url)
        echo "http://$(get_local_ip):${PORT}/viewer.html"
        ;;
    help|--help|-h)
        show_help
        ;;
    *)
        echo "Unknown command: $1"
        show_help
        exit 1
        ;;
esac
