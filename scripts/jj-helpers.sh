#!/bin/bash
# VibeGo jj helpers for multi-session workflow
# Source this file in your shell: source jj-helpers.sh

# Get current tmux window index (for naming changes)
jj-window-id() {
    if [ -n "$TMUX" ]; then
        tmux display-message -p '#I'
    else
        echo "no-tmux"
    fi
}

# Get current tmux pane ID
jj-pane-id() {
    if [ -n "$TMUX" ]; then
        echo "${TMUX_PANE:-unknown}" | sed 's/%//'
    else
        echo "unknown"
    fi
}

# Start a new task (creates independent change from main)
# Usage: jj-task "add player movement"
jj-task() {
    if [ -z "$1" ]; then
        echo "Usage: jj-task \"description of your task\""
        return 1
    fi

    local desc="$1"
    local window_id=$(jj-window-id)

    # Check if we're in a jj repo
    if ! jj root &>/dev/null; then
        echo "Error: Not in a jj repository"
        echo "Run: jj-init-project /path/to/your/project"
        return 1
    fi

    jj new main -m "[w${window_id}] ${desc}"
    echo "Created new change for: ${desc}"
    echo ""
    jj log -r '@' --no-graph
}

# Show what all windows are working on
jj-tasks() {
    if ! jj root &>/dev/null; then
        echo "Error: Not in a jj repository"
        return 1
    fi

    echo "=== Active Changes (all sessions) ==="
    echo ""
    jj log -r 'main..' --no-graph
}

# Sync all changes with latest main from remote
jj-sync() {
    if ! jj root &>/dev/null; then
        echo "Error: Not in a jj repository"
        return 1
    fi

    echo "Fetching from remote..."
    jj git fetch

    echo ""
    echo "Rebasing all changes onto main..."
    jj rebase -s 'all:roots(main..)' -d main 2>/dev/null || {
        echo "Note: No changes to rebase or already up to date"
    }

    echo ""
    echo "Done. Current state:"
    jj log -r 'main..' --no-graph 2>/dev/null || echo "(no active changes)"
}

# Show conflicts across all changes
jj-conflicts() {
    if ! jj root &>/dev/null; then
        echo "Error: Not in a jj repository"
        return 1
    fi

    echo "=== Checking for conflicts ==="
    local conflicts=$(jj log -r 'main..' --no-graph -T 'if(conflict, change_id.short() ++ " " ++ description.first_line() ++ " [CONFLICT]\n")' 2>/dev/null)

    if [ -z "$conflicts" ]; then
        echo "No conflicts found!"
    else
        echo "$conflicts"
        echo ""
        echo "To resolve: jj edit <change-id>, fix files, then continue working"
    fi
}

# Quick reconcile: show options for combining changes
jj-reconcile() {
    if ! jj root &>/dev/null; then
        echo "Error: Not in a jj repository"
        return 1
    fi

    echo "=== Current Changes ==="
    echo ""
    jj log -r 'main..' --no-graph

    echo ""
    echo "=== Reconciliation Options ==="
    echo ""
    echo "Stack changes (linear history):"
    echo "  jj rebase -s <change2> -d <change1>"
    echo ""
    echo "Merge changes (parallel history):"
    echo "  jj new <change1> <change2> -m 'merge features'"
    echo ""
    echo "Squash into one:"
    echo "  jj squash --into <target-change>"
    echo ""
    echo "Resolve conflicts:"
    echo "  jj edit <change-id>  # switch to conflicted change"
    echo "  # fix conflict markers in files"
    echo "  jj squash           # apply fixes"
}

# Push all bookmarked changes to GitHub
jj-push() {
    if ! jj root &>/dev/null; then
        echo "Error: Not in a jj repository"
        return 1
    fi

    echo "Pushing all bookmarks to remote..."
    jj git push --all --allow-new
}

# Create a bookmark (like git branch) for current change
# Usage: jj-bookmark "feature-name"
jj-bookmark() {
    if [ -z "$1" ]; then
        echo "Usage: jj-bookmark \"bookmark-name\""
        return 1
    fi

    if ! jj root &>/dev/null; then
        echo "Error: Not in a jj repository"
        return 1
    fi

    jj bookmark create "$1"
    echo "Created bookmark: $1"
    echo "Push with: jj git push --allow-new"
}

# Quick status showing current change and conflicts
jj-status() {
    if ! jj root &>/dev/null; then
        echo "Error: Not in a jj repository"
        return 1
    fi

    echo "=== jj Status ==="
    jj status
    echo ""

    # Check for conflicts
    local conflict_count=$(jj log -r 'main..' --no-graph -T 'if(conflict, "x")' 2>/dev/null | wc -c | tr -d ' ')
    if [ "$conflict_count" -gt 0 ]; then
        echo "Warning: $conflict_count change(s) have conflicts"
        echo "Run: jj-conflicts"
    fi
}

# Undo the last jj operation
jj-undo() {
    if ! jj root &>/dev/null; then
        echo "Error: Not in a jj repository"
        return 1
    fi

    echo "Undoing last operation..."
    jj undo
    echo ""
    jj status
}

# Show help for jj-* commands
jj-help() {
    echo "VibeGo jj Helper Commands"
    echo "========================="
    echo ""
    echo "Starting work:"
    echo "  jj-task \"description\"    Start new independent change"
    echo "  jj-bookmark \"name\"       Create bookmark for current change"
    echo ""
    echo "Viewing state:"
    echo "  jj-status                Quick status overview"
    echo "  jj-tasks                 See all active changes"
    echo "  jj-conflicts             Show changes with conflicts"
    echo ""
    echo "Syncing & reconciling:"
    echo "  jj-sync                  Fetch remote and rebase all changes"
    echo "  jj-reconcile             Show options for combining changes"
    echo "  jj-push                  Push all bookmarks to GitHub"
    echo ""
    echo "Utilities:"
    echo "  jj-undo                  Undo last jj operation"
    echo "  jj-window-id             Show current tmux window ID"
    echo "  jj-help                  Show this help"
    echo ""
    echo "Native jj commands:"
    echo "  jj status                Current working copy status"
    echo "  jj log                   Show change history"
    echo "  jj diff                  Show current changes"
    echo "  jj edit <change-id>      Switch to editing a change"
    echo "  jj squash                Squash current change into parent"
}

# Print message when sourced
if [[ "${BASH_SOURCE[0]}" != "${0}" ]]; then
    echo "VibeGo jj helpers loaded. Run 'jj-help' for commands."
fi
