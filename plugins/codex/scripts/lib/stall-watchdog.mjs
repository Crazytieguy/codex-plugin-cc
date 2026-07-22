import process from "node:process";

import { appendLogLine } from "./tracked-jobs.mjs";

const DEFAULT_WARN_MS = 180000;
const DEFAULT_REPEAT_MS = 600000;

const DISABLED_WATCHDOG = {
  enabled: false,
  start() {},
  touch() {},
  stop() {}
};

function parseMsEnv(name, fallback) {
  const raw = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(raw) ? raw : fallback;
}

function formatDuration(ms) {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes === 0) {
    return `${seconds}s`;
  }
  return seconds === 0 ? `${minutes}m` : `${minutes}m${seconds}s`;
}

/**
 * Advisory liveness watchdog for foreground Codex runs. While the app-server
 * is silent past the warn threshold, it emits a warning line to stdout (each
 * line surfaces as a Monitor notification to Claude, which decides whether to
 * keep waiting, cancel, or escalate to the user) and to the job log. It never
 * terminates the run: a legitimately long turn just produces a benign line.
 *
 * The watchdog owns all timing/transport state. Callers arm it with
 * `start(transport)` at the beginning of each connection attempt (so preflight
 * work never triggers it, and a broker→direct fallback re-arms with the right
 * transport) and reset it with `touch(label)` on every protocol message.
 */
export function createStallWatchdog(options = {}) {
  const warnMs = options.warnMs ?? parseMsEnv("CODEX_COMPANION_STALL_WARN_MS", DEFAULT_WARN_MS);
  if (!Number.isFinite(warnMs) || warnMs <= 0) {
    return DISABLED_WATCHDOG;
  }
  const repeatMs = Math.max(
    1000,
    options.repeatMs ?? parseMsEnv("CODEX_COMPANION_STALL_REPEAT_MS", DEFAULT_REPEAT_MS)
  );
  const checkIntervalMs = options.checkIntervalMs ?? Math.max(250, Math.min(Math.floor(warnMs / 4), 15000));
  const now = options.now ?? Date.now;
  const writeLine = options.writeLine ?? ((line) => process.stdout.write(line));
  const appendLog = options.appendLog ?? ((message) => appendLogLine(options.logFile ?? null, message));
  const quiet = Boolean(options.quiet);
  const jobId = options.jobId ?? null;

  let transport = null;
  let lastEventLabel = null;
  let lastActivityAt = null;
  let lastWarnAt = null;
  let timer = null;

  function buildWarningLine(silentMs) {
    const repeated = lastWarnAt !== null;
    const opening = repeated ? "still no activity from Codex" : "no activity from Codex";
    const lastEvent = lastEventLabel ?? "none since connect";
    const jobDetail = jobId ? `, job: ${jobId}` : "";
    const statusHint = jobId ? `\`codex-companion status ${jobId}\`` : "`codex-companion status`";
    const cancelHint = jobId ? `\`codex-companion cancel ${jobId}\`` : "`codex-companion cancel`";
    const advice = repeated
      ? `Consider cancelling with ${cancelHint} and telling the user Codex appears stalled.`
      : `This can be normal for a long turn, but may mean Codex is stalled. Keep waiting, check progress with ${statusHint}, or cancel with ${cancelHint} — if this repeats, tell the user Codex appears stalled.`;
    return `codex-companion: ${opening} for ${formatDuration(silentMs)} (last event: ${lastEvent}, transport: ${transport}${jobDetail}). ${advice}`;
  }

  function check() {
    if (lastActivityAt === null) {
      return;
    }
    const silentMs = now() - lastActivityAt;
    if (silentMs < warnMs) {
      return;
    }
    if (lastWarnAt !== null && now() - lastWarnAt < repeatMs) {
      return;
    }
    const line = buildWarningLine(silentMs);
    lastWarnAt = now();
    // The watchdog is advisory: a failed sink (ENOSPC, removed log dir, closed
    // stdout) must never throw out of the interval callback and kill the run,
    // and one failed sink must not suppress the other.
    if (!quiet) {
      try {
        writeLine(`${line}\n`);
      } catch {
        // Best effort.
      }
    }
    try {
      appendLog(line);
    } catch {
      // Best effort.
    }
  }

  return {
    enabled: true,
    start(nextTransport) {
      transport = nextTransport ?? "unknown";
      lastEventLabel = null;
      lastActivityAt = now();
      lastWarnAt = null;
      if (!timer) {
        timer = setInterval(check, checkIntervalMs);
        timer.unref?.();
      }
    },
    touch(label) {
      if (lastActivityAt === null) {
        return;
      }
      if (label) {
        lastEventLabel = label;
      }
      lastActivityAt = now();
      lastWarnAt = null;
    },
    stop() {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
      lastActivityAt = null;
    }
  };
}
