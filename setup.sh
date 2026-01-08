#!/bin/bash
#
# VibeGo Setup Script v1.0.0
# Automates Mac setup for mobile Claude Code and Codex CLI control via SSH
#
# Usage: ./setup.sh
#

set -o pipefail

# ============================================================================
# CONSTANTS & COLORS
# ============================================================================

VIBEGO_VERSION="1.0.0"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Defaults
DEFAULT_NTFY_TOPIC="vibego-$(whoami)"
DEFAULT_TMUX_SESSION="mobile"
HOMEBREW_PACKAGES=("tmux" "jq")

# Claude Code paths
CLAUDE_DIR="$HOME/.claude"
CLAUDE_HOOKS_DIR="$CLAUDE_DIR/hooks"
CLAUDE_SETTINGS_FILE="$CLAUDE_DIR/settings.json"
CLAUDE_NOTIFY_SCRIPT="$CLAUDE_HOOKS_DIR/notify.sh"
CLAUDE_NOTIFY_IDLE_SCRIPT="$CLAUDE_HOOKS_DIR/notify-idle.sh"

# Codex CLI paths
CODEX_DIR="$HOME/.codex"
CODEX_HOOKS_DIR="$CODEX_DIR/hooks"
CODEX_CONFIG_FILE="$CODEX_DIR/config.toml"
CODEX_NOTIFY_SCRIPT="$CODEX_HOOKS_DIR/notify.sh"

# Shell config paths
ZSHRC="$HOME/.zshrc"
ZSHENV="$HOME/.zshenv"
SSH_DIR="$HOME/.ssh"
AUTHORIZED_KEYS="$SSH_DIR/authorized_keys"

# ntfy
NTFY_URL="https://ntfy.sh"

# Colors
COLOR_RED='\033[0;31m'
COLOR_GREEN='\033[0;32m'
COLOR_YELLOW='\033[1;33m'
COLOR_BLUE='\033[0;34m'
COLOR_CYAN='\033[0;36m'
COLOR_BOLD='\033[1m'
COLOR_RESET='\033[0m'

# Symbols
SYMBOL_SUCCESS="✓"
SYMBOL_ERROR="✗"
SYMBOL_WARNING="⚠"
SYMBOL_INFO="ℹ"

# Global state
CREATED_BACKUPS=()
SETUP_CLAUDE=false
SETUP_CODEX=false
SETUP_JJ=false

# ============================================================================
# HELPER FUNCTIONS
# ============================================================================

print_banner() {
    echo -e "${COLOR_CYAN}${COLOR_BOLD}"
    cat << "EOF"
__     __ _  _            ____
\ \   / /(_)| |__   ___  / ___|  ___
 \ \ / / | || '_ \ / _ \| |  _  / _ \
  \ V /  | || |_) |  __/| |_| || (_) |
   \_/   |_||_.__/ \___| \____| \___/

EOF
    echo -e "${COLOR_RESET}${COLOR_BOLD}VibeGo Setup v${VIBEGO_VERSION}${COLOR_RESET}"
    echo -e "${COLOR_CYAN}Control Claude Code & Codex CLI from your phone${COLOR_RESET}"
    echo
}

print_step() {
    echo -e "${COLOR_BLUE}==>${COLOR_RESET} ${COLOR_BOLD}$1${COLOR_RESET}"
}

print_success() {
    echo -e "  ${COLOR_GREEN}${SYMBOL_SUCCESS}${COLOR_RESET} $1"
}

print_error() {
    echo -e "  ${COLOR_RED}${SYMBOL_ERROR}${COLOR_RESET} $1" >&2
}

print_warning() {
    echo -e "  ${COLOR_YELLOW}${SYMBOL_WARNING}${COLOR_RESET} $1"
}

print_info() {
    echo -e "  ${COLOR_CYAN}${SYMBOL_INFO}${COLOR_RESET} $1"
}

ask_yes_no() {
    local prompt="$1"
    local default="${2:-n}"
    local response

    if [[ "$default" == "y" ]]; then
        prompt="$prompt [Y/n] "
    else
        prompt="$prompt [y/N] "
    fi

    read -p "$(echo -e "${COLOR_YELLOW}?${COLOR_RESET} $prompt")" response
    response="${response:-$default}"

    [[ "$response" =~ ^[Yy]$ ]]
}

backup_file() {
    local file="$1"

    if [[ ! -f "$file" ]]; then
        return 1
    fi

    local backup="${file}.backup.$(date +%Y%m%d_%H%M%S)"
    cp "$file" "$backup"
    CREATED_BACKUPS+=("$backup")
    print_info "Backed up: $(basename "$file") → $(basename "$backup")"
    return 0
}

restore_backups() {
    if [[ ${#CREATED_BACKUPS[@]} -eq 0 ]]; then
        print_info "No backups to restore"
        return
    fi

    print_step "Restoring backups..."
    for backup in "${CREATED_BACKUPS[@]}"; do
        local original="${backup%.backup.*}"
        if [[ -f "$backup" ]]; then
            cp "$backup" "$original"
            print_success "Restored: $(basename "$original")"
        fi
    done
}

error_handler() {
    local exit_code=$1
    local line_number=$2

    echo
    print_error "Error occurred at line $line_number (exit code: $exit_code)"
    print_error "Setup incomplete"
    echo

    if [[ ${#CREATED_BACKUPS[@]} -gt 0 ]]; then
        if ask_yes_no "Restore backups and revert changes?" "n"; then
            restore_backups
        fi
    fi

    exit "$exit_code"
}

# ============================================================================
# VALIDATION FUNCTIONS
# ============================================================================

check_macos() {
    if [[ "$(uname)" != "Darwin" ]]; then
        print_error "This script requires macOS"
        return 1
    fi
    return 0
}

validate_topic_name() {
    local topic="$1"

    # ntfy topic rules: lowercase, numbers, underscores, hyphens
    if [[ ! "$topic" =~ ^[a-z0-9_-]+$ ]]; then
        print_error "Invalid topic name: $topic"
        print_error "Must contain only: lowercase letters, numbers, _, -"
        return 1
    fi

    if [[ ${#topic} -lt 3 || ${#topic} -gt 64 ]]; then
        print_error "Topic name must be 3-64 characters"
        return 1
    fi

    return 0
}

check_homebrew() {
    if command -v brew &>/dev/null; then
        print_success "Homebrew already installed"
        return 0
    fi

    print_warning "Homebrew not found"

    if ask_yes_no "Install Homebrew? (Required for dependencies)" "y"; then
        install_homebrew
    else
        print_error "Homebrew is required for VibeGo dependencies"
        return 1
    fi
}

check_remote_login() {
    print_step "Checking Remote Login status..."

    # Check if Remote Login is enabled
    if sudo systemsetup -getremotelogin 2>/dev/null | grep -q "On"; then
        print_success "Remote Login is enabled"
        return 0
    else
        print_warning "Remote Login is NOT enabled"
        echo
        print_info "To enable Remote Login:"
        print_info "  1. Open System Settings"
        print_info "  2. Go to General → Sharing"
        print_info "  3. Toggle 'Remote Login' ON"
        echo

        read -p "Press Enter after enabling Remote Login..."

        # Re-check
        if sudo systemsetup -getremotelogin 2>/dev/null | grep -q "On"; then
            print_success "Remote Login is now enabled"
            return 0
        else
            print_error "Remote Login still disabled"
            print_info "You can enable it later, but SSH won't work until then"
            return 0  # Don't fail, just warn
        fi
    fi
}

# ============================================================================
# CLI DETECTION FUNCTIONS
# ============================================================================

check_claude_installed() {
    command -v claude &>/dev/null
}

check_codex_installed() {
    command -v codex &>/dev/null
}

select_cli_tools() {
    print_step "Detecting installed CLI tools..."

    local claude_available=false
    local codex_available=false

    if check_claude_installed; then
        claude_available=true
        print_success "Claude Code detected"
    else
        print_info "Claude Code not installed"
    fi

    if check_codex_installed; then
        codex_available=true
        print_success "Codex CLI detected"
    else
        print_info "Codex CLI not installed"
    fi

    echo

    # If neither installed, warn and exit
    if [[ "$claude_available" == false && "$codex_available" == false ]]; then
        print_error "No supported CLI tools found"
        print_info "Install Claude Code: npm install -g @anthropic-ai/claude-code"
        print_info "Install Codex CLI: npm install -g @openai/codex"
        return 1
    fi

    print_step "Select CLI tools to configure"
    echo

    # Ask about each available CLI
    if [[ "$claude_available" == true ]]; then
        if ask_yes_no "Configure Claude Code notifications?" "y"; then
            SETUP_CLAUDE=true
        fi
    fi

    if [[ "$codex_available" == true ]]; then
        if ask_yes_no "Configure Codex CLI notifications?" "y"; then
            SETUP_CODEX=true
        fi
    fi

    # Ensure at least one was selected
    if [[ "$SETUP_CLAUDE" == false && "$SETUP_CODEX" == false ]]; then
        print_warning "No CLI tools selected for configuration"
        if ! ask_yes_no "Continue anyway?" "n"; then
            return 1
        fi
    fi

    echo
    return 0
}

preflight_checks() {
    print_step "Running preflight checks..."

    local errors=()

    # Check OS
    if ! check_macos; then
        errors+=("macOS required")
    fi

    # Check write permissions
    if [[ ! -w "$HOME" ]]; then
        errors+=("No write permission to home directory")
    fi

    # Check disk space
    local available=$(df -h "$HOME" | awk 'NR==2 {print $4}' | sed 's/Gi$//')
    if [[ -n "$available" ]] && [[ $(echo "$available < 1" | bc 2>/dev/null || echo 0) -eq 1 ]]; then
        errors+=("Less than 1GB disk space available")
    fi

    # Check internet connectivity
    if ! ping -c 1 -W 2 8.8.8.8 &>/dev/null; then
        print_warning "No internet connectivity (required for Homebrew and ntfy)"
        print_info "Setup will continue, but some features may not work"
    fi

    # Display errors
    if [[ ${#errors[@]} -gt 0 ]]; then
        print_error "Preflight checks failed:"
        for error in "${errors[@]}"; do
            print_error "  - $error"
        done
        return 1
    fi

    print_success "Preflight checks passed"
    return 0
}

# ============================================================================
# INSTALLATION FUNCTIONS
# ============================================================================

install_homebrew() {
    print_step "Installing Homebrew..."
    print_warning "This may take several minutes and require sudo password"
    echo

    # Official Homebrew install script
    /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

    # Detect architecture and add to PATH
    if [[ $(uname -m) == "arm64" ]]; then
        # Apple Silicon
        eval "$(/opt/homebrew/bin/brew shellenv)"
    else
        # Intel
        eval "$(/usr/local/bin/brew shellenv)"
    fi

    print_success "Homebrew installed"
}

install_dependencies() {
    print_step "Checking dependencies..."

    local failed=()

    for dep in "${HOMEBREW_PACKAGES[@]}"; do
        if command -v "$dep" &>/dev/null; then
            print_success "$dep already installed"
            continue
        fi

        print_info "Installing $dep..."
        if brew install "$dep" &>/dev/null; then
            print_success "$dep installed successfully"
        else
            print_error "Failed to install $dep"
            failed+=("$dep")
        fi
    done

    if [[ ${#failed[@]} -gt 0 ]]; then
        print_error "Failed to install: ${failed[*]}"
        print_error "Please install manually: brew install ${failed[*]}"
        return 1
    fi

    return 0
}

create_claude_hooks_dir() {
    if [[ -d "$CLAUDE_HOOKS_DIR" ]]; then
        print_success "Claude hooks directory already exists"
        return 0
    fi

    mkdir -p "$CLAUDE_HOOKS_DIR"
    print_success "Created Claude hooks directory"
}

install_claude_notify_script() {
    local ntfy_topic="$1"

    print_step "Installing Claude notification script..."

    # Backup existing notify.sh if present
    if [[ -f "$CLAUDE_NOTIFY_SCRIPT" ]]; then
        backup_file "$CLAUDE_NOTIFY_SCRIPT"
    fi

    # Create notify.sh
    cat > "$CLAUDE_NOTIFY_SCRIPT" << 'OUTER_EOF'
#!/bin/bash
# Send push notification via ntfy.sh when Claude asks a question

EVENT_DATA=$(cat)
QUESTION=$(echo "$EVENT_DATA" | jq -r '.tool_input.questions[0].question // "Claude needs your input"')

# Show last 2 path components for better session identification
PROJECT=$(pwd | rev | cut -d'/' -f1-2 | rev)

# Get tmux window info for multi-session awareness
WINDOW_INFO=""
IS_ACTIVE=""
if [ -n "$TMUX_PANE" ]; then
  # Get current window index
  WINDOW_INDEX=$(tmux display-message -p '#{window_index}' 2>/dev/null)

  CLIENT=$(tmux list-clients -F '#{client_name}' 2>/dev/null | head -1)
  if [ -n "$CLIENT" ]; then
    CLIENT_PANE=$(tmux display-message -t "$CLIENT" -p '#{pane_id}' 2>/dev/null)
    if [ "$TMUX_PANE" = "$CLIENT_PANE" ]; then
      IS_ACTIVE="[ACTIVE] "
    else
      # Show window number if not active (helps identify which window)
      WINDOW_INFO="[W${WINDOW_INDEX}] "
    fi
  else
    # No client attached, show window number
    WINDOW_INFO="[W${WINDOW_INDEX}] "
  fi
fi

# Get local IP for ssh:// deep link (tap notification to open Termius)
LOCAL_IP=$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || echo "")
SSH_CLICK=""
if [ -n "$LOCAL_IP" ]; then
  SSH_CLICK="ssh://$(whoami)@${LOCAL_IP}"
fi

OUTER_EOF

    # Append the curl command with the topic substituted
    cat >> "$CLAUDE_NOTIFY_SCRIPT" << EOF
curl -s -X POST "$NTFY_URL/$ntfy_topic" \\
  -H "Title: Claude Code" \\
  -H "Priority: high" \\
  -H "Tags: robot" \\
  \${SSH_CLICK:+-H "Click: \$SSH_CLICK"} \\
  -d "\${IS_ACTIVE}\${WINDOW_INFO}\${PROJECT}: \$QUESTION"
EOF

    chmod +x "$CLAUDE_NOTIFY_SCRIPT"
    print_success "Created notification script with topic: $ntfy_topic"
}

install_claude_notify_idle_script() {
    local ntfy_topic="$1"

    print_step "Installing Claude idle/permission notification script..."

    # Backup existing notify-idle.sh if present
    if [[ -f "$CLAUDE_NOTIFY_IDLE_SCRIPT" ]]; then
        backup_file "$CLAUDE_NOTIFY_IDLE_SCRIPT"
    fi

    # Create notify-idle.sh
    cat > "$CLAUDE_NOTIFY_IDLE_SCRIPT" << 'OUTER_EOF'
#!/bin/bash
# Send push notification via ntfy.sh when Claude is done or needs permission

EVENT_DATA=$(cat)

MESSAGE=$(echo "$EVENT_DATA" | jq -r '.message // "Claude needs your attention"')
NOTIFICATION_TYPE=$(echo "$EVENT_DATA" | jq -r '.notification_type // "unknown"')
CWD=$(echo "$EVENT_DATA" | jq -r '.cwd // "."')

# Show last 2 path components for better session identification
PROJECT=$(echo "$CWD" | rev | cut -d'/' -f1-2 | rev)

# Get tmux window info for multi-session awareness
WINDOW_INFO=""
IS_ACTIVE=""
if [ -n "$TMUX_PANE" ]; then
  WINDOW_INDEX=$(tmux display-message -p '#{window_index}' 2>/dev/null)
  CLIENT=$(tmux list-clients -F '#{client_name}' 2>/dev/null | head -1)
  if [ -n "$CLIENT" ]; then
    CLIENT_PANE=$(tmux display-message -t "$CLIENT" -p '#{pane_id}' 2>/dev/null)
    if [ "$TMUX_PANE" = "$CLIENT_PANE" ]; then
      IS_ACTIVE="[ACTIVE] "
    else
      WINDOW_INFO="[W${WINDOW_INDEX}] "
    fi
  else
    WINDOW_INFO="[W${WINDOW_INDEX}] "
  fi
fi

# Set title and priority based on notification type
case "$NOTIFICATION_TYPE" in
  "permission_prompt")
    TITLE="Permission Needed"
    PRIORITY="urgent"
    TAGS="warning"
    ;;
  "idle_prompt")
    TITLE="Task Complete"
    PRIORITY="high"
    TAGS="white_check_mark"
    ;;
  *)
    TITLE="Claude Code"
    PRIORITY="default"
    TAGS="robot"
    ;;
esac

# Get local IP for ssh:// deep link (tap notification to open Termius)
LOCAL_IP=$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || echo "")
SSH_CLICK=""
if [ -n "$LOCAL_IP" ]; then
  SSH_CLICK="ssh://$(whoami)@${LOCAL_IP}"
fi

OUTER_EOF

    # Append the curl command with the topic substituted
    cat >> "$CLAUDE_NOTIFY_IDLE_SCRIPT" << EOF
curl -s -X POST "$NTFY_URL/$ntfy_topic" \\
  -H "Title: \$TITLE" \\
  -H "Priority: \$PRIORITY" \\
  -H "Tags: \$TAGS" \\
  \${SSH_CLICK:+-H "Click: \$SSH_CLICK"} \\
  -d "\${IS_ACTIVE}\${WINDOW_INFO}\${PROJECT}: \$MESSAGE"
EOF

    chmod +x "$CLAUDE_NOTIFY_IDLE_SCRIPT"
    print_success "Created idle/permission notification script"
}

# ============================================================================
# CODEX CLI INSTALLATION FUNCTIONS
# ============================================================================

create_codex_hooks_dir() {
    if [[ -d "$CODEX_HOOKS_DIR" ]]; then
        print_success "Codex hooks directory already exists"
        return 0
    fi

    mkdir -p "$CODEX_HOOKS_DIR"
    print_success "Created Codex hooks directory"
}

install_codex_notify_script() {
    local ntfy_topic="$1"

    print_step "Installing Codex notification script..."

    # Backup existing script if present
    if [[ -f "$CODEX_NOTIFY_SCRIPT" ]]; then
        backup_file "$CODEX_NOTIFY_SCRIPT"
    fi

    # Create notify.sh for Codex
    # Note: Codex passes JSON as command-line argument $1, not stdin
    cat > "$CODEX_NOTIFY_SCRIPT" << 'OUTER_EOF'
#!/bin/bash
# VibeGo: Send push notification via ntfy.sh for Codex CLI
# Codex passes JSON as command-line argument (not stdin like Claude)

EVENT_DATA="$1"

# Parse event data from JSON argument
EVENT_TYPE=$(echo "$EVENT_DATA" | jq -r '.type // "unknown"')
CWD=$(echo "$EVENT_DATA" | jq -r '.cwd // "."')
# Truncate message to avoid overly long notifications
MESSAGE=$(echo "$EVENT_DATA" | jq -r '."last-assistant-message" // "Codex finished"' | head -c 200)

# Show last 2 path components for better session identification
PROJECT=$(echo "$CWD" | rev | cut -d'/' -f1-2 | rev)

# Get tmux window info for multi-session awareness
WINDOW_INFO=""
IS_ACTIVE=""
if [ -n "$TMUX_PANE" ]; then
  WINDOW_INDEX=$(tmux display-message -p '#{window_index}' 2>/dev/null)
  CLIENT=$(tmux list-clients -F '#{client_name}' 2>/dev/null | head -1)
  if [ -n "$CLIENT" ]; then
    CLIENT_PANE=$(tmux display-message -t "$CLIENT" -p '#{pane_id}' 2>/dev/null)
    if [ "$TMUX_PANE" = "$CLIENT_PANE" ]; then
      IS_ACTIVE="[ACTIVE] "
    else
      WINDOW_INFO="[W${WINDOW_INDEX}] "
    fi
  else
    WINDOW_INFO="[W${WINDOW_INDEX}] "
  fi
fi

# Set title and priority based on event type
case "$EVENT_TYPE" in
  "agent-turn-complete")
    TITLE="Codex Complete"
    PRIORITY="high"
    TAGS="white_check_mark"
    ;;
  "approval-requested")
    TITLE="Codex Permission"
    PRIORITY="urgent"
    TAGS="warning"
    ;;
  *)
    TITLE="Codex"
    PRIORITY="default"
    TAGS="robot"
    ;;
esac

# Get local IP for ssh:// deep link (tap notification to open Termius)
LOCAL_IP=$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || echo "")
SSH_CLICK=""
if [ -n "$LOCAL_IP" ]; then
  SSH_CLICK="ssh://$(whoami)@${LOCAL_IP}"
fi

OUTER_EOF

    # Append the curl command with the topic substituted
    cat >> "$CODEX_NOTIFY_SCRIPT" << EOF
curl -s -X POST "$NTFY_URL/$ntfy_topic" \\
  -H "Title: \$TITLE" \\
  -H "Priority: \$PRIORITY" \\
  -H "Tags: \$TAGS" \\
  \${SSH_CLICK:+-H "Click: \$SSH_CLICK"} \\
  -d "\${IS_ACTIVE}\${WINDOW_INFO}\${PROJECT}: \$MESSAGE"
EOF

    chmod +x "$CODEX_NOTIFY_SCRIPT"
    print_success "Created Codex notification script with topic: $ntfy_topic"
}

update_codex_config() {
    print_step "Updating Codex CLI config..."

    # Create .codex dir if not exists
    mkdir -p "$CODEX_DIR"

    # Check if config.toml exists
    if [[ ! -f "$CODEX_CONFIG_FILE" ]]; then
        # Create new config.toml with notify setting
        cat > "$CODEX_CONFIG_FILE" << EOF
# VibeGo: Codex CLI notification configuration
notify = ["$CODEX_NOTIFY_SCRIPT"]
EOF
        print_success "Created Codex config.toml with notification hook"
        return 0
    fi

    # Backup existing config
    backup_file "$CODEX_CONFIG_FILE"

    # Check if notify is already configured
    if grep -q "^notify" "$CODEX_CONFIG_FILE" 2>/dev/null; then
        # Update existing notify line
        # Use sed to replace the notify line
        sed -i.bak "s|^notify.*|notify = [\"$CODEX_NOTIFY_SCRIPT\"]|" "$CODEX_CONFIG_FILE"
        rm -f "${CODEX_CONFIG_FILE}.bak"
        print_success "Updated existing notify setting in config.toml"
    else
        # Append notify setting
        echo "" >> "$CODEX_CONFIG_FILE"
        echo "# VibeGo: Notification hook" >> "$CODEX_CONFIG_FILE"
        echo "notify = [\"$CODEX_NOTIFY_SCRIPT\"]" >> "$CODEX_CONFIG_FILE"
        print_success "Added notify setting to config.toml"
    fi
}

# ============================================================================
# JJ VCS INTEGRATION (Optional)
# ============================================================================

check_jj_installed() {
    command -v jj &>/dev/null
}

setup_jj() {
    print_step "Setting up jj VCS for multi-session workflow..."

    # Check if jj is installed
    if ! check_jj_installed; then
        print_info "Installing jj..."
        if brew install jj &>/dev/null; then
            print_success "jj installed successfully"
        else
            print_error "Failed to install jj"
            print_info "Install manually: brew install jj"
            return 1
        fi
    else
        print_success "jj already installed: $(jj --version 2>/dev/null | head -1)"
    fi

    # Create jj config directory
    local jj_config_dir="$HOME/.config/jj"
    local jj_config_file="$jj_config_dir/config.toml"

    mkdir -p "$jj_config_dir"

    # Create jj config if not exists
    if [[ ! -f "$jj_config_file" ]]; then
        print_info "Creating jj configuration..."

        # Get git user info if available
        local git_name=$(git config --global user.name 2>/dev/null || echo "Your Name")
        local git_email=$(git config --global user.email 2>/dev/null || echo "your@email.com")

        cat > "$jj_config_file" << EOF
# jj configuration for VibeGo multi-session workflow
[user]
name = "$git_name"
email = "$git_email"

[ui]
default-command = "log"
diff-editor = ":builtin"
merge-editor = ":builtin"

# VibeGo aliases for multi-session workflow
[aliases]
# Quick status
s = ["status"]
# Start new independent change from main
task = ["new", "main", "-m"]
# Show all active changes
tasks = ["log", "-r", "main.."]
# Reconcile: rebase all changes onto latest main
sync = ["rebase", "-s", "all:roots(main..@)", "-d", "main"]
EOF
        print_success "Created jj config at $jj_config_file"
    else
        print_success "jj config already exists"
    fi

    # Copy helper scripts
    local bin_dir="$HOME/.local/bin"
    mkdir -p "$bin_dir"

    if [[ -f "$SCRIPT_DIR/scripts/jj-helpers.sh" ]]; then
        cp "$SCRIPT_DIR/scripts/jj-helpers.sh" "$bin_dir/"
        chmod +x "$bin_dir/jj-helpers.sh"
        print_success "Installed jj-helpers.sh to $bin_dir"
    fi

    if [[ -f "$SCRIPT_DIR/scripts/jj-init-project.sh" ]]; then
        cp "$SCRIPT_DIR/scripts/jj-init-project.sh" "$bin_dir/jj-init-project"
        chmod +x "$bin_dir/jj-init-project"
        print_success "Installed jj-init-project to $bin_dir"
    fi

    # Add to shell if not present
    local marker="# VibeGo: jj helpers"
    if ! grep -q "$marker" "$ZSHRC" 2>/dev/null; then
        cat >> "$ZSHRC" << EOF

$marker
export PATH="\$HOME/.local/bin:\$PATH"
if [[ -f "\$HOME/.local/bin/jj-helpers.sh" ]]; then
  source "\$HOME/.local/bin/jj-helpers.sh"
fi
EOF
        print_success "Added jj helpers to .zshrc"
    else
        print_success "jj helpers already in .zshrc"
    fi

    echo
    print_info "jj setup complete!"
    print_info "To initialize a project: jj-init-project /path/to/project"
    print_info "See docs/jj-workflow.md for multi-session workflow guide"
}

# ============================================================================
# CONFIGURATION FUNCTIONS
# ============================================================================

update_settings_json() {
    print_step "Updating Claude Code settings..."

    # Create .claude dir if not exists
    mkdir -p "$CLAUDE_DIR"

    # Check if settings.json exists
    if [[ ! -f "$CLAUDE_SETTINGS_FILE" ]]; then
        # Create new settings.json with all hooks
        cat > "$CLAUDE_SETTINGS_FILE" << EOF
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "AskUserQuestion",
        "hooks": [
          {
            "type": "command",
            "command": "$CLAUDE_NOTIFY_SCRIPT"
          }
        ]
      }
    ],
    "Notification": [
      {
        "matcher": "permission_prompt",
        "hooks": [
          {
            "type": "command",
            "command": "$CLAUDE_NOTIFY_IDLE_SCRIPT"
          }
        ]
      },
      {
        "matcher": "idle_prompt",
        "hooks": [
          {
            "type": "command",
            "command": "$CLAUDE_NOTIFY_IDLE_SCRIPT"
          }
        ]
      }
    ]
  }
}
EOF
        print_success "Created new settings.json with all notification hooks"
        return 0
    fi

    # Backup settings.json
    backup_file "$CLAUDE_SETTINGS_FILE"

    # Merge hooks into existing settings
    local temp_file=$(mktemp)
    jq --arg notify_script "$CLAUDE_NOTIFY_SCRIPT" --arg notify_idle_script "$CLAUDE_NOTIFY_IDLE_SCRIPT" '
        # Ensure hooks object exists
        .hooks //= {} |
        # Ensure arrays exist
        .hooks.PreToolUse //= [] |
        .hooks.Notification //= [] |
        # Add PreToolUse hook if not present
        (if (.hooks.PreToolUse | map(select(.matcher == "AskUserQuestion")) | length) == 0 then
            .hooks.PreToolUse += [{
                "matcher": "AskUserQuestion",
                "hooks": [{"type": "command", "command": $notify_script}]
            }]
        else . end) |
        # Add permission_prompt hook if not present
        (if (.hooks.Notification | map(select(.matcher == "permission_prompt")) | length) == 0 then
            .hooks.Notification += [{
                "matcher": "permission_prompt",
                "hooks": [{"type": "command", "command": $notify_idle_script}]
            }]
        else . end) |
        # Add idle_prompt hook if not present
        (if (.hooks.Notification | map(select(.matcher == "idle_prompt")) | length) == 0 then
            .hooks.Notification += [{
                "matcher": "idle_prompt",
                "hooks": [{"type": "command", "command": $notify_idle_script}]
            }]
        else . end)
    ' "$CLAUDE_SETTINGS_FILE" > "$temp_file"

    # Validate JSON before replacing
    if jq empty "$temp_file" 2>/dev/null; then
        mv "$temp_file" "$CLAUDE_SETTINGS_FILE"
        print_success "Updated settings.json with notification hooks"
    else
        print_error "Failed to update settings.json (invalid JSON)"
        rm "$temp_file"
        return 1
    fi
}

update_zshenv() {
    print_step "Updating .zshenv..."

    local marker="# VibeGo: Homebrew PATH for SSH sessions"

    # Determine Homebrew path based on architecture
    local brew_path
    if [[ $(uname -m) == "arm64" ]]; then
        brew_path="/opt/homebrew/bin"
    else
        brew_path="/usr/local/bin"
    fi

    # Check if already configured
    if [[ -f "$ZSHENV" ]] && grep -q "$marker" "$ZSHENV" 2>/dev/null; then
        print_success "Homebrew PATH already configured in .zshenv"
        return 0
    fi

    # Backup .zshenv if it exists
    if [[ -f "$ZSHENV" ]]; then
        backup_file "$ZSHENV"
    fi

    # Add Homebrew PATH
    cat >> "$ZSHENV" << EOF

$marker
export PATH="$brew_path:\$PATH"
EOF

    print_success "Added Homebrew PATH to .zshenv"
}

update_zshrc() {
    print_step "Updating .zshrc..."

    local marker="# VibeGo: tmux auto-attach for SSH sessions"

    # Check if already configured
    if [[ -f "$ZSHRC" ]] && grep -q "$marker" "$ZSHRC" 2>/dev/null; then
        print_success "tmux auto-attach already configured in .zshrc"
        return 0
    fi

    # Backup .zshrc if it exists
    if [[ -f "$ZSHRC" ]]; then
        backup_file "$ZSHRC"
    fi

    # Add tmux auto-attach
    cat >> "$ZSHRC" << 'EOF'

# VibeGo: tmux auto-attach for SSH sessions
if [[ -n "$SSH_CONNECTION" && -z "$TMUX" ]]; then
  tmux attach -t mobile 2>/dev/null || tmux new -s mobile
fi
EOF

    print_success "Added tmux auto-attach to .zshrc"
}

# ============================================================================
# SSH FUNCTIONS
# ============================================================================

check_ssh_key() {
    local key_file="$SSH_DIR/id_ed25519"

    if [[ -f "$key_file" ]]; then
        return 0
    fi
    return 1
}

generate_ssh_key() {
    print_step "Generating SSH key..."

    mkdir -p "$SSH_DIR"
    chmod 700 "$SSH_DIR"

    ssh-keygen -t ed25519 -f "$SSH_DIR/id_ed25519" -N "" -C "VibeGo-$(whoami)@$(hostname)"

    if [[ -f "$SSH_DIR/id_ed25519" ]]; then
        print_success "SSH key generated"
        return 0
    else
        print_error "Failed to generate SSH key"
        return 1
    fi
}

setup_passwordless() {
    print_step "Setting up passwordless SSH..."

    local public_key="$SSH_DIR/id_ed25519.pub"

    if [[ ! -f "$public_key" ]]; then
        print_error "Public key not found: $public_key"
        return 1
    fi

    # Create authorized_keys if it doesn't exist
    mkdir -p "$SSH_DIR"
    touch "$AUTHORIZED_KEYS"
    chmod 600 "$AUTHORIZED_KEYS"

    # Check if key already in authorized_keys
    local pub_key_content=$(cat "$public_key")
    if grep -qF "$pub_key_content" "$AUTHORIZED_KEYS" 2>/dev/null; then
        print_success "Public key already in authorized_keys"
        return 0
    fi

    # Add public key to authorized_keys
    cat "$public_key" >> "$AUTHORIZED_KEYS"
    print_success "Added public key to authorized_keys"
}

configure_ssh() {
    print_step "Configuring SSH access..."

    if check_ssh_key; then
        print_success "SSH key already exists"

        if ask_yes_no "Enable passwordless SSH login?" "y"; then
            setup_passwordless
        fi
    else
        print_info "No SSH key found"

        if ask_yes_no "Generate SSH key for passwordless login?" "y"; then
            if generate_ssh_key; then
                setup_passwordless
            fi
        fi
    fi
}

# ============================================================================
# NETWORK FUNCTIONS
# ============================================================================

get_local_ip() {
    # Try multiple methods for robustness
    local ip=""

    # Method 1: ifconfig (most reliable on Mac)
    ip=$(ifconfig | grep "inet " | grep -v 127.0.0.1 | head -1 | awk '{print $2}')

    if [[ -z "$ip" ]]; then
        # Method 2: Get WiFi device and its IP
        local device=$(networksetup -listallhardwareports | awk '/Wi-Fi/{getline; print $2}')
        if [[ -n "$device" ]]; then
            ip=$(ipconfig getifaddr "$device" 2>/dev/null)
        fi
    fi

    echo "$ip"
}

get_hostname() {
    hostname -s
}

# ============================================================================
# TESTING FUNCTIONS
# ============================================================================

test_ntfy_connection() {
    local topic="$1"

    print_step "Testing ntfy.sh connectivity..."

    local test_message="VibeGo setup test - $(date +%H:%M:%S)"

    if curl -s -m 10 -X POST "$NTFY_URL/$topic" \
        -H "Title: VibeGo Setup" \
        -H "Tags: test" \
        -d "$test_message" &>/dev/null; then

        print_success "ntfy.sh connection successful"
        print_info "Check your Android device for test notification"
        return 0
    else
        print_warning "Could not connect to ntfy.sh"
        print_warning "Check your internet connection"
        print_info "Notifications may not work until connectivity restored"
        return 1
    fi
}

# ============================================================================
# SUMMARY FUNCTIONS
# ============================================================================

print_phone_instructions() {
    local ntfy_topic="$1"
    local local_ip="$2"

    echo
    echo -e "${COLOR_BOLD}${COLOR_CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${COLOR_RESET}"
    echo -e "${COLOR_BOLD}  Phone Setup Instructions${COLOR_RESET}"
    echo -e "${COLOR_CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${COLOR_RESET}"
    echo
    echo -e "${COLOR_BOLD}1. Install Apps:${COLOR_RESET}"
    echo "   • Termius (https://termius.com) — SSH client for iOS & Android"
    echo "   • ntfy (https://ntfy.sh) — push notifications for iOS & Android"
    echo
    echo -e "${COLOR_BOLD}2. Configure ntfy:${COLOR_RESET}"
    echo "   • Open ntfy → Tap '+' → Subscribe to topic"
    echo -e "   • Topic: ${COLOR_GREEN}${COLOR_BOLD}$ntfy_topic${COLOR_RESET}"
    echo
    echo -e "${COLOR_BOLD}3. Configure Termius:${COLOR_RESET}"
    echo "   • Open Termius → Add new host"
    echo -e "   • Enter: ${COLOR_GREEN}${COLOR_BOLD}$(whoami)@$local_ip${COLOR_RESET}"
    echo "   • Connect once to save the host"
    echo
    echo -e "${COLOR_BOLD}4. Test the Flow:${COLOR_RESET}"
    echo "   • SSH into your Mac from Termius"
    if [[ "$SETUP_CLAUDE" == true ]]; then
        echo "   • Run: cd <project> && claude"
        echo "   • When Claude asks a question, you'll get a notification"
    fi
    if [[ "$SETUP_CODEX" == true ]]; then
        echo "   • Run: cd <project> && codex"
        echo "   • When Codex finishes a task, you'll get a notification"
        if [[ "$SETUP_CLAUDE" == true ]]; then
            echo "   • Note: Codex only notifies on task completion (not questions)"
        fi
    fi
    echo -e "   • ${COLOR_GREEN}Tap the notification → opens Termius directly${COLOR_RESET}"
    echo
    echo -e "${COLOR_BOLD}5. Multiple Sessions (tmux windows):${COLOR_RESET}"
    echo "   • Ctrl+b c  → Create new window for another agentic coding session"
    echo "   • Ctrl+b 0-9 → Switch to window (notification shows [W0], [W1], etc.)"
    echo "   • Notifications show [ACTIVE] if you're viewing that window"
    echo
    echo -e "${COLOR_CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${COLOR_RESET}"
    echo
}

print_summary() {
    local ntfy_topic="$1"
    local local_ip="$2"

    echo
    echo -e "${COLOR_GREEN}${COLOR_BOLD}${SYMBOL_SUCCESS} VibeGo setup complete!${COLOR_RESET}"
    echo
    echo -e "${COLOR_BOLD}Configuration Summary:${COLOR_RESET}"
    echo -e "  ntfy topic:   ${COLOR_GREEN}$ntfy_topic${COLOR_RESET}"
    echo -e "  Local IP:     ${COLOR_GREEN}$local_ip${COLOR_RESET}"
    echo -e "  Username:     ${COLOR_GREEN}$(whoami)${COLOR_RESET}"
    echo -e "  Hostname:     ${COLOR_GREEN}$(get_hostname)${COLOR_RESET}"
    local cli_list=""
    [[ "$SETUP_CLAUDE" == true ]] && cli_list="Claude Code"
    [[ "$SETUP_CODEX" == true ]] && cli_list="${cli_list:+$cli_list, }Codex CLI"
    echo -e "  CLI tools:    ${COLOR_GREEN}${cli_list:-None}${COLOR_RESET}"
    if [[ "$SETUP_JJ" == true ]]; then
        echo -e "  jj VCS:       ${COLOR_GREEN}Enabled (multi-session support)${COLOR_RESET}"
    fi
    echo
    echo -e "${COLOR_BOLD}Next Steps:${COLOR_RESET}"
    echo "  1. Set up your phone (see instructions above)"
    echo "  2. Connect via Termius from your phone"
    if [[ "$SETUP_CLAUDE" == true && "$SETUP_CODEX" == true ]]; then
        echo "  3. Run 'claude' or 'codex' in any project directory"
    elif [[ "$SETUP_CLAUDE" == true ]]; then
        echo "  3. Run 'claude' in any project directory"
    elif [[ "$SETUP_CODEX" == true ]]; then
        echo "  3. Run 'codex' in any project directory"
    fi
    echo "  4. Get push notifications when the AI needs input or finishes"
    echo
    echo -e "${COLOR_BOLD}Documentation:${COLOR_RESET}"
    echo "  See README.md for detailed usage and troubleshooting"
    echo

    if [[ ${#CREATED_BACKUPS[@]} -gt 0 ]]; then
        echo -e "${COLOR_BOLD}Backups Created:${COLOR_RESET}"
        for backup in "${CREATED_BACKUPS[@]}"; do
            echo "  • $backup"
        done
        echo
    fi
}

# ============================================================================
# MAIN FUNCTION
# ============================================================================

main() {
    # Set up error handling
    trap 'error_handler $? $LINENO' ERR

    # Print banner
    print_banner

    # Preflight checks
    if ! preflight_checks; then
        exit 1
    fi
    echo

    # Collect user input
    print_step "Configuration"
    echo
    echo "VibeGo will set up your Mac for mobile AI coding assistant control."
    echo "Supports Claude Code and Codex CLI."
    echo

    # Select CLI tools to configure
    if ! select_cli_tools; then
        exit 1
    fi

    # Get ntfy topic
    local ntfy_topic=""
    while true; do
        read -p "$(echo -e "${COLOR_YELLOW}?${COLOR_RESET} ntfy topic name [${DEFAULT_NTFY_TOPIC}]: ")" ntfy_topic
        ntfy_topic="${ntfy_topic:-$DEFAULT_NTFY_TOPIC}"

        if validate_topic_name "$ntfy_topic"; then
            break
        fi
    done
    echo

    # Check/install Homebrew
    if ! check_homebrew; then
        exit 1
    fi
    echo

    # Install dependencies
    if ! install_dependencies; then
        print_error "Failed to install dependencies"
        exit 1
    fi
    echo

    # Configure Claude Code if selected
    if [[ "$SETUP_CLAUDE" == true ]]; then
        create_claude_hooks_dir
        install_claude_notify_script "$ntfy_topic"
        install_claude_notify_idle_script "$ntfy_topic"
        if ! update_settings_json; then
            print_error "Failed to update Claude settings.json"
            exit 1
        fi
        echo
    fi

    # Configure Codex CLI if selected
    if [[ "$SETUP_CODEX" == true ]]; then
        create_codex_hooks_dir
        install_codex_notify_script "$ntfy_topic"
        update_codex_config
        echo
    fi

    # Optional: jj VCS for multi-session workflow
    echo
    print_step "Optional: jj VCS Integration"
    echo
    echo "jj (Jujutsu) enables multiple Claude Code sessions to work on the"
    echo "same project simultaneously without conflicts blocking workflow."
    echo
    if ask_yes_no "Set up jj VCS for multi-session workflow?" "n"; then
        SETUP_JJ=true
        setup_jj
        echo
    fi

    # Update shell configs
    update_zshenv
    update_zshrc
    echo

    # Configure SSH
    configure_ssh
    echo

    # Check Remote Login
    check_remote_login
    echo

    # Test ntfy connection
    test_ntfy_connection "$ntfy_topic"
    echo

    # Get network info
    local_ip=$(get_local_ip)
    if [[ -z "$local_ip" ]]; then
        local_ip="<unable to detect IP>"
        print_warning "Could not detect local IP address"
        print_info "Find your IP in System Settings → Network"
    fi

    # Print phone instructions
    print_phone_instructions "$ntfy_topic" "$local_ip"

    # Print summary
    print_summary "$ntfy_topic" "$local_ip"
}

# Run main function
main "$@"
