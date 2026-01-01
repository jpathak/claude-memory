#!/bin/bash
# Claude Memory - Check if important conclusions should be stored
# Stop hook - fires when Claude finishes responding
# Uses command type to check if claude-mem was called when it should have been

# Read the hook input from stdin
INPUT=$(cat)

# Extract relevant data from the hook input
TRANSCRIPT=$(echo "$INPUT" | python3 -c "
import json, sys
try:
    data = json.load(sys.stdin)
    # Get the conversation transcript
    transcript = data.get('transcript', [])
    # Get last few messages
    recent = transcript[-5:] if len(transcript) > 5 else transcript
    for msg in recent:
        role = msg.get('role', '')
        content = msg.get('content', '')
        if isinstance(content, list):
            for c in content:
                if isinstance(c, dict) and c.get('type') == 'text':
                    print(f'{role}: {c.get(\"text\", \"\")[:500]}')
        elif isinstance(content, str):
            print(f'{role}: {content[:500]}')
except Exception as e:
    print(f'Error: {e}', file=sys.stderr)
" 2>/dev/null)

# Check if claude-mem store was called in recent tool uses
MEMORY_STORED=$(echo "$INPUT" | python3 -c "
import json, sys
try:
    data = json.load(sys.stdin)
    transcript = data.get('transcript', [])
    for msg in transcript[-10:]:
        content = msg.get('content', [])
        if isinstance(content, list):
            for c in content:
                if isinstance(c, dict):
                    if c.get('type') == 'tool_use' and 'claude-mem store' in str(c):
                        print('yes')
                        sys.exit(0)
                    if c.get('type') == 'tool_result' and 'Memory stored' in str(c):
                        print('yes')
                        sys.exit(0)
    print('no')
except:
    print('no')
" 2>/dev/null)

# Check if there are indicators of important conclusions
HAS_CONCLUSION=$(echo "$TRANSCRIPT" | python3 -c "
import sys
text = sys.stdin.read().lower()
indicators = [
    'i found',
    'i discovered',
    'the issue is',
    'the problem is',
    'the solution is',
    'i recommend',
    'we should',
    'important:',
    'key finding',
    'root cause',
    'conclusion:',
    'in summary',
    'this means',
    'therefore',
    'as a result',
    'the answer is',
    'i learned',
    'turns out',
    'it appears that',
    'the reason is'
]
for ind in indicators:
    if ind in text:
        print('yes')
        exit(0)
print('no')
" 2>/dev/null)

# If there's an important conclusion but no memory was stored, inject a reminder
if [ "$HAS_CONCLUSION" = "yes" ] && [ "$MEMORY_STORED" = "no" ]; then
    # Return continue with context to store the memory
    cat << 'EOF'
{
  "decision": "continue",
  "reason": "Important conclusion detected - storing to memory",
  "hookSpecificOutput": {
    "additionalContext": "⚠️ MEMORY STORAGE REMINDER ⚠️\n\nYou just made an important conclusion or discovery. You MUST store this as a memory before completing.\n\nRun this command NOW:\n```bash\nclaude-mem store -t conclusion --title \"<descriptive title>\" -s \"<the key finding or conclusion>\" -i 0.7\n```\n\nThen you may complete your response."
  }
}
EOF
else
    # No action needed, allow stop
    cat << 'EOF'
{
  "decision": "stop"
}
EOF
fi

exit 0
