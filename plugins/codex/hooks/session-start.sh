#!/bin/bash
# SessionStart hook: check node availability, then delegate to the lifecycle script.
# Emits a systemMessage if node is missing or the script fails.

# Pass stdin through to the node script
input=$(cat)

if ! command -v node >/dev/null 2>&1; then
  echo '{"systemMessage":"\u001b[1;34mcodex:\u001b[0m node not found, run \u001b[1;35m/codex:setup\u001b[0m"}'
  exit 0
fi

LOG_DIR="${CLAUDE_PLUGIN_DATA:-${HOME}/.cache/codex-companion}"
LOG_FILE="${LOG_DIR}/session-start-error.log"
mkdir -p "$LOG_DIR" 2>/dev/null

result=$(echo "$input" | node "${CLAUDE_PLUGIN_ROOT}/scripts/session-lifecycle-hook.mjs" SessionStart 2>>"$LOG_FILE")
status=$?

if [ $status -ne 0 ] || [ -z "$result" ]; then
  echo '{"systemMessage":"\u001b[1;34mcodex:\u001b[0m setup error, run \u001b[1;35m/codex:setup\u001b[0m"}'
  exit 0
fi

echo "$result"
