import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

import { buildEnv, installFakeCodex } from "./fake-codex-fixture.mjs";
import { initGitRepo, makeTempDir, run } from "./helpers.mjs";
import { ensureBrokerSession, sendBrokerShutdown } from "../plugins/codex/scripts/lib/broker-lifecycle.mjs";
import { parseBrokerEndpoint } from "../plugins/codex/scripts/lib/broker-endpoint.mjs";
import { createStallWatchdog } from "../plugins/codex/scripts/lib/stall-watchdog.mjs";
import { resolveJobLogFile, resolveJobsDir, resolveStateFile } from "../plugins/codex/scripts/lib/state.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = path.join(ROOT, "plugins", "codex", "scripts", "codex-companion.mjs");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function makeSinks() {
  const stdout = [];
  const log = [];
  return {
    stdout,
    log,
    writeLine: (line) => stdout.push(line),
    appendLog: (message) => log.push(message)
  };
}

function watchdogEnv(binDir, extra = {}) {
  return {
    ...buildEnv(binDir),
    CODEX_COMPANION_STALL_WARN_MS: "300",
    CODEX_COMPANION_STALL_REPEAT_MS: "10000",
    ...extra
  };
}

function initRepoWithChange(repo) {
  initGitRepo(repo);
  fs.mkdirSync(path.join(repo, "src"));
  fs.writeFileSync(path.join(repo, "src", "app.js"), "export const value = 1;\n");
  run("git", ["add", "src/app.js"], { cwd: repo });
  run("git", ["commit", "-m", "init"], { cwd: repo });
  fs.writeFileSync(path.join(repo, "src", "app.js"), "export const value = 2;\n");
}

// The unit tests below inject `now` and drive it manually, so warning
// decisions are deterministic regardless of CI scheduling; real waits only
// give the (fast) polling interval a chance to tick.
const TICK_MS = 50;

test("watchdog warns after silence and repeats on the repeat cadence", async () => {
  const sinks = makeSinks();
  let clock = 0;
  const watchdog = createStallWatchdog({
    jobId: "task-unit",
    warnMs: 100,
    repeatMs: 1000,
    checkIntervalMs: 10,
    quiet: false,
    now: () => clock,
    writeLine: sinks.writeLine,
    appendLog: sinks.appendLog
  });

  try {
    watchdog.start("direct");
    clock = 150;
    await sleep(TICK_MS);
    assert.equal(sinks.stdout.length, 1, sinks.stdout.join(""));
    assert.match(sinks.stdout[0], /no activity from Codex/);
    assert.match(sinks.stdout[0], /transport: direct/);
    assert.match(sinks.stdout[0], /job: task-unit/);
    assert.match(sinks.stdout[0], /last event: none since connect/);
    assert.equal(sinks.log.length, 1);

    clock = 500;
    await sleep(TICK_MS);
    assert.equal(sinks.stdout.length, 1, "warned again before the repeat cadence elapsed");

    clock = 1300;
    await sleep(TICK_MS);
    assert.equal(sinks.stdout.length, 2, sinks.stdout.join(""));
    assert.match(sinks.stdout[1], /still no activity from Codex/);
  } finally {
    watchdog.stop();
  }
});

test("watchdog touch resets the silence clock and records the last event", async () => {
  const sinks = makeSinks();
  let clock = 0;
  const watchdog = createStallWatchdog({
    jobId: "task-unit",
    warnMs: 200,
    repeatMs: 10000,
    checkIntervalMs: 10,
    now: () => clock,
    writeLine: sinks.writeLine,
    appendLog: sinks.appendLog
  });

  try {
    watchdog.start("broker");
    clock = 150;
    watchdog.touch("item/started");
    clock = 300;
    await sleep(TICK_MS);
    assert.equal(sinks.stdout.length, 0, sinks.stdout.join(""));
    clock = 400;
    await sleep(TICK_MS);
    assert.equal(sinks.stdout.length, 1);
    assert.match(sinks.stdout[0], /last event: item\/started/);
    assert.match(sinks.stdout[0], /transport: broker/);
  } finally {
    watchdog.stop();
  }
});

test("watchdog stays silent before start() and after stop()", async () => {
  const sinks = makeSinks();
  const watchdog = createStallWatchdog({
    warnMs: 50,
    repeatMs: 100,
    checkIntervalMs: 10,
    writeLine: sinks.writeLine,
    appendLog: sinks.appendLog
  });

  await sleep(150);
  assert.equal(sinks.stdout.length, 0);

  watchdog.start("direct");
  watchdog.stop();
  await sleep(150);
  assert.equal(sinks.stdout.length, 0);
});

test("watchdog quiet mode suppresses stdout but still logs", async () => {
  const sinks = makeSinks();
  const watchdog = createStallWatchdog({
    warnMs: 50,
    repeatMs: 10000,
    checkIntervalMs: 10,
    quiet: true,
    writeLine: sinks.writeLine,
    appendLog: sinks.appendLog
  });

  try {
    watchdog.start("direct");
    await sleep(150);
    assert.equal(sinks.stdout.length, 0);
    assert.ok(sinks.log.length >= 1);
  } finally {
    watchdog.stop();
  }
});

test("watchdog is disabled when warnMs is zero or negative", async () => {
  const sinks = makeSinks();
  const watchdog = createStallWatchdog({
    warnMs: 0,
    checkIntervalMs: 10,
    writeLine: sinks.writeLine,
    appendLog: sinks.appendLog
  });

  assert.equal(watchdog.enabled, false);
  watchdog.start("direct");
  await sleep(100);
  watchdog.touch("x");
  watchdog.stop();
  assert.equal(sinks.stdout.length, 0);
  assert.equal(sinks.log.length, 0);
});

test("watchdog sinks are independently best-effort", async () => {
  const stdout = [];
  const log = [];
  const throwingLog = createStallWatchdog({
    warnMs: 50,
    repeatMs: 10000,
    checkIntervalMs: 10,
    writeLine: (line) => stdout.push(line),
    appendLog: () => {
      throw new Error("log sink failed");
    }
  });
  const throwingStdout = createStallWatchdog({
    warnMs: 50,
    repeatMs: 10000,
    checkIntervalMs: 10,
    writeLine: () => {
      throw new Error("stdout sink failed");
    },
    appendLog: (message) => log.push(message)
  });

  try {
    throwingLog.start("direct");
    throwingStdout.start("direct");
    await sleep(150);
    assert.ok(stdout.length >= 1, "stdout warning suppressed by throwing log sink");
    assert.ok(log.length >= 1, "log warning suppressed by throwing stdout sink");
  } finally {
    throwingLog.stop();
    throwingStdout.stop();
  }
});

test("stalled task emits a stall warning on stdout and still completes", () => {
  const repo = makeTempDir();
  const binDir = makeTempDir();
  installFakeCodex(binDir, "stalled-task");
  initGitRepo(repo);

  const result = run("node", [SCRIPT, "task", "do the thing"], {
    cwd: repo,
    env: watchdogEnv(binDir)
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /no activity from Codex/);
  assert.match(result.stdout, /transport: (broker|direct), job: task-/);
  assert.match(result.stdout, /Task prompt accepted/);
});

test("stalled task with --json keeps stdout as clean JSON and warns only in the job log", () => {
  const repo = makeTempDir();
  const binDir = makeTempDir();
  installFakeCodex(binDir, "stalled-task");
  initGitRepo(repo);

  const result = run("node", [SCRIPT, "task", "do the thing", "--json"], {
    cwd: repo,
    env: watchdogEnv(binDir)
  });

  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.status, 0);
  assert.ok(payload.jobId, "task payload should include the job id");

  const logFile = resolveJobLogFile(repo, payload.jobId);
  const logContent = fs.readFileSync(logFile, "utf8");
  assert.match(logContent, /no activity from Codex/);
});

test("task --resume-last warns when thread discovery stalls and still resumes", () => {
  const repo = makeTempDir();
  const binDir = makeTempDir();
  installFakeCodex(binDir, "stalled-thread-list");
  initGitRepo(repo);
  const env = watchdogEnv(binDir);

  const first = run("node", [SCRIPT, "task", "do the thing"], { cwd: repo, env });
  assert.equal(first.status, 0, first.stderr);

  // Drop the tracked-job state (keep broker.json) so --resume-last has to
  // discover the persisted thread via the app-server's stalled thread/list.
  fs.rmSync(resolveStateFile(repo), { force: true });
  fs.rmSync(resolveJobsDir(repo), { recursive: true, force: true });

  const result = run("node", [SCRIPT, "task", "--resume-last"], { cwd: repo, env });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /no activity from Codex/);
  assert.match(result.stdout, /Resumed the prior run/);
});

test("task --resume-last --json logs a discovery-stall warning to the job log", () => {
  const repo = makeTempDir();
  const binDir = makeTempDir();
  installFakeCodex(binDir, "stalled-thread-list");
  initGitRepo(repo);
  const env = watchdogEnv(binDir);

  const first = run("node", [SCRIPT, "task", "do the thing"], { cwd: repo, env });
  assert.equal(first.status, 0, first.stderr);

  fs.rmSync(resolveStateFile(repo), { force: true });
  fs.rmSync(resolveJobsDir(repo), { recursive: true, force: true });

  const result = run("node", [SCRIPT, "task", "--resume-last", "--json"], { cwd: repo, env });

  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.status, 0);
  assert.ok(payload.jobId, "task payload should include the job id");

  const logContent = fs.readFileSync(resolveJobLogFile(repo, payload.jobId), "utf8");
  assert.match(logContent, /no activity from Codex/);
  assert.match(logContent, /job: task-/);
});

test("stalled native review emits a stall warning and still completes", () => {
  const repo = makeTempDir();
  const binDir = makeTempDir();
  installFakeCodex(binDir, "stalled-review");
  initRepoWithChange(repo);

  const result = run("node", [SCRIPT, "review"], {
    cwd: repo,
    env: watchdogEnv(binDir)
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /no activity from Codex/);
  assert.match(result.stdout, /Reviewed uncommitted changes/);
});

test("dead broker endpoint falls back to direct and warns during a stalled initialize", () => {
  const repo = makeTempDir();
  const binDir = makeTempDir();
  installFakeCodex(binDir, "stalled-initialize");
  initGitRepo(repo);

  const result = run("node", [SCRIPT, "task", "do the thing"], {
    cwd: repo,
    env: watchdogEnv(binDir, {
      CODEX_COMPANION_APP_SERVER_ENDPOINT: `unix:${path.join(makeTempDir(), "missing.sock")}`
    })
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /no activity from Codex/);
  assert.match(result.stdout, /transport: direct/);
  assert.match(result.stdout, /last event: none since connect/);
  assert.match(result.stdout, /Task prompt accepted/);
});

function makeRawBrokerClient(endpoint) {
  const target = parseBrokerEndpoint(endpoint);
  const socket = net.createConnection({ path: target.path });
  socket.setEncoding("utf8");
  const pending = new Map();
  let nextId = 1;
  let buffer = "";

  socket.on("data", (chunk) => {
    buffer += chunk;
    let nl = buffer.indexOf("\n");
    while (nl !== -1) {
      const line = buffer.slice(0, nl);
      buffer = buffer.slice(nl + 1);
      nl = buffer.indexOf("\n");
      if (!line.trim()) continue;
      const message = JSON.parse(line);
      if (message.id !== undefined && pending.has(message.id)) {
        const { resolve, reject } = pending.get(message.id);
        pending.delete(message.id);
        if (message.error) {
          reject(new Error(message.error.message));
        } else {
          resolve(message.result ?? {});
        }
      }
    }
  });

  return {
    socket,
    request(method, params = {}) {
      const id = nextId++;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        socket.write(`${JSON.stringify({ id, method, params })}\n`);
      });
    }
  };
}

test("busy broker falls back to a direct app-server and the warning reports the direct transport", async () => {
  const repo = makeTempDir();
  const binDir = makeTempDir();
  installFakeCodex(binDir, "interruptible-slow-task");
  initGitRepo(repo);
  const env = watchdogEnv(binDir, { CODEX_COMPANION_STALL_WARN_MS: "500" });

  const session = await ensureBrokerSession(repo, { env, timeoutMs: 15000 });
  assert.ok(session, "broker should start");

  const rawClient = makeRawBrokerClient(session.endpoint);
  try {
    await rawClient.request("initialize", { clientInfo: { name: "test" }, capabilities: {} });
    const thread = await rawClient.request("thread/start", { cwd: repo, ephemeral: true });
    // Occupies the broker: the interruptible turn stays inProgress for 5s.
    await rawClient.request("turn/start", {
      threadId: thread.thread.id,
      input: [{ type: "text", text: "hold the broker" }]
    });

    const result = run("node", [SCRIPT, "task", "do the thing"], {
      cwd: repo,
      env
    });

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /no activity from Codex/);
    assert.match(result.stdout, /transport: direct/);
    assert.match(result.stdout, /Task prompt accepted/);
  } finally {
    rawClient.socket.destroy();
    await sendBrokerShutdown(session.endpoint, { timeoutMs: 2000 });
  }
});
