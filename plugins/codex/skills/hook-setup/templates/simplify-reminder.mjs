#!/usr/bin/env node
// PreToolUse reminder: when invoking the simplify skill, remind to also run
// a codex adversarial-review in the background alongside the other review agents.
// Hook config: matcher "Skill", if "Skill(simplify)"

import fs from "node:fs";

// Drain stdin (required by hook protocol)
fs.readFileSync(0, "utf8");

const output = {
  hookSpecificOutput: {
    hookEventName: "PreToolUse",
    additionalContext:
      "Before launching the simplify review agents, first start " +
      "`codex-companion adversarial-review` with run_in_background: true " +
      "to run a Codex adversarial review in parallel with the other agents."
  }
};

process.stdout.write(JSON.stringify(output) + "\n");
