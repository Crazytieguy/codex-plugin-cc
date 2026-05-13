# Codex Prompt Anti-Patterns

Avoid these when prompting Codex.

## Vague task framing

Bad:

```text
Take a look at this and let me know what you think.
```

Better:

```markdown
## Goal
Review this change for material correctness and regression risks.
```

## Missing output contract

Bad:

```text
Investigate and report back.
```

Better:

```markdown
## Output
1. Root cause
2. Evidence
3. Smallest safe next step
```

## Missing stop rules

Bad:

```text
Debug this failure.
```

Better:

```markdown
## Stop Rules
Keep going until the evidence supports a confident root cause. Stop and ask only when a missing detail changes correctness or safety.
```

## Asking for more reasoning instead of a better contract

Bad:

```text
Think harder and be very smart.
```

Better:

```markdown
## Verification
Before finalizing, confirm the answer matches the observed evidence and task requirements.
```

The same applies to `--effort`. Raising effort masks a weak prompt; tighten the contract first, then raise effort only if the result still falls short.

## Mixing unrelated jobs into one run

Bad:

```text
Review this diff, fix the bug you find, update the docs, and suggest a roadmap.
```

Better:
- Review first.
- Apply a separate fix prompt if needed.
- Use a third run for docs or roadmap work.

## Unsupported certainty

Bad:

```text
Tell me exactly why production failed.
```

Better:

```markdown
## Grounding
Ground every claim in the provided context or tool output. Label hypotheses as such.
```

## Procedure-heavy prompts

Bad:

```text
Step 1: open file X. Step 2: read function Y. Step 3: change line Z. Step 4: run the test. Step 5: ...
```

Better:

```markdown
## Goal
The build should pass with no behavior change to module Z.

## Success Criteria
- Failing test in `path/to/test` passes.
- No changes outside the failing path.
```

Listing implementation steps narrows the search space. State the destination and let Codex pick the route. Procedure is fine only when the path itself is part of the contract (e.g., "use git bisect, not log inspection").

## Overuse of ALWAYS / NEVER

Bad:

```text
ALWAYS read the file before editing. NEVER use sed. ALWAYS add tests for every change.
```

Better:

```markdown
## Constraints
- If you edit a file you haven't read in this session, read it first.
- If the change touches user-visible behavior, add or update a test.
```

Reserve `ALWAYS` / `NEVER` for genuine invariants — safety rules, required output fields, hard contract guarantees. Use scoped "if X then Y" rules elsewhere.
