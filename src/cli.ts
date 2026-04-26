#!/usr/bin/env node
import { parseArgs, styleText } from "node:util";

import { runInit } from "./commands/init.ts";

const USAGE = `whetstone — deterministic primitives for the Whetstone agent-improvement loop.

Usage:
  whetstone <command> [options]

Commands:
  init                 Scaffold the whetstone/ folder in the current repo.

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
    default:
      fail(`unknown command: ${command}\n\n${USAGE}`);
  }
}

try {
  await main();
} catch (err) {
  fail(err instanceof Error ? err.message : String(err));
}
