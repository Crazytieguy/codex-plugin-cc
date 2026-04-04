# Codex plugin for Claude Code

AI models from different providers tend to have uncorrelated failure modes, making cross-model review effective at catching issues that self-review misses. Many users have found Codex particularly effective at reviewing Claude's work. This plugin connects them: Claude can delegate tasks to Codex, run adversarial reviews on code and plans, and iterate on the feedback autonomously.

This is a fork of [openai/codex-plugin-cc](https://github.com/openai/codex-plugin-cc) with a focus on giving Claude and the user more control over when and how Codex is invoked, through composable hooks and a simpler CLI interface.

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
