---
name: claude-memory
description: Use this skill when you need to store or recall persistent memories across sessions, delegate tasks to other Claude instances, or coordinate with other instances working on this project. Activate when users mention remembering decisions, tracking what happened, coordinating with other Claude sessions, or when you make important decisions that should persist.
---

# Claude Memory System

A persistent memory and coordination system that lives in `.claude-memory/` in the project directory.

## When to Use This Skill

- User says "remember this" or "don't forget"
- You make a significant decision worth preserving
- You discover important facts about the codebase
- User expresses preferences (coding style, tools, patterns)
- You need to delegate work to another Claude instance
- You want to check what decisions were made previously

## Quick Start

### Check if Memory System Exists

```bash
ls -la .claude-memory/
```

If it doesn't exist, create it:

```bash
mkdir -p .claude-memory/{memories,tasks/{pending,in_progress,completed,failed},instances,inbox,artifacts,archive}
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

Create a task file in `.claude-memory/tasks/pending/`:

```yaml
# .claude-memory/tasks/pending/task_xyz789.yaml
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

```
.claude-memory/
├── README.md           # Self-describing docs
├── config.yaml         # System settings
├── index.json          # Fast lookups by type, tag, file
├── timeline.json       # Chronological view
├── memories/           # Memory YAML files
├── tasks/
│   ├── pending/        # Unclaimed tasks
│   ├── in_progress/    # Being worked on
│   ├── completed/      # Done with results
│   └── failed/         # Failed tasks
├── instances/
│   └── activity.yaml   # Who's active, what they're doing
├── inbox/              # Direct messages between instances
├── artifacts/          # Files from tasks (screenshots, etc.)
└── archive/            # Old/pruned memories
```

## Conflict Resolution

When memories conflict:
1. Check `links.supersedes` - newer memory explicitly replaces older
2. Check timestamps - more recent usually wins
3. Read surrounding entries in `timeline.json` for context

## Setup (If Not Initialized)

Create `index.json`:

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

Create `instances/activity.yaml`:

```yaml
instances: {}
heartbeat:
  interval_seconds: 60
  stale_after_seconds: 300
  offline_after_seconds: 900
recent_activity: []
```

## Best Practices

1. **Store memories proactively** - Don't wait to be asked
2. **Use appropriate importance** - 0.9 for critical decisions, 0.3 for minor notes
3. **Link related memories** - Use `links.related_to` and `links.supersedes`
4. **Update the index** - After creating a memory, add its ID to `index.json`
5. **Tag consistently** - Use lowercase, common tags across memories
