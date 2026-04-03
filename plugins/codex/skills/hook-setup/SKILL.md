---
name: hook-setup
description: This skill should be used when the user asks to "configure codex hooks", "set up review hooks", "enable codex enforcement", "add codex review gates", or wants to configure when and how Codex reviews are triggered automatically.
---

# Codex Hook Setup

Configure PreToolUse hooks that remind or require Claude to run Codex reviews at key moments.

## Motivation

AI models from different providers have different strengths. OpenAI models are well suited to give Claude review feedback — catching issues that Claude might miss, and challenging assumptions from a different perspective. These hooks automate that feedback loop so Claude can iterate on Codex feedback autonomously.

## Re-run Behavior

Before starting, check `.claude/settings.local.json` for existing codex review hooks (PreToolUse hooks referencing codex-companion or plan-review scripts). If hooks exist, tell the user what's currently configured and ask if they want to reconfigure. If reconfiguring, replace the existing hooks.

## Setup Flow

### Step 1: What to Review

Explain the options and reasoning to the user:

> There are three natural moments to trigger a Codex review:
>
> - **Plans** — Get adversarial feedback on your plan before exiting plan mode. Catches gaps, wrong assumptions, and missing steps early, when they're cheapest to fix.
> - **Code on /simplify** — Run a Codex adversarial review in parallel with the other /simplify agents. Adds an independent perspective from a different model without extra effort.
> - **Code before commit** — Review changes before they're committed. A reminder on `git add` nudges Claude to review; an enforcement hook on `git commit` blocks until a review is done.
>
> Pick any combination, or describe what you'd like instead.

Use `AskUserQuestion` with multiSelect:
- **Plans**
- **Code on /simplify**
- **Code before commit**

If the user provides a custom answer instead of selecting options, use the templates as inspiration to build a hook matching their request. Check the Claude Code hooks documentation for the correct syntax, and offer to test live — hooks in `settings.local.json` hot-reload without restart (but if `codex-companion` is not yet on PATH, a new session is needed first).

### Step 2: Enforcement Level

Only ask this if the user selected at least one option in Step 1.

Explain the options:

> Hooks can work as **reminders** or **enforcement**:
>
> - **Reminders** inject a suggestion but don't block. Less intrusive and allow flexibility when skipping a review is the right call.
> - **Enforcement** blocks the action until a Codex review has completed. Provides a stronger guarantee that reviews actually happen.

Use `AskUserQuestion` with single select:
- **Reminders only**
- **Enforced**

### Step 3: Write Hooks

Based on selections, copy the appropriate template scripts from `templates/` to the project's `.claude/scripts/` directory. Create the directory and add a `.gitignore` with `*` if it doesn't exist. Only modify the scripts if the user requested something custom.

Then add hook entries to `.claude/settings.local.json` under the `hooks` key, pointing to the copied scripts.

**Template mapping:**

- **Plans + Reminders:** `plan-write-reminder.mjs`
- **Plans + Enforced:** `plan-write-reminder.mjs` + `exit-plan-mode-enforce.mjs` (reminder on write, enforcement on ExitPlanMode)
- **Code on /simplify:** `simplify-reminder.mjs` (reminder only, no enforcement variant)
- **Code before commit + Reminders:** `git-add-reminder.mjs`
- **Code before commit + Enforced:** `git-add-reminder.mjs` + `git-commit-enforce.mjs` (reminder on add, enforcement on commit)

#### Settings Format

Hooks in `.claude/settings.local.json` use the direct format (no wrapper):

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Write",
        "hooks": [
          {
            "type": "command",
            "if": "Write(~/.claude/plans/*)",
            "command": "node .claude/scripts/plan-write-reminder.mjs",
            "timeout": 5
          }
        ]
      }
    ]
  }
}
```

#### Hook `if` Patterns

- `"if": "Write(~/.claude/plans/*)"` — Write to plan files
- `"if": "Skill(simplify)"` — /simplify skill invocation
- `"if": "Bash(git add *)"` — git add commands
- `"if": "Bash(git commit:*)"` — git commit commands (`:*` for heredoc compatibility)
- `"matcher": "ExitPlanMode"` — ExitPlanMode (no `if` needed, matcher suffices)

## Templates

Working hook scripts in `templates/`, ready to use as-is:

- **`plan-write-reminder.mjs`** — Reminder when writing plan files
- **`simplify-reminder.mjs`** — Reminder when invoking /simplify
- **`git-add-reminder.mjs`** — Reminder when staging files
- **`exit-plan-mode-enforce.mjs`** — Block ExitPlanMode without completed plan review
- **`git-commit-enforce.mjs`** — Block git commit without completed code review
