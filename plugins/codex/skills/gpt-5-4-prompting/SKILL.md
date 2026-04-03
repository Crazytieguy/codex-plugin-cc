---
name: gpt-5-4-prompting
description: This skill should be used when delegating a task to Codex via `codex-companion task`. Provides prompt structure and recipes for effective Codex / GPT-5.4 task delegation.
---

# GPT-5.4 Prompting

Prompt Codex like an operator, not a collaborator. Keep prompts compact and block-structured with XML tags. State the task, the output contract, the follow-through defaults, and the small set of extra constraints that matter.

## Core Rules

- Prefer one clear task per Codex run. Split unrelated asks into separate runs.
- Tell Codex what done looks like. Do not assume it will infer the desired end state.
- Add explicit grounding and verification rules for any task where unsupported guesses would hurt quality.
- Prefer better prompt contracts over raising reasoning or adding long natural-language explanations.
- Use XML tags consistently so the prompt has stable internal structure.

## Default Prompt Recipe

- `<task>`: the concrete job and the relevant repository or failure context.
- `<structured_output_contract>` or `<compact_output_contract>`: exact shape, ordering, and brevity requirements.
- `<default_follow_through_policy>`: what Codex should do by default instead of asking routine questions.
- `<verification_loop>` or `<completeness_contract>`: required for debugging, implementation, or risky fixes.
- `<grounding_rules>` or `<citation_rules>`: required for review, research, or anything that could drift into unsupported claims.

## Block Selection by Task Type

- Coding or debugging: add `completeness_contract`, `verification_loop`, and `missing_context_gating`.
- Review or adversarial review: add `grounding_rules`, `structured_output_contract`, and `dig_deeper_nudge`.
- Research or recommendation tasks: add `research_mode` and `citation_rules`.
- Write-capable tasks: add `action_safety` so Codex stays narrow and avoids unrelated refactors.

## Prompt Shape

- Use built-in `codex-companion review` or `codex-companion adversarial-review` when the job is reviewing local git changes. Those prompts already carry the review contract.
- Use `codex-companion task` when the task is diagnosis, planning, research, or implementation and more direct prompt control is needed.
- Use `codex-companion task --resume-last` for follow-up instructions on the same Codex thread. Send only the delta instruction instead of restating the whole prompt unless the direction changed materially.

## Working Rules

- Prefer explicit prompt contracts over vague nudges.
- Use stable XML tag names that match the block names from the reference file.
- Do not raise reasoning or complexity first. Tighten the prompt and verification rules before escalating.
- Ask Codex for brief, outcome-based progress updates only when the task is long-running or tool-heavy.
- Keep claims anchored to observed evidence. If something is a hypothesis, say so.

## Prompt Assembly Checklist

1. Define the exact task and scope in `<task>`.
2. Choose the smallest output contract that still makes the answer easy to use.
3. Decide whether Codex should keep going by default or stop for missing high-risk details.
4. Add verification, grounding, and safety tags only where the task needs them.
5. Remove redundant instructions before sending the prompt.

## References

Reusable blocks: [references/prompt-blocks.md](references/prompt-blocks.md)
End-to-end templates: [references/codex-prompt-recipes.md](references/codex-prompt-recipes.md)
Common failure modes: [references/codex-prompt-antipatterns.md](references/codex-prompt-antipatterns.md)
