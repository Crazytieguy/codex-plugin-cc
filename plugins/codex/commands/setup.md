---
description: Check whether Node and Codex are ready, and optionally configure review hooks
allowed-tools: Bash(node:*), Bash(npm:*)
---

Output of `codex-companion setup --json`:

!`node "${CLAUDE_PLUGIN_ROOT}/scripts/codex-companion.mjs" setup --json 2>&1 || echo '{"error": true}'`

---

Use the output above to determine the current state. The JSON includes `ready` (boolean), `node.available`, `npm.available`, `codex.available`, `auth.loggedIn`, and `nextSteps`.

Follow the first matching path:

**If the output has `"error": true` or `node.available` is false:**
Tell the user to install Node.js 18.18+ and rerun `/codex:setup`.

**If `codex.available` is false and `npm.available` is true:**
Use `AskUserQuestion` with options: `Install Codex (Recommended)`, `Skip for now`
- If install: run `npm install -g @openai/codex`, then rerun `node "${CLAUDE_PLUGIN_ROOT}/scripts/codex-companion.mjs" setup --json` and present the updated result.
- If skip: present the setup output and stop.

**If `codex.available` is false and `npm.available` is false:**
Tell the user to install npm (or install Codex manually with `npm install -g @openai/codex`) and rerun `/codex:setup`.

**If `auth.loggedIn` is false:**
Tell the user to run `!codex login` and then rerun `/codex:setup`.

**If `ready` is true:**

Present the setup status to the user.

Check `.claude/settings.local.json` for existing codex-companion permission rules. If not already present, tell the user you're adding read-only permissions for codex-companion, then add these to `permissions.allow` (merge, do not overwrite existing rules):

```
"Bash(codex-companion)", "Bash(codex-companion help)", "Bash(codex-companion help *)",
"Bash(codex-companion review)", "Bash(codex-companion review *)",
"Bash(codex-companion adversarial-review)", "Bash(codex-companion adversarial-review *)",
"Bash(codex-companion plan-review *)",
"Bash(codex-companion status)", "Bash(codex-companion status *)",
"Bash(codex-companion result)", "Bash(codex-companion result *)",
"Bash(codex-companion cancel)", "Bash(codex-companion cancel *)"
```

Then check if codex review hooks are already configured in `.claude/settings.local.json` (look for PreToolUse hooks referencing codex-companion or plan-review). If hooks already exist, tell the user hooks are already configured and ask if they want to reconfigure. If not configured (or user wants to reconfigure):

Output this explanation verbatim:

**Review hooks** let Claude automatically get Codex feedback at key moments — when writing a plan, running /simplify, or before committing code.

Without hooks, Codex reviews only happen when you or Claude explicitly request them. This gives you full control but means more manual involvement — you'll need to remember to ask for reviews at the right times.

With hooks, Claude can get a second opinion from Codex autonomously, iterating on feedback without needing your input. This enables greater autonomy — you can step away while Claude perfects a plan or polishes code. The tradeoff is runtime: waiting for Codex reviews and iterations adds time to each cycle.

Use `AskUserQuestion` with options: `Configure review hooks (Recommended)`, `Skip for now`

If the user chooses to configure: load the `codex:hook-setup` skill.
If the user chooses to skip: tell them they can run `/codex:hook-setup` anytime.

After the hook question is resolved (regardless of hook choice), tell the user you're saving setup state, then write the marker file:
```bash
mkdir -p "${CLAUDE_PLUGIN_DATA}" && touch "${CLAUDE_PLUGIN_DATA}/setup-ran"
```
