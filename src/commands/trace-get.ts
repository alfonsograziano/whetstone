import { createReadStream } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { createInterface } from "node:readline";

import { TraceSchema, type Trace } from "../schemas/index.ts";

export interface TraceGetOptions {
  cwd?: string;
}

export interface TraceGetResult {
  /** The matched trace, or null if not found. */
  trace: Trace | null;
  /** Path of the JSONL file that contained the trace, relative to whetstone/. */
  file: string | null;
  /** 1-based line number within that file. */
  line: number | null;
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
 * Search all traces/*.jsonl files under whetstone/ for a trace matching `id`.
 * Files are scanned in sorted order; scanning stops at first match.
 */
export async function runTraceGet(
  id: string,
  options: TraceGetOptions = {},
): Promise<TraceGetResult> {
  if (!id || id.trim() === "") {
    throw new Error("trace id must be a non-empty string");
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

  const tracesDir = join(rootPath, "traces");
  if (!(await pathExists(tracesDir))) {
    return { trace: null, file: null, line: null };
  }

  let entries: string[];
  try {
    entries = (await readdir(tracesDir)).filter((n) => n.endsWith(".jsonl"));
  } catch (err) {
    throw new Error(
      `Failed to read traces/ directory: ${(err as Error).message}`,
    );
  }

  entries.sort();

  for (const name of entries) {
    const absPath = join(tracesDir, name);
    const s = await stat(absPath);
    if (!s.isFile()) continue;

    const stream = createReadStream(absPath, { encoding: "utf8" });
    const rl = createInterface({ input: stream, crlfDelay: Infinity });

    let lineNo = 0;
    let found = false;

    try {
      for await (const raw of rl) {
        lineNo += 1;
        const line = raw.trim();
        if (line === "") continue;

        let parsed: unknown;
        try {
          parsed = JSON.parse(line);
        } catch {
          continue; // malformed line — skip
        }

        const result = TraceSchema.safeParse(parsed);
        if (!result.success) continue; // schema mismatch — skip

        if (result.data.id === id) {
          found = true;
          rl.close();
          stream.destroy();
          return {
            trace: result.data,
            file: `traces/${name}`,
            line: lineNo,
          };
        }
      }
    } catch (err) {
      // Unreadable file — skip and keep searching
      if (!found) continue;
    }
  }

  return { trace: null, file: null, line: null };
}

export function formatTraceText(result: TraceGetResult): string {
  if (!result.trace) {
    return "Trace not found.\n";
  }
  return `${JSON.stringify(result.trace, null, 2)}\n`;
}

export function formatTraceJson(result: TraceGetResult): string {
  if (!result.trace) {
    return `${JSON.stringify({ found: false, trace: null, file: null, line: null }, null, 2)}\n`;
  }
  return `${JSON.stringify(
    { found: true, trace: result.trace, file: result.file, line: result.line },
    null,
    2,
  )}\n`;
}
