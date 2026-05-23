#!/usr/bin/env node
// PreToolUse reminder: when invoking the code-review skill, remind to also run
// a codex adversarial-review in the background alongside the other review agents.
// Hook config: matcher "Skill" (no `if` — Skill(code-review) pattern doesn't work)

import fs from "node:fs";

const input = JSON.parse(fs.readFileSync(0, "utf8"));

// Self-validate: only fire for the code-review skill
const skill = input.tool_input?.skill ?? "";
if (skill !== "code-review") {
  process.exit(0);
}

const output = {
  hookSpecificOutput: {
    hookEventName: "PreToolUse",
    additionalContext:
      "Before launching the code-review agents, first start " +
      "`codex-companion adversarial-review` via the Monitor tool " +
      "to run a Codex adversarial review in parallel with the other agents."
  }
};

process.stdout.write(JSON.stringify(output) + "\n");
