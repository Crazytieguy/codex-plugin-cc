import net from "node:net";
import test from "node:test";
import assert from "node:assert/strict";

import { buildEnv, installFakeCodex } from "./fake-codex-fixture.mjs";
import { isPidAlive, makeTempDir, waitFor } from "./helpers.mjs";
import { ensureBrokerSession, sendBrokerShutdown } from "../plugins/codex/scripts/lib/broker-lifecycle.mjs";
import { parseBrokerEndpoint } from "../plugins/codex/scripts/lib/broker-endpoint.mjs";

function connectToBroker(endpoint) {
  const target = parseBrokerEndpoint(endpoint);
  const socket = net.createConnection({ path: target.path });
  socket.setEncoding("utf8");
  return socket;
}

async function startBroker({ idleTimeoutMs } = {}) {
  const repo = makeTempDir();
  const binDir = makeTempDir();
  installFakeCodex(binDir);
  const env = { ...buildEnv(binDir) };
  if (idleTimeoutMs !== undefined) {
    env.CODEX_COMPANION_BROKER_IDLE_TIMEOUT_MS = String(idleTimeoutMs);
  }
  const session = await ensureBrokerSession(repo, { env, timeoutMs: 15000 });
  assert.ok(session, "broker should start");
  return { repo, binDir, env, session };
}

test("broker exits on its own after the idle timeout", async () => {
  const { session } = await startBroker({ idleTimeoutMs: 250 });

  // ensureBrokerSession's readiness probes disconnect immediately, so the
  // broker is already idle. It must reap itself without any external teardown.
  await waitFor(() => !isPidAlive(session.pid));
});

test("broker does not idle-exit while a client is connected", async () => {
  const { session } = await startBroker({ idleTimeoutMs: 250 });

  const socket = connectToBroker(session.endpoint);
  await new Promise((resolve, reject) => {
    socket.once("connect", resolve);
    socket.once("error", reject);
  });

  await new Promise((resolve) => setTimeout(resolve, 800));
  assert.equal(isPidAlive(session.pid), true, "broker must stay up while a client is connected");

  socket.destroy();
  await waitFor(() => !isPidAlive(session.pid));
});

test("concurrent ensureBrokerSession calls converge on a single broker", async () => {
  const repo = makeTempDir();
  const binDir = makeTempDir();
  installFakeCodex(binDir);
  const env = buildEnv(binDir);

  const sessions = await Promise.all([
    ensureBrokerSession(repo, { env, timeoutMs: 15000 }),
    ensureBrokerSession(repo, { env, timeoutMs: 15000 }),
    ensureBrokerSession(repo, { env, timeoutMs: 15000 })
  ]);

  try {
    for (const session of sessions) {
      assert.ok(session, "every caller should get a broker session");
    }
    const endpoints = new Set(sessions.map((session) => session.endpoint));
    const pids = new Set(sessions.map((session) => session.pid));
    assert.equal(endpoints.size, 1, `expected one endpoint, got ${[...endpoints].join(", ")}`);
    assert.equal(pids.size, 1, `expected one broker pid, got ${[...pids].join(", ")}`);
  } finally {
    const endpoint = sessions.find((session) => session?.endpoint)?.endpoint;
    if (endpoint) {
      await sendBrokerShutdown(endpoint, { timeoutMs: 500 });
    }
  }
});
