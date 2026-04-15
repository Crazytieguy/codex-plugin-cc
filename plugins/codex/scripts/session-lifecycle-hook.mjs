#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { terminateProcessTree } from "./lib/process.mjs";
import { BROKER_ENDPOINT_ENV } from "./lib/app-server.mjs";
import {
  clearBrokerSession,
  LOG_FILE_ENV,
  loadBrokerSession,
  PID_FILE_ENV,
  sendBrokerShutdown,
  teardownBrokerSession
} from "./lib/broker-lifecycle.mjs";
import { getCodexLoginStatus } from "./lib/codex.mjs";
import { getUsageText } from "./lib/help.mjs";
import { loadState } from "./lib/state.mjs";
import { resolveWorkspaceRoot } from "./lib/workspace.mjs";

export const SESSION_ID_ENV = "CODEX_COMPANION_SESSION_ID";
const PLUGIN_DATA_ENV = "CLAUDE_PLUGIN_DATA";
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));

function readHookInput() {
  const raw = fs.readFileSync(0, "utf8").trim();
  if (!raw) {
    return {};
  }
  return JSON.parse(raw);
}

function shellEscape(value) {
  return `'${String(value).replace(/'/g, `'\"'\"'`)}'`;
}

function appendEnvVar(name, value) {
  if (!process.env.CLAUDE_ENV_FILE || value == null || value === "") {
    return;
  }
  fs.appendFileSync(process.env.CLAUDE_ENV_FILE, `export ${name}=${shellEscape(value)}\n`, "utf8");
}

function appendEnvPath(dir) {
  if (!process.env.CLAUDE_ENV_FILE || !dir) {
    return;
  }
  fs.appendFileSync(process.env.CLAUDE_ENV_FILE, `export PATH="${dir}:$PATH"\n`, "utf8");
}

function getHelpText() {
  return getUsageText();
}

function terminateSessionProcesses(cwd, sessionId) {
  if (!cwd || !sessionId) {
    return;
  }

  const workspaceRoot = resolveWorkspaceRoot(cwd);
  const state = loadState(workspaceRoot);
  for (const job of state.jobs) {
    if (job.sessionId !== sessionId) {
      continue;
    }
    if (job.status !== "queued" && job.status !== "running") {
      continue;
    }
    try {
      terminateProcessTree(job.pid ?? Number.NaN);
    } catch {
      // Ignore teardown failures during session shutdown.
    }
  }
}

function handleSessionStart(input) {
  const source = input.source ?? "startup";

  // On resume, context window is intact and CLAUDE_ENV_FILE can't be overwritten.
  if (source === "resume") {
    return;
  }

  // Process setup: env vars and PATH
  appendEnvVar(SESSION_ID_ENV, input.session_id);
  appendEnvVar("CODEX_COMPANION_DATA_DIR", process.env[PLUGIN_DATA_ENV]);
  appendEnvVar("CLAUDE_PROJECT_DIR", process.env.CLAUDE_PROJECT_DIR);
  appendEnvPath(SCRIPT_DIR);

  // Check codex availability
  const cwd = input.cwd || process.cwd();
  const authStatus = getCodexLoginStatus(cwd);
  const ready = authStatus.available && authStatus.loggedIn;

  if (!ready) {
    const output = {
      systemMessage: "\u001b[1;34mcodex:\u001b[0m not configured, run \u001b[1;35m/codex:setup\u001b[0m"
    };
    process.stdout.write(`${JSON.stringify(output)}\n`);
    return;
  }

  // Check if setup has been run
  const pluginDataDir = process.env[PLUGIN_DATA_ENV];
  const setupRanFile = pluginDataDir ? path.join(pluginDataDir, "setup-ran") : null;
  const setupRan = setupRanFile && fs.existsSync(setupRanFile);

  const statusMsg = setupRan
    ? "\u001b[1;34mcodex:\u001b[0m available"
    : "\u001b[1;34mcodex:\u001b[0m run \u001b[1;35m/codex:setup\u001b[0m to configure";

  const helpText = getHelpText();
  const additionalContext = helpText ? `## codex-companion\n\n${helpText}` : "";

  const output = {
    systemMessage: statusMsg,
    ...(additionalContext ? {
      hookSpecificOutput: {
        hookEventName: "SessionStart",
        additionalContext
      }
    } : {})
  };
  process.stdout.write(`${JSON.stringify(output)}\n`);
}

async function handleSessionEnd(input) {
  const cwd = input.cwd || process.cwd();
  const brokerSession =
    loadBrokerSession(cwd) ??
    (process.env[BROKER_ENDPOINT_ENV]
      ? {
          endpoint: process.env[BROKER_ENDPOINT_ENV],
          pidFile: process.env[PID_FILE_ENV] ?? null,
          logFile: process.env[LOG_FILE_ENV] ?? null
        }
      : null);
  const brokerEndpoint = brokerSession?.endpoint ?? null;
  const pidFile = brokerSession?.pidFile ?? null;
  const logFile = brokerSession?.logFile ?? null;
  const sessionDir = brokerSession?.sessionDir ?? null;
  const pid = brokerSession?.pid ?? null;

  if (brokerEndpoint) {
    await sendBrokerShutdown(brokerEndpoint);
  }

  terminateSessionProcesses(cwd, input.session_id || process.env[SESSION_ID_ENV]);
  teardownBrokerSession({
    endpoint: brokerEndpoint,
    pidFile,
    logFile,
    sessionDir,
    pid,
    killProcess: terminateProcessTree
  });
  clearBrokerSession(cwd);
}

async function main() {
  const input = readHookInput();
  const eventName = process.argv[2] ?? input.hook_event_name ?? "";

  if (eventName === "SessionStart") {
    handleSessionStart(input);
    return;
  }

  if (eventName === "SessionEnd") {
    await handleSessionEnd(input);
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
