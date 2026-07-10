#!/usr/bin/env node

import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import process from "node:process";

import { parseArgs } from "./lib/args.mjs";
import { BROKER_BUSY_RPC_CODE, CodexAppServerClient } from "./lib/app-server.mjs";
import { parseBrokerEndpoint } from "./lib/broker-endpoint.mjs";

function buildJsonRpcError(code, message, data) {
  return data === undefined ? { code, message } : { code, message, data };
}

function send(socket, message) {
  if (socket.destroyed) {
    return;
  }
  socket.write(`${JSON.stringify(message)}\n`);
}

function writePidFile(pidFile) {
  if (!pidFile) {
    return;
  }
  fs.mkdirSync(path.dirname(pidFile), { recursive: true });
  fs.writeFileSync(pidFile, `${process.pid}\n`, "utf8");
}

async function main() {
  const [subcommand, ...argv] = process.argv.slice(2);
  if (subcommand !== "serve") {
    throw new Error("Usage: node scripts/app-server-broker.mjs serve --endpoint <value> [--cwd <path>] [--pid-file <path>]");
  }

  const { options } = parseArgs(argv, {
    valueOptions: ["cwd", "pid-file", "endpoint"]
  });

  if (!options.endpoint) {
    throw new Error("Missing required --endpoint.");
  }

  const cwd = options.cwd ? path.resolve(process.cwd(), options.cwd) : process.cwd();
  const endpoint = String(options.endpoint);
  const listenTarget = parseBrokerEndpoint(endpoint);
  const pidFile = options["pid-file"] ? path.resolve(options["pid-file"]) : null;
  writePidFile(pidFile);

  const appClient = await CodexAppServerClient.connect(cwd, { disableBroker: true });
  const sockets = new Set();

  // The broker forwards one streaming turn at a time. While `activeStream` is
  // set, only its owning socket may send non-interrupt requests; everyone else
  // gets BROKER_BUSY and the `withAppServer` fallback spawns a direct AppServer.
  let activeStream = null;
  // Shape: { socket, threadIds: Set<string>, primaryThreadId: string, turnId: string }

  // The broker owns its own lifetime: SessionEnd hooks are best-effort (they can
  // fire for sessions that aren't done, or never fire at all for background
  // sessions), so nothing external tears the broker down. Instead it exits on
  // its own after sitting idle — no client sockets, no in-flight stream.
  const idleTimeoutRaw = Number.parseInt(
    process.env.CODEX_COMPANION_BROKER_IDLE_TIMEOUT_MS ?? "",
    10
  );
  const idleTimeoutMs = Number.isFinite(idleTimeoutRaw) ? idleTimeoutRaw : 30 * 60 * 1000;
  let idleTimer = null;

  function disarmIdleTimer() {
    if (idleTimer) {
      clearTimeout(idleTimer);
      idleTimer = null;
    }
  }

  function armIdleTimer() {
    if (idleTimeoutMs <= 0 || idleTimer || sockets.size > 0 || activeStream) {
      return;
    }
    idleTimer = setTimeout(() => {
      idleTimer = null;
      // Re-check: a client may have connected (or a stream started) since the
      // timer was armed without the disarm having cleared this callback.
      if (shuttingDown || sockets.size > 0 || activeStream) {
        return;
      }
      shutdown(server).finally(() => process.exit(0));
    }, idleTimeoutMs);
    idleTimer.unref();
  }

  function clearActiveStream() {
    activeStream = null;
    armIdleTimer();
  }

  function routeNotification(message) {
    if (!activeStream) {
      return;
    }
    send(activeStream.socket, message);
    if (message.method === "turn/completed") {
      const threadId = message.params?.threadId ?? null;
      if (threadId && activeStream.threadIds.has(threadId)) {
        clearActiveStream();
      }
    }
  }

  let shuttingDown = false;
  async function shutdown(server) {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    disarmIdleTimer();
    for (const socket of sockets) {
      socket.end();
    }
    await appClient.close().catch(() => {});
    await new Promise((resolve) => server.close(resolve));
    if (listenTarget.kind === "unix" && fs.existsSync(listenTarget.path)) {
      fs.unlinkSync(listenTarget.path);
    }
    if (pidFile && fs.existsSync(pidFile)) {
      fs.unlinkSync(pidFile);
      // The session dir (a mkdtemp holding pid/log/socket) would otherwise
      // accumulate one leftover per broker lifetime — nothing external cleans
      // it when the broker exits on its own. Log removal is safe: our stdio
      // fd stays valid after unlink.
      const sessionDir = path.dirname(pidFile);
      try {
        fs.unlinkSync(path.join(sessionDir, "broker.log"));
      } catch {
        // Log may already be gone.
      }
      try {
        fs.rmdirSync(sessionDir);
      } catch {
        // Non-empty or already removed.
      }
    }
  }

  appClient.setNotificationHandler(routeNotification);

  const server = net.createServer((socket) => {
    if (shuttingDown) {
      socket.destroy();
      return;
    }
    sockets.add(socket);
    disarmIdleTimer();
    socket.setEncoding("utf8");
    let buffer = "";
    let pending = Promise.resolve();

    function enqueue(work) {
      pending = pending.then(work).catch(() => {});
    }

    async function handleMessage(message) {
      if (message.id !== undefined && message.method === "initialize") {
        send(socket, {
          id: message.id,
          result: { userAgent: "codex-companion-broker" }
        });
        return;
      }

      if (message.method === "initialized" && message.id === undefined) {
        return;
      }

      if (message.id !== undefined && message.method === "broker/shutdown") {
        send(socket, { id: message.id, result: {} });
        await shutdown(server);
        process.exit(0);
      }

      if (message.id === undefined) {
        return;
      }

      // turn/interrupt is idempotent on the AppServer; always forward.
      if (message.method === "turn/interrupt") {
        try {
          const result = await appClient.request(message.method, message.params ?? {});
          send(socket, { id: message.id, result });
        } catch (error) {
          send(socket, {
            id: message.id,
            error: buildJsonRpcError(error.rpcCode ?? -32000, error.message)
          });
        }
        return;
      }

      if (activeStream && activeStream.socket !== socket) {
        send(socket, {
          id: message.id,
          error: buildJsonRpcError(BROKER_BUSY_RPC_CODE, "Shared Codex broker is busy.")
        });
        return;
      }

      // Reserve the slot before awaiting the upstream request, otherwise a
      // request from another socket can pass the busy check while this one is
      // still in flight and both end up sharing the AppServer.
      let reservation = null;
      if (!activeStream) {
        reservation = { socket, threadIds: new Set(), primaryThreadId: null, turnId: null };
        activeStream = reservation;
      }

      try {
        const params = message.params ?? {};
        const result = await appClient.request(message.method, params);
        send(socket, { id: message.id, result });

        const turn = result?.turn;
        if (turn?.id && turn?.status === "inProgress") {
          const primaryThreadId =
            message.method === "review/start" && result.reviewThreadId
              ? result.reviewThreadId
              : params.threadId ?? null;
          const threadIds = new Set();
          if (params.threadId) {
            threadIds.add(params.threadId);
          }
          if (result.reviewThreadId) {
            threadIds.add(result.reviewThreadId);
          }
          if (primaryThreadId) {
            activeStream = {
              socket,
              threadIds,
              primaryThreadId,
              turnId: turn.id
            };
          }
        }
      } catch (error) {
        send(socket, {
          id: message.id,
          error: buildJsonRpcError(error.rpcCode ?? -32000, error.message)
        });
      } finally {
        // Release the reservation unless this request started a streaming
        // turn (which replaced it). Without this, the first non-streaming
        // request would lock the broker to its socket forever.
        if (reservation && activeStream === reservation) {
          clearActiveStream();
        }
      }
    }

    socket.on("data", (chunk) => {
      buffer += chunk;
      let newlineIndex = buffer.indexOf("\n");
      while (newlineIndex !== -1) {
        const line = buffer.slice(0, newlineIndex);
        buffer = buffer.slice(newlineIndex + 1);
        newlineIndex = buffer.indexOf("\n");

        if (!line.trim()) {
          continue;
        }

        let message;
        try {
          message = JSON.parse(line);
        } catch (error) {
          send(socket, {
            id: null,
            error: buildJsonRpcError(-32700, `Invalid JSON: ${error.message}`)
          });
          continue;
        }

        enqueue(() => handleMessage(message));
      }
    });

    function handleSocketClose() {
      sockets.delete(socket);
      if (activeStream && activeStream.socket === socket) {
        const { primaryThreadId, turnId } = activeStream;
        clearActiveStream();
        // Best-effort: tell the AppServer the in-flight turn is abandoned so it
        // doesn't keep running an orphan after the client disappears. A bare
        // reservation (request still in flight, no turn yet) has nothing to
        // interrupt.
        if (primaryThreadId && turnId) {
          appClient
            .request("turn/interrupt", { threadId: primaryThreadId, turnId })
            .catch(() => {});
        }
      }
      armIdleTimer();
    }

    socket.on("close", handleSocketClose);
    socket.on("error", handleSocketClose);
  });

  process.on("SIGTERM", async () => {
    await shutdown(server);
    process.exit(0);
  });

  process.on("SIGINT", async () => {
    await shutdown(server);
    process.exit(0);
  });

  // If the upstream AppServer dies, the broker has nothing to do. Exit so the
  // next client respawns a fresh broker (ensureBrokerSession detects the dead
  // endpoint, tears down stale state, and spawns again).
  appClient.exitPromise.then(() => {
    if (shuttingDown) {
      return;
    }
    shutdown(server).finally(() => process.exit(1));
  });

  server.listen(listenTarget.path);
  armIdleTimer();
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
