import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { makeTempDir } from "./helpers.mjs";
import {
  listJobs,
  loadState,
  resolveStateDir,
  resolveStateFile,
  upsertJob,
  withStateLock
} from "../plugins/codex/scripts/lib/state.mjs";
import { runTrackedJob } from "../plugins/codex/scripts/lib/tracked-jobs.mjs";

const STATE_MODULE = fileURLToPath(new URL("../plugins/codex/scripts/lib/state.mjs", import.meta.url));

function stateLockPath(workspace) {
  return path.join(resolveStateDir(workspace), "state.lock");
}

test("resolveStateDir uses a temp-backed per-workspace directory", () => {
  const workspace = makeTempDir();
  const stateDir = resolveStateDir(workspace);

  assert.equal(stateDir.startsWith(os.tmpdir()), true);
  assert.match(path.basename(stateDir), /.+-[a-f0-9]{16}$/);
  assert.match(stateDir, new RegExp(`^${os.tmpdir().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
});

test("resolveStateDir uses CLAUDE_PLUGIN_DATA when it is provided", () => {
  const workspace = makeTempDir();
  const pluginDataDir = makeTempDir();
  const previousPluginDataDir = process.env.CLAUDE_PLUGIN_DATA;
  process.env.CLAUDE_PLUGIN_DATA = pluginDataDir;

  try {
    const stateDir = resolveStateDir(workspace);

    assert.equal(stateDir.startsWith(path.join(pluginDataDir, "state")), true);
    assert.match(path.basename(stateDir), /.+-[a-f0-9]{16}$/);
    assert.match(
      stateDir,
      new RegExp(`^${path.join(pluginDataDir, "state").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`)
    );
  } finally {
    if (previousPluginDataDir == null) {
      delete process.env.CLAUDE_PLUGIN_DATA;
    } else {
      process.env.CLAUDE_PLUGIN_DATA = previousPluginDataDir;
    }
  }
});


function withTempPluginData(t) {
  const pluginDataDir = makeTempDir();
  const previous = process.env.CLAUDE_PLUGIN_DATA;
  process.env.CLAUDE_PLUGIN_DATA = pluginDataDir;
  t.after(() => {
    if (previous == null) {
      delete process.env.CLAUDE_PLUGIN_DATA;
    } else {
      process.env.CLAUDE_PLUGIN_DATA = previous;
    }
  });
}

test("state writes are atomic and leave no temp files behind", (t) => {
  withTempPluginData(t);
  const workspace = makeTempDir();

  upsertJob(workspace, { id: "job-a", status: "running" });
  upsertJob(workspace, { id: "job-b", status: "completed" });

  const stateDir = resolveStateDir(workspace);
  const leftovers = fs.readdirSync(stateDir).filter((name) => name.includes(".tmp-"));
  assert.deepEqual(leftovers, []);
  assert.deepEqual(
    listJobs(workspace).map((job) => job.id).sort(),
    ["job-a", "job-b"]
  );
});

test("withStateLock steals a lock held by a dead process", (t) => {
  withTempPluginData(t);
  const workspace = makeTempDir();

  upsertJob(workspace, { id: "seed", status: "running" });
  const dead = spawnSync(process.execPath, ["-e", ""], { encoding: "utf8" });
  assert.equal(dead.status, 0);
  fs.writeFileSync(stateLockPath(workspace), String(dead.pid), "utf8");

  const result = withStateLock(workspace, () => "ran");
  assert.equal(result, "ran");
  assert.equal(fs.existsSync(stateLockPath(workspace)), false);
});

test("state mutations throw on lock timeout without writing", (t) => {
  withTempPluginData(t);
  const workspace = makeTempDir();

  upsertJob(workspace, { id: "existing", status: "completed" });
  const stateFile = resolveStateFile(workspace);
  const before = fs.readFileSync(stateFile, "utf8");

  // Hold the lock with our own (live) pid so acquisition cannot steal it.
  fs.writeFileSync(stateLockPath(workspace), String(process.pid), "utf8");
  process.env.CODEX_COMPANION_STATE_LOCK_TIMEOUT_MS = "100";
  t.after(() => {
    delete process.env.CODEX_COMPANION_STATE_LOCK_TIMEOUT_MS;
    fs.rmSync(stateLockPath(workspace), { force: true });
  });

  assert.throws(() => upsertJob(workspace, { id: "new-job", status: "running" }), /Timed out waiting for lock/);
  assert.equal(fs.readFileSync(stateFile, "utf8"), before);
});

test("concurrent upsertJob writers lose no updates", async (t) => {
  withTempPluginData(t);
  const workspace = makeTempDir();
  const jobCount = 6;

  const children = [];
  for (let i = 0; i < jobCount; i += 1) {
    const script = `import(${JSON.stringify(STATE_MODULE)}).then((state) => {
      state.upsertJob(${JSON.stringify(workspace)}, { id: "job-${i}", status: "running" });
    });`;
    children.push(
      new Promise((resolve, reject) => {
        const child = spawn(process.execPath, ["--input-type=module", "-e", script], {
          env: process.env,
          stdio: ["ignore", "ignore", "pipe"]
        });
        let stderr = "";
        child.stderr.on("data", (chunk) => {
          stderr += chunk;
        });
        child.on("exit", (code) =>
          code === 0 ? resolve() : reject(new Error(`writer ${i} exited ${code}: ${stderr}`))
        );
        child.on("error", reject);
      })
    );
  }
  await Promise.all(children);

  const ids = listJobs(workspace).map((job) => job.id).sort();
  assert.deepEqual(ids, Array.from({ length: jobCount }, (_, i) => `job-${i}`).sort());
});

test("runTrackedJob preserves a stored success when the state index is lock-blocked", async (t) => {
  withTempPluginData(t);
  const workspace = makeTempDir();

  process.env.CODEX_COMPANION_STATE_LOCK_TIMEOUT_MS = "100";
  t.after(() => {
    delete process.env.CODEX_COMPANION_STATE_LOCK_TIMEOUT_MS;
    fs.rmSync(stateLockPath(workspace), { force: true });
  });

  const job = { id: "job-locked", workspaceRoot: workspace, title: "Test job" };
  const execution = await runTrackedJob(job, async () => {
    // Take the state lock (as a live foreign holder) after the initial
    // "running" upsert, so only the completion index update is blocked.
    fs.writeFileSync(stateLockPath(workspace), String(process.pid), "utf8");
    return { exitStatus: 0, payload: { ok: true }, rendered: "done", summary: "done" };
  });

  assert.equal(execution.exitStatus, 0);
  const jobFile = path.join(resolveStateDir(workspace), "jobs", "job-locked.json");
  const stored = JSON.parse(fs.readFileSync(jobFile, "utf8"));
  assert.equal(stored.status, "completed");
  assert.deepEqual(stored.result, { ok: true });

  // The index couldn't be updated (lock held), but the run must not be
  // converted into a failure.
  fs.rmSync(stateLockPath(workspace), { force: true });
  const state = loadState(workspace);
  const indexed = state.jobs.find((entry) => entry.id === "job-locked");
  assert.equal(indexed.status, "running");
});

test("contended stale-lock stealing preserves mutual exclusion", async (t) => {
  withTempPluginData(t);
  const workspace = makeTempDir();
  const writerCount = 6;

  // Seed a stale lock from a dead process so every writer enters the steal
  // path concurrently; a broken steal lets two writers mutate at once and
  // lose an increment.
  upsertJob(workspace, { id: "seed", status: "running" });
  const dead = spawnSync(process.execPath, ["-e", ""], { encoding: "utf8" });
  fs.writeFileSync(stateLockPath(workspace), String(dead.pid), "utf8");

  const children = [];
  for (let i = 0; i < writerCount; i += 1) {
    const script = `import(${JSON.stringify(STATE_MODULE)}).then((state) => {
      state.updateState(${JSON.stringify(workspace)}, (s) => {
        s.config.counter = (s.config.counter ?? 0) + 1;
      });
    });`;
    children.push(
      new Promise((resolve, reject) => {
        const child = spawn(process.execPath, ["--input-type=module", "-e", script], {
          env: process.env,
          stdio: ["ignore", "ignore", "pipe"]
        });
        let stderr = "";
        child.stderr.on("data", (chunk) => {
          stderr += chunk;
        });
        child.on("exit", (code) =>
          code === 0 ? resolve() : reject(new Error(`writer ${i} exited ${code}: ${stderr}`))
        );
        child.on("error", reject);
      })
    );
  }
  await Promise.all(children);

  assert.equal(loadState(workspace).config.counter, writerCount);
});
