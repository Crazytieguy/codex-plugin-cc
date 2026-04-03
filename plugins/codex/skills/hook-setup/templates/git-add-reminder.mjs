#!/usr/bin/env node
// PreToolUse reminder: when staging files, remind to run a codex review before committing.
// Hook config: matcher "Bash", if "Bash(git add *)"

import fs from "node:fs";

// Drain stdin (required by hook protocol)
fs.readFileSync(0, "utf8");

const output = {
  hookSpecificOutput: {
    hookEventName: "PreToolUse",
    additionalContext:
      "Before committing, run `codex-companion review` to get a comprehensive Codex review of the changes."
  }
};

process.stdout.write(JSON.stringify(output) + "\n");
