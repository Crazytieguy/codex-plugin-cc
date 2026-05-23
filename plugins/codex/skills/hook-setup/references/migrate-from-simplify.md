# Migrating from /simplify

The /simplify skill was renamed to /code-review. The `simplify-reminder.mjs` hook script no longer fires (its self-validation expects skill name `"simplify"` which the renamed skill never passes). This guide walks through removing the legacy hook and, if the user wants to keep the review behavior, installing the equivalent /code-review hook with their customizations preserved.

## Target end state

- `.claude/scripts/simplify-reminder.mjs` removed
- The corresponding PreToolUse entry in `.claude/settings.local.json` (Skill matcher pointing at `simplify-reminder.mjs`) removed
- If the user wants the equivalent /code-review hook: `code-review-reminder.mjs` installed under `.claude/scripts/`, settings.local.json updated, and any customizations from the old script carried over

## Steps

### 1. Read the legacy script and detect customizations

Read `.claude/scripts/simplify-reminder.mjs`. Compare against the canonical pre-rename baseline below. Note any meaningful differences — common customizations: changed `additionalContext` wording, additional logic, extra logging, alternative invocation guidance (e.g. `run_in_background: true` instead of `via the Monitor tool`).

Canonical pre-rename `simplify-reminder.mjs`:

```javascript
#!/usr/bin/env node
// PreToolUse reminder: when invoking the simplify skill, remind to also run
// a codex adversarial-review in the background alongside the other review agents.
// Hook config: matcher "Skill" (no `if` — Skill(simplify) pattern doesn't work)

import fs from "node:fs";

const input = JSON.parse(fs.readFileSync(0, "utf8"));

// Self-validate: only fire for the simplify skill
const skill = input.tool_input?.skill ?? "";
if (skill !== "simplify") {
  process.exit(0);
}

const output = {
  hookSpecificOutput: {
    hookEventName: "PreToolUse",
    additionalContext:
      "Before launching the simplify review agents, first start " +
      "`codex-companion adversarial-review` via the Monitor tool " +
      "to run a Codex adversarial review in parallel with the other agents."
  }
};

process.stdout.write(JSON.stringify(output) + "\n");
```

Ignore the literal `"simplify"` references on the skill-name and comment lines — those would have changed under the rename anyway. Anything else that differs is a real customization.

### 2. Ask the user

Tell the user the legacy hook was detected and summarize:
- Whether the script is the unmodified baseline or has customizations (list them concretely if so)
- That the migration will delete the old file and settings entry

Then ask (via `AskUserQuestion`):
- **Keep the equivalent /code-review hook (Recommended)** — install `code-review-reminder.mjs`, port any customizations.
- **Remove only** — just delete the legacy script and settings entry; don't install a replacement.

If the user has customizations and chose "Keep", confirm each customization should carry over (or ask which to drop).

### 3. Execute the migration

Always:
- Delete `.claude/scripts/simplify-reminder.mjs`.
- Edit `.claude/settings.local.json`: remove the PreToolUse entry with `matcher: "Skill"` whose command references `simplify-reminder.mjs`. Be careful to remove the whole entry, not just the inner command — and to leave other matcher blocks (Write, Bash, ExitPlanMode) untouched.

If the user chose **Keep**:
- Copy `templates/code-review-reminder.mjs` from the plugin into `.claude/scripts/code-review-reminder.mjs`.
- Apply any customizations the user opted to carry over (edit the new file to match).
- Add a new PreToolUse entry to `.claude/settings.local.json`:

  ```json
  {
    "matcher": "Skill",
    "hooks": [
      {
        "type": "command",
        "command": "node \"$CLAUDE_PROJECT_DIR/.claude/scripts/code-review-reminder.mjs\"",
        "timeout": 5
      }
    ]
  }
  ```

- Honor the existing persistence strategy: if `.claude/scripts/.gitignore` exists (developer-local), don't track the new script; if no gitignore (committed scripts), the file becomes a tracked addition.

### 4. Verify

Confirm the stale file is gone (`fs.existsSync` returns false) and the settings entry is removed. Tell the user the SessionStart "out of date" warning will stop on the next session start.

After migration completes, return to the normal hook-setup flow only if the user also wants to add or reconfigure other hooks (plan review, commit review). Otherwise this is the end.
