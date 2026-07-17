# Codex Prompt Recipes

Starting templates for `codex-companion task` prompts. Copy the smallest recipe that fits, then trim anything that isn't earning its place. For write-capable tasks, add `--write`.

## Diagnosis

```markdown
## Goal
Diagnose why the failing test or command is breaking in this repository.

## Success Criteria
- A single most-likely root cause, supported by evidence from the repo or tool output.
- The smallest safe next step is identified.

## Output
1. Most likely root cause
2. Evidence
3. Smallest safe next step

## Verification
Before finalizing, confirm the proposed root cause matches the observed evidence.

## Stop Rules
- Keep going until the evidence supports a confident root cause.
- Don't guess missing repository facts. If required context is absent, state exactly what remains unknown.
```

## Narrow Fix

Pair with `--write`.

```markdown
## Goal
Implement the smallest safe fix for the identified issue. Preserve existing behavior outside the failing path.

## Constraints
- Keep changes tightly scoped to the stated fix.
- No unrelated refactors, renames, or cleanup.
- Stop and ask before any destructive or irreversible action (deleting files, dropping or migrating data, force operations, history rewrites).
- If something the task names (a file, test, resource) can't be found, stop and report it — never act on a near-match or substitute target.

## Output
1. Summary of the fix
2. Touched files
3. Verification performed
4. Residual risks or follow-ups

## Verification
Before finalizing, confirm the fix matches the task requirements and the changed code is coherent. Check whether adjacent code paths share the broken invariant; fix them too or call them out as explicitly out of scope.

## Stop Rules
- Resolve the task fully before stopping. Don't stop after identifying the issue without applying the fix.
- If a missing detail materially changes correctness, ask. Otherwise proceed on the most reasonable low-risk interpretation.
```

## Research / Recommendation

```markdown
## Goal
Research the available options and recommend the best path for this task.

## Output
1. Observed facts
2. Reasoned recommendation
3. Tradeoffs
4. Open questions

## Grounding
Back important claims with explicit references to inspected sources. Prefer primary sources.

## Stop Rules
Don't guess missing facts. If a source you'd need to verify a recommendation is absent, state exactly what remains unknown rather than inferring.
```

## Prompt Repair

Use when delegating prompt critique to Codex. The required outputs prevent plausible-but-untethered rewrites.

```markdown
## Goal
Diagnose why this existing prompt is underperforming for Codex and propose the smallest high-leverage changes.

## Grounding
- Base the diagnosis on the prompt text and the failure examples provided.
- Don't invent failure modes that aren't supported by the examples.

## Output
1. Failure modes observed in the examples
2. Root causes in the current prompt
3. Revised prompt
4. Why the revision addresses only the cited failure modes (no unrelated changes)

## Verification
Before finalizing, confirm the revised prompt resolves the cited failures without adding contradictory instructions.
```

