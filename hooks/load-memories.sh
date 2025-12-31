#!/bin/bash
# Claude Memory - Load memories on startup hook
# This hook is triggered on the first tool call to inject memories into context

MEMORY_DIR=".claude-memory"
INDEX_FILE="$MEMORY_DIR/index.json"
MEMORIES_DIR="$MEMORY_DIR/memories"

# Exit early if memory system not initialized
if [ ! -f "$INDEX_FILE" ]; then
    exit 0
fi

# Check if we've already loaded memories this session (use a temp marker)
MARKER="/tmp/claude-memory-loaded-$$"
if [ -f "$MARKER" ]; then
    exit 0
fi
touch "$MARKER"

# Read high-importance memory IDs from index
HIGH_IMPORTANCE=$(cat "$INDEX_FILE" 2>/dev/null | grep -o '"high_importance":\s*\[[^]]*\]' | grep -o '"[a-f0-9]*"' | tr -d '"' | head -10)

if [ -z "$HIGH_IMPORTANCE" ]; then
    exit 0
fi

echo "=== CLAUDE MEMORY SYSTEM - IMPORTANT MEMORIES ==="
echo "The following memories were stored from previous sessions. Apply these immediately:"
echo ""

for mem_id in $HIGH_IMPORTANCE; do
    # Find the memory file containing this ID
    mem_file=$(find "$MEMORIES_DIR" -name "*${mem_id}*.yaml" 2>/dev/null | head -1)
    if [ -n "$mem_file" ] && [ -f "$mem_file" ]; then
        # Extract key fields from YAML
        title=$(grep "^title:" "$mem_file" | cut -d'"' -f2)
        type=$(grep "^type:" "$mem_file" | cut -d'"' -f2)
        summary=$(grep "^summary:" "$mem_file" | cut -d'"' -f2)
        importance=$(grep "^importance:" "$mem_file" | awk '{print $2}')

        echo "[$type] $title (importance: $importance)"
        echo "  $summary"
        echo ""
    fi
done

echo "=== END MEMORIES ==="
echo ""
