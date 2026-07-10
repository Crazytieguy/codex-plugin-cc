import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createBrokerEndpoint, parseBrokerEndpoint } from "./broker-endpoint.mjs";
import { writeFileAtomic } from "./fs.mjs";
import { acquirePidLockAsync } from "./lockfile.mjs";
import { terminateProcessTree } from "./process.mjs";
import { resolveStateDir } from "./state.mjs";

const BROKER_STATE_FILE = "broker.json";
const BROKER_LOCK_FILE = "broker.lock";
const BROKER_LOCK_BASE_TIMEOUT_MS = 10000;

export function createBrokerSessionDir(prefix = "cxc-") {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function connectToEndpoint(endpoint) {
  const target = parseBrokerEndpoint(endpoint);
  return net.createConnection({ path: target.path });
}

export async function waitForBrokerEndpoint(endpoint, timeoutMs = 2000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const ready = await new Promise((resolve) => {
      const socket = connectToEndpoint(endpoint);
      socket.on("connect", () => {
        socket.end();
        resolve(true);
      });
      socket.on("error", () => resolve(false));
    });
    if (ready) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return false;
}

/** @param {string} endpoint @param {{ timeoutMs?: number }} [options] */
export async function sendBrokerShutdown(endpoint, { timeoutMs } = {}) {
  await new Promise((resolve) => {
    const socket = connectToEndpoint(endpoint);
    socket.setEncoding("utf8");
    if (Number.isFinite(timeoutMs) && timeoutMs > 0) {
      socket.setTimeout(timeoutMs);
      socket.on("timeout", () => {
        socket.destroy();
        resolve();
      });
    }
    socket.on("connect", () => {
      socket.write(`${JSON.stringify({ id: 1, method: "broker/shutdown", params: {} })}\n`);
    });
    socket.on("data", () => {
      socket.end();
      resolve();
    });
    socket.on("error", resolve);
    socket.on("close", resolve);
  });
}

export function spawnBrokerProcess({ scriptPath, cwd, endpoint, pidFile, logFile, env = process.env }) {
  const logFd = fs.openSync(logFile, "a");
  const child = spawn(process.execPath, [scriptPath, "serve", "--endpoint", endpoint, "--cwd", cwd, "--pid-file", pidFile], {
    cwd,
    env,
    detached: true,
    stdio: ["ignore", logFd, logFd]
  });
  child.unref();
  fs.closeSync(logFd);
  return child;
}

function resolveBrokerStateFile(cwd) {
  return path.join(resolveStateDir(cwd), BROKER_STATE_FILE);
}

export function loadBrokerSession(cwd) {
  const stateFile = resolveBrokerStateFile(cwd);
  if (!fs.existsSync(stateFile)) {
    return null;
  }

  try {
    return JSON.parse(fs.readFileSync(stateFile, "utf8"));
  } catch {
    return null;
  }
}

export function saveBrokerSession(cwd, session) {
  const stateDir = resolveStateDir(cwd);
  fs.mkdirSync(stateDir, { recursive: true });
  writeFileAtomic(resolveBrokerStateFile(cwd), `${JSON.stringify(session, null, 2)}\n`);
}

export function clearBrokerSession(cwd) {
  const stateFile = resolveBrokerStateFile(cwd);
  if (fs.existsSync(stateFile)) {
    fs.unlinkSync(stateFile);
  }
}

async function isBrokerEndpointReady(endpoint) {
  if (!endpoint) {
    return false;
  }
  try {
    return await waitForBrokerEndpoint(endpoint, 150);
  } catch {
    return false;
  }
}

export async function ensureBrokerSession(cwd, options = {}) {
  // Fast path: a live broker needs no lock — broker.json writes are atomic.
  const existing = loadBrokerSession(cwd);
  if (existing && (await isBrokerEndpointReady(existing.endpoint))) {
    return existing;
  }

  // Serialize stale teardown + spawn + save across concurrent sessions,
  // otherwise two sessions can both observe "no broker" and both spawn one.
  // The holder keeps the lock across its spawn + readiness wait, so waiters
  // must outlast that window or they'd give up on a broker that is about to
  // become ready.
  const stateDir = resolveStateDir(cwd);
  fs.mkdirSync(stateDir, { recursive: true });
  const releaseLock = await acquirePidLockAsync(path.join(stateDir, BROKER_LOCK_FILE), {
    timeoutMs: Math.max(BROKER_LOCK_BASE_TIMEOUT_MS, (options.timeoutMs ?? 2000) + 5000)
  });
  if (!releaseLock) {
    // Lock timeout: degrade to no broker (callers spawn a direct app-server).
    return null;
  }

  try {
    // Recheck under the lock — another session may have just spawned a broker.
    const current = loadBrokerSession(cwd);
    if (current && (await isBrokerEndpointReady(current.endpoint))) {
      return current;
    }

    if (current) {
      teardownBrokerSession({
        endpoint: current.endpoint ?? null,
        pidFile: current.pidFile ?? null,
        logFile: current.logFile ?? null,
        sessionDir: current.sessionDir ?? null,
        pid: current.pid ?? null,
        killProcess: options.killProcess ?? terminateProcessTree
      });
      clearBrokerSession(cwd);
    }

    const sessionDir = createBrokerSessionDir();
    const endpointFactory = options.createBrokerEndpoint ?? createBrokerEndpoint;
    const endpoint = endpointFactory(sessionDir, options.platform);
    const pidFile = path.join(sessionDir, "broker.pid");
    const logFile = path.join(sessionDir, "broker.log");
    const scriptPath =
      options.scriptPath ??
      fileURLToPath(new URL("../app-server-broker.mjs", import.meta.url));

    const child = spawnBrokerProcess({
      scriptPath,
      cwd,
      endpoint,
      pidFile,
      logFile,
      env: options.env ?? process.env
    });

    const ready = await waitForBrokerEndpoint(endpoint, options.timeoutMs ?? 2000);
    if (!ready) {
      teardownBrokerSession({
        endpoint,
        pidFile,
        logFile,
        sessionDir,
        pid: child.pid ?? null,
        killProcess: options.killProcess ?? terminateProcessTree
      });
      return null;
    }

    const session = {
      endpoint,
      pidFile,
      logFile,
      sessionDir,
      pid: child.pid ?? null
    };
    saveBrokerSession(cwd, session);
    return session;
  } finally {
    releaseLock();
  }
}

export function teardownBrokerSession({ endpoint = null, pidFile, logFile, sessionDir = null, pid = null, killProcess = null }) {
  if (Number.isFinite(pid) && killProcess) {
    try {
      killProcess(pid);
    } catch {
      // Ignore missing or already-exited broker processes.
    }
  }

  if (pidFile && fs.existsSync(pidFile)) {
    fs.unlinkSync(pidFile);
  }

  if (logFile && fs.existsSync(logFile)) {
    fs.unlinkSync(logFile);
  }

  if (endpoint) {
    try {
      const target = parseBrokerEndpoint(endpoint);
      if (target.kind === "unix" && fs.existsSync(target.path)) {
        fs.unlinkSync(target.path);
      }
    } catch {
      // Ignore malformed or already-removed broker endpoints during teardown.
    }
  }

  const resolvedSessionDir = sessionDir ?? (pidFile ? path.dirname(pidFile) : logFile ? path.dirname(logFile) : null);
  if (resolvedSessionDir && fs.existsSync(resolvedSessionDir)) {
    try {
      fs.rmdirSync(resolvedSessionDir);
    } catch {
      // Ignore non-empty or missing directories.
    }
  }
}
