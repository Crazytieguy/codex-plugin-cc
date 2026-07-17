# Prompt Sections

Reusable Markdown section snippets for composing `codex-companion task` prompts. Paste under a heading; trim to fit. Voice rule: prefer scoped "if X then Y" over `ALWAYS X`.

## Goal

The core wrapper. Use in nearly every prompt.

```markdown
## Goal
Describe the concrete outcome and the relevant repository or failure context.
```

## Success Criteria

Use when "done" isn't obvious.

```markdown
## Success Criteria
- Checkable statement 1.
- Checkable statement 2.
```

## Constraints: action safety

Use for write-capable or potentially broad tasks.

```markdown
## Constraints
- Keep changes tightly scoped to the stated task.
- No unrelated refactors, renames, or cleanup unless they are required for correctness.
- Stop and ask before any destructive or irreversible action. If something the task names (a file, function, resource) doesn't exist as described, report the mismatch — don't act on a near-match.
```

## Grounding

Use for review, research, or root-cause analysis.

```markdown
## Grounding
Ground every claim in the provided context or your tool outputs. Don't present inferences as facts; label hypotheses as such.
```

## Output: structured

Use when the response shape matters.

```markdown
## Output
Return exactly this shape and nothing else. Put the highest-value findings or decisions first.
1. ...
2. ...
3. ...
```

## Output: compact prose

Use when you want concise prose instead of a schema.

```markdown
## Output
Keep the final answer compact. No long scene-setting, no recap. Lead with the highest-value finding.
```

## Verification

Use when correctness matters.

```markdown
## Verification
Before finalizing, verify the result against the task requirements and the changed files or tool outputs. If a check fails, revise instead of reporting the first draft.
```

## Stop Rules: keep going by default

Use when Codex should act without asking routine questions.

```markdown
## Stop Rules
Default to the most reasonable low-risk interpretation and keep going. Only stop to ask when a missing detail changes correctness, safety, or an irreversible action.
```

## Stop Rules: gate on missing context

Use when Codex might otherwise guess.

```markdown
## Stop Rules
Don't guess missing repository facts. If required context is absent, retrieve it with tools or state exactly what remains unknown.
```
