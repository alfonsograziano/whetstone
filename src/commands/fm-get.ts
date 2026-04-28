import { stat, readFile } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";

import { FailureModesFileSchema, type FailureMode } from "../schemas/index.ts";

export interface FmGetOptions {
  cwd?: string;
}

export interface FmGetResult {
  /** The matched failure mode, or null if not found. */
  failureMode: FailureMode | null;
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

/**
 * Look up a single failure mode by id in whetstone/failure_modes.json.
 */
export async function runFmGet(
  id: string,
  options: FmGetOptions = {},
): Promise<FmGetResult> {
  if (!id || id.trim() === "") {
    throw new Error("failure-mode id must be a non-empty string");
  }

  const cwdInput = options.cwd ?? process.cwd();
  const cwdAbsolute = isAbsolute(cwdInput)
    ? cwdInput
    : resolve(process.cwd(), cwdInput);

  if (!(await pathExists(cwdAbsolute))) {
    throw new Error(`--cwd path does not exist: ${cwdAbsolute}`);
  }

  const rootPath = join(cwdAbsolute, "whetstone");
  if (!(await pathExists(rootPath))) {
    throw new Error(
      `whetstone/ directory not found at ${rootPath}. Run "whetstone init" first.`,
    );
  }

  const fmPath = join(rootPath, "failure_modes.json");
  if (!(await pathExists(fmPath))) {
    throw new Error(
      `failure_modes.json not found at ${fmPath}. Run "whetstone init" first.`,
    );
  }

  let raw: string;
  try {
    raw = await readFile(fmPath, "utf8");
  } catch (err) {
    throw new Error(
      `Failed to read failure_modes.json: ${(err as Error).message}`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(
      `failure_modes.json is not valid JSON: ${(err as Error).message}`,
    );
  }

  const result = FailureModesFileSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(
      `failure_modes.json does not match the expected schema. Run "whetstone validate" for details.`,
    );
  }

  const fm = result.data.failureModes.find((m) => m.id === id) ?? null;
  return { failureMode: fm };
}

export function formatFmText(result: FmGetResult): string {
  if (!result.failureMode) {
    return "Failure mode not found.\n";
  }
  return `${JSON.stringify(result.failureMode, null, 2)}\n`;
}

export function formatFmJson(result: FmGetResult): string {
  if (!result.failureMode) {
    return `${JSON.stringify({ found: false, failureMode: null }, null, 2)}\n`;
  }
  return `${JSON.stringify({ found: true, failureMode: result.failureMode }, null, 2)}\n`;
}
