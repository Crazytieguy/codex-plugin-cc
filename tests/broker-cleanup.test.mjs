import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

import { buildEnv, installFakeCodex } from "./fake-codex-fixture.mjs";
import {
  cleanupTrackedBrokers,
  discoverDescendants,
  initGitRepo,
  makeTempDir,
  run
} from "./helpers.mjs";
import { loadBrokerSession } from "../plugins/codex/scripts/lib/broker-lifecycle.mjs";
import { parseBrokerEndpoint } from "../plugins/codex/scripts/lib/broker-endpoint.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = path.join(ROOT, "plugins", "codex", "scripts", "codex-companion.mjs");

async function waitFor(predicate, { timeoutMs = 5000, intervalMs = 50 } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const value = await predicate();
    if (value) {
      return value;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error("Timed out waiting for condition.");
}

test("cleanupTrackedBrokers tears down broker and child app-server", async () => {
  const repo = makeTempDir();
  const binDir = makeTempDir();
  installFakeCodex(binDir);
  initGitRepo(repo);
  fs.writeFileSync(path.join(repo, "README.md"), "hello\n");
  run("git", ["add", "README.md"], { cwd: repo });
  run("git", ["commit", "-m", "init"], { cwd: repo });
  fs.writeFileSync(path.join(repo, "README.md"), "hello again\n");

  const env = buildEnv(binDir);
  const review = run("node", [SCRIPT, "review"], { cwd: repo, env });
  assert.equal(review.status, 0, review.stderr);

  const session = loadBrokerSession(repo);
  if (!session) {
    return;
  }
  assert.ok(Number.isFinite(session.pid), "broker session should record a pid");

  const descendants = await waitFor(
    () => {
      const found = discoverDescendants(session.pid);
      return found.length > 0 ? found : null;
    },
    { timeoutMs: 5000 }
  );
  assert.ok(descendants.length >= 1, "broker should have at least one live descendant");

  await cleanupTrackedBrokers();

  assert.throws(() => process.kill(session.pid, 0), (error) => error.code === "ESRCH");
  for (const pid of descendants) {
    assert.throws(() => process.kill(pid, 0), (error) => error.code === "ESRCH");
  }

  const parsed = parseBrokerEndpoint(session.endpoint);
  if (parsed.kind === "unix") {
    assert.equal(fs.existsSync(parsed.path), false, "unix endpoint socket file should be gone");
  }

  assert.equal(loadBrokerSession(repo), null, "session state should be cleared");
});
