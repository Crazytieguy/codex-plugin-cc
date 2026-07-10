#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { terminateProcessTree } from "./lib/process.mjs";
import { getCodexAvailability } from "./lib/codex.mjs";
import { getUsageText } from "./lib/help.mjs";
import { loadState, readJobFile, resolveJobFile } from "./lib/state.mjs";
import { resolveWorkspaceRoot } from "./lib/workspace.mjs";

export const SESSION_ID_ENV = "CODEX_COMPANION_SESSION_ID";
const PLUGIN_DATA_ENV = "CLAUDE_PLUGIN_DATA";
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));

// Documented SessionEnd reasons that mean the session is genuinely over.
// SessionEnd also fires when a session is merely saved for later resumption
// (reason "resume"), and background-session supervisor kills are undocumented
// (likely "other") — fail closed and leave jobs running for those. Job
// processes are single-task and self-terminating, so a skipped termination
// only means a job runs to natural completion.
const FINAL_SESSION_END_REASONS = new Set([
  "clear",
  "logout",
  "prompt_input_exit",
  "bypass_permissions_disabled"
]);

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
    // "queued" is legacy from pre-1.0.12 --background workers; still terminate any orphan PID.
    if (job.status !== "running" && job.status !== "queued") {
      continue;
    }
    // The index can miss a completion update (lock contention at job end).
    // Don't signal a pid whose job file already shows a terminal state — the
    // worker exited and the OS may have recycled its pid.
    try {
      const storedStatus = readJobFile(resolveJobFile(workspaceRoot, job.id))?.status ?? null;
      if (storedStatus && storedStatus !== "running" && storedStatus !== "queued") {
        continue;
      }
    } catch {
      // No job file or unreadable — fall through to terminate.
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

  // Always run env/PATH writes — desktop rewind forks the session (new session id,
  // fresh empty env dir) and fires SessionStart with source="resume"; skipping writes
  // there leaves `codex-companion` off PATH for the remainder of that session.
  appendEnvVar(SESSION_ID_ENV, input.session_id);
  appendEnvVar("CODEX_COMPANION_DATA_DIR", process.env[PLUGIN_DATA_ENV]);
  appendEnvVar("CLAUDE_PROJECT_DIR", process.env.CLAUDE_PROJECT_DIR);
  appendEnvPath(SCRIPT_DIR);

  // On resume the conversation context is preserved, so don't re-emit the status
  // systemMessage or re-inject the help text.
  if (source === "resume") {
    return;
  }

  // Check codex availability
  const cwd = input.cwd || process.cwd();
  const availability = getCodexAvailability(cwd);
  const ready = availability.available;

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

  // The /simplify skill was renamed to /code-review; old hook scripts no longer fire.
  // Remove this check a release or two after 1.0.19.
  const staleScript = path.join(cwd, ".claude", "scripts", "simplify-reminder.mjs");
  const hooksOutdated = fs.existsSync(staleScript);

  const statusMsg = hooksOutdated
    ? "\u001b[1;34mcodex:\u001b[0m hook scripts out of date (/simplify renamed to /code-review), re-run \u001b[1;35m/codex:setup\u001b[0m"
    : setupRan
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

function handleSessionEnd(input) {
  // The workspace-shared broker is deliberately NOT touched here: SessionEnd
  // fires for sessions that aren't done and never fires for others, and other
  // live sessions may be streaming through the broker. The broker reaps itself
  // via its idle timeout (see app-server-broker.mjs).
  if (!FINAL_SESSION_END_REASONS.has(input.reason)) {
    return;
  }
  const cwd = input.cwd || process.cwd();
  terminateSessionProcesses(cwd, input.session_id || process.env[SESSION_ID_ENV]);
}

async function main() {
  const input = readHookInput();
  const eventName = process.argv[2] ?? input.hook_event_name ?? "";

  if (eventName === "SessionStart") {
    handleSessionStart(input);
    return;
  }

  if (eventName === "SessionEnd") {
    handleSessionEnd(input);
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
