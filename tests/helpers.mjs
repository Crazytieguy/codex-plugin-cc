import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { after } from "node:test";

import {
  clearBrokerSession,
  loadBrokerSession,
  sendBrokerShutdown,
  teardownBrokerSession
} from "../plugins/codex/scripts/lib/broker-lifecycle.mjs";
import { parseBrokerEndpoint } from "../plugins/codex/scripts/lib/broker-endpoint.mjs";
import { terminateProcessTree } from "../plugins/codex/scripts/lib/process.mjs";

const trackedDirs = new Set();

export function makeTempDir(prefix = "codex-plugin-test-") {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  trackedDirs.add(dir);
  return dir;
}

export function writeExecutable(filePath, source) {
  fs.writeFileSync(filePath, source, { encoding: "utf8", mode: 0o755 });
}

export function run(command, args, options = {}) {
  return spawnSync(command, args, {
    cwd: options.cwd,
    env: options.env,
    encoding: "utf8",
    input: options.input,
    shell: process.platform === "win32" && !path.isAbsolute(command),
    windowsHide: true
  });
}

/**
 * Return a copy of process.env without CODEX_COMPANION_* variables that leak
 * from a live Claude Code session into child processes and break test isolation.
 */
export function cleanEnv(extra = {}) {
  const env = { ...process.env, ...extra };
  for (const key of Object.keys(env)) {
    if (key.startsWith("CODEX_COMPANION_")) delete env[key];
  }
  return env;
}

export function initGitRepo(cwd) {
  run("git", ["init", "-b", "main"], { cwd });
  run("git", ["config", "user.name", "Codex Plugin Tests"], { cwd });
  run("git", ["config", "user.email", "tests@example.com"], { cwd });
  run("git", ["config", "commit.gpgsign", "false"], { cwd });
  run("git", ["config", "tag.gpgsign", "false"], { cwd });
}

function isPidAlive(pid) {
  if (!Number.isFinite(pid)) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code !== "ESRCH";
  }
}

/**
 * Build a `ppid → pid[]` map for all processes on the system. Returns null if
 * no supported process-listing backend is available (callers treat null as
 * "unknown" so they can skip assertions instead of timing out).
 *
 * POSIX: `ps -A -o pid=,ppid=`
 * Windows: `wmic` (deprecated, removed from Windows 11 24H2+) → PowerShell fallback.
 */
function buildChildMap() {
  if (process.platform === "win32") {
    // Try wmic first for older Windows compatibility.
    const wmic = spawnSync(
      "wmic",
      ["process", "get", "ProcessId,ParentProcessId"],
      { encoding: "utf8", windowsHide: true }
    );
    if (wmic.status === 0 && wmic.stdout) {
      const map = new Map();
      const lines = wmic.stdout.split(/\r?\n/).slice(1);
      for (const line of lines) {
        const match = line.trim().match(/^(\d+)\s+(\d+)/);
        if (!match) continue;
        const parentPid = Number(match[1]);
        const childPid = Number(match[2]);
        if (!map.has(parentPid)) map.set(parentPid, []);
        map.get(parentPid).push(childPid);
      }
      return map;
    }

    // Fallback: PowerShell + CIM (works on Windows 11 24H2+ where wmic is gone).
    const ps = spawnSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        "Get-CimInstance Win32_Process | ForEach-Object { \"$($_.ParentProcessId) $($_.ProcessId)\" }"
      ],
      { encoding: "utf8", windowsHide: true }
    );
    if (ps.status === 0 && ps.stdout) {
      const map = new Map();
      for (const line of ps.stdout.split(/\r?\n/)) {
        const match = line.trim().match(/^(\d+)\s+(\d+)/);
        if (!match) continue;
        const parentPid = Number(match[1]);
        const childPid = Number(match[2]);
        if (!map.has(parentPid)) map.set(parentPid, []);
        map.get(parentPid).push(childPid);
      }
      return map;
    }

    return null;
  }

  const result = spawnSync("ps", ["-A", "-o", "pid=,ppid="], { encoding: "utf8" });
  if (result.status !== 0 || !result.stdout) {
    return null;
  }
  const map = new Map();
  for (const line of result.stdout.split("\n")) {
    const match = line.trim().match(/^(\d+)\s+(\d+)/);
    if (!match) continue;
    const childPid = Number(match[1]);
    const parentPid = Number(match[2]);
    if (!map.has(parentPid)) map.set(parentPid, []);
    map.get(parentPid).push(childPid);
  }
  return map;
}

/**
 * Walk the process tree rooted at `pid` and return every descendant. Excludes
 * `pid` itself. Returns `null` when no process-listing backend is available on
 * this platform (callers should skip descendant assertions rather than treating
 * this as "no descendants"). Returns `[]` when the backend worked but the pid
 * has no children.
 */
export function discoverDescendants(pid) {
  if (!Number.isFinite(pid)) {
    return [];
  }

  const children = buildChildMap();
  if (children === null) {
    return null;
  }

  const descendants = [];
  const stack = [pid];
  const seen = new Set();
  while (stack.length > 0) {
    const current = stack.pop();
    if (seen.has(current)) continue;
    seen.add(current);
    const kids = children.get(current) ?? [];
    for (const child of kids) {
      descendants.push(child);
      stack.push(child);
    }
  }
  return descendants;
}

async function waitUntil(predicate, { timeoutMs, intervalMs = 50 }) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await predicate()) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return false;
}

function endpointReachable(endpoint) {
  return new Promise((resolve) => {
    let parsed;
    try {
      parsed = parseBrokerEndpoint(endpoint);
    } catch {
      resolve(false);
      return;
    }
    if (parsed.kind === "unix") {
      resolve(fs.existsSync(parsed.path));
      return;
    }
    // pipe — attempt a connection and see if it succeeds.
    const socket = net.createConnection({ path: parsed.path });
    const timer = setTimeout(() => {
      socket.destroy();
      resolve(false);
    }, 200);
    socket.on("connect", () => {
      clearTimeout(timer);
      socket.end();
      resolve(true);
    });
    socket.on("error", () => {
      clearTimeout(timer);
      resolve(false);
    });
  });
}

/**
 * Tear down every broker rooted in a tracked temp dir. Registered as a
 * file-level `after()` hook; also callable directly from tests. Throws only
 * if the final state is genuinely still broken (broker or descendant still
 * alive, endpoint still reachable, session file still present).
 */
export async function cleanupTrackedBrokers() {
  const diagnostics = [];
  const finalFailures = [];

  for (const dir of trackedDirs) {
    let session;
    try {
      session = loadBrokerSession(dir);
    } catch (error) {
      diagnostics.push(`loadBrokerSession(${dir}) threw: ${error?.message ?? error}`);
      continue;
    }
    if (!session) {
      continue;
    }

    const brokerPid = session.pid ?? null;
    // discoverDescendants returns null if the platform has no supported backend.
    // In that case we skip descendant assertions — the group/tree kill still
    // targets everything — and only verify the broker pid itself.
    const discoveredDescendants = Number.isFinite(brokerPid) ? discoverDescendants(brokerPid) : [];
    const descendants = discoveredDescendants ?? [];
    const descendantsKnown = discoveredDescendants !== null;

    if (session.endpoint) {
      try {
        await sendBrokerShutdown(session.endpoint, { timeoutMs: 500 });
      } catch (error) {
        diagnostics.push(`sendBrokerShutdown(${dir}) threw: ${error?.message ?? error}`);
      }
    }

    try {
      teardownBrokerSession({
        endpoint: session.endpoint ?? null,
        pidFile: session.pidFile ?? null,
        logFile: session.logFile ?? null,
        sessionDir: session.sessionDir ?? null,
        pid: brokerPid,
        killProcess: terminateProcessTree
      });
    } catch (error) {
      diagnostics.push(`teardownBrokerSession(${dir}) threw: ${error?.message ?? error}`);
    }

    // Give the SIGTERM a moment to land.
    await waitUntil(
      () => !isPidAlive(brokerPid) && descendants.every((pid) => !isPidAlive(pid)),
      { timeoutMs: 2000 }
    );

    // Escalate — kill the whole group/tree.
    if (
      Number.isFinite(brokerPid) &&
      (isPidAlive(brokerPid) || descendants.some((pid) => isPidAlive(pid)))
    ) {
      try {
        if (process.platform === "win32") {
          spawnSync("taskkill", ["/PID", String(brokerPid), "/T", "/F"], {
            windowsHide: true
          });
        } else {
          try {
            process.kill(-brokerPid, "SIGKILL");
          } catch (error) {
            if (error?.code !== "ESRCH") {
              diagnostics.push(`SIGKILL -${brokerPid} threw: ${error?.message ?? error}`);
            }
          }
          // Also SIGKILL any descendants directly, in case they escaped the group.
          for (const pid of descendants) {
            try {
              process.kill(pid, "SIGKILL");
            } catch (error) {
              if (error?.code !== "ESRCH") {
                diagnostics.push(`SIGKILL ${pid} threw: ${error?.message ?? error}`);
              }
            }
          }
        }
      } catch (error) {
        diagnostics.push(`force-kill(${dir}) threw: ${error?.message ?? error}`);
      }

      await waitUntil(
        () => !isPidAlive(brokerPid) && descendants.every((pid) => !isPidAlive(pid)),
        { timeoutMs: 2000 }
      );
    }

    try {
      clearBrokerSession(dir);
    } catch (error) {
      diagnostics.push(`clearBrokerSession(${dir}) threw: ${error?.message ?? error}`);
    }

    // Final state check — the only thing that actually fails the suite.
    const brokerStillAlive = isPidAlive(brokerPid);
    const leakedDescendants = descendantsKnown
      ? descendants.filter((pid) => isPidAlive(pid))
      : [];
    const endpointStillUp = session.endpoint ? await endpointReachable(session.endpoint) : false;
    const sessionStillLoaded = loadBrokerSession(dir) !== null;

    if (brokerStillAlive || leakedDescendants.length > 0 || endpointStillUp || sessionStillLoaded) {
      finalFailures.push({
        dir,
        brokerPid,
        brokerStillAlive,
        leakedDescendants,
        endpointStillUp,
        sessionStillLoaded
      });
    }
  }

  trackedDirs.clear();

  if (finalFailures.length > 0) {
    const summary = finalFailures
      .map((f) => JSON.stringify(f))
      .join("\n");
    const diag = diagnostics.length > 0 ? `\nDiagnostics:\n${diagnostics.join("\n")}` : "";
    throw new Error(`cleanupTrackedBrokers left state behind:\n${summary}${diag}`);
  }
}

after(cleanupTrackedBrokers);
