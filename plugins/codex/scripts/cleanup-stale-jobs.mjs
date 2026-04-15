#!/usr/bin/env node
// Async SessionStart hook: remove codex-companion job records whose corresponding
// Claude Code transcript no longer exists. Scoped to the current project.

import fs from "node:fs";
import path from "node:path";

import { loadState, resolveStateDir, saveState } from "./lib/state.mjs";

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

function acquireLock(lockPath) {
  while (true) {
    try {
      fs.writeFileSync(lockPath, String(process.pid), { flag: "wx" });
      return true;
    } catch (err) {
      if (err.code !== "EEXIST") {
        return false;
      }
    }

    let holderPid;
    try {
      holderPid = Number.parseInt(fs.readFileSync(lockPath, "utf8").trim(), 10);
    } catch {
      // Lock disappeared between EEXIST and read — try again.
      continue;
    }

    if (!Number.isFinite(holderPid) || holderPid <= 0) {
      try {
        fs.unlinkSync(lockPath);
      } catch {
        return false;
      }
      continue;
    }

    try {
      process.kill(holderPid, 0);
      // Holder is alive — another cleanup is running.
      return false;
    } catch (err) {
      if (err.code === "ESRCH") {
        try {
          fs.unlinkSync(lockPath);
        } catch {
          return false;
        }
        continue;
      }
      return false;
    }
  }
}

function releaseLock(lockPath) {
  try {
    fs.unlinkSync(lockPath);
  } catch {
    // Best effort.
  }
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

  const stateDir = resolveStateDir(cwd);
  const lockPath = path.join(stateDir, "cleanup.lock");

  try {
    fs.mkdirSync(stateDir, { recursive: true });
  } catch {
    return;
  }

  if (!acquireLock(lockPath)) {
    return;
  }

  try {
    const state = loadState(cwd);
    const filteredJobs = state.jobs.filter(
      (job) => !job.sessionId || validSessionIds.has(job.sessionId)
    );
    if (filteredJobs.length === state.jobs.length) {
      return;
    }
    saveState(cwd, { ...state, jobs: filteredJobs });
  } finally {
    releaseLock(lockPath);
  }
}

main();
