import fs from "node:fs";

import { isPidAlive } from "./process.mjs";

const DEFAULT_RETRY_MS = 25;
// Healthy holders keep a lock for milliseconds (state mutations) up to the
// broker spawn+readiness wait (seconds). A lock older than this is stale even
// if its pid looks alive — the pid may have been recycled, or belong to
// another user (EPERM reads as alive).
const DEFAULT_STALE_AGE_MS = 60_000;

const sleepBuffer = new Int32Array(new SharedArrayBuffer(4));

function sleepSync(ms) {
  Atomics.wait(sleepBuffer, 0, 0, ms);
}

function releasePidLock(lockPath) {
  // Only remove the lock if we still own it — a mis-stolen and re-created
  // lock must not be deleted out from under its new holder.
  try {
    if (fs.readFileSync(lockPath, "utf8").trim() === String(process.pid)) {
      fs.unlinkSync(lockPath);
    }
  } catch {
    // Already removed or unreadable — nothing to release.
  }
}

/**
 * One acquisition attempt. Returns "acquired", "busy" (live holder — sleep and
 * retry), or "retry" (transient state — retry immediately; the caller's
 * deadline bounds the loop).
 *
 * Stale locks (dead holder, or older than staleAgeMs) are stolen atomically:
 * rename removes the path exactly once, so two stealers can never both
 * proceed — the loser's rename throws and it just retries. If the rename
 * grabbed a lock a successor created between our read and the rename, it is
 * restored with link() (atomic; fails if an even newer lock exists, in which
 * case the displaced holder is protected by the ownership check in release).
 */
function tryAcquireOnce(lockPath, staleAgeMs) {
  try {
    fs.writeFileSync(lockPath, String(process.pid), { flag: "wx" });
    return "acquired";
  } catch (error) {
    if (error?.code !== "EEXIST") {
      throw error;
    }
  }

  let holderRaw;
  let holderMtimeMs;
  try {
    holderRaw = fs.readFileSync(lockPath, "utf8");
    holderMtimeMs = fs.statSync(lockPath).mtimeMs;
  } catch {
    return "retry";
  }

  const holderPid = Number.parseInt(holderRaw.trim(), 10);
  const expired = Date.now() - holderMtimeMs > staleAgeMs;
  if (isPidAlive(holderPid) && !expired) {
    return "busy";
  }

  const stolenPath = `${lockPath}.stale-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
  try {
    fs.renameSync(lockPath, stolenPath);
  } catch {
    return "retry";
  }

  let stolenRaw = null;
  try {
    stolenRaw = fs.readFileSync(stolenPath, "utf8");
  } catch {
    // Nothing to inspect; treat as stolen.
  }
  if (
    stolenRaw !== null &&
    stolenRaw !== holderRaw &&
    isPidAlive(Number.parseInt(stolenRaw.trim(), 10))
  ) {
    try {
      fs.linkSync(stolenPath, lockPath);
    } catch {
      // A newer lock already exists; the displaced holder's release is a
      // no-op thanks to the ownership check.
    }
  }
  try {
    fs.unlinkSync(stolenPath);
  } catch {
    // Best effort — the unique name can't collide with future steals.
  }
  return "retry";
}

/**
 * Acquire a PID lockfile, blocking the thread synchronously (Atomics.wait)
 * between retries. Returns a release function. Throws on timeout — callers
 * must never mutate the guarded state without the lock.
 */
export function acquirePidLockSync(lockPath, { timeoutMs, retryMs = DEFAULT_RETRY_MS, staleAgeMs = DEFAULT_STALE_AGE_MS }) {
  const deadline = Date.now() + timeoutMs;
  while (true) {
    const result = tryAcquireOnce(lockPath, staleAgeMs);
    if (result === "acquired") {
      return () => releasePidLock(lockPath);
    }
    if (Date.now() >= deadline) {
      throw new Error(`Timed out waiting for lock at ${lockPath}.`);
    }
    // "retry" states normally resolve on the next attempt; the short sleep
    // keeps a pathological one (persistent rename failure) from spinning hot.
    sleepSync(result === "busy" ? retryMs : 1);
  }
}

/**
 * Async variant: yields to the event loop between retries. Returns a release
 * function, or null on timeout — callers degrade instead of racing.
 */
export async function acquirePidLockAsync(lockPath, { timeoutMs, retryMs = DEFAULT_RETRY_MS, staleAgeMs = DEFAULT_STALE_AGE_MS }) {
  const deadline = Date.now() + timeoutMs;
  while (true) {
    const result = tryAcquireOnce(lockPath, staleAgeMs);
    if (result === "acquired") {
      return () => releasePidLock(lockPath);
    }
    if (Date.now() >= deadline) {
      return null;
    }
    await new Promise((resolve) => setTimeout(resolve, result === "busy" ? retryMs : 1));
  }
}
