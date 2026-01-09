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
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover">
    <title>VibeGo Terminal</title>
    <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        html, body {
            background: #1a1a2e;
            color: #eee;
            font-family: 'SF Mono', 'Menlo', 'Monaco', monospace;
            font-size: 12px;
            line-height: 1.4;
            overflow-x: hidden;
            min-height: 100%;
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
            margin-bottom: 65px;
            padding: 10px;
            padding-bottom: 20px;
            background: #1a1a2e;
            position: relative;
            z-index: 1;
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
            padding-bottom: calc(10px + env(safe-area-inset-bottom, 0px));
            display: flex;
            gap: 8px;
            justify-content: center;
            border-top: 1px solid #0f3460;
            z-index: 101;
            -webkit-transform: translateZ(0);
            transform: translateZ(0);
            -webkit-backface-visibility: hidden;
            backface-visibility: hidden;
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
        /* Screenshot Modal */
        #screenshot-modal {
            display: none;
            position: fixed;
            top: 0; left: 0; right: 0; bottom: 0;
            background: rgba(0,0,0,0.95);
            z-index: 200;
            justify-content: center;
            align-items: center;
            flex-direction: column;
        }
        #screenshot-modal.visible { display: flex; }
        #screenshot-modal img {
            max-width: 95%;
            max-height: 80%;
            object-fit: contain;
            border: 2px solid #0f3460;
            border-radius: 8px;
        }
        #screenshot-modal .close-btn {
            position: absolute;
            top: 20px; right: 20px;
            background: #e94560;
            color: white;
            border: none;
            padding: 10px 20px;
            border-radius: 5px;
            cursor: pointer;
            font-family: inherit;
        }
        #screenshot-modal .info {
            color: #666;
            margin-top: 15px;
            font-size: 11px;
        }
        #screenshot-loading { color: #53bf9d; font-size: 14px; }
        /* Navigation Confirmation Modal */
        #nav-confirm-modal {
            display: none;
            position: fixed;
            top: 0; left: 0; right: 0; bottom: 0;
            background: rgba(0,0,0,0.95);
            z-index: 300;
            justify-content: center;
            align-items: center;
        }
        #nav-confirm-modal.visible { display: flex; }
        #nav-confirm-modal .modal-content {
            background: #16213e;
            padding: 30px;
            border-radius: 12px;
            text-align: center;
            max-width: 300px;
            border: 1px solid #0f3460;
        }
        #nav-confirm-modal h3 {
            color: #e94560;
            margin-bottom: 10px;
            font-size: 18px;
        }
        #nav-confirm-modal p {
            color: #aaa;
            margin-bottom: 25px;
            font-size: 13px;
        }
        #nav-confirm-modal .modal-buttons {
            display: flex;
            gap: 15px;
            justify-content: center;
        }
        #nav-confirm-modal .stay-btn {
            background: #53bf9d;
            color: #1a1a2e;
            padding: 12px 24px;
            border-radius: 6px;
            font-weight: bold;
        }
        #nav-confirm-modal .leave-btn {
            background: #0f3460;
            color: #aaa;
            padding: 12px 24px;
            border-radius: 6px;
        }
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
        <button onclick="jumpToTop()">Top</button>
        <button onclick="jumpToBottom()">Bottom</button>
        <button id="autoScrollBtn" class="active" onclick="toggleAutoScroll()">Auto</button>
        <button onclick="clearTerminal()">Clear</button>
        <button onclick="refreshWindows()">Refresh</button>
        <button onclick="takeScreenshot()">Screen</button>
    </div>
    <div id="screenshot-modal">
        <button class="close-btn" onclick="closeScreenshot()">Close</button>
        <div id="screenshot-loading">Taking screenshot...</div>
        <img id="screenshot-img" style="display:none" onclick="closeScreenshot()">
        <div class="info">Tap image or Close to dismiss</div>
    </div>
    <div id="nav-confirm-modal">
        <div class="modal-content">
            <h3>Leave this page?</h3>
            <p>You will stop viewing the terminal output.</p>
            <div class="modal-buttons">
                <button class="stay-btn" onclick="stayOnPage()">Stay</button>
                <button class="leave-btn" onclick="leavePage()">Leave</button>
            </div>
        </div>
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

        function jumpToTop() {
            autoScroll = false;
            document.getElementById('autoScrollBtn').classList.remove('active');
            window.scrollTo(0, 0);
        }

        function jumpToBottom() {
            window.scrollTo(0, document.body.scrollHeight);
        }

        function clearTerminal() {
            document.getElementById('terminal').textContent = '';
            // Remember current length so we only show new content after this point
            if (windowData[currentWindow]) {
                windowData[currentWindow].clearedAtLength = windowData[currentWindow].content?.length || 0;
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

        function escapeHtml(text) {
            return text
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;');
        }

        function colorize(text) {
            // First escape HTML to prevent code in terminal from being parsed
            text = escapeHtml(text);
            return text
                .replace(/^(Human:|User:|&gt;)/gm, '<span class="user-msg">$1</span>')
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

            // Reset cleared state when switching windows (show full history)
            if (windowData[windowIndex]) {
                windowData[windowIndex].clearedAtLength = 0;
            }

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

            // If cleared, only show content after the clear point
            let content = data.content;
            if (data.clearedAtLength && data.clearedAtLength > 0) {
                content = data.content.substring(data.clearedAtLength);
                if (!content.trim()) {
                    terminal.innerHTML = '<div class="empty-state"><p>Cleared</p><p class="dim">Waiting for new output...</p></div>';
                    return;
                }
            }

            terminal.innerHTML = colorize(content);

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

        async function takeScreenshot() {
            const modal = document.getElementById('screenshot-modal');
            const loading = document.getElementById('screenshot-loading');
            const img = document.getElementById('screenshot-img');

            modal.classList.add('visible');
            loading.style.display = 'block';
            img.style.display = 'none';

            try {
                const response = await fetch('/screenshot', { method: 'POST' });
                if (response.ok) {
                    const data = await response.json();
                    img.src = '/' + data.file + '?t=' + Date.now();
                    img.onload = function() {
                        loading.style.display = 'none';
                        img.style.display = 'block';
                    };
                } else {
                    const err = await response.json().catch(() => ({}));
                    alert(err.error || 'Screenshot failed');
                    modal.classList.remove('visible');
                }
            } catch (e) {
                alert('Screenshot failed: ' + e.message);
                modal.classList.remove('visible');
            }
        }

        function closeScreenshot() {
            document.getElementById('screenshot-modal').classList.remove('visible');
        }

        // Horizontal swipe for tab switching
        let touchStartX = 0;
        let touchStartY = 0;
        let isHorizontalSwipe = false;
        let swipeHandled = false;
        const SWIPE_MIN_DISTANCE = 80; // minimum swipe distance

        document.addEventListener('touchstart', function(e) {
            const touch = e.touches[0];
            touchStartX = touch.clientX;
            touchStartY = touch.clientY;
            isHorizontalSwipe = false;
            swipeHandled = false;
        }, { passive: true });

        document.addEventListener('touchmove', function(e) {
            if (swipeHandled) return;

            const touch = e.touches[0];
            const deltaX = touch.clientX - touchStartX;
            const deltaY = Math.abs(touch.clientY - touchStartY);
            const absDeltaX = Math.abs(deltaX);

            // Determine swipe direction early (after 15px movement)
            if (!isHorizontalSwipe && absDeltaX > 15) {
                // If more horizontal than vertical, it's a tab swipe
                isHorizontalSwipe = absDeltaX > deltaY * 1.5;
            }

            // If horizontal swipe, prevent scrolling and browser gestures
            if (isHorizontalSwipe) {
                e.preventDefault();
            }
        }, { passive: false });

        document.addEventListener('touchend', function(e) {
            if (swipeHandled || windows.length <= 1) return;

            const touch = e.changedTouches[0];
            const deltaX = touch.clientX - touchStartX;
            const deltaY = Math.abs(touch.clientY - touchStartY);

            // Must be horizontal swipe with enough distance
            if (!isHorizontalSwipe || Math.abs(deltaX) < SWIPE_MIN_DISTANCE) return;

            swipeHandled = true;

            if (deltaX > 0) {
                // Swipe right = previous tab
                const prevIndex = currentWindow > 0 ? currentWindow - 1 : windows.length - 1;
                switchWindow(prevIndex);
            } else {
                // Swipe left = next tab
                const nextIndex = currentWindow < windows.length - 1 ? currentWindow + 1 : 0;
                switchWindow(nextIndex);
            }
        }, { passive: true });

        // Navigation confirmation - beforeunload for browser close/refresh
        window.addEventListener('beforeunload', function(e) {
            e.preventDefault();
            e.returnValue = '';
            return '';
        });

        // Navigation confirmation - back button handling
        let allowNavigation = false;

        // Push initial state to trap back button
        history.pushState({ page: 'viewer' }, '', window.location.href);

        window.addEventListener('popstate', function(e) {
            if (!allowNavigation) {
                // Push state again to stay on page while modal is shown
                history.pushState({ page: 'viewer' }, '', window.location.href);
                showNavConfirm();
            }
        });

        function showNavConfirm() {
            document.getElementById('nav-confirm-modal').classList.add('visible');
        }

        function stayOnPage() {
            document.getElementById('nav-confirm-modal').classList.remove('visible');
        }

        function leavePage() {
            document.getElementById('nav-confirm-modal').classList.remove('visible');
            allowNavigation = true;
            history.back();
        }
    </script>
</body>
</html>
HTMLEOF
}

create_python_server() {
    cat > "$LOG_DIR/server.py" << 'PYEOF'
#!/usr/bin/env python3
import os, subprocess, time, glob, json
from http.server import HTTPServer, SimpleHTTPRequestHandler

class VibeGoHandler(SimpleHTTPRequestHandler):
    def do_POST(self):
        if self.path == '/screenshot':
            timestamp = int(time.time() * 1000)
            filename = f'screenshot-{timestamp}.png'
            filepath = os.path.join(os.getcwd(), filename)

            result = subprocess.run(['screencapture', '-x', filepath], capture_output=True, text=True)

            if result.returncode == 0 and os.path.exists(filepath):
                # Cleanup old screenshots (keep last 5)
                for old in sorted(glob.glob('screenshot-*.png'), reverse=True)[5:]:
                    try: os.remove(old)
                    except: pass

                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({'file': filename}).encode())
            else:
                error_msg = result.stderr.strip() if result.stderr else 'Screenshot failed'
                if 'could not create image' in error_msg.lower():
                    error_msg = 'Screen Recording permission needed. Grant in System Settings > Privacy > Screen Recording'
                self.send_response(500)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({'error': error_msg}).encode())
        else:
            self.send_response(404)
            self.end_headers()

    def log_message(self, format, *args):
        pass  # Suppress logging

if __name__ == '__main__':
    PORT = int(os.environ.get('VIBEGO_WEB_PORT', '8765'))
    server = HTTPServer(('0.0.0.0', PORT), VibeGoHandler)
    server.serve_forever()
PYEOF
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

    # Create initial windows.json
    update_windows_json

    # Start background process that captures screen state periodically
    # Using capture-pane instead of pipe-pane for TUI compatibility
    (
        while true; do
            update_windows_json

            # Capture current screen state of each window
            local current_windows=$(tmux list-windows -t "$SESSION" -F '#{window_index}' 2>/dev/null)
            for win_idx in $current_windows; do
                local log_file="$LOG_DIR/window-${win_idx}.log"
                # Capture visible pane content plus scrollback (-S -1000 gets last 1000 lines)
                tmux capture-pane -t "${SESSION}:${win_idx}" -p -S -500 2>/dev/null | \
                    perl -pe 's/\e\[[0-9;?]*[a-zA-Z]//g; s/\e\][^\a]*\a//g; s/\r//g' > "$log_file"
            done

            sleep 1
        done
    ) &
    echo $! > "$LOG_DIR/updater.pid"

    echo -e "${GREEN}Started screen capture for all windows${RESET}"
}

stop_capture() {
    # Stop the background capture process
    if [[ -f "$LOG_DIR/updater.pid" ]]; then
        kill "$(cat "$LOG_DIR/updater.pid")" 2>/dev/null || true
        rm -f "$LOG_DIR/updater.pid"
    fi

    echo -e "${YELLOW}Stopped capturing${RESET}"
}

start_server() {
    mkdir -p "$LOG_DIR"
    create_html_viewer
    create_python_server

    if [[ -f "$PID_FILE" ]] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
        echo -e "${YELLOW}Web server already running${RESET}"
        return
    fi

    cd "$LOG_DIR"
    python3 server.py > /dev/null 2>&1 &
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
