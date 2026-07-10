#!/usr/bin/env node
// Async SessionStart hook: remove codex-companion job records whose corresponding
// Claude Code transcript no longer exists. Scoped to the current project.

import fs from "node:fs";
import path from "node:path";

import { loadState, updateState } from "./lib/state.mjs";

function readHookInput() {
  try {
    const raw = fs.readFileSync(0, "utf8").trim();
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function collectTranscriptSessionIds(transcriptDir) {
  const ids = new Set();
  let entries;
  try {
    entries = fs.readdirSync(transcriptDir);
  } catch {
    return ids;
  }
  for (const name of entries) {
    if (name.endsWith(".jsonl")) {
      ids.add(name.slice(0, -".jsonl".length));
    }
  }
  return ids;
}

function main() {
  const input = readHookInput();
  const transcriptPath = input.transcript_path;
  const cwd = input.cwd || process.cwd();

  if (!transcriptPath) {
    return;
  }

  const transcriptDir = path.dirname(transcriptPath);
  const validSessionIds = collectTranscriptSessionIds(transcriptDir);
  // Empty set means "dir missing" or "transcripts live elsewhere"; either way, don't delete.
  if (validSessionIds.size === 0) {
    return;
  }

  const isStale = (job) => job.sessionId && !validSessionIds.has(job.sessionId);

  // Unlocked pre-check keeps the common no-op case free of lock traffic and
  // state.json rewrites; the filter is re-applied under the lock.
  if (!loadState(cwd).jobs.some(isStale)) {
    return;
  }

  try {
    updateState(
      cwd,
      (state) => {
        state.jobs = state.jobs.filter((job) => !isStale(job));
      },
      // Don't stall SessionStart on a busy lock — a skipped round reruns on
      // the next session start.
      { timeoutMs: 1000 }
    );
  } catch {
    // Lock still contended after the wait — skip this round.
  }
}

main();
