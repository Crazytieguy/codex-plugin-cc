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
 * List direct children of `pid`. Cross-platform. Returns [] if the lookup fails
 * or no children exist. Used by discoverDescendants to walk the tree.
 */
function listDirectChildren(pid) {
  if (!Number.isFinite(pid)) {
    return [];
  }

  if (process.platform === "win32") {
    const result = spawnSync(
      "wmic",
      ["process", "where", `(ParentProcessId=${pid})`, "get", "ProcessId"],
      { encoding: "utf8", windowsHide: true }
    );
    if (result.status !== 0 || !result.stdout) {
      return [];
    }
    const children = [];
    for (const line of result.stdout.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || !/^\d+$/.test(trimmed)) continue;
      const childPid = Number(trimmed);
      if (Number.isFinite(childPid) && childPid !== pid) {
        children.push(childPid);
      }
    }
    return children;
  }

  const result = spawnSync("ps", ["-A", "-o", "pid=,ppid="], { encoding: "utf8" });
  if (result.status !== 0 || !result.stdout) {
    return [];
  }
  const children = [];
  for (const line of result.stdout.split("\n")) {
    const match = line.trim().match(/^(\d+)\s+(\d+)/);
    if (!match) continue;
    const childPid = Number(match[1]);
    const parentPid = Number(match[2]);
    if (parentPid === pid) {
      children.push(childPid);
    }
  }
  return children;
}

/**
 * Walk the process tree rooted at `pid` and return every descendant. Excludes
 * `pid` itself. Best-effort — if the platform helper returns nothing we return [].
 */
export function discoverDescendants(pid) {
  if (!Number.isFinite(pid)) {
    return [];
  }

  // Build a full ppid→pid map once and walk it. Cheaper than querying per-node
  // and avoids races where a child exits between queries.
  if (process.platform === "win32") {
    const descendants = [];
    const stack = [pid];
    const seen = new Set();
    while (stack.length > 0) {
      const current = stack.pop();
      if (seen.has(current)) continue;
      seen.add(current);
      for (const child of listDirectChildren(current)) {
        descendants.push(child);
        stack.push(child);
      }
    }
    return descendants;
  }

  const result = spawnSync("ps", ["-A", "-o", "pid=,ppid="], { encoding: "utf8" });
  if (result.status !== 0 || !result.stdout) {
    return [];
  }
  const children = new Map();
  for (const line of result.stdout.split("\n")) {
    const match = line.trim().match(/^(\d+)\s+(\d+)/);
    if (!match) continue;
    const childPid = Number(match[1]);
    const parentPid = Number(match[2]);
    if (!children.has(parentPid)) {
      children.set(parentPid, []);
    }
    children.get(parentPid).push(childPid);
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
    const descendants = Number.isFinite(brokerPid) ? discoverDescendants(brokerPid) : [];

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
    const leakedDescendants = descendants.filter((pid) => isPidAlive(pid));
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
