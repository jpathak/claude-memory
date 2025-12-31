---
name: mem-status
description: Show the current status of the Claude Memory system including recent memories, active instances, and pending tasks
---

# Memory System Status

Display an overview of the Claude Memory system state.

## Steps

1. Check if memory system exists:
```bash
test -d .claude-memory && echo "Memory system initialized" || echo "Not initialized - run /mem-init"
```

2. If initialized, read and summarize:

### Recent Memories
Read `.claude-memory/index.json` and display the `recent` array entries.

### Active Instances
Read `.claude-memory-runtime/instances/activity.yaml` and show instances with recent `last_activity`.

### Pending Tasks
Count files in `.claude-memory-runtime/tasks/pending/`:
```bash
ls .claude-memory-runtime/tasks/pending/*.yaml 2>/dev/null | wc -l
```

### Recent Activity
Read the `recent_activity` array from `.claude-memory-runtime/instances/activity.yaml`.

## Output Format

```
Claude Memory Status
====================
Memory Directory: .claude-memory/ (version controlled)
Runtime Directory: .claude-memory-runtime/ (git ignored)
Initialized: Yes/No

Recent Memories (last 5):
- [decision] Title of memory 1
- [fact] Title of memory 2
...

Active Instances: N
- instance_abc (hostname) - working on: description

Pending Tasks: N
- [priority] Task title

Recent Activity:
- timestamp instance_id: action
...
```
