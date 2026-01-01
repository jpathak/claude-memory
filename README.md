# Claude Memory

A persistent memory and coordination system for Claude Code instances. Enables cross-session knowledge retention, automatic memory storage, and multi-instance coordination.

## Features

- **Automatic Memory Storage**: Detects when users say "remember", "always", "never", "I prefer" and automatically stores memories
- **Conclusion Detection**: Catches when Claude makes important discoveries or conclusions and prompts storage
- **Cross-Session Persistence**: Memories persist across Claude Code sessions via `.claude-memory/` directory
- **Multi-Instance Coordination**: Delegate tasks between Claude instances and share knowledge

## Installation

### As a Claude Code Plugin

1. Add the marketplace:
```bash
claude plugins:marketplace:add claude-memory-marketplace --source directory --path /path/to/claude-memory
```

2. Install the plugin:
```bash
claude plugins:install claude-memory@claude-memory-marketplace
```

3. Enable the plugin:
```bash
claude plugins:enable claude-memory@claude-memory-marketplace
```

### CLI Installation

```bash
npm install -g .
```

## How It Works

### Hooks

The plugin uses three hooks to enforce memory storage:

| Hook | Trigger | Action |
|------|---------|--------|
| **SessionStart** | Session begins | Loads existing memories into context |
| **UserPromptSubmit** | User sends message | Detects trigger phrases, injects mandatory storage instructions |
| **Stop** | Claude finishes responding | Detects conclusions, forces memory storage if needed |

### Trigger Phrases

The system automatically detects these phrases and enforces memory storage:

**Explicit Triggers:**
- "remember this/that"
- "don't forget"
- "always do/use"
- "never do/use"
- "I prefer"
- "from now on"

**Implicit Triggers:**
- "I like"
- "let's use"
- "we decided"
- "prefer X over Y"

### Conclusion Detection

The Stop hook detects phrases indicating important discoveries:
- "I found", "I discovered"
- "the problem is", "the issue is"
- "the solution is"
- "root cause"
- "I recommend"

## CLI Usage

```bash
# Initialize memory system in current directory
claude-mem init

# Store a memory
claude-mem store -t preference --title "Code Style" -s "User prefers tabs over spaces" -i 0.8

# Recall memories
claude-mem recall                    # List recent
claude-mem recall "database"         # Search
claude-mem recall --important        # High importance only
claude-mem recall -t decision        # Filter by type

# Show status
claude-mem status

# View timeline
claude-mem timeline

# Delegate a task
claude-mem delegate --title "Review PR" -d "Review pull request #123"

# List and claim tasks
claude-mem tasks
claude-mem claim <taskId>
claude-mem complete <taskId>
```

## Memory Types

| Type | Importance | Use Case |
|------|------------|----------|
| `preference` | 0.7-0.9 | User preferences, coding style, tool choices |
| `decision` | 0.6-0.8 | Architectural decisions, technology choices |
| `fact` | 0.4-0.7 | Discovered facts about codebase, APIs |
| `event` | 0.3-0.6 | Deployments, releases, milestones |
| `context` | 0.5-0.7 | Background information |
| `conclusion` | 0.6-0.8 | Investigation results, findings |

## Directory Structure

```
.claude-memory/           # Version controlled
├── config.yaml          # Project settings
├── index.json           # Fast lookups
├── timeline.json        # Chronological view
├── memories/            # Memory YAML files
├── completed/           # Completed tasks
└── archive/             # Archived memories

.claude-memory-runtime/   # Git ignored
├── instances/           # Active instances
├── inbox/               # Inter-instance messages
├── tasks/               # Pending/in-progress tasks
└── artifacts/           # Temporary files
```

## Development

```bash
# Install dependencies
npm install

# Build
npm run build

# Run tests
npm test

# Development mode
npm run dev
```

## License

MIT
