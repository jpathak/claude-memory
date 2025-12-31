#!/bin/bash
# Claude Memory - Load memories on session start
# Outputs JSON with additionalContext for Claude Code SessionStart hook

MEMORY_DIR=".claude-memory"
INDEX_FILE="$MEMORY_DIR/index.json"
MEMORIES_DIR="$MEMORY_DIR/memories"

# Exit early if memory system not initialized (output empty JSON)
if [ ! -f "$INDEX_FILE" ]; then
    echo '{}'
    exit 0
fi

# Read high-importance memory IDs from index
HIGH_IMPORTANCE=$(cat "$INDEX_FILE" 2>/dev/null | grep -o '"high_importance":\s*\[[^]]*\]' | grep -o '"[a-f0-9]*"' | tr -d '"' | head -10)

if [ -z "$HIGH_IMPORTANCE" ]; then
    echo '{}'
    exit 0
fi

# Build the memories text
MEMORIES_TEXT="=== CLAUDE MEMORY SYSTEM ===\n\nThe following high-importance memories were stored from previous sessions. You MUST apply these immediately:\n\n"

for mem_id in $HIGH_IMPORTANCE; do
    # Find the memory file containing this ID
    mem_file=$(find "$MEMORIES_DIR" -name "*${mem_id}*.yaml" 2>/dev/null | head -1)
    if [ -n "$mem_file" ] && [ -f "$mem_file" ]; then
        # Extract key fields from YAML
        title=$(grep "^title:" "$mem_file" | sed 's/^title: *//' | tr -d '"')
        type=$(grep "^type:" "$mem_file" | sed 's/^type: *//' | tr -d '"')
        summary=$(grep "^summary:" "$mem_file" | sed 's/^summary: *//' | tr -d '"')
        details=$(grep "^details:" "$mem_file" | sed 's/^details: *//' | tr -d '"')
        importance=$(grep "^importance:" "$mem_file" | awk '{print $2}')

        MEMORIES_TEXT="${MEMORIES_TEXT}[${type}] ${title} (importance: ${importance})\n"
        MEMORIES_TEXT="${MEMORIES_TEXT}  Summary: ${summary}\n"
        if [ -n "$details" ] && [ "$details" != "|" ]; then
            MEMORIES_TEXT="${MEMORIES_TEXT}  Details: ${details}\n"
        fi
        MEMORIES_TEXT="${MEMORIES_TEXT}\n"
    fi
done

MEMORIES_TEXT="${MEMORIES_TEXT}=== END MEMORIES ===\n\nApply these preferences and decisions to all your work in this session."

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
