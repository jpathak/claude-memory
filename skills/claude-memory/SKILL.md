---
name: claude-memory
description: "IMPORTANT: Activate this skill IMMEDIATELY at the start of every session before any other action. Check .claude-memory/ for stored memories and apply them (especially preferences like git email, coding style, etc). Also use when: storing new memories, recalling past decisions, user says 'remember this', delegating to other instances, or coordinating with other Claude sessions."
---

# Claude Memory System

A persistent memory and coordination system using two directories:
- `.claude-memory/` - **Version controlled** project knowledge (memories, completed tasks, config)
- `.claude-memory-runtime/` - **Git ignored** instance-specific runtime data (active instances, inbox, pending tasks)

## When to Use This Skill

- User says "remember this" or "don't forget"
- You make a significant decision worth preserving
- You discover important facts about the codebase
- User expresses preferences (coding style, tools, patterns)
- You need to delegate work to another Claude instance
- You want to check what decisions were made previously

## On Startup - IMPORTANT

**Always check for and load memories when starting a session:**

1. Check if `.claude-memory/` exists
2. Read `index.json` to find high-importance memories
3. Load memories from `memories/` especially those with importance >= 0.7
4. Apply preferences immediately (e.g., git email, coding style)

## Quick Start

### Check if Memory System Exists

```bash
ls -la .claude-memory/
ls -la .claude-memory-runtime/
```

If they don't exist, create them:

```bash
# Version controlled directory
mkdir -p .claude-memory/{memories,completed,archive}

# Git ignored runtime directory
mkdir -p .claude-memory-runtime/{instances,inbox,tasks/{pending,in_progress},failed,artifacts}
```

Then create the initial files (see Setup section below).

### Store a Memory

Create a YAML file in `.claude-memory/memories/`:

```yaml
# .claude-memory/memories/2024-01-15T10-30-00_decision_abc123.yaml
id: "abc123"
type: "decision"
status: "active"
timestamp: "2024-01-15T10:30:00Z"
instance_id: "your-instance-id"
title: "Chose PostgreSQL over MongoDB"
summary: "Selected PostgreSQL for ACID compliance and complex query needs"
details: |
  User data requires transactions across multiple tables.
  MongoDB's eventual consistency was a concern.
tags:
  - database
  - architecture
importance: 0.8
confidence: 0.9
context:
  related_files:
    - "src/db/schema.sql"
```

### Recall Memories

Read the index for quick lookups:

```bash
cat .claude-memory/index.json
```

Then read specific memory files based on IDs found in the index.

### Delegate a Task

Create a task file in `.claude-memory-runtime/tasks/pending/`:

```yaml
# .claude-memory-runtime/tasks/pending/task_xyz789.yaml
id: "task_xyz789"
created_at: "2024-01-15T14:00:00Z"
created_by:
  instance_id: "your-instance-id"
type: "request"
priority: "high"
title: "Test login flow in browser"
description: "Test the OAuth login with Google and GitHub"
instructions: |
  1. Navigate to /login
  2. Test Google OAuth
  3. Test GitHub OAuth
  4. Report any errors
target:
  capabilities:
    - "browser_testing"
status: "pending"
status_history:
  - status: "pending"
    timestamp: "2024-01-15T14:00:00Z"
    by: "your-instance-id"
```

When completed, the task moves to `.claude-memory/completed/` (version controlled).

## Memory Types

| Type | When to Use | Example |
|------|-------------|---------|
| `decision` | Choosing between alternatives | "Chose React over Vue for component library" |
| `fact` | Discovered truth about codebase/domain | "API rate limit is 100 requests/minute" |
| `event` | Something significant happened | "Deployed v2.0 to production" |
| `preference` | User or project preference | "User prefers tabs over spaces" |
| `context` | Background information | "This is a healthcare app, HIPAA applies" |
| `conclusion` | Result of investigation | "Performance issue was N+1 queries" |

## Directory Structure

The system uses **two directories** to separate version-controlled project knowledge from ephemeral instance data:

### .claude-memory/ (VERSION CONTROLLED)
```
.claude-memory/
├── README.md           # Self-describing docs
├── config.yaml         # Project settings
├── index.json          # Fast lookups by type, tag, file
├── timeline.json       # Chronological view
├── memories/           # Memory YAML files (decisions, facts, preferences)
├── completed/          # Completed tasks with results
└── archive/            # Archived memories
```

### .claude-memory-runtime/ (GIT IGNORED)
```
.claude-memory-runtime/
├── instances/
│   └── activity.yaml   # Active instances registry
├── inbox/              # Direct messages between instances
├── tasks/
│   ├── pending/        # Unclaimed tasks
│   └── in_progress/    # Tasks being worked on
├── failed/             # Failed tasks
└── artifacts/          # Temp files from tasks
```

## Conflict Resolution

When memories conflict:
1. Check `links.supersedes` - newer memory explicitly replaces older
2. Check timestamps - more recent usually wins
3. Read surrounding entries in `timeline.json` for context

## Setup (If Not Initialized)

Create `index.json` in `.claude-memory/`:

```json
{
  "version": "1.0",
  "last_updated": "2024-01-15T10:00:00Z",
  "by_type": {
    "decision": [],
    "event": [],
    "fact": [],
    "preference": [],
    "context": [],
    "conclusion": []
  },
  "by_tag": {},
  "by_file": {},
  "by_status": {
    "active": [],
    "superseded": [],
    "archived": []
  },
  "recent": [],
  "high_importance": []
}
```

Create `instances/activity.yaml` in `.claude-memory-runtime/`:

```yaml
instances: {}
heartbeat:
  interval_seconds: 60
  stale_after_seconds: 300
  offline_after_seconds: 900
recent_activity: []
```

## Best Practices

1. **Load memories on startup** - Always check for and apply high-importance memories
2. **Store memories proactively** - Don't wait to be asked
3. **Use appropriate importance** - 0.9 for critical decisions/preferences, 0.3 for minor notes
4. **Link related memories** - Use `links.related_to` and `links.supersedes`
5. **Update the index** - After creating a memory, add its ID to `index.json`
6. **Tag consistently** - Use lowercase, common tags across memories
7. **Commit memory changes** - Memory files should be committed with related code changes
