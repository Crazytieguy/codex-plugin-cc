#!/usr/bin/env node
// PreToolUse reminder: when writing a plan file, remind to run codex plan-review.
// Hook config: matcher "Write", if "Write(~/.claude/plans/*)"

import fs from "node:fs";

const input = JSON.parse(fs.readFileSync(0, "utf8"));
const filePath = input.tool_input?.file_path ?? "";

// Only remind for plan files
if (!filePath.includes(".claude/plans/")) {
  process.exit(0);
}

const output = {
  hookSpecificOutput: {
    hookEventName: "PreToolUse",
    additionalContext:
      "After finalizing this plan, run `codex-companion plan-review " +
      filePath +
      "` to get Codex feedback, address any comments, then exit plan mode."
  }
};

process.stdout.write(JSON.stringify(output) + "\n");
