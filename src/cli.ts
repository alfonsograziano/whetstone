#!/usr/bin/env node
import { parseArgs, styleText } from "node:util";

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

const USAGE = `whetstone — deterministic primitives for the Whetstone agent-improvement loop.

Usage:
  whetstone <command> [options]

Commands:
  init                 Scaffold the whetstone/ folder in the current repo.
  validate             Validate the whetstone/ tree against schemas + invariants.
  status               Print catalogue health + pending-trace counts.
  trace get <id>       Find a trace by id across all traces/*.jsonl files.
  fm get <id>          Print a failure mode by id from failure_modes.json.

Global options:
  -h, --help           Show this help.
  -v, --version        Print the CLI version.

Run 'whetstone <command> --help' for command-specific options.
`;

const INIT_USAGE = `whetstone init — scaffold the whetstone/ folder.

Usage:
  whetstone init [options]

Options:
  -C, --cwd <path>     Directory to initialise inside (default: process.cwd()).
                       Must exist and be a directory.
  -h, --help           Show this help.

Pre-existing files are left untouched and reported as skipped. To refresh a
file, delete it first and re-run init.
`;

const VALIDATE_USAGE = `whetstone validate — validate the whetstone/ tree.

Usage:
  whetstone validate [options]

Checks:
  - Structure: whetstone.config.md, failure_modes.json, traces/, failure_modes/, adapters/.
  - Schemas:   failure_modes.json (FailureModesFile) and every traces/*.jsonl line (Trace).
  - Invariants: unique failure-mode ids, affected-trace files & ids exist, bidirectional
                links between failure modes and traces, no duplicate (filename, traceId)
                entries, no dangling failureModeIds[] references on traces.

Options:
  -C, --cwd <path>     Directory to validate inside (default: process.cwd()).
                       Must contain a whetstone/ folder.
  --json               Emit a structured JSON report instead of human text.
  -h, --help           Show this help.

Exit codes:
  0  validation passed
  1  validation issues were found
  2  could not run (missing/invalid --cwd, IO error)
`;

const TRACE_GET_USAGE = `whetstone trace get <id> — find a trace by id.

Usage:
  whetstone trace get <id> [options]

Searches all traces/*.jsonl files under whetstone/ (sorted alphabetically) and
prints the first trace whose "id" field matches. Scanning stops at first match.

Options:
  -C, --cwd <path>     Directory to inspect (default: process.cwd()).
  --json               Emit a structured JSON object instead of pretty-printed trace.
  -h, --help           Show this help.

Exit codes:
  0  trace found and printed
  1  trace not found
  2  could not run (missing/invalid --cwd, IO error)
`;

const FM_GET_USAGE = `whetstone fm get <id> — print a failure mode by id.

Usage:
  whetstone fm get <id> [options]

Looks up the failure mode whose "id" field matches in whetstone/failure_modes.json
and prints it.

Options:
  -C, --cwd <path>     Directory to inspect (default: process.cwd()).
  --json               Emit a structured JSON object instead of pretty-printed record.
  -h, --help           Show this help.

Exit codes:
  0  failure mode found and printed
  1  failure mode not found
  2  could not run (missing/invalid --cwd, IO error)
`;

const STATUS_USAGE = `whetstone status — print catalogue health.

Usage:
  whetstone status [options]

Reports:
  - Failure-mode counts by lifecycle status (discovered, investigating, verified, …).
  - Recently updated failure modes (top 5 by lastUpdated).
  - SPECs awaiting approval (failure modes in spec_drafted state).
  - Per-file trace counts under traces/, including pending counts.

Options:
  -C, --cwd <path>     Directory to inspect (default: process.cwd()).
                       Must contain a whetstone/ folder.
  --json               Emit a structured JSON report instead of human text.
  -h, --help           Show this help.

Exit codes:
  0  status report printed
  2  could not run (missing/invalid --cwd, missing whetstone/, malformed
     failure_modes.json — run 'whetstone validate' for details)
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

async function runInitCommand(argv: string[]): Promise<void> {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      options: {
        cwd: { type: "string", short: "C" },
        help: { type: "boolean", short: "h", default: false },
      },
      allowPositionals: false,
      strict: true,
    });
  } catch (err) {
    fail((err as Error).message);
  }

  if (parsed.values.help) {
    process.stdout.write(INIT_USAGE);
    return;
  }

  await runInit({ cwd: parsed.values.cwd });
}

async function runValidateCommand(argv: string[]): Promise<void> {
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
    process.stdout.write(VALIDATE_USAGE);
    return;
  }

  let report;
  try {
    report = await runValidate({ cwd: parsed.values.cwd });
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
    fail("Usage: whetstone trace get <id>", 2);
  }

  let result;
  try {
    result = await runTraceGet(id, { cwd: parsed.values.cwd });
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
    fail("Usage: whetstone fm get <id>", 2);
  }

  let result;
  try {
    result = await runFmGet(id, { cwd: parsed.values.cwd });
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

  let report;
  try {
    report = await runStatus({ cwd: parsed.values.cwd });
  } catch (err) {
    fail(err instanceof Error ? err.message : String(err), 2);
  }

  const output = parsed.values.json
    ? statusReportJson(report)
    : statusReportText(report);
  process.stdout.write(output);
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
      fail(`unknown subcommand: trace ${sub ?? ""}\n\nRun 'whetstone trace get <id>' to look up a trace.`);
      return;
    }
    case "fm": {
      const [sub, ...fmRest] = rest;
      if (sub === "get") {
        await runFmGetCommand(fmRest);
        return;
      }
      fail(`unknown subcommand: fm ${sub ?? ""}\n\nRun 'whetstone fm get <id>' to look up a failure mode.`);
      return;
    }
    default:
      fail(`unknown command: ${command}\n\n${USAGE}`);
  }
}

try {
  await main();
} catch (err) {
  fail(err instanceof Error ? err.message : String(err));
}
