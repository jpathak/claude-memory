---
name: mem-init
description: Initialize the Claude Memory system in the current project directory
---

# Initialize Claude Memory

Create the memory system directory structure:
- `.claude-memory/` - Version controlled project knowledge
- `.claude-memory-runtime/` - Git ignored instance runtime data

## Steps

1. Create the directory structure:
```bash
# Version controlled directories
mkdir -p .claude-memory/{memories,completed,archive}

# Git ignored runtime directories
mkdir -p .claude-memory-runtime/{instances,inbox,tasks/{pending,in_progress},failed,artifacts}
```

2. Create `index.json` in `.claude-memory/`:
```json
{
  "version": "1.0",
  "last_updated": "{{TIMESTAMP}}",
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

3. Create `timeline.json`:
```json
{
  "entries": [],
  "last_updated": "{{TIMESTAMP}}"
}
```

4. Create `config.yaml` in `.claude-memory/`:
```yaml
version: "1.0"
instance_id: "{{INSTANCE_ID}}"
storage:
  max_memories: 1000
  max_tasks: 100
  prune_after_days: 90
  archive_instead_of_delete: true
retrieval:
  auto_load_recent: 10
  auto_load_high_importance: true
  max_context_memories: 20
instance:
  capabilities:
    - coding
    - testing
  heartbeat_interval_seconds: 60
```

5. Create `instances/activity.yaml` in `.claude-memory-runtime/`:
```yaml
instances: {}
heartbeat:
  interval_seconds: 60
  stale_after_seconds: 300
  offline_after_seconds: 900
recent_activity: []
```

6. Create `README.md` in `.claude-memory/` with system documentation (see skill for full content)

7. Add `.claude-memory-runtime/` to `.gitignore`:
```bash
echo ".claude-memory-runtime/" >> .gitignore
```

Replace `{{TIMESTAMP}}` with current ISO 8601 timestamp and `{{INSTANCE_ID}}` with a unique identifier like `instance_` followed by 8 random characters.

## Confirmation

After initialization, confirm by listing the structure:
```bash
ls -la .claude-memory/
ls -la .claude-memory-runtime/
```
