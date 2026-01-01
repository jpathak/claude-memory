---
name: claude-memory
description: "IMPORTANT: Activate this skill IMMEDIATELY at the start of every session before any other action. Check .claude-memory/ for stored memories and apply them (especially preferences like git email, coding style, etc). Also use when: storing new memories, recalling past decisions, user says 'remember this', delegating to other instances, or coordinating with other Claude sessions."
---

# Claude Memory System

A persistent memory and coordination system for Claude instances. This skill enables **automatic** memory storage and recall across sessions.

## CRITICAL: Automatic Behavior

### AUTO-STORE: When to Store Memories (DO THIS AUTOMATICALLY)

**You MUST automatically store a memory when ANY of these triggers occur:**

1. **Explicit triggers** - User says:
   - "remember this", "remember that", "don't forget"
   - "always do X", "never do Y", "I prefer X"
   - "from now on", "going forward", "in the future"
   - "keep in mind", "note that", "important:"

2. **Implicit triggers** - You detect:
   - User expresses a preference (coding style, tools, naming conventions)
   - A significant architectural or design decision is made
   - User corrects you ("no, do it this way instead")
   - Project-specific facts are discovered (API limits, env requirements)
   - Important context about the domain (compliance requirements, business rules)
   - User shares their email, name, or identity preferences

3. **Decision points** - When you and the user:
   - Choose between multiple options
   - Settle on an approach after discussion
   - Establish a pattern to follow

**IMMEDIATELY run the CLI when a trigger is detected - don't just acknowledge!**

### AUTO-RECALL: When to Query Memories (DO THIS AUTOMATICALLY)

**You MUST automatically recall memories when:**

1. Starting a new session (SessionStart hook handles high-importance ones)
2. User asks about past decisions ("why did we...", "what was the...")
3. You need context about project patterns or preferences
4. Before making a decision that might contradict a past preference
5. User references something discussed in a previous session
6. Working on files that have related memories

## How to Store a Memory (EXECUTE THIS)

When a trigger is detected, **immediately run**:

```bash
claude-mem store -t <type> --title "<short title>" -s "<what to remember>" -i <importance>
```

### Quick Reference

| Trigger | Type | Importance | Example |
|---------|------|------------|---------|
| "remember my email is X" | preference | 0.9 | `claude-mem store -t preference --title "User Email" -s "User email is x@y.com" -i 0.9` |
| "I prefer tabs over spaces" | preference | 0.8 | `claude-mem store -t preference --title "Code Style: Tabs" -s "User prefers tabs over spaces" -i 0.8` |
| "Let's use PostgreSQL" | decision | 0.8 | `claude-mem store -t decision --title "Database Choice" -s "Chose PostgreSQL for the project" -i 0.8` |
| "The API limit is 100/min" | fact | 0.6 | `claude-mem store -t fact --title "API Rate Limit" -s "API limited to 100 requests per minute" -i 0.6` |
| "We deployed v2.0" | event | 0.5 | `claude-mem store -t event --title "v2.0 Deployed" -s "Deployed version 2.0 to production" -i 0.5` |
| "Never commit to main directly" | preference | 0.9 | `claude-mem store -t preference --title "Git Workflow" -s "Never commit directly to main, always use PRs" -i 0.9` |

### Memory Types

- `preference` - User/project preferences (importance: 0.7-0.9)
- `decision` - Choices made between alternatives (importance: 0.6-0.8)
- `fact` - Discovered truths about codebase/domain (importance: 0.4-0.7)
- `event` - Significant occurrences (importance: 0.3-0.6)
- `context` - Background information (importance: 0.5-0.7)
- `conclusion` - Investigation results (importance: 0.6-0.8)

### Importance Guidelines

- **0.9** - Critical: User identity, core preferences, must-follow rules
- **0.8** - High: Important decisions, strong preferences
- **0.7** - Medium-High: Patterns, conventions to follow
- **0.5** - Medium: Useful facts, context
- **0.3** - Low: Minor notes, less critical info

## How to Recall Memories

```bash
# List recent memories
claude-mem recall

# Search by keyword
claude-mem recall "PostgreSQL"

# Filter by type
claude-mem recall -t preference

# Show only important memories
claude-mem recall --important

# Get full status
claude-mem status
```

## Example Flows

### Flow 1: User Expresses Preference
```
User: "I prefer using yarn over npm for this project"

Claude thinks: Preference detected! Store immediately.
Claude runs: claude-mem store -t preference --title "Package Manager: Yarn" -s "User prefers yarn over npm for this project" -i 0.8
Claude says: "Got it, I'll use yarn for all package operations. I've stored this preference for future sessions."
```

### Flow 2: Decision Made
```
User: "Let's go with the microservices approach instead of monolith"

Claude thinks: Architectural decision made! Store immediately.
Claude runs: claude-mem store -t decision --title "Architecture: Microservices" -s "Chose microservices over monolith architecture for scalability" -i 0.8
Claude says: "Understood, we're going with microservices. I've recorded this decision."
```

### Flow 3: User Correction
```
User: "No, always use double quotes in this codebase, not single"

Claude thinks: User corrected me - this is a preference! Store immediately.
Claude runs: claude-mem store -t preference --title "Code Style: Double Quotes" -s "Always use double quotes, not single quotes in this codebase" -i 0.8
Claude says: "Noted! I'll use double quotes from now on. This preference is saved for future sessions."
```

### Flow 4: Recalling Context
```
User: "Why did we choose Redis for caching?"

Claude thinks: User asking about past decision. Let me check memories.
Claude runs: claude-mem recall "Redis"
Claude says: "According to my records from [date], we chose Redis because..."
```

## Directory Structure

### .claude-memory/ (VERSION CONTROLLED)
```
.claude-memory/
├── config.yaml         # Project settings
├── index.json          # Fast lookups by type, tag, file
├── timeline.json       # Chronological view
├── memories/           # Memory YAML files
├── completed/          # Completed delegated tasks
└── archive/            # Archived memories
```

### .claude-memory-runtime/ (GIT IGNORED)
```
.claude-memory-runtime/
├── instances/          # Active instances registry
├── inbox/              # Messages between instances
├── tasks/              # Pending/in-progress tasks
└── artifacts/          # Temp files
```

## On Session Start

The SessionStart hook automatically loads high-importance memories. You should:

1. Read and internalize any memories provided in the session context
2. Apply preferences immediately (coding style, git email, etc.)
3. Be ready to store new memories as the conversation progresses

## Best Practices

1. **Store proactively** - Don't wait to be asked, detect triggers automatically
2. **Confirm storage** - Tell the user when you've stored a memory
3. **Use appropriate importance** - Critical preferences get 0.9, minor notes get 0.3
4. **Recall before deciding** - Check memories before making decisions that might conflict
5. **Link related memories** - Reference past decisions when storing new ones
6. **Keep summaries concise** - The summary should be clear and actionable
