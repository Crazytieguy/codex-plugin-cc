#!/usr/bin/env node
// PreToolUse enforcement: block git commit unless a code review has completed
// since the last commit. Uses timestamp comparison: review completedAt vs last commit time.
// Hook config: matcher "Bash", if "Bash(git commit:*)"

import fs from "node:fs";
import { execSync } from "node:child_process";

const input = JSON.parse(fs.readFileSync(0, "utf8"));

const sessionId =
  process.env.CODEX_COMPANION_SESSION_ID || input.session_id || "";

function deny(reason) {
  const output = {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: reason
    }
  };
  process.stdout.write(JSON.stringify(output) + "\n");
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
  // No commits yet or not in a git repo — allow
  lastCommitTime = null;
}

// Get codex job status
let statusData;
try {
  const raw = execSync("codex-companion status --all --json", {
    encoding: "utf8",
    timeout: 10000
  });
  statusData = JSON.parse(raw);
} catch {
  process.exit(0);
}

// Collect all jobs
const allJobs = [
  ...(statusData.running ?? []),
  ...(statusData.recent ?? []),
  ...(statusData.latestFinished ? [statusData.latestFinished] : [])
];

const sessionJobs = sessionId
  ? allJobs.filter((job) => job.sessionId === sessionId)
  : allJobs;

// Check if a review is currently running
const runningReview = sessionJobs.find(
  (job) =>
    (job.kind === "review" || job.kind === "adversarial-review") &&
    (job.status === "queued" || job.status === "running")
);

if (runningReview) {
  deny(
    "A Codex review is still running. Wait for it to finish, address any feedback, then try git commit again."
  );
  process.exit(0);
}

// Find the most recent completed review
const completedReviews = sessionJobs.filter(
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
  if (!lastCommitTime) return true; // No prior commits — any review counts
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
