# Multi-Session Workflow with jj

Run multiple Claude Code sessions simultaneously on the same project without conflicts blocking your workflow.

## Why jj?

| Problem with Git | Solution with jj |
|------------------|------------------|
| Only one working copy | Multiple independent changes |
| Conflicts block operations | Conflicts are recorded, not fatal |
| Need worktrees for parallel work | Single repo, multiple changes |
| Manual rebase management | Automatic descendant rebasing |

## Quick Start

### 1. Install jj

```bash
brew install jj
```

### 2. Configure jj (one-time)

```bash
jj config set --user user.name "Your Name"
jj config set --user user.email "your@email.com"
```

### 3. Initialize your project

```bash
jj-init-project ~/Documents/Dev/godot/pitgo
```

### 4. Start working in multiple sessions

**In tmux window 0:**
```bash
cd ~/Documents/Dev/godot/pitgo
jj-task "add player dash ability"
# Claude Code works on files...
```

**In tmux window 1 (same time):**
```bash
cd ~/Documents/Dev/godot/pitgo
jj-task "improve enemy AI pathfinding"
# Claude Code works on different files...
```

### 5. Check status across all sessions

```bash
jj-tasks  # See all active changes
```

### 6. Reconcile when ready

```bash
jj-reconcile  # Shows options for combining work
```

## Command Reference

### Starting Work

| Command | Description |
|---------|-------------|
| `jj-task "description"` | Create new independent change from main |
| `jj-bookmark "name"` | Create named bookmark for current change |

### Viewing State

| Command | Description |
|---------|-------------|
| `jj-status` | Quick status with conflict check |
| `jj-tasks` | See all active changes (all sessions) |
| `jj-conflicts` | Show which changes have conflicts |
| `jj log` | Full change graph |
| `jj diff` | See current uncommitted changes |

### Syncing & Pushing

| Command | Description |
|---------|-------------|
| `jj-sync` | Fetch remote and rebase all changes onto main |
| `jj-push` | Push all bookmarked changes to GitHub |
| `jj-reconcile` | Show options for combining changes |

### Utilities

| Command | Description |
|---------|-------------|
| `jj-undo` | Undo last jj operation |
| `jj-help` | Show all helper commands |

## Handling Conflicts

Unlike git, jj **doesn't block** when conflicts occur. Conflicts are recorded in the change and you resolve them when convenient.

### Detecting Conflicts

```bash
jj-conflicts
# Shows: abc123 add player dash [CONFLICT]
```

### Resolving Conflicts

```bash
# Switch to the conflicted change
jj edit abc123

# Open the file with conflicts (standard <<<< ==== >>>> markers)
# Fix the conflicts in your editor

# The change auto-updates when you save
# Check with:
jj status
```

### Conflict Propagation

When you fix a conflict in an earlier change, jj automatically rebases descendants. Often this resolves downstream conflicts too.

## Reconciling Multiple Sessions

When you're done working in multiple windows and want to combine the work:

### Option A: Stack Changes (Linear History)

Creates a clean linear history. Good for sequential features.

```bash
# Make change2 build on change1
jj rebase -s <change2-id> -d <change1-id>

# Then change3 builds on change2
jj rebase -s <change3-id> -d <change2-id>

# Result: main → change1 → change2 → change3
```

### Option B: Merge Changes (Parallel History)

Keeps changes as parallel branches, then merges. Good for independent features.

```bash
# Create a merge commit
jj new <change1-id> <change2-id> <change3-id> -m "merge all features"

# Result: main → change1 ─┐
#              → change2 ─┼→ merge
#              → change3 ─┘
```

### Option C: Squash Into One

Combines all changes into a single commit. Good for related small changes.

```bash
# Squash change2 into change1
jj squash -r <change2-id> --into <change1-id>
```

## Pushing to GitHub

### Create PR-Ready Branch

```bash
# Create a bookmark (like git branch) for your change
jj bookmark create my-feature -r <change-id>

# Push to GitHub
jj git push --allow-new

# Or push all bookmarks at once
jj-push
```

### After PR is Merged

```bash
# Fetch latest from remote
jj git fetch

# Sync your changes
jj-sync
```

## Example: Full Multi-Session Workflow

```bash
# === Terminal Setup ===
# Open tmux and create windows: Ctrl+b c (multiple times)

# === Window 0: Player Features ===
cd ~/Documents/Dev/godot/pitgo
jj-task "add player wall jump"
# Claude Code implements wall jump...

# === Window 1: Enemy System (same time) ===
cd ~/Documents/Dev/godot/pitgo
jj-task "add enemy wave spawner"
# Claude Code implements spawner...

# === Window 2: UI Work (same time) ===
cd ~/Documents/Dev/godot/pitgo
jj-task "add health bar UI"
# Claude Code implements UI...

# === Later: Check All Work ===
jj-tasks
# Shows all 3 changes

# === Reconcile ===
jj-reconcile
# Choose to stack or merge

# Example: Stack them linearly
jj rebase -s <enemy-change> -d <player-change>
jj rebase -s <ui-change> -d <enemy-change>

# === Push to GitHub ===
jj bookmark create feature-bundle
jj git push --allow-new
```

## Tips for Claude Code Sessions

1. **Start each task with `jj-task`** - This creates an independent change that won't interfere with other sessions.

2. **Check `jj-tasks` periodically** - See what other sessions are working on.

3. **Don't panic about conflicts** - They're recorded, not blocking. Resolve when convenient.

4. **Use `jj-undo` if something goes wrong** - Every operation is reversible.

5. **Keep main clean** - Always branch from main, reconcile back to main.

## Troubleshooting

### "Not in a jj repository"

```bash
jj-init-project .  # Initialize jj in current directory
```

### "Working copy is dirty"

jj auto-snapshots, so this usually resolves itself. If stuck:

```bash
jj status  # See what's changed
jj describe -m "WIP"  # Save as work in progress
```

### Conflicts After Sync

```bash
jj-conflicts  # Find conflicted changes
jj edit <id>  # Switch to that change
# Fix conflict markers
jj squash     # Apply fix
```

### Lost Changes

```bash
jj op log     # See all operations
jj op restore <op-id>  # Restore to previous state
```
