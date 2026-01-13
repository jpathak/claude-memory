#!/bin/bash
# Claude Memory - Detect memory triggers in user prompts
# UserPromptSubmit hook - fires when user submits a message

# Read the hook input from stdin
INPUT=$(cat)

# Extract the user's message from JSON
USER_MESSAGE=$(echo "$INPUT" | python3 -c "
import json, sys
try:
    data = json.load(sys.stdin)
    # The prompt is in the 'prompt' field
    print(data.get('prompt', ''))
except:
    print('')
" 2>/dev/null)

# Convert to lowercase for matching (using printf to avoid shell injection)
USER_MESSAGE_LOWER=$(printf '%s' "$USER_MESSAGE" | tr '[:upper:]' '[:lower:]')

# Define trigger patterns for explicit memory requests
EXPLICIT_TRIGGERS=(
    "remember this"
    "remember that"
    "don't forget"
    "do not forget"
    "always do"
    "always use"
    "never do"
    "never use"
    "i prefer"
    "i always"
    "i never"
    "from now on"
    "going forward"
    "in the future"
    "keep in mind"
    "note that"
    "important:"
    "make sure to always"
    "make sure to never"
)

# Define trigger patterns for preferences/decisions
PREFERENCE_TRIGGERS=(
    "i like"
    "i want"
    "i need you to"
    "please always"
    "please never"
    "use .* instead"
    "prefer .* over"
    "let's go with"
    "let's use"
    "we should use"
    "we decided"
    "the decision is"
)

# Check for explicit triggers
TRIGGER_FOUND=""
TRIGGER_TYPE=""

for trigger in "${EXPLICIT_TRIGGERS[@]}"; do
    if printf '%s' "$USER_MESSAGE_LOWER" | grep -qi "$trigger"; then
        TRIGGER_FOUND="$trigger"
        TRIGGER_TYPE="explicit"
        break
    fi
done

# If no explicit trigger, check for preference triggers
if [ -z "$TRIGGER_FOUND" ]; then
    for trigger in "${PREFERENCE_TRIGGERS[@]}"; do
        if printf '%s' "$USER_MESSAGE_LOWER" | grep -qiE "$trigger"; then
            TRIGGER_FOUND="$trigger"
            TRIGGER_TYPE="preference"
            break
        fi
    done
fi

# If a trigger was found, inject mandatory storage instructions
if [ -n "$TRIGGER_FOUND" ]; then
    # Determine the memory type based on trigger
    if printf '%s' "$TRIGGER_FOUND" | grep -qiE "prefer|like|always|never"; then
        MEM_TYPE="preference"
        IMPORTANCE="0.8"
    elif printf '%s' "$TRIGGER_FOUND" | grep -qiE "decided|decision|go with|use"; then
        MEM_TYPE="decision"
        IMPORTANCE="0.7"
    else
        MEM_TYPE="preference"
        IMPORTANCE="0.8"
    fi

    # Create the mandatory instruction
    INSTRUCTION="⚠️ MEMORY TRIGGER DETECTED ⚠️

The user's message contains a memory trigger phrase: \"$TRIGGER_FOUND\"

YOU MUST store this as a memory. This is MANDATORY, not optional.

REQUIRED ACTION - Execute this command BEFORE doing anything else:
\`\`\`bash
claude-mem store -t $MEM_TYPE --title \"<descriptive title>\" -s \"<what the user wants remembered>\" -i $IMPORTANCE
\`\`\`

Extract the key information from the user's message and store it.
Do NOT skip this step. Do NOT just acknowledge - actually run the command.

After storing, confirm to the user that you've remembered it."

    # Escape for JSON
    ESCAPED_INSTRUCTION=$(echo "$INSTRUCTION" | python3 -c "
import json, sys
print(json.dumps(sys.stdin.read())[1:-1])
" 2>/dev/null)

    # Output the hook response with additionalContext
    cat << EOF
{
  "hookSpecificOutput": {
    "hookEventName": "UserPromptSubmit",
    "additionalContext": "$ESCAPED_INSTRUCTION"
  }
}
EOF
else
    # No trigger found, just pass through
    echo '{}'
fi

exit 0
