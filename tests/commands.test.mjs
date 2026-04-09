import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PLUGIN_ROOT = path.join(ROOT, "plugins", "codex");

function read(relativePath) {
  return fs.readFileSync(path.join(PLUGIN_ROOT, relativePath), "utf8");
}

function exists(relativePath) {
  return fs.existsSync(path.join(PLUGIN_ROOT, relativePath));
}

test("only setup command remains", () => {
  const commandFiles = fs.readdirSync(path.join(PLUGIN_ROOT, "commands")).sort();
  assert.deepEqual(commandFiles, ["setup.md"]);
});

test("deleted files do not exist", () => {
  assert.ok(!exists("commands/review.md"));
  assert.ok(!exists("commands/rescue.md"));
  assert.ok(!exists("agents"));
  assert.ok(!exists("skills/codex-cli-runtime"));
  assert.ok(!exists("skills/codex-result-handling"));
  assert.ok(!exists("scripts/stop-review-gate-hook.mjs"));
  assert.ok(!exists("prompts/stop-review-gate.md"));
});

test("hooks.json has only SessionStart and SessionEnd", () => {
  const hooksJson = JSON.parse(read("hooks/hooks.json"));
  const events = Object.keys(hooksJson.hooks);
  assert.deepEqual(events.sort(), ["SessionEnd", "SessionStart"]);
});

test("gpt-5-4-prompting skill references codex-companion task", () => {
  const skill = read("skills/gpt-5-4-prompting/SKILL.md");
  assert.doesNotMatch(skill, /rescue/i);
  assert.match(skill, /codex-companion task/);
});

test("hook-setup skill exists with templates", () => {
  assert.ok(exists("skills/hook-setup/SKILL.md"));
  assert.ok(exists("skills/hook-setup/templates/plan-write-reminder.mjs"));
  assert.ok(exists("skills/hook-setup/templates/simplify-reminder.mjs"));
  assert.ok(exists("skills/hook-setup/templates/git-add-reminder.mjs"));
  assert.ok(exists("skills/hook-setup/templates/exit-plan-mode-enforce.mjs"));
  assert.ok(exists("skills/hook-setup/templates/git-commit-enforce.mjs"));
});

test("plan-review subcommand exists in codex-companion", () => {
  const source = read("scripts/codex-companion.mjs");
  assert.match(source, /case "plan-review":/);
});

test("wrapper script and session-start hook exist", () => {
  assert.ok(exists("scripts/codex-companion"));
  assert.ok(exists("hooks/session-start.sh"));
});
