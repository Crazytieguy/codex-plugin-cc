# Changelog

## 1.0.24

- Added a non-fatal stall watchdog to foreground runs (`review`, `adversarial-review`, `plan-review`, `task`): when the Codex app-server sends no protocol messages for 3 minutes (`CODEX_COMPANION_STALL_WARN_MS`, 0 disables), `codex-companion` emits a warning line on stdout — surfacing as a Monitor notification to Claude — and keeps waiting, repeating every 10 minutes (`CODEX_COMPANION_STALL_REPEAT_MS`). The warning names the silent duration, last event, transport, and job id, with status/cancel hints; `--json` runs log the warning to the job log instead of stdout. Motivated by a WSL report of Codex hanging indefinitely with no diagnostics.

## 1.0.22

- Updated `codex-prompting` guidance for gpt-5.6-sol: constraints must be explicit (Sol treats silence as permission), simplified reasoning-effort guidance (defer to the user's configured default; mostly `medium` or `high`), strengthened action-safety constraints with a no-near-match rule, and removed keep-going/anti-laziness language throughout — Stop Rules are now optional early-stop gates.
- Reduced findings-pressure in the review prompts for gpt-5.6-sol's pedantry tendencies: trimmed "don't validate" role clauses, symmetric approve/needs-attention rule, materiality bar for races and edge cases, and an approval-default `plan-review-followup` re-check scoped to prior [P0]/[P1] findings.
- Replaced `adversarial-review`'s enumerated Attack Surface checklist with a single weighting sentence (cost and detectability, no named defect classes) — the taxonomy was training exactly the pedantic race/edge-case findings the Finding Bar had to counteract; generalized that Finding Bar clause to cover all findings, not just races and edge cases.
- `--effort` now accepts `max`; `minimal` dropped from the docs (still accepted for older models).

## 1.0.18

- Biased `plan-review-followup` prompt toward approval and dropped `[P2]` from the follow-up severity surface, so iterated plan reviews converge faster without surfacing nitpicks.

## 1.0.17

- Rewrote `adversarial-review`, `plan-review`, and `plan-review-followup` prompts to the GPT-5.5 prompt shape: Markdown section headings, outcome-first framing, payload-only XML. Toned down the adversarial language to reduce nitpicky findings while preserving the material-issue bar.

## 1.0.16

- Renamed `gpt-5-4-prompting` skill to `codex-prompting`; rewrote guidance for GPT-5.5 (outcome-first Markdown sections instead of XML blocks, updated anti-patterns, `--effort` defaults).

## 1.0.0

- Initial version of the Codex plugin for Claude Code
