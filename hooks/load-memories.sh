#!/bin/bash
# Claude Memory - Load memories on session start
# Outputs JSON with additionalContext for Claude Code SessionStart hook

MEMORY_DIR=".claude-memory"
INDEX_FILE="$MEMORY_DIR/index.json"
MEMORIES_DIR="$MEMORY_DIR/memories"

# Auto-initialize if memory system not set up
if [ ! -d "$MEMORY_DIR" ]; then
    mkdir -p "$MEMORY_DIR/memories"
    mkdir -p ".claude-memory-runtime/instances"
    mkdir -p ".claude-memory-runtime/tasks"
    mkdir -p ".claude-memory-runtime/inbox"
    mkdir -p ".claude-memory-runtime/artifacts"
    echo '{"memories":[],"high_importance":[]}' > "$INDEX_FILE"

    # Add runtime dir to gitignore if not already there
    if [ -f ".gitignore" ]; then
        grep -q "^\.claude-memory-runtime" .gitignore || echo ".claude-memory-runtime/" >> .gitignore
    fi

    # Output initialization message
    cat << 'INIT_EOF'
{
  "hookSpecificOutput": {
    "hookEventName": "SessionStart",
    "additionalContext": "=== CLAUDE MEMORY SYSTEM ===\n\nMemory system initialized for this project.\n\n--- AUTOMATIC MEMORY BEHAVIOR ---\nYou MUST automatically store memories when:\n- User says 'remember', 'don't forget', 'always', 'never', 'I prefer'\n- User expresses preferences or makes decisions\n- User corrects you on how to do something\n- Important facts are discovered\n\nTo store: claude-mem store -t <type> --title \"<title>\" -s \"<summary>\" -i <importance>\nTo recall: claude-mem recall [query]\n\n=== END MEMORIES ==="
  }
}
INIT_EOF
    exit 0
fi

# If directory exists but no index, create it
if [ ! -f "$INDEX_FILE" ]; then
    echo '{"memories":[],"high_importance":[]}' > "$INDEX_FILE"
    echo '{}'
    exit 0
fi

# Read high-importance memory IDs from index using Python for reliable JSON parsing
HIGH_IMPORTANCE=$(python3 -c "
import json, sys
try:
    with open('$INDEX_FILE') as f:
        d = json.load(f)
    for mid in d.get('high_importance', [])[:10]:
        print(mid)
except:
    pass
" 2>/dev/null)

# Build the memories text - start with instructions
MEMORIES_TEXT="=== CLAUDE MEMORY SYSTEM ===\n\n"
MEMORIES_TEXT="${MEMORIES_TEXT}--- AUTOMATIC MEMORY BEHAVIOR (CRITICAL) ---\n"
MEMORIES_TEXT="${MEMORIES_TEXT}You MUST automatically store memories when:\n"
MEMORIES_TEXT="${MEMORIES_TEXT}- User says 'remember', 'don't forget', 'always', 'never', 'I prefer', 'from now on'\n"
MEMORIES_TEXT="${MEMORIES_TEXT}- User expresses preferences (coding style, tools, conventions)\n"
MEMORIES_TEXT="${MEMORIES_TEXT}- User corrects you ('no, do it this way')\n"
MEMORIES_TEXT="${MEMORIES_TEXT}- Decisions are made between alternatives\n"
MEMORIES_TEXT="${MEMORIES_TEXT}- Important project facts are discovered\n\n"
MEMORIES_TEXT="${MEMORIES_TEXT}To store: claude-mem store -t <type> --title \"<title>\" -s \"<summary>\" -i <importance>\n"
MEMORIES_TEXT="${MEMORIES_TEXT}Types: preference (0.8-0.9), decision (0.7-0.8), fact (0.5-0.7), event (0.3-0.5)\n"
MEMORIES_TEXT="${MEMORIES_TEXT}To recall: claude-mem recall [query] or claude-mem recall --important\n\n"

if [ -z "$HIGH_IMPORTANCE" ]; then
    MEMORIES_TEXT="${MEMORIES_TEXT}No stored memories yet. Be ready to store new ones!\n\n=== END MEMORIES ==="
else
    MEMORIES_TEXT="${MEMORIES_TEXT}--- STORED MEMORIES (Apply these immediately) ---\n\n"

    for mem_id in $HIGH_IMPORTANCE; do
        # Find the memory file containing this ID
        mem_file=$(find "$MEMORIES_DIR" -name "*${mem_id}*.yaml" 2>/dev/null | head -1)
        if [ -n "$mem_file" ] && [ -f "$mem_file" ]; then
            # Extract key fields from YAML
            title=$(grep "^title:" "$mem_file" | sed 's/^title: *//' | tr -d '"')
            type=$(grep "^type:" "$mem_file" | sed 's/^type: *//' | tr -d '"')
            summary=$(grep "^summary:" "$mem_file" | sed 's/^summary: *//' | tr -d '"')
            importance=$(grep "^importance:" "$mem_file" | awk '{print $2}')

            MEMORIES_TEXT="${MEMORIES_TEXT}[${type}] ${title} (importance: ${importance})\n"
            MEMORIES_TEXT="${MEMORIES_TEXT}  -> ${summary}\n\n"
        fi
    done

    MEMORIES_TEXT="${MEMORIES_TEXT}=== END MEMORIES ===\n\nApply these preferences/decisions NOW. Store new memories as conversation progresses."
fi

# Escape the text for JSON (handle newlines and quotes)
# Use awk for cross-platform compatibility (macOS + Linux)
ESCAPED_TEXT=$(echo -e "$MEMORIES_TEXT" | awk '
BEGIN { ORS="" }
{
    gsub(/\\/, "\\\\")
    gsub(/"/, "\\\"")
    if (NR > 1) print "\\n"
    print
}
')

# Output valid JSON for SessionStart hook
cat << EOF
{
  "hookSpecificOutput": {
    "hookEventName": "SessionStart",
    "additionalContext": "${ESCAPED_TEXT}"
  }
}
EOF

exit 0
