# Changelog

## 1.0.25

- Review prompts gain an Independence rule, ported from the gpt-6-astra-tuned reviewer agents: claims in the `adversarial-review` focus text or in a reviewed plan are verified against the repository rather than trusted, while user-relayed requirements and decisions are taken as given. The `plan-review-followup` re-check verifies fixes against the revised plan and repository, not the plan's own claim.
- `codex-prompting` updated for gpt-6-astra per OpenAI's guidance: Astra can stop at a first implementation and hand back for review (unlike Sol, which over-persisted), so a new "Define done" rule asks Claude to state whether done includes running/checking/fixing and whether ambiguities are Codex's to decide or to report. The "treats silence as permission" framing is replaced with the observed failure mode — going past the ask on long runs.
- `--effort` now accepts `ultra`.
- Removed the `spark` model alias — gpt-5.3-codex-spark is no longer offered by Codex. Pass model slugs directly.
- Fixed a type error in `app-server.mjs` that failed `npm run build`.

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
