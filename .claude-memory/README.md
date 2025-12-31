# Claude Memory System

This directory contains a shared memory and coordination system for Claude instances working on this project.

## For New Claude Instances

Welcome! You're now part of a distributed team of Claude instances.

### On Startup
1. Read this file
2. Check `instances/activity.yaml` for other active instances
3. Load recent memories from `index.json`
4. Check `tasks/pending/` for tasks you can help with

### Storing Memories
Create YAML files in `memories/` when:
- A significant decision is made
- A bug root cause is found
- User expresses a preference
- An investigation reaches a conclusion

Memory types: `decision`, `event`, `fact`, `preference`, `context`, `conclusion`

### Directory Structure
```
.claude-memory/
├── README.md           <- You are here
├── config.yaml         <- System settings
├── index.json          <- Fast lookups
├── timeline.json       <- Chronological view
├── memories/           <- Memory YAML files
├── tasks/
│   ├── pending/        <- Unclaimed tasks
│   ├── in_progress/    <- Being worked on
│   ├── completed/      <- Done with results
│   └── failed/         <- Failed tasks
├── instances/
│   └── activity.yaml   <- Who's active
├── inbox/              <- Direct messages
├── artifacts/          <- Files from tasks
└── archive/            <- Old memories
```

### Conflict Resolution
1. Check `links.supersedes` in memories
2. Check timestamps (newer wins)
3. Read `timeline.json` for context
