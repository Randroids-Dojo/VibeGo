#!/bin/bash
# VibeGo Auto-Responder Setup Script
# Sets up the auto-responder service for VibeGo

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_DIR="$HOME/.config/vibego"
VIBEGO_DIR="$HOME/.vibego"
HOOKS_DIR="$HOME/.claude/hooks"
LAUNCH_AGENTS="$HOME/Library/LaunchAgents"

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
RED='\033[0;31m'
NC='\033[0m'

echo -e "${CYAN}VibeGo Auto-Responder Setup${NC}"
echo

# Check if Node.js is installed
if ! command -v node &>/dev/null; then
    echo -e "${RED}Error: Node.js is not installed${NC}"
    echo "Install Node.js first: brew install node"
    exit 1
fi

# Check Node.js version
NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
    echo -e "${RED}Error: Node.js 18+ required (found v$NODE_VERSION)${NC}"
    exit 1
fi

echo -e "${GREEN}✓${NC} Node.js $(node -v) detected"

# Build the project
echo
echo "Building auto-responder..."
cd "$SCRIPT_DIR"

if [ ! -d "node_modules" ]; then
    npm install
fi

npm run build
echo -e "${GREEN}✓${NC} Build complete"

# Create directories
echo
echo "Creating directories..."
mkdir -p "$CONFIG_DIR"
mkdir -p "$VIBEGO_DIR/logs"
mkdir -p "$HOOKS_DIR"
echo -e "${GREEN}✓${NC} Directories created"

# Copy example config if not exists
if [ ! -f "$CONFIG_DIR/auto-responder.yaml" ]; then
    cp "$SCRIPT_DIR/config/config.example.yaml" "$CONFIG_DIR/auto-responder.yaml"
    echo -e "${GREEN}✓${NC} Config file created: $CONFIG_DIR/auto-responder.yaml"
    echo -e "${YELLOW}  → Edit this file to configure your LLM provider and rules${NC}"
else
    echo -e "${YELLOW}!${NC} Config already exists: $CONFIG_DIR/auto-responder.yaml"
fi

# Copy hook helper
cp "$SCRIPT_DIR/hooks/auto-respond.sh" "$HOOKS_DIR/"
chmod +x "$HOOKS_DIR/auto-respond.sh"
echo -e "${GREEN}✓${NC} Hook helper installed: $HOOKS_DIR/auto-respond.sh"

# Check for API keys
echo
echo "Checking API keys..."

if [ -n "$ANTHROPIC_API_KEY" ]; then
    echo -e "${GREEN}✓${NC} ANTHROPIC_API_KEY is set"
elif [ -n "$OPENAI_API_KEY" ]; then
    echo -e "${GREEN}✓${NC} OPENAI_API_KEY is set"
else
    echo -e "${YELLOW}!${NC} No LLM API key found"
    echo "  Set ANTHROPIC_API_KEY or OPENAI_API_KEY in your shell profile"
    echo "  Or configure Ollama for local LLM"
fi

# Ask about launchd installation
echo
read -p "Install as launchd daemon (auto-start on login)? [y/N] " -n 1 -r
echo

if [[ $REPLY =~ ^[Yy]$ ]]; then
    mkdir -p "$LAUNCH_AGENTS"

    # Get node path
    NODE_PATH=$(which node)

    # Create customized plist
    cat > "$LAUNCH_AGENTS/com.vibego.auto-responder.plist" << EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.vibego.auto-responder</string>
    <key>ProgramArguments</key>
    <array>
        <string>$NODE_PATH</string>
        <string>$SCRIPT_DIR/dist/index.js</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <dict>
        <key>SuccessfulExit</key>
        <false/>
    </dict>
    <key>WorkingDirectory</key>
    <string>$SCRIPT_DIR</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string>
        <key>HOME</key>
        <string>$HOME</string>
    </dict>
    <key>StandardOutPath</key>
    <string>$VIBEGO_DIR/logs/launchd-stdout.log</string>
    <key>StandardErrorPath</key>
    <string>$VIBEGO_DIR/logs/launchd-stderr.log</string>
    <key>ThrottleInterval</key>
    <integer>5</integer>
</dict>
</plist>
EOF

    # Load the service
    launchctl unload "$LAUNCH_AGENTS/com.vibego.auto-responder.plist" 2>/dev/null || true
    launchctl load "$LAUNCH_AGENTS/com.vibego.auto-responder.plist"

    echo -e "${GREEN}✓${NC} Launchd daemon installed and started"
fi

echo
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}Setup Complete!${NC}"
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo
echo "Next steps:"
echo "  1. Edit $CONFIG_DIR/auto-responder.yaml"
echo "     - Set your LLM provider (claude/openai/ollama)"
echo "     - Configure auto-respond patterns"
echo "     - Set dry_run: true for testing"
echo
echo "  2. Integrate with your notification hooks:"
echo "     Add to the beginning of ~/.claude/hooks/notify.sh:"
echo
echo '     if echo "$EVENT_DATA" | ~/.claude/hooks/auto-respond.sh "AskUserQuestion"; then'
echo '       exit 0'
echo '     fi'
echo
echo "  3. Service commands:"
echo "     Start:  launchctl load ~/Library/LaunchAgents/com.vibego.auto-responder.plist"
echo "     Stop:   launchctl unload ~/Library/LaunchAgents/com.vibego.auto-responder.plist"
echo "     Logs:   tail -f ~/.vibego/logs/auto-responder.log"
echo
