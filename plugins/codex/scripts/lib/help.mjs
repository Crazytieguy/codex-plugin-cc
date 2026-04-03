export function getUsageText() {
  return `codex-companion — Codex reviews and tasks from Claude Code.

Review commands:

  review [--base <ref>] [--scope <auto|working-tree|branch>] [--model <model>] [--json]
    Comprehensive code review via Codex's built-in reviewer. Slower, thorough.
    Defaults to uncommitted changes; --base <ref> for branch review. Read-only.

  adversarial-review [--base <ref>] [--scope <auto|working-tree|branch>] [--model <model>] [--json] [focus text]
    Targeted review challenging design choices, tradeoffs, and assumptions.
    Faster than review. Optional focus text steers the critique. Read-only.

  plan-review <file> [--model <model>]
    Adversarial review of a plan file. Codex reads plan content and inspects referenced files.
    Use before exiting plan mode.

Other commands (run codex-companion help <command> for details):

  task      Delegate work to Codex (investigation, diagnosis, implementation).
  status    Show running/recent Codex jobs.
  result    Show output of a finished job.
  cancel    Cancel an active background job.
  setup     Check Codex installation and auth status.

  help [command]   Show this text, or details for a specific command.`;
}

export function getCommandHelp(command) {
  const commands = {
    task: `codex-companion task [options] [prompt]

Delegate a task to Codex: investigation, diagnosis, implementation, research.

Options:
  --background       Run as a detached job (trackable via status/result/cancel).
  --write            Allow Codex to modify files (default is read-only).
  --resume-last      Continue the most recent Codex task thread.
  --resume           Shorthand for --resume-last.
  --fresh            Start a new thread (ignore any existing session).
  --model <model>    Choose a model. Usually leave unset for Codex defaults.
                     Use "spark" for gpt-5.3-codex-spark.
  --effort <level>   Reasoning effort: none, minimal, low, medium, high, xhigh.
  --prompt-file <path>  Read task prompt from a file.
  --json             Output structured JSON.`,

    status: `codex-companion status [job-id] [options]

Show running and recent Codex jobs for this repository.
Pass a job-id for detailed single-job status.

Options:
  --all                Show all jobs, not just recent.
  --wait               Poll until the job finishes (requires job-id).
  --timeout-ms <ms>    Max wait time when polling.
  --poll-interval-ms <ms>  Poll frequency (default 2000ms).
  --json               Output structured JSON.`,

    result: `codex-companion result [job-id] [--json]

Show the stored output of a finished Codex job.`,

    cancel: `codex-companion cancel [job-id] [--json]

Cancel an active background Codex job.`,

    setup: `codex-companion setup [--json]

Check whether Codex is installed, authenticated, and ready.`
  };

  return commands[command] ?? null;
}
