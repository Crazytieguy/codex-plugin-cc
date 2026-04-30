#!/usr/bin/env node
// PreToolUse enforcement: block git commit unless a code review has completed
// since the last commit. Uses timestamp comparison: review completedAt vs last commit time.
// Hook config: matcher "Bash", if "Bash(git commit:*)", wrapped by run-with-session-env.sh

import fs from "node:fs";
import { execSync } from "node:child_process";
import { deny, fetchSessionJobs } from "./lib/hook-helpers.mjs";

const input = JSON.parse(fs.readFileSync(0, "utf8"));

// Self-validate: exit early if this isn't actually a git commit command
// (defense against `if` pattern matching bugs in Claude Code hooks)
const command = input.tool_input?.command ?? "";
if (!command.match(/^git\s+commit\b/)) {
  process.exit(0);
}

// Get the timestamp of the last git commit
let lastCommitTime;
try {
  const raw = execSync("git log -1 --format=%cI HEAD", {
    encoding: "utf8",
    timeout: 5000
  }).trim();
  lastCommitTime = raw ? new Date(raw) : null;
} catch {
  lastCommitTime = null;
}

const allJobs = fetchSessionJobs();
if (!allJobs) {
  // codex-companion unavailable — fail open
  process.exit(0);
}

// Check if a review is currently running
const runningReview = allJobs.find(
  (job) =>
    (job.kind === "review" || job.kind === "adversarial-review") &&
    job.status === "running"
);

if (runningReview) {
  deny(
    "A Codex review is still running. Wait for it to finish, address any feedback, then try git commit again."
  );
  process.exit(0);
}

// Find the most recent completed review
const completedReviews = allJobs.filter(
  (job) =>
    (job.kind === "review" || job.kind === "adversarial-review") &&
    job.status === "completed" &&
    job.completedAt
);

if (completedReviews.length === 0) {
  deny(
    "No Codex review has been completed in this session. " +
      "Run `codex-companion review` first, " +
      "address any findings, then try git commit again."
  );
  process.exit(0);
}

// Check if any completed review is more recent than the last commit
const hasRecentReview = completedReviews.some((job) => {
  if (!lastCommitTime) return true;
  return new Date(job.completedAt) > lastCommitTime;
});

if (!hasRecentReview) {
  deny(
    "No Codex review has been completed since the last commit. " +
      "Run `codex-companion review` " +
      "to review the current changes, then try git commit again."
  );
  process.exit(0);
}

// Review completed after last commit — allow
process.exit(0);
