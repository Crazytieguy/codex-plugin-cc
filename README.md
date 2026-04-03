# Codex plugin for Claude Code

Use Codex from inside Claude Code for code reviews, plan reviews, and task delegation.

## Motivation

Codex is good at focused review and investigation tasks. Claude Code is good at orchestrating multi-step workflows. This plugin connects them: Claude can call Codex for a second opinion on code or plans, delegate investigation tasks, or run adversarial reviews — all without leaving the Claude Code session.

This is a fork of [openai/codex-plugin-cc](https://github.com/openai/codex-plugin-cc) with a focus on giving Claude and the user more control over when and how Codex is invoked, through composable hooks and a simpler CLI interface.

## Requirements

- **ChatGPT subscription (incl. Free) or OpenAI API key** — usage counts toward your [Codex limits](https://developers.openai.com/codex/pricing)
- **Node.js 18.18 or later**

## Install

```
claude plugin marketplace add Crazytieguy/codex-plugin-cc
claude plugin install codex
```

Or add to your `.claude/settings.json` manually:

```json
{
  "enabledPlugins": {
    "codex@codex-plugin-cc": true
  },
  "extraKnownMarketplaces": {
    "codex-plugin-cc": {
      "source": {
        "source": "github",
        "repo": "Crazytieguy/codex-plugin-cc"
      }
    }
  }
}
```

Then run `/codex:setup` to check that Node and Codex are installed and authenticated, and optionally configure review hooks.
