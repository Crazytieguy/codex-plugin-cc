import fs from "node:fs";
import process from "node:process";

import { readJobFile, resolveJobFile, resolveJobLogFile, upsertJob, writeJobFile } from "./state.mjs";

/**
 * Update the shared state index without letting a lock timeout break the
 * caller: the per-job file is the source of truth for results, the index is
 * metadata. Returns whether the update landed; failures are logged when a
 * log target is provided and silently dropped otherwise (progress updates).
 */
function bestEffortUpsertJob(workspaceRoot, patch, { logFile = null, warnLabel = null } = {}) {
  try {
    upsertJob(workspaceRoot, patch);
    return true;
  } catch (error) {
    if (warnLabel) {
      const message = error instanceof Error ? error.message : String(error);
      appendLogLine(logFile, `Warning: ${warnLabel}: ${message}`);
      process.stderr.write(`codex-companion: ${warnLabel}: ${message}\n`);
    }
    return false;
  }
}

export const SESSION_ID_ENV = "CODEX_COMPANION_SESSION_ID";

export function nowIso() {
  return new Date().toISOString();
}

function normalizeProgressEvent(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return {
      message: String(value.message ?? "").trim(),
      phase: typeof value.phase === "string" && value.phase.trim() ? value.phase.trim() : null,
      threadId: typeof value.threadId === "string" && value.threadId.trim() ? value.threadId.trim() : null,
      turnId: typeof value.turnId === "string" && value.turnId.trim() ? value.turnId.trim() : null,
      logTitle: typeof value.logTitle === "string" && value.logTitle.trim() ? value.logTitle.trim() : null,
      logBody: value.logBody == null ? null : String(value.logBody).trimEnd()
    };
  }

  return {
    message: String(value ?? "").trim(),
    phase: null,
    threadId: null,
    turnId: null,
    logTitle: null,
    logBody: null
  };
}

export function appendLogLine(logFile, message) {
  const normalized = String(message ?? "").trim();
  if (!logFile || !normalized) {
    return;
  }
  fs.appendFileSync(logFile, `[${nowIso()}] ${normalized}\n`, "utf8");
}

export function appendLogBlock(logFile, title, body) {
  if (!logFile || !body) {
    return;
  }
  fs.appendFileSync(logFile, `\n[${nowIso()}] ${title}\n${String(body).trimEnd()}\n`, "utf8");
}

export function createJobLogFile(workspaceRoot, jobId, title) {
  const logFile = resolveJobLogFile(workspaceRoot, jobId);
  fs.writeFileSync(logFile, "", "utf8");
  if (title) {
    appendLogLine(logFile, `Starting ${title}.`);
  }
  return logFile;
}

export function createJobRecord(base, options = {}) {
  const env = options.env ?? process.env;
  const sessionId = env[options.sessionIdEnv ?? SESSION_ID_ENV];
  return {
    ...base,
    createdAt: nowIso(),
    ...(sessionId ? { sessionId } : {})
  };
}

export function createJobProgressUpdater(workspaceRoot, jobId) {
  let lastPhase = null;
  let lastThreadId = null;
  let lastTurnId = null;

  return (event) => {
    const normalized = normalizeProgressEvent(event);
    const patch = { id: jobId };
    let changed = false;

    if (normalized.phase && normalized.phase !== lastPhase) {
      lastPhase = normalized.phase;
      patch.phase = normalized.phase;
      changed = true;
    }

    if (normalized.threadId && normalized.threadId !== lastThreadId) {
      lastThreadId = normalized.threadId;
      patch.threadId = normalized.threadId;
      changed = true;
    }

    if (normalized.turnId && normalized.turnId !== lastTurnId) {
      lastTurnId = normalized.turnId;
      patch.turnId = normalized.turnId;
      changed = true;
    }

    if (!changed) {
      return;
    }

    // Progress updates are droppable — don't let state-lock contention kill
    // a healthy run. The completion write surfaces persistent failures.
    bestEffortUpsertJob(workspaceRoot, patch);

    const jobFile = resolveJobFile(workspaceRoot, jobId);
    if (!fs.existsSync(jobFile)) {
      return;
    }

    const storedJob = readJobFile(jobFile);
    writeJobFile(workspaceRoot, jobId, {
      ...storedJob,
      ...patch
    });
  };
}

export function createProgressReporter({ logFile = null, onEvent = null } = {}) {
  if (!logFile && !onEvent) {
    return null;
  }

  return (eventOrMessage) => {
    const event = normalizeProgressEvent(eventOrMessage);
    appendLogLine(logFile, event.message);
    appendLogBlock(logFile, event.logTitle, event.logBody);
    onEvent?.(event);
  };
}

function readStoredJobOrNull(workspaceRoot, jobId) {
  const jobFile = resolveJobFile(workspaceRoot, jobId);
  if (!fs.existsSync(jobFile)) {
    return null;
  }
  return readJobFile(jobFile);
}

export async function runTrackedJob(job, runner, options = {}) {
  const logFile = options.logFile ?? job.logFile ?? null;
  const runningRecord = {
    ...job,
    status: "running",
    startedAt: nowIso(),
    phase: "starting",
    pid: process.pid,
    logFile
  };
  writeJobFile(job.workspaceRoot, job.id, runningRecord);
  try {
    upsertJob(job.workspaceRoot, runningRecord);
  } catch (error) {
    // The job never entered the index, so nothing will ever reconcile the
    // just-written "running" job file — remove it rather than strand it.
    try {
      fs.unlinkSync(resolveJobFile(job.workspaceRoot, job.id));
    } catch {
      // Best effort.
    }
    throw error;
  }

  let execution;
  try {
    execution = await runner();
  } catch (error) {
    // Persistence in this path is best-effort: the runner's error is what the
    // caller needs to see, never an ENOSPC/lock error that follows it.
    try {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const existing = readStoredJobOrNull(job.workspaceRoot, job.id) ?? runningRecord;
      const completedAt = nowIso();
      writeJobFile(job.workspaceRoot, job.id, {
        ...existing,
        status: "failed",
        phase: "failed",
        errorMessage,
        pid: null,
        completedAt,
        logFile: logFile ?? existing.logFile ?? null
      });
      bestEffortUpsertJob(job.workspaceRoot, {
        id: job.id,
        status: "failed",
        phase: "failed",
        pid: null,
        errorMessage,
        completedAt
      });
    } catch {
      // Preserve the runner's error.
    }
    throw error;
  }

  // The runner succeeded. The job file is the stored result and is written
  // first; a failure to update the shared state index afterwards must not be
  // reported as a job failure or overwrite the stored result.
  const completionStatus = execution.exitStatus === 0 ? "completed" : "failed";
  const completedAt = nowIso();
  writeJobFile(job.workspaceRoot, job.id, {
    ...runningRecord,
    status: completionStatus,
    threadId: execution.threadId ?? null,
    turnId: execution.turnId ?? null,
    pid: null,
    phase: completionStatus === "completed" ? "done" : "failed",
    completedAt,
    result: execution.payload,
    rendered: execution.rendered
  });
  bestEffortUpsertJob(
    job.workspaceRoot,
    {
      id: job.id,
      status: completionStatus,
      threadId: execution.threadId ?? null,
      turnId: execution.turnId ?? null,
      summary: execution.summary,
      phase: completionStatus === "completed" ? "done" : "failed",
      pid: null,
      completedAt
    },
    { logFile, warnLabel: `job ${job.id} finished but the state index could not be updated` }
  );
  appendLogBlock(logFile, "Final output", execution.rendered);
  return execution;
}
