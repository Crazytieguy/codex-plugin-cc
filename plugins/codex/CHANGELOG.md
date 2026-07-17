# Changelog

## 1.0.22

- Updated `codex-prompting` guidance for gpt-5.6-sol: constraints must be explicit (Sol treats silence as permission), simplified reasoning-effort guidance (defer to the user's configured default; mostly `medium` or `high`), strengthened the action-safety constraints template with a no-near-match rule. Review prompts unchanged — their grounding and evidence rules already counter Sol's fabrication tendencies.
- `--effort` now accepts `max`; `minimal` dropped from the docs (still accepted for older models).

## 1.0.18

- Biased `plan-review-followup` prompt toward approval and dropped `[P2]` from the follow-up severity surface, so iterated plan reviews converge faster without surfacing nitpicks.

## 1.0.17

- Rewrote `adversarial-review`, `plan-review`, and `plan-review-followup` prompts to the GPT-5.5 prompt shape: Markdown section headings, outcome-first framing, payload-only XML. Toned down the adversarial language to reduce nitpicky findings while preserving the material-issue bar.

## 1.0.16

- Renamed `gpt-5-4-prompting` skill to `codex-prompting`; rewrote guidance for GPT-5.5 (outcome-first Markdown sections instead of XML blocks, updated anti-patterns, `--effort` defaults).

## 1.0.0

- Initial version of the Codex plugin for Claude Code
