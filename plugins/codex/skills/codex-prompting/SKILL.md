---
name: codex-prompting
description: This skill should be used when delegating a task to Codex via `codex-companion task`. Provides prompt structure, section templates, and recipes for effective Codex task delegation.
---

# Codex Prompting

Prompt Codex outcome-first. Describe the destination, success criteria, evidence rules, and output shape; let Codex pick the path. Be terse — Codex follows instructions literally, so verbose hedging hurts.

## When to use

- Composing a `codex-companion task` prompt for diagnosis, fixes, research, or recommendation.
- Not for `codex-companion review`, `adversarial-review`, or `plan-review` — those carry their own prompts.
- Always start `codex-companion` commands via the Monitor tool, not Bash.
- Use `codex-companion task --resume-last` for follow-ups on the same Codex thread; send only the delta unless direction changed.

## Prompt Shape

Use Markdown section headings. Skip any section that doesn't add value.

- `## Role` (optional) — one line, only when stance matters (e.g., adversarial reviewer).
- `## Goal` — the concrete outcome and the repository or failure context.
- `## Success Criteria` — terse, checkable statements of "done".
- `## Constraints` — scope limits, files off-limits, style rules.
- `## Grounding` (optional) — required for review or research; how claims must be supported.
- `## Output` — exact shape, ordering, brevity. Schema or numbered list.
- `## Verification` (optional) — required for code edits or risky fixes; what to re-check before finalizing.
- `## Stop Rules` — when to keep going vs ask.

XML tags inside a section are fine for wrapping multi-line payloads (diffs, logs, schemas). Section headings stay Markdown.

## Core Rules

- Outcome-first. State the destination, evidence rules, and success criteria. Avoid step-by-step procedure unless the path itself is part of the contract.
- Be terse and literal. Codex follows instructions more literally than older models — verbose hedging narrows the search space.
- Reserve `ALWAYS` / `NEVER` for genuine invariants (safety, required output fields, hard contract guarantees). Use scoped "if X then Y" elsewhere.
- One clear task per run. Split unrelated asks into separate runs.
- Tighten the contract before raising effort. Higher reasoning is not automatically better; the model can over-search.
- Drop "current date" boilerplate — Codex knows the UTC date.
- Keep claims anchored to observed evidence. Label hypotheses as such.

## Reasoning Effort

`--effort` defaults to `medium`. Adjust deliberately:

- `low` — quick lookups, mechanical edits, well-scoped fixes.
- `medium` (default) — most diagnosis, review, and implementation.
- `high` / `xhigh` — hard multi-file refactors, ambiguous debugging, deep research. Use sparingly.
- `minimal` / `none` — only when you've proved `medium` is wasteful for this shape of task.

Rule: tighten the contract before raising effort.

For model selection, leave `--model` unset — Codex picks a sensible default per task type.

## Prompt Assembly Checklist

1. Write the `## Goal` in one sentence.
2. Add `## Success Criteria` (1-4 bullets).
3. Pick the smallest `## Output` shape that's still easy to consume.
4. Add `## Constraints` only for real risks (scope creep, irreversible action).
5. Add `## Grounding` and/or `## Verification` only when the task can drift or break.
6. Decide `## Stop Rules`: default to keep-going unless something is irreversible or correctness-changing.
7. Re-read and cut redundant lines.

## References

Reusable sections: [references/prompt-sections.md](references/prompt-sections.md)
End-to-end templates: [references/codex-prompt-recipes.md](references/codex-prompt-recipes.md)
Common failure modes: [references/codex-prompt-antipatterns.md](references/codex-prompt-antipatterns.md)
