#!/usr/bin/env node
// PreToolUse enforcement: block ExitPlanMode until a plan-review has completed in this session.
// Hook config: matcher "ExitPlanMode" (no if needed)

import fs from "node:fs";
import { execSync } from "node:child_process";

const input = JSON.parse(fs.readFileSync(0, "utf8"));

// Get session ID from env (set via CLAUDE_ENV_FILE) or from hook input
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

// Collect all jobs from the status response
const allJobs = [
  ...(statusData.running ?? []),
  ...(statusData.recent ?? []),
  ...(statusData.latestFinished ? [statusData.latestFinished] : [])
];

// Filter to this session if we have a session ID
const sessionJobs = sessionId
  ? allJobs.filter((job) => job.sessionId === sessionId)
  : allJobs;

// Check if a plan-review is currently running
const runningPlanReview = sessionJobs.find(
  (job) =>
    job.kind === "plan-review" &&
    (job.status === "queued" || job.status === "running")
);

if (runningPlanReview) {
  deny(
    "A Codex plan review is still running. Wait for it to finish, address any feedback, then try ExitPlanMode again."
  );
  process.exit(0);
}

// Check if a plan-review has completed in this session
const completedPlanReview = sessionJobs.find(
  (job) => job.kind === "plan-review" && job.status === "completed"
);

if (!completedPlanReview) {
  deny(
    "No Codex plan review has been completed in this session. " +
      "Run `codex-companion plan-review <plan-file>` to get feedback on the plan, " +
      "address any comments, then try ExitPlanMode again."
  );
  process.exit(0);
}

// Plan review completed — allow
process.exit(0);
