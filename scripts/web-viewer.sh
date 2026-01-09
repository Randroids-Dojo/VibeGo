#!/bin/bash
# VibeGo Web Viewer - Stream tmux session to phone browser
# Usage: web-viewer.sh [start|stop|status]

set -e

# Configuration
PORT="${VIBEGO_WEB_PORT:-8765}"
LOG_DIR="$HOME/.vibego/logs"
PID_FILE="$LOG_DIR/web-viewer.pid"
HTML_FILE="$LOG_DIR/viewer.html"
SESSION="${VIBEGO_TMUX_SESSION:-mobile}"

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
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
    <title>VibeGo Terminal</title>
    <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body {
            background: #1a1a2e;
            color: #eee;
            font-family: 'SF Mono', 'Menlo', 'Monaco', monospace;
            font-size: 12px;
            line-height: 1.4;
            overflow-x: hidden;
        }
        #header {
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            background: #16213e;
            z-index: 100;
            border-bottom: 1px solid #0f3460;
        }
        #title-bar {
            padding: 8px 15px;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        #title-bar h1 {
            font-size: 14px;
            color: #e94560;
        }
        #status {
            font-size: 11px;
            color: #53bf9d;
        }
        #tabs {
            display: flex;
            overflow-x: auto;
            -webkit-overflow-scrolling: touch;
            scrollbar-width: none;
            padding: 0 10px;
            gap: 5px;
            padding-bottom: 8px;
        }
        #tabs::-webkit-scrollbar { display: none; }
        .tab {
            flex-shrink: 0;
            background: #0f3460;
            color: #aaa;
            border: none;
            padding: 6px 14px;
            border-radius: 15px;
            font-size: 11px;
            cursor: pointer;
            display: flex;
            align-items: center;
            gap: 6px;
            font-family: inherit;
        }
        .tab:active { transform: scale(0.95); }
        .tab.active {
            background: #e94560;
            color: #fff;
        }
        .tab .indicator {
            width: 6px;
            height: 6px;
            border-radius: 50%;
            background: #53bf9d;
            display: none;
        }
        .tab.has-update .indicator {
            display: block;
            animation: pulse 1s infinite;
        }
        .tab.active .indicator { display: none; }
        @keyframes pulse {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.3; }
        }
        #terminal-container {
            margin-top: 85px;
            margin-bottom: 55px;
            padding: 10px;
        }
        #terminal {
            white-space: pre-wrap;
            word-wrap: break-word;
            overflow-wrap: break-word;
        }
        #controls {
            position: fixed;
            bottom: 0;
            left: 0;
            right: 0;
            background: #16213e;
            padding: 10px;
            display: flex;
            gap: 8px;
            justify-content: center;
            border-top: 1px solid #0f3460;
        }
        button {
            background: #0f3460;
            color: #eee;
            border: none;
            padding: 8px 14px;
            border-radius: 5px;
            font-size: 11px;
            cursor: pointer;
            font-family: inherit;
        }
        button:active { background: #e94560; }
        button.active { background: #53bf9d; color: #1a1a2e; }
        .claude-msg { color: #53bf9d; }
        .user-msg { color: #e94560; }
        .tool-msg { color: #f39c12; }
        .system-msg { color: #3498db; }
        .error-msg { color: #e74c3c; }
        .dim { color: #666; }
        #loading {
            text-align: center;
            padding: 40px;
            color: #666;
        }
        .empty-state {
            text-align: center;
            padding: 40px 20px;
            color: #666;
        }
        .empty-state p { margin: 10px 0; }
    </style>
</head>
<body>
    <div id="header">
        <div id="title-bar">
            <h1>VibeGo</h1>
            <span id="status">Connecting...</span>
        </div>
        <div id="tabs">
            <div id="loading">Loading windows...</div>
        </div>
    </div>
    <div id="terminal-container">
        <pre id="terminal"></pre>
    </div>
    <div id="controls">
        <button id="autoScrollBtn" class="active" onclick="toggleAutoScroll()">Auto-scroll</button>
        <button onclick="clearTerminal()">Clear</button>
        <button onclick="refreshWindows()">Refresh</button>
    </div>

    <script>
        let autoScroll = true;
        let currentWindow = 0;
        let windows = [];
        let windowData = {};
        let lastLengths = {};
        let lastUpdate = Date.now();

        function toggleAutoScroll() {
            autoScroll = !autoScroll;
            document.getElementById('autoScrollBtn').classList.toggle('active', autoScroll);
        }

        function clearTerminal() {
            document.getElementById('terminal').textContent = '';
            if (windowData[currentWindow]) {
                windowData[currentWindow].cleared = true;
            }
        }

        function updateStatus(connected) {
            const status = document.getElementById('status');
            if (connected) {
                const ago = Math.round((Date.now() - lastUpdate) / 1000);
                status.textContent = `Live • W${currentWindow}`;
                status.style.color = '#53bf9d';
            } else {
                status.textContent = 'Disconnected';
                status.style.color = '#e94560';
            }
        }

        function colorize(text) {
            return text
                .replace(/^(Human:|User:|>)/gm, '<span class="user-msg">$1</span>')
                .replace(/^(Assistant:|Claude:)/gm, '<span class="claude-msg">$1</span>')
                .replace(/(^|\s)(✓|✔|Done|Success)/gm, '$1<span class="claude-msg">$2</span>')
                .replace(/(✗|✘|Error:|error:|FAILED|Failed)/gi, '<span class="error-msg">$1</span>')
                .replace(/^(\s*[▶●◆→⟩])/gm, '<span class="tool-msg">$1</span>')
                .replace(/^(───|━━━|---).*/gm, '<span class="dim">$&</span>');
        }

        function switchWindow(windowIndex) {
            currentWindow = windowIndex;

            // Update tab styles
            document.querySelectorAll('.tab').forEach((tab, i) => {
                tab.classList.toggle('active', i === windowIndex);
                if (i === windowIndex) {
                    tab.classList.remove('has-update');
                }
            });

            // Show window content
            renderCurrentWindow();
            updateStatus(true);
        }

        function renderCurrentWindow() {
            const terminal = document.getElementById('terminal');
            const data = windowData[currentWindow];

            if (!data || !data.content) {
                terminal.innerHTML = '<div class="empty-state"><p>No output yet</p><p class="dim">Start Claude Code in this window</p></div>';
                return;
            }

            terminal.innerHTML = colorize(data.content);

            if (autoScroll) {
                window.scrollTo(0, document.body.scrollHeight);
            }
        }

        function renderTabs() {
            const tabsContainer = document.getElementById('tabs');

            if (windows.length === 0) {
                tabsContainer.innerHTML = '<div class="empty-state">No tmux windows found</div>';
                return;
            }

            tabsContainer.innerHTML = windows.map((win, i) => {
                const isActive = i === currentWindow;
                const hasUpdate = windowData[i]?.hasUpdate && !isActive;
                return `
                    <button class="tab ${isActive ? 'active' : ''} ${hasUpdate ? 'has-update' : ''}"
                            onclick="switchWindow(${i})">
                        <span class="indicator"></span>
                        W${win.index}: ${win.name}
                    </button>
                `;
            }).join('');
        }

        async function fetchWindows() {
            try {
                const response = await fetch('/windows.json?t=' + Date.now());
                if (response.ok) {
                    const data = await response.json();
                    windows = data.windows || [];
                    renderTabs();

                    // Auto-select first window if none selected
                    if (windows.length > 0 && !windows.find(w => w.index === currentWindow)) {
                        currentWindow = windows[0].index;
                    }
                }
            } catch (e) {
                console.error('Failed to fetch windows:', e);
            }
        }

        async function fetchLog(windowIndex) {
            try {
                const response = await fetch(`/window-${windowIndex}.log?t=` + Date.now());
                if (response.ok) {
                    const text = await response.text();
                    const prevLength = lastLengths[windowIndex] || 0;

                    if (text.length !== prevLength) {
                        if (!windowData[windowIndex]) {
                            windowData[windowIndex] = {};
                        }

                        windowData[windowIndex].content = text;
                        windowData[windowIndex].hasUpdate = windowIndex !== currentWindow;
                        lastLengths[windowIndex] = text.length;
                        lastUpdate = Date.now();

                        // Re-render tabs to show update indicator
                        renderTabs();

                        // If this is current window, update display
                        if (windowIndex === currentWindow) {
                            renderCurrentWindow();
                        }
                    }
                    return true;
                }
            } catch (e) {
                // Window log might not exist yet
            }
            return false;
        }

        async function fetchAllLogs() {
            let anySuccess = false;
            for (const win of windows) {
                if (await fetchLog(win.index)) {
                    anySuccess = true;
                }
            }
            updateStatus(anySuccess);
        }

        async function refreshWindows() {
            await fetchWindows();
            await fetchAllLogs();
        }

        // Initial load
        refreshWindows();

        // Poll for updates
        setInterval(fetchAllLogs, 1000);
        setInterval(fetchWindows, 5000);  // Refresh window list less frequently
    </script>
</body>
</html>
HTMLEOF
}

update_windows_json() {
    # Get list of windows and write to JSON
    local windows_json="$LOG_DIR/windows.json"

    if tmux has-session -t "$SESSION" 2>/dev/null; then
        # Get window list
        local windows=$(tmux list-windows -t "$SESSION" -F '{"index":#{window_index},"name":"#{window_name}","active":#{window_active}}' 2>/dev/null | tr '\n' ',' | sed 's/,$//')
        echo "{\"windows\":[${windows}],\"session\":\"${SESSION}\"}" > "$windows_json"
    else
        echo '{"windows":[],"session":"'$SESSION'","error":"no session"}' > "$windows_json"
    fi
}

start_capture() {
    mkdir -p "$LOG_DIR"

    if ! tmux has-session -t "$SESSION" 2>/dev/null; then
        echo -e "${RED}Error: tmux session '$SESSION' not found${RESET}"
        echo "Start a tmux session first: tmux new -s $SESSION"
        exit 1
    fi

    # Stop any existing captures
    stop_capture 2>/dev/null || true

    # Get all windows and start capturing each
    local windows=$(tmux list-windows -t "$SESSION" -F '#{window_index}' 2>/dev/null)

    for win_idx in $windows; do
        local log_file="$LOG_DIR/window-${win_idx}.log"
        > "$log_file"  # Clear log

        # Capture the first pane of each window
        tmux pipe-pane -t "${SESSION}:${win_idx}" -o "cat >> '$log_file'"
        echo -e "${GREEN}Capturing window $win_idx → window-${win_idx}.log${RESET}"
    done

    # Create initial windows.json
    update_windows_json

    # Start background process to update windows.json periodically
    (
        while true; do
            sleep 2
            update_windows_json

            # Also start capturing any new windows
            local current_windows=$(tmux list-windows -t "$SESSION" -F '#{window_index}' 2>/dev/null)
            for win_idx in $current_windows; do
                local log_file="$LOG_DIR/window-${win_idx}.log"
                if [[ ! -f "$log_file" ]]; then
                    > "$log_file"
                    tmux pipe-pane -t "${SESSION}:${win_idx}" -o "cat >> '$log_file'"
                fi
            done
        done
    ) &
    echo $! > "$LOG_DIR/updater.pid"
}

stop_capture() {
    # Stop all pipe-panes
    if tmux has-session -t "$SESSION" 2>/dev/null; then
        local windows=$(tmux list-windows -t "$SESSION" -F '#{window_index}' 2>/dev/null)
        for win_idx in $windows; do
            tmux pipe-pane -t "${SESSION}:${win_idx}" 2>/dev/null || true
        done
    fi

    # Stop updater
    if [[ -f "$LOG_DIR/updater.pid" ]]; then
        kill "$(cat "$LOG_DIR/updater.pid")" 2>/dev/null || true
        rm -f "$LOG_DIR/updater.pid"
    fi

    echo -e "${YELLOW}Stopped capturing${RESET}"
}

start_server() {
    mkdir -p "$LOG_DIR"
    create_html_viewer

    if [[ -f "$PID_FILE" ]] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
        echo -e "${YELLOW}Web server already running${RESET}"
        return
    fi

    cd "$LOG_DIR"
    python3 -m http.server "$PORT" --bind 0.0.0.0 > /dev/null 2>&1 &
    echo $! > "$PID_FILE"

    local ip=$(get_local_ip)
    echo -e "${GREEN}Web server started${RESET}"
    echo -e "View at: ${CYAN}http://${ip}:${PORT}/viewer.html${RESET}"
}

stop_server() {
    if [[ -f "$PID_FILE" ]]; then
        kill "$(cat "$PID_FILE")" 2>/dev/null || true
        rm -f "$PID_FILE"
        echo -e "${YELLOW}Web server stopped${RESET}"
    fi
}

show_status() {
    local ip=$(get_local_ip)

    echo -e "${CYAN}=== VibeGo Web Viewer Status ===${RESET}"
    echo

    # Check tmux session
    if tmux has-session -t "$SESSION" 2>/dev/null; then
        local win_count=$(tmux list-windows -t "$SESSION" 2>/dev/null | wc -l | tr -d ' ')
        echo -e "Session: ${GREEN}$SESSION ($win_count windows)${RESET}"
    else
        echo -e "Session: ${RED}$SESSION not found${RESET}"
    fi

    # Check capture
    if [[ -f "$LOG_DIR/updater.pid" ]] && kill -0 "$(cat "$LOG_DIR/updater.pid")" 2>/dev/null; then
        echo -e "Capture: ${GREEN}Running${RESET}"
    else
        echo -e "Capture: ${YELLOW}Not running${RESET}"
    fi

    # Check web server
    if [[ -f "$PID_FILE" ]] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
        echo -e "Server:  ${GREEN}Running on port ${PORT}${RESET}"
        echo -e "URL:     ${CYAN}http://${ip}:${PORT}/viewer.html${RESET}"
    else
        echo -e "Server:  ${YELLOW}Not running${RESET}"
    fi

    # Log files info
    echo
    echo "Log files:"
    for f in "$LOG_DIR"/window-*.log; do
        if [[ -f "$f" ]]; then
            local name=$(basename "$f")
            local size=$(du -h "$f" | cut -f1)
            local lines=$(wc -l < "$f" | tr -d ' ')
            echo "  $name: ${size} (${lines} lines)"
        fi
    done
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
    echo "  VIBEGO_WEB_PORT      HTTP port (default: 8765)"
    echo "  VIBEGO_TMUX_SESSION  tmux session name (default: mobile)"
}

case "${1:-status}" in
    start)
        start_capture
        start_server
        echo
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
