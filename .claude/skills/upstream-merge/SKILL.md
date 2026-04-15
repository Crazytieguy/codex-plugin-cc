---
name: upstream-merge
description: This skill should be used when the user asks to "merge upstream", "pull upstream changes", "sync with upstream", "check upstream", or wants to incorporate changes from the upstream openai/codex-plugin-cc repository into this fork.
---

# Upstream Merge

Merge changes from `upstream/main` (openai/codex-plugin-cc) into this fork (Crazytieguy/codex-plugin-cc).

## Why merge, not rebase

This fork has a large structural divergence — removed slash commands (cancel, result, status), removed the codex-rescue agent, removed stop-review-gate, simplified marketplace.json, rewrote README. Rebasing replays our commits onto upstream, re-creating these structural conflicts on every commit. Merging resolves once per pull, and `git rerere` (enabled globally) remembers resolutions for identical conflict hunks next time.

## What we keep vs. adopt

**Always keep ours (reject upstream changes to these):**
- Package identity: name is `codex-plugin-cc` (not `@openai/codex-plugin-cc`), our version number, our description/author fields.
- Marketplace schema: `.claude-plugin/marketplace.json` has no `metadata.version` or `plugins[].version` — those were simplified out. The `scripts/bump-version.mjs` TARGETS array should match (no marketplace entry).
- README: ours is intentionally different. Always keep our side.
- Deleted files: `plugins/codex/agents/codex-rescue.md`, `plugins/codex/commands/cancel.md`, `plugins/codex/commands/result.md`, `plugins/codex/commands/status.md`, `plugins/codex/scripts/stop-review-gate-hook.mjs`. If upstream modifies these, `git rm` them during conflict resolution.
- Error messages should reference `codex-companion` CLI, not `/codex:` slash commands.

**Adopt from upstream:**
- Bug fixes and new capabilities in shared code (lib/, scripts/, tests/).
- New files that don't conflict with our structure.
- But adapt call sites to match our structure — e.g., if upstream renames a function, update our fork-specific callers too.

**Don't merge upstream bugs.** If upstream introduces something broken, fix it as part of the merge rather than importing known issues. This is caught by the review step below.

## Procedure

1. **Fetch and inspect:** `git fetch upstream` then `git log --oneline HEAD..upstream/main` to see what's new. Summarize for the user.

2. **Triage new capabilities:** if upstream added non-trivial new features (a new skill, a new hook, a new command, a new agent, a significant new workflow), stop and ask the user whether to include or drop each one before proceeding. Bug fixes and incremental improvements to existing code don't need approval — only things that change the surface area of the plugin.

3. **Merge:** `git merge upstream/main --no-edit`. Rerere may auto-resolve some conflicts from prior merges.

4. **Resolve conflicts** applying the keep/adopt rules above. For modify/delete conflicts on removed files, `git rm` them. For content conflicts, keep our identity/structure while adopting upstream's functional changes.

5. **Check for breakage:** fix stale imports, orphaned function references, async/await mismatches. Run `node --check` on modified `.mjs` files. Run `npm run check-version` to verify version consistency.

6. **Review the merge result** — run both in parallel:
   - Use Monitor to run `codex-companion review` on the staged diff.
   - Spawn an Agent to review the full staged diff (`git diff --cached`). Brief it with the merge context (what upstream added, what we kept/rejected, what post-merge fixes were applied) and ask it to check whether the merge result is correct — give it latitude to find issues open-endedly rather than prescribing what to look for.

   Address all issues found by either reviewer. Re-run reviews if the fixes were substantial.

7. **Run tests:** `npm run test`. All tests should pass. Investigate any failures — distinguish pre-existing flaky tests from merge-introduced regressions.

8. **Commit** the merge with a message summarizing what was adopted, what was rejected, and any post-merge fixes applied.
