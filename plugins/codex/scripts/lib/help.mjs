export function getUsageText() {
  return `codex-companion — Codex reviews and tasks from Claude Code.
Always start codex reviews and tasks via the Monitor tool, not Bash.

codex-companion subcommands:

  review [--base <ref>] [--scope <auto|working-tree|branch>] [--model <model>] [--json]
         [--include-reasoning]
    Comprehensive code review via Codex's built-in reviewer. Slower, thorough.
    Defaults to uncommitted changes; --base <ref> for branch review. Read-only.

  adversarial-review [--base <ref>] [--scope <auto|working-tree|branch>] [--model <model>] [--json]
                     [--include-reasoning] [focus text]
    Targeted review challenging design choices, tradeoffs, and assumptions.
    Faster than review. Optional focus text steers the critique. Read-only.

  plan-review <file> [--model <model>] [--resume]
    Adversarial review of a plan file. Codex reads plan content and inspects referenced files.
    Use before exiting plan mode. --resume continues a prior review thread for the same file.

  task [--write] [--resume <job-id>] [--resume-last] [--model <model>] [--effort <level>]
       [--prompt-file <path>] [--json] [prompt]
    Delegate a task to Codex: investigation, diagnosis, implementation, research.
    Default is read-only; --write to allow edits. --resume continues a prior thread.

  status [job-id] [--all] [--workspace] [--json]
  status <job-id> --wait [--timeout-ms <ms>] [--poll-interval-ms <ms>] [--json]
    Show running/recent Codex jobs for this repository.
    Pass a job-id for detailed single-job status; --wait polls until that job finishes.

  result [job-id] [--json]
    Show the stored output of a finished Codex job.

  cancel [job-id] [--json]
    Cancel an active Codex job.

  setup [--json]
    Check whether Codex is installed, authenticated, and ready.

  help [command]
    Show this text, or details for a specific command.`;
}

export function getCommandHelp(command) {
  const commands = {
    review: `codex-companion review [options]

Comprehensive code review via Codex's built-in reviewer. Slower, thorough.
Defaults to uncommitted changes; --base <ref> for branch review. Read-only.

Options:
  --base <ref>         Base ref for branch diff (e.g. main, HEAD~3).
  --scope <mode>       auto, working-tree, or branch.
  --model <model>      Choose a model.
  --include-reasoning  Include reasoning summary in output.
  --json               Output structured JSON.`,

    "adversarial-review": `codex-companion adversarial-review [options] [focus text]

Targeted review challenging design choices, tradeoffs, and assumptions.
Faster than review. Optional focus text steers the critique. Read-only.

Options:
  --base <ref>         Base ref for branch diff (e.g. main, HEAD~3).
  --scope <mode>       auto, working-tree, or branch.
  --model <model>      Choose a model.
  --include-reasoning  Include reasoning summary in output.
  --json               Output structured JSON.`,

    "plan-review": `codex-companion plan-review <file> [options]

Adversarial review of a plan file. Codex reads plan content and inspects
referenced files. Use before exiting plan mode.

Options:
  --model <model>      Choose a model.
  --resume             Continue a prior review thread for the same file.
                       Codex keeps its previous context, so it can focus
                       on what changed instead of re-reading the codebase.`,

    task: `codex-companion task [options] [prompt]

Delegate a task to Codex: investigation, diagnosis, implementation, research.

Options:
  --write            Allow Codex to modify files (default is read-only).
  --resume <job-id>  Continue the Codex task thread for the named job. Find ids
                     with codex-companion status (or status --workspace if the
                     job was created in a different Claude session).
  --resume-last      Continue the most recent Codex task thread for this session.
  --model <model>    Choose a model. Usually leave unset for Codex defaults.
                     Use "spark" for gpt-5.3-codex-spark.
  --effort <level>   Reasoning effort: none, minimal, low, medium, high, xhigh.
  --prompt-file <path>  Read task prompt from a file.
  --json             Output structured JSON (includes jobId).`,

    status: `codex-companion status [job-id] [options]

Show running and recent Codex jobs for this repository.
Pass a job-id for detailed single-job status.

Options:
  --all                Show all jobs, not just recent.
  --workspace          List jobs from this workspace across all Claude sessions.
                       Use this if a job you expect to see is missing — Claude is
                       likely running under a new session id.
  --wait               Poll until the job finishes (requires job-id).
  --timeout-ms <ms>    Max wait time when polling.
  --poll-interval-ms <ms>  Poll frequency (default 2000ms).
  --json               Output structured JSON.`,

    result: `codex-companion result [job-id] [--json]

Show the stored output of a finished Codex job.`,

    cancel: `codex-companion cancel [job-id] [--json]

Cancel an active Codex job.`,

    setup: `codex-companion setup [--json]

Check whether Codex is installed, authenticated, and ready.`
  };

  return commands[command] ?? null;
}
