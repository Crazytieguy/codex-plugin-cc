import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

import { buildEnv, installFakeCodex } from "./fake-codex-fixture.mjs";
import { discoverDescendants, makeTempDir } from "./helpers.mjs";
import { ensureBrokerSession, sendBrokerShutdown } from "../plugins/codex/scripts/lib/broker-lifecycle.mjs";
import { parseBrokerEndpoint } from "../plugins/codex/scripts/lib/broker-endpoint.mjs";
import { BROKER_BUSY_RPC_CODE } from "../plugins/codex/scripts/lib/app-server.mjs";

function connectToBroker(endpoint) {
  const target = parseBrokerEndpoint(endpoint);
  const socket = net.createConnection({ path: target.path });
  socket.setEncoding("utf8");
  return socket;
}

function makeClient(socket) {
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
          reject(Object.assign(new Error(message.error.message), { rpcCode: message.error.code }));
        } else {
          resolve(message.result ?? {});
        }
      }
    }
  });

  function request(method, params) {
    const id = nextId++;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      socket.write(`${JSON.stringify({ id, method, params })}\n`);
    });
  }

  function notify(method, params) {
    socket.write(`${JSON.stringify({ method, params })}\n`);
  }

  return { request, notify };
}

async function waitFor(predicate, { timeoutMs = 2000, intervalMs = 25 } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const value = await predicate();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error("Timed out waiting for condition.");
}

function readFakeState(binDir) {
  const statePath = path.join(binDir, "fake-codex-state.json");
  if (!fs.existsSync(statePath)) return null;
  return JSON.parse(fs.readFileSync(statePath, "utf8"));
}

async function withBroker(behavior, fn) {
  const repo = makeTempDir();
  const binDir = makeTempDir();
  installFakeCodex(binDir, behavior);
  const env = buildEnv(binDir);
  const session = await ensureBrokerSession(repo, { env, timeoutMs: 15000 });
  assert.ok(session, "broker should start");
  try {
    await fn({ repo, binDir, session, env });
  } finally {
    try {
      await sendBrokerShutdown(session.endpoint, { timeoutMs: 500 });
    } catch {}
  }
}

test("broker forwards turn/interrupt when streaming client disconnects mid-stream", async () => {
  await withBroker("interruptible-slow-task", async ({ binDir, session }) => {
    const socket = connectToBroker(session.endpoint);
    await new Promise((resolve, reject) => {
      socket.once("connect", resolve);
      socket.once("error", reject);
    });

    const client = makeClient(socket);
    await client.request("initialize", { clientInfo: { name: "test" }, capabilities: {} });
    client.notify("initialized", {});

    const startResult = await client.request("thread/start", { cwd: "/tmp" });
    const threadId = startResult.thread.id;

    const turnResult = await client.request("turn/start", {
      threadId,
      input: [{ type: "text", text: "go" }]
    });
    const turnId = turnResult.turn.id;
    assert.equal(turnResult.turn.status, "inProgress");

    // Client disappears mid-stream. The broker should send turn/interrupt to
    // the upstream AppServer so it doesn't keep running an orphaned turn.
    socket.destroy();

    await waitFor(() => {
      const state = readFakeState(binDir);
      return state?.lastInterrupt?.turnId === turnId ? state : null;
    });

    const state = readFakeState(binDir);
    assert.equal(state.lastInterrupt.threadId, threadId);
    assert.equal(state.lastInterrupt.turnId, turnId);
  });
});

test("concurrent turn/start from a second socket gets BROKER_BUSY, not a shared stream", async () => {
  await withBroker("interruptible-slow-task", async ({ session }) => {
    async function connectClient() {
      const socket = connectToBroker(session.endpoint);
      await new Promise((resolve, reject) => {
        socket.once("connect", resolve);
        socket.once("error", reject);
      });
      const client = makeClient(socket);
      await client.request("initialize", { clientInfo: { name: "test" }, capabilities: {} });
      client.notify("initialized", {});
      return client;
    }

    const clientA = await connectClient();
    const clientB = await connectClient();

    const threadA = (await clientA.request("thread/start", { cwd: "/tmp" })).thread.id;
    // A completed non-streaming request must release the slot for other
    // sockets — otherwise this second thread/start would hang or get BUSY.
    const threadB = (await clientB.request("thread/start", { cwd: "/tmp" })).thread.id;

    // Fire both turn/start requests before either response arrives. Exactly
    // one may win the stream slot; the other must get BROKER_BUSY instead of
    // silently sharing the AppServer.
    const results = await Promise.allSettled([
      clientA.request("turn/start", { threadId: threadA, input: [{ type: "text", text: "go" }] }),
      clientB.request("turn/start", { threadId: threadB, input: [{ type: "text", text: "go" }] })
    ]);

    const winners = results.filter((r) => r.status === "fulfilled");
    const busy = results.filter(
      (r) => r.status === "rejected" && r.reason?.rpcCode === BROKER_BUSY_RPC_CODE
    );
    assert.equal(winners.length, 1, `expected exactly one winner, got: ${JSON.stringify(results)}`);
    assert.equal(busy.length, 1, `expected exactly one BROKER_BUSY rejection, got: ${JSON.stringify(results)}`);
    assert.equal(winners[0].value.turn.status, "inProgress");
  });
});

test("broker process exits when the upstream AppServer dies", async () => {
  await withBroker("review-ok", async ({ session }) => {
    assert.ok(Number.isFinite(session.pid), "broker should record its own pid");

    const descendants = discoverDescendants(session.pid);
    if (descendants === null) {
      // No process-listing backend on this platform; we can't kill the
      // AppServer directly without it. Skip the rest of the assertion.
      return;
    }

    const appServerPid = await waitFor(() => {
      const fresh = discoverDescendants(session.pid);
      return fresh && fresh.length > 0 ? fresh[0] : null;
    });

    process.kill(appServerPid, "SIGKILL");

    await waitFor(() => {
      try {
        process.kill(session.pid, 0);
        return false;
      } catch (error) {
        return error?.code === "ESRCH";
      }
    });
  });
});
