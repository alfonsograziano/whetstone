#!/usr/bin/env node
import { parseArgs, styleText } from "node:util";

import {
  reportJson as agentsReportJson,
  reportText as agentsReportText,
  runAgents,
} from "./commands/agents.ts";
import { listAgents } from "./commands/agent-root.ts";
import { runInit } from "./commands/init.ts";
import {
  formatFmJson,
  formatFmText,
  runFmGet,
} from "./commands/fm-get.ts";
import {
  reportJson as statusReportJson,
  reportText as statusReportText,
  runStatus,
} from "./commands/status.ts";
import {
  formatTraceJson,
  formatTraceText,
  runTraceGet,
} from "./commands/trace-get.ts";
import {
  reportJson,
  reportText,
  runValidate,
} from "./commands/validate.ts";
import {
  reportText as installSkillsReportText,
  runInstallSkills,
  DEFAULT_TARGET as INSTALL_SKILLS_DEFAULT_TARGET,
} from "./commands/install-skills.ts";

const USAGE = `tracebound — deterministic primitives for the Tracebound agent-improvement loop.

Usage:
  tracebound <command> [options]

Commands:
  init <agent-name>    Scaffold the tracebound/<agent-name>/ folder in the current repo.
  agents               List the agents configured under tracebound/.
  validate             Validate one agent's tracebound/<agent>/ tree against schemas + invariants.
  status               Print catalogue health + pending-trace counts for one agent.
  trace get <id>       Find a trace by id across one agent's traces/*.jsonl files.
  fm get <id>          Print a failure mode by id from one agent's failure_modes.json.
  install-skills       Copy the bundled Tracebound skills into the local project's skills directory.

Global options:
  -h, --help           Show this help.
  -v, --version        Print the CLI version.

Run 'tracebound <command> --help' for command-specific options.
`;

const INIT_USAGE = `tracebound init <agent-name> — scaffold tracebound/<agent-name>/.

Usage:
  tracebound init <agent-name> [options]

Positionals:
  <agent-name>         Required. Lowercase letters, digits, underscores, hyphens.
                       Must start with a letter or digit. Pattern: ^[a-z0-9][a-z0-9_-]*$

Options:
  -C, --cwd <path>     Directory to initialise inside (default: process.cwd()).
                       Must exist and be a directory.
  -h, --help           Show this help.

Multiple agents can coexist as siblings under tracebound/. Pre-existing files
are left untouched and reported as skipped. To refresh a file, delete it first
and re-run init.
`;

const AGENTS_USAGE = `tracebound agents — list the agents configured under tracebound/.

Usage:
  tracebound agents [options]

Lists every subdirectory of tracebound/ that contains a tracebound.config.md file,
sorted alphabetically. Subdirectories without that file are skipped silently
(partial inits or unrelated folders). Exits 0 even when no agents are configured.

Options:
  -C, --cwd <path>     Directory to inspect (default: process.cwd()).
  --json               Emit a structured JSON report ({ "agents": [{ "name", "path" }] }).
  -h, --help           Show this help.

Exit codes:
  0  listing printed (may be empty)
  2  could not run (missing/invalid --cwd)
`;

const VALIDATE_USAGE = `tracebound validate — validate one agent's tracebound/<agent>/ tree.

Usage:
  tracebound validate --agent <name> [options]

Checks:
  - Structure: tracebound.config.md, failure_modes.json, traces/, failure_modes/, adapters/.
  - Schemas:   failure_modes.json (FailureModesFile) and every traces/*.jsonl line (Trace).
  - Invariants: unique failure-mode ids, affected-trace files & ids exist, bidirectional
                links between failure modes and traces, no duplicate (filename, traceId)
                entries, no dangling failureModeIds[] references on traces.

Options:
  -a, --agent <name>   Required. Agent to validate (under tracebound/<name>/).
  -C, --cwd <path>     Directory to validate inside (default: process.cwd()).
                       Must contain a tracebound/ folder.
  --json               Emit a structured JSON report instead of human text.
  -h, --help           Show this help.

Exit codes:
  0  validation passed
  1  validation issues were found
  2  could not run (missing/invalid --cwd, missing or unknown --agent, IO error)
`;

const TRACE_GET_USAGE = `tracebound trace get <id> — find a trace by id within one agent.

Usage:
  tracebound trace get <id> --agent <name> [options]

Searches all traces/*.jsonl files under tracebound/<agent>/ (sorted alphabetically)
and prints the first trace whose "id" field matches. Scanning stops at first match.

Options:
  -a, --agent <name>   Required. Agent to search (under tracebound/<name>/).
  -C, --cwd <path>     Directory to inspect (default: process.cwd()).
  --json               Emit a structured JSON object instead of pretty-printed trace.
  -h, --help           Show this help.

Exit codes:
  0  trace found and printed
  1  trace not found
  2  could not run (missing/invalid --cwd, missing or unknown --agent, IO error)
`;

const FM_GET_USAGE = `tracebound fm get <id> — print a failure mode by id within one agent.

Usage:
  tracebound fm get <id> --agent <name> [options]

Looks up the failure mode whose "id" field matches in
tracebound/<agent>/failure_modes.json and prints it.

Options:
  -a, --agent <name>   Required. Agent to query (under tracebound/<name>/).
  -C, --cwd <path>     Directory to inspect (default: process.cwd()).
  --json               Emit a structured JSON object instead of pretty-printed record.
  -h, --help           Show this help.

Exit codes:
  0  failure mode found and printed
  1  failure mode not found
  2  could not run (missing/invalid --cwd, missing or unknown --agent, IO error)
`;

const STATUS_USAGE = `tracebound status — print catalogue health for one agent.

Usage:
  tracebound status --agent <name> [options]

Reports:
  - Failure-mode counts by lifecycle status (discovered, investigating, verified, …).
  - Recently updated failure modes (top 5 by lastUpdated).
  - SPECs awaiting approval (failure modes in spec_drafted state).
  - Per-file trace counts under traces/, including pending counts.

Options:
  -a, --agent <name>   Required. Agent to inspect (under tracebound/<name>/).
  -C, --cwd <path>     Directory to inspect (default: process.cwd()).
                       Must contain a tracebound/ folder.
  --json               Emit a structured JSON report instead of human text.
  -h, --help           Show this help.

Exit codes:
  0  status report printed
  2  could not run (missing/invalid --cwd, missing or unknown --agent, malformed
     failure_modes.json — run 'tracebound validate --agent <name>' for details)
`;

const INSTALL_SKILLS_USAGE = `tracebound install-skills — copy bundled skills into a project's skills directory.

Usage:
  tracebound install-skills [options]

Copies every skill bundled with the CLI (analyze-traces, create-adapter,
research-failure-mode, implement-failure-mode) into the local project's
skills directory. By default, skills that already exist locally with the
same content are left untouched, and skills that have been edited locally
are NOT overwritten unless --force is passed.

When --cwd is the @nearform/tracebound package itself (e.g. when invoked
from a postinstall script inside the package), the command exits 0 without
writing anything.

Options:
  -C, --cwd <path>     Directory to install skills into (default: process.cwd()).
                       Must exist and be a directory.
  -t, --target <dir>   Subdirectory under --cwd to install skills into.
                       Default: ${INSTALL_SKILLS_DEFAULT_TARGET}
  -f, --force          Overwrite skills whose local copy differs from the bundled copy.
      --dry-run        Print what would change, do not write.
  -h, --help           Show this help.

Exit codes:
  0  success (skills installed, already up-to-date, or self-install skipped)
  2  could not run (missing/invalid --cwd, bundled skills missing, IO error)
`;

async function readVersion(): Promise<string> {
  try {
    const { readFile } = await import("node:fs/promises");
    const { join } = await import("node:path");
    const pkgPath = join(import.meta.dirname, "..", "package.json");
    const raw = await readFile(pkgPath, "utf8");
    const pkg = JSON.parse(raw) as { version?: string };
    return pkg.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

function fail(message: string, exitCode = 1): never {
  process.stderr.write(`${styleText("red", `Error: ${message}`)}\n`);
  process.exit(exitCode);
}

async function formatAvailableAgents(cwd?: string): Promise<string> {
  try {
    const agents = await listAgents(cwd);
    if (agents.length === 0) {
      return "(none — run 'tracebound init <name>' to create one)";
    }
    return agents.map((a) => a.name).join(", ");
  } catch {
    return "(unknown — could not read --cwd)";
  }
}

async function runInitCommand(argv: string[]): Promise<void> {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      options: {
        cwd: { type: "string", short: "C" },
        help: { type: "boolean", short: "h", default: false },
      },
      allowPositionals: true,
      strict: true,
    });
  } catch (err) {
    fail((err as Error).message, 2);
  }

  if (parsed.values.help) {
    process.stdout.write(INIT_USAGE);
    return;
  }

  const agent = parsed.positionals[0];
  if (!agent) {
    fail("<agent-name> is required.\n\n" + INIT_USAGE, 2);
  }
  if (parsed.positionals.length > 1) {
    fail(
      `unexpected positional argument: "${parsed.positionals[1]}".\n\n${INIT_USAGE}`,
      2,
    );
  }

  try {
    await runInit({ cwd: parsed.values.cwd, agent });
  } catch (err) {
    fail(err instanceof Error ? err.message : String(err), 2);
  }
}

async function runValidateCommand(argv: string[]): Promise<void> {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      options: {
        agent: { type: "string", short: "a" },
        cwd: { type: "string", short: "C" },
        json: { type: "boolean", default: false },
        help: { type: "boolean", short: "h", default: false },
      },
      allowPositionals: false,
      strict: true,
    });
  } catch (err) {
    fail((err as Error).message, 2);
  }

  if (parsed.values.help) {
    process.stdout.write(VALIDATE_USAGE);
    return;
  }

  if (!parsed.values.agent) {
    const available = await formatAvailableAgents(parsed.values.cwd);
    fail(`--agent <name> is required. Available agents: ${available}`, 2);
  }

  let report;
  try {
    report = await runValidate({
      cwd: parsed.values.cwd,
      agent: parsed.values.agent,
    });
  } catch (err) {
    fail(err instanceof Error ? err.message : String(err), 2);
  }

  const output = parsed.values.json ? reportJson(report) : reportText(report);
  process.stdout.write(output);
  process.exit(report.ok ? 0 : 1);
}

async function runTraceGetCommand(argv: string[]): Promise<void> {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      options: {
        agent: { type: "string", short: "a" },
        cwd: { type: "string", short: "C" },
        json: { type: "boolean", default: false },
        help: { type: "boolean", short: "h", default: false },
      },
      allowPositionals: true,
      strict: true,
    });
  } catch (err) {
    fail((err as Error).message, 2);
  }

  if (parsed.values.help) {
    process.stdout.write(TRACE_GET_USAGE);
    return;
  }

  const id = parsed.positionals[0];
  if (!id) {
    fail("Usage: tracebound trace get <id> --agent <name>", 2);
  }

  if (!parsed.values.agent) {
    const available = await formatAvailableAgents(parsed.values.cwd);
    fail(`--agent <name> is required. Available agents: ${available}`, 2);
  }

  let result;
  try {
    result = await runTraceGet(id, {
      cwd: parsed.values.cwd,
      agent: parsed.values.agent,
    });
  } catch (err) {
    fail(err instanceof Error ? err.message : String(err), 2);
  }

  const output = parsed.values.json
    ? formatTraceJson(result)
    : formatTraceText(result);
  process.stdout.write(output);
  process.exit(result.trace ? 0 : 1);
}

async function runFmGetCommand(argv: string[]): Promise<void> {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      options: {
        agent: { type: "string", short: "a" },
        cwd: { type: "string", short: "C" },
        json: { type: "boolean", default: false },
        help: { type: "boolean", short: "h", default: false },
      },
      allowPositionals: true,
      strict: true,
    });
  } catch (err) {
    fail((err as Error).message, 2);
  }

  if (parsed.values.help) {
    process.stdout.write(FM_GET_USAGE);
    return;
  }

  const id = parsed.positionals[0];
  if (!id) {
    fail("Usage: tracebound fm get <id> --agent <name>", 2);
  }

  if (!parsed.values.agent) {
    const available = await formatAvailableAgents(parsed.values.cwd);
    fail(`--agent <name> is required. Available agents: ${available}`, 2);
  }

  let result;
  try {
    result = await runFmGet(id, {
      cwd: parsed.values.cwd,
      agent: parsed.values.agent,
    });
  } catch (err) {
    fail(err instanceof Error ? err.message : String(err), 2);
  }

  const output = parsed.values.json
    ? formatFmJson(result)
    : formatFmText(result);
  process.stdout.write(output);
  process.exit(result.failureMode ? 0 : 1);
}

async function runStatusCommand(argv: string[]): Promise<void> {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      options: {
        agent: { type: "string", short: "a" },
        cwd: { type: "string", short: "C" },
        json: { type: "boolean", default: false },
        help: { type: "boolean", short: "h", default: false },
      },
      allowPositionals: false,
      strict: true,
    });
  } catch (err) {
    fail((err as Error).message, 2);
  }

  if (parsed.values.help) {
    process.stdout.write(STATUS_USAGE);
    return;
  }

  if (!parsed.values.agent) {
    const available = await formatAvailableAgents(parsed.values.cwd);
    fail(`--agent <name> is required. Available agents: ${available}`, 2);
  }

  let report;
  try {
    report = await runStatus({
      cwd: parsed.values.cwd,
      agent: parsed.values.agent,
    });
  } catch (err) {
    fail(err instanceof Error ? err.message : String(err), 2);
  }

  const output = parsed.values.json
    ? statusReportJson(report)
    : statusReportText(report);
  process.stdout.write(output);
}

async function runAgentsCommand(argv: string[]): Promise<void> {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      options: {
        cwd: { type: "string", short: "C" },
        json: { type: "boolean", default: false },
        help: { type: "boolean", short: "h", default: false },
      },
      allowPositionals: false,
      strict: true,
    });
  } catch (err) {
    fail((err as Error).message, 2);
  }

  if (parsed.values.help) {
    process.stdout.write(AGENTS_USAGE);
    return;
  }

  let report;
  try {
    report = await runAgents({ cwd: parsed.values.cwd });
  } catch (err) {
    fail(err instanceof Error ? err.message : String(err), 2);
  }

  const output = parsed.values.json
    ? agentsReportJson(report)
    : agentsReportText(report);
  process.stdout.write(output);
}

async function runInstallSkillsCommand(argv: string[]): Promise<void> {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      options: {
        cwd: { type: "string", short: "C" },
        target: { type: "string", short: "t" },
        force: { type: "boolean", short: "f", default: false },
        "dry-run": { type: "boolean", default: false },
        help: { type: "boolean", short: "h", default: false },
      },
      allowPositionals: false,
      strict: true,
    });
  } catch (err) {
    fail((err as Error).message, 2);
  }

  if (parsed.values.help) {
    process.stdout.write(INSTALL_SKILLS_USAGE);
    return;
  }

  try {
    const result = await runInstallSkills({
      cwd: parsed.values.cwd,
      target: parsed.values.target,
      force: parsed.values.force,
      dryRun: parsed.values["dry-run"],
    });
    process.stdout.write(installSkillsReportText(result));
  } catch (err) {
    fail(err instanceof Error ? err.message : String(err), 2);
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.length === 0 || args[0] === "-h" || args[0] === "--help") {
    process.stdout.write(USAGE);
    return;
  }

  if (args[0] === "-v" || args[0] === "--version") {
    process.stdout.write(`${await readVersion()}\n`);
    return;
  }

  const [command, ...rest] = args;

  switch (command) {
    case "init":
      await runInitCommand(rest);
      return;
    case "agents":
      await runAgentsCommand(rest);
      return;
    case "validate":
      await runValidateCommand(rest);
      return;
    case "status":
      await runStatusCommand(rest);
      return;
    case "trace": {
      const [sub, ...traceRest] = rest;
      if (sub === "get") {
        await runTraceGetCommand(traceRest);
        return;
      }
      fail(`unknown subcommand: trace ${sub ?? ""}\n\nRun 'tracebound trace get <id>' to look up a trace.`);
      return;
    }
    case "fm": {
      const [sub, ...fmRest] = rest;
      if (sub === "get") {
        await runFmGetCommand(fmRest);
        return;
      }
      fail(`unknown subcommand: fm ${sub ?? ""}\n\nRun 'tracebound fm get <id>' to look up a failure mode.`);
      return;
    }
    case "install-skills":
      await runInstallSkillsCommand(rest);
      return;
    default:
      fail(`unknown command: ${command}\n\n${USAGE}`);
  }
}

try {
  await main();
} catch (err) {
  fail(err instanceof Error ? err.message : String(err));
}
