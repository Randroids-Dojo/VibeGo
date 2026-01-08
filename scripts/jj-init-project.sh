#!/bin/bash
# Initialize a project for jj colocated mode (alongside existing git)
# Usage: jj-init-project [project-path]

set -e

PROJECT_PATH="${1:-.}"

# Resolve to absolute path
PROJECT_PATH=$(cd "$PROJECT_PATH" 2>/dev/null && pwd) || {
    echo "Error: Cannot access directory: $1"
    exit 1
}

echo "=== jj Project Initialization ==="
echo "Project: $PROJECT_PATH"
echo ""

# Check if jj is installed
if ! command -v jj &>/dev/null; then
    echo "Error: jj is not installed"
    echo ""
    echo "Install with: brew install jj"
    exit 1
fi

# Check if it's a git repository
if [ ! -d "$PROJECT_PATH/.git" ]; then
    echo "Error: $PROJECT_PATH is not a git repository"
    echo ""
    echo "jj colocated mode requires an existing git repo."
    echo "Initialize git first with: git init"
    exit 1
fi

cd "$PROJECT_PATH"

# Check if jj is already initialized
if [ -d ".jj" ]; then
    echo "Project already has jj initialized"
    echo ""
    jj status
    echo ""
    echo "Ready to use! Try:"
    echo "  jj-task \"your task description\""
    exit 0
fi

# Initialize jj in colocated mode
echo "Initializing jj in colocated mode..."
jj git init --colocate

echo ""
echo "Verifying setup..."
ls -la .git .jj | head -4

echo ""
echo "=== Success! ==="
echo ""
echo "jj is now running alongside git in: $PROJECT_PATH"
echo ""
echo "Quick start commands:"
echo "  jj status                    # see current state"
echo "  jj-task \"my feature\"         # start new work"
echo "  jj log                       # see all changes"
echo "  jj-tasks                     # see active changes"
echo ""
echo "For multi-session workflow:"
echo "  Window 0: jj-task \"feature A\""
echo "  Window 1: jj-task \"feature B\""
echo "  Later:    jj-reconcile"
echo ""
echo "Git still works:"
echo "  git status                   # works as usual"
echo "  jj git push                  # push via jj"
