import { ensureGitRepository } from "./git.mjs";

// Resolution spawns a git subprocess and the answer is stable for a process
// lifetime, so memoize — state locking/loading resolves the root many times
// per mutation.
const workspaceRootCache = new Map();

export function resolveWorkspaceRoot(cwd) {
  const cached = workspaceRootCache.get(cwd);
  if (cached !== undefined) {
    return cached;
  }
  let root;
  try {
    root = ensureGitRepository(cwd);
  } catch {
    root = cwd;
  }
  workspaceRootCache.set(cwd, root);
  return root;
}
