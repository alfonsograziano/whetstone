import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { styleText } from "node:util";

import { resolveAgentRootForInit } from "./agent-root.ts";

const TEMPLATE_PATH = join(
  import.meta.dirname,
  "..",
  "..",
  "templates",
  "tracebound.config.md",
);

const FAILURE_MODES_SEED = `${JSON.stringify(
  { failureModes: [] },
  null,
  2,
)}\n`;

export const SUBDIRS = ["traces", "failure_modes", "adapters"] as const;

export interface InitOptions {
  cwd?: string;
  agent?: string;
}

export interface InitResult {
  /** Absolute path to the created `tracebound/<agent>/` directory. */
  rootPath: string;
  created: string[];
  skipped: string[];
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw err;
  }
}

async function writeIfMissing(
  absPath: string,
  contents: string | Uint8Array,
  result: InitResult,
): Promise<void> {
  if (await pathExists(absPath)) {
    result.skipped.push(absPath);
    process.stdout.write(
      `${styleText("dim", `skipped (exists): ${absPath}`)}\n`,
    );
    return;
  }
  await writeFile(absPath, contents);
  result.created.push(absPath);
  process.stdout.write(`created: ${absPath}\n`);
}

export async function runInit(options: InitOptions = {}): Promise<InitResult> {
  const { rootPath } = await resolveAgentRootForInit({
    cwd: options.cwd,
    agent: options.agent,
  });

  const result: InitResult = { rootPath, created: [], skipped: [] };

  await mkdir(rootPath, { recursive: true });
  for (const sub of SUBDIRS) {
    await mkdir(join(rootPath, sub), { recursive: true });
  }
  await mkdir(join(rootPath, "traces", "original"), { recursive: true });

  const templateContents = await readFile(TEMPLATE_PATH, "utf8");

  await writeIfMissing(
    join(rootPath, "tracebound.config.md"),
    templateContents,
    result,
  );

  await writeIfMissing(
    join(rootPath, "failure_modes.json"),
    FAILURE_MODES_SEED,
    result,
  );

  process.stdout.write(
    `${styleText("green", `✓ Tracebound initialised at ${rootPath}`)}\n`,
  );

  return result;
}
