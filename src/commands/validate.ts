import { createReadStream } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { styleText } from "node:util";

import type { z } from "zod";

import {
  FailureModesFileSchema,
  TraceSchema,
  type FailureMode,
  type Trace,
} from "../schemas/index.ts";
import { resolveAgentRootForRead } from "./agent-root.ts";
import { SUBDIRS } from "./init.ts";

export interface ValidationIssue {
  code: string;
  severity: "error";
  /** Path relative to the agent root, e.g. "traces/langfuse-2026-04-26.jsonl". */
  file?: string;
  /** 1-based for NDJSON lines. */
  line?: number;
  /** Dotted JSON path inside the document. */
  path?: string;
  message: string;
  hint: string;
}

export interface ValidationReport {
  ok: boolean;
  /** Absolute path to the `whetstone/<agent>/` root that was inspected. */
  rootPath: string;
  summary: {
    fileCount: number;
    issueCount: number;
  };
  issues: ValidationIssue[];
}

export interface ValidateOptions {
  cwd?: string;
  agent?: string;
}

const REQUIRED_FILES = ["whetstone.config.md", "failure_modes.json"] as const;

interface PathInfo {
  exists: boolean;
  isDir: boolean;
  isFile: boolean;
}

async function inspectPath(p: string): Promise<PathInfo> {
  try {
    const s = await stat(p);
    return { exists: true, isDir: s.isDirectory(), isFile: s.isFile() };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return { exists: false, isDir: false, isFile: false };
    }
    throw err;
  }
}

interface ParsedTraceFile {
  /** Filename relative to traces/, e.g. "langfuse-2026-04-26.jsonl". */
  name: string;
  /** True when the entire file was readable AND every line parsed. */
  parsedCleanly: boolean;
  /** Map of traceId → trace for lines that validated. Empty for failed files. */
  traces: Map<string, Trace>;
}

async function readTraceFile(
  absPath: string,
  relPath: string,
  issues: ValidationIssue[],
): Promise<ParsedTraceFile> {
  const traces = new Map<string, Trace>();
  let parsedCleanly = true;

  const stream = createReadStream(absPath, { encoding: "utf8" });
  const rl = createInterface({ input: stream, crlfDelay: Infinity });

  let lineNo = 0;
  try {
    for await (const raw of rl) {
      lineNo += 1;
      const line = raw.trim();
      if (line === "") continue;

      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch (err) {
        parsedCleanly = false;
        issues.push({
          code: "WHET_PARSE_TRACE",
          severity: "error",
          file: relPath,
          line: lineNo,
          message: `Failed to parse JSON: ${(err as Error).message}`,
          hint: "Each line of an NDJSON file must be a single, complete JSON object.",
        });
        continue;
      }

      const result = TraceSchema.safeParse(parsed);
      if (!result.success) {
        parsedCleanly = false;
        issues.push(
          ...zodIssuesToValidation(
            result.error,
            relPath,
            "WHET_SCHEMA_TRACE",
            (path) =>
              `Fix the offending field at "${path}" so the trace matches the Trace schema (see src/schemas/trace.ts).`,
            lineNo,
          ),
        );
        continue;
      }

      const trace = result.data;
      if (traces.has(trace.id)) {
        parsedCleanly = false;
        issues.push({
          code: "WHET_TRACE_DUPLICATE_ID",
          severity: "error",
          file: relPath,
          line: lineNo,
          path: "id",
          message: `Duplicate trace id "${trace.id}" already seen earlier in this file.`,
          hint: "Trace ids must be globally unique. Remove or re-id one of the duplicates.",
        });
        continue;
      }
      traces.set(trace.id, trace);
    }
  } catch (err) {
    parsedCleanly = false;
    issues.push({
      code: "WHET_PARSE_TRACE",
      severity: "error",
      file: relPath,
      message: `Failed to read trace file: ${(err as Error).message}`,
      hint: "Confirm the file is readable and is encoded as UTF-8 NDJSON.",
    });
  }

  return { name: relPath, parsedCleanly, traces };
}

function zodIssuesToValidation(
  zerr: z.ZodError,
  file: string,
  code: string,
  hintForPath: (path: string) => string,
  line?: number,
): ValidationIssue[] {
  return zerr.issues.map((iss) => {
    const path = iss.path.length ? iss.path.map(String).join(".") : "(root)";
    return {
      code,
      severity: "error",
      file,
      line,
      path,
      message: `${iss.message} at ${path}`,
      hint: hintForPath(path),
    };
  });
}

export async function runValidate(
  options: ValidateOptions = {},
): Promise<ValidationReport> {
  const { rootPath, agentName } = await resolveAgentRootForRead({
    cwd: options.cwd,
    agent: options.agent,
  });

  const issues: ValidationIssue[] = [];
  let fileCount = 0;

  // Pass 1: structure. resolveAgentRootForRead has already verified the agent dir
  // exists, so we only check the required files and subdirs inside it.
  for (const f of REQUIRED_FILES) {
    const info = await inspectPath(join(rootPath, f));
    if (!info.exists || !info.isFile) {
      issues.push({
        code: "WHET_STRUCT_MISSING",
        severity: "error",
        file: f,
        message: `Required file is missing: whetstone/${agentName}/${f}.`,
        hint: `Run "whetstone init ${agentName}" to recreate it (existing files are preserved).`,
      });
    }
  }

  for (const sub of SUBDIRS) {
    const info = await inspectPath(join(rootPath, sub));
    if (!info.exists || !info.isDir) {
      issues.push({
        code: "WHET_STRUCT_MISSING",
        severity: "error",
        file: `${sub}/`,
        message: `Required subdirectory is missing: whetstone/${agentName}/${sub}/.`,
        hint: `Run "whetstone init ${agentName}" to recreate it.`,
      });
    }
  }

  // Pass 2: failure_modes.json schema.
  const fmPath = join(rootPath, "failure_modes.json");
  const fmInfo = await inspectPath(fmPath);
  let failureModes: FailureMode[] | null = null;

  if (fmInfo.exists && fmInfo.isFile) {
    fileCount += 1;
    const raw = await readFile(fmPath, "utf8");
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      issues.push({
        code: "WHET_PARSE_FAILURE_MODES",
        severity: "error",
        file: "failure_modes.json",
        message: `Failed to parse JSON: ${(err as Error).message}`,
        hint: "failure_modes.json must be a single JSON object. Run `jq . failure_modes.json` to spot the syntax error.",
      });
    }
    if (parsed !== undefined) {
      const result = FailureModesFileSchema.safeParse(parsed);
      if (!result.success) {
        issues.push(
          ...zodIssuesToValidation(
            result.error,
            "failure_modes.json",
            "WHET_SCHEMA_FAILURE_MODES",
            (path) =>
              `Fix the offending field at "${path}" so the document matches the FailureModesFile schema (see src/schemas/failure-mode.ts).`,
          ),
        );
      } else {
        failureModes = result.data.failureModes;
      }
    }
  }

  // Pass 3: traces/*.jsonl streaming validation.
  const tracesDir = join(rootPath, "traces");
  const tracesInfo = await inspectPath(tracesDir);
  const traceFiles = new Map<string, ParsedTraceFile>();

  if (tracesInfo.exists && tracesInfo.isDir) {
    let entries: string[] = [];
    try {
      entries = (await readdir(tracesDir)).filter((n) => n.endsWith(".jsonl"));
    } catch (err) {
      issues.push({
        code: "WHET_STRUCT_MISSING",
        severity: "error",
        file: "traces/",
        message: `Failed to read traces/: ${(err as Error).message}`,
        hint: "Confirm the directory is readable.",
      });
    }
    entries.sort();
    for (const name of entries) {
      const abs = join(tracesDir, name);
      const info = await inspectPath(abs);
      if (!info.isFile) continue;
      fileCount += 1;
      const parsed = await readTraceFile(abs, `traces/${name}`, issues);
      traceFiles.set(name, parsed);
    }
  }

  // Pass 4: cross-file invariants. Skip when failure_modes.json itself didn't parse.
  if (failureModes !== null) {
    const fmIds = new Set<string>();
    const seenIds = new Map<string, number>();
    for (const fm of failureModes) {
      seenIds.set(fm.id, (seenIds.get(fm.id) ?? 0) + 1);
    }
    for (const [id, count] of seenIds) {
      if (count > 1) {
        issues.push({
          code: "WHET_FM_DUPLICATE_ID",
          severity: "error",
          file: "failure_modes.json",
          path: `failureModes[].id`,
          message: `Failure-mode id "${id}" appears ${count} times.`,
          hint: `Rename or delete duplicates so each failure mode in failure_modes.json has a unique "id".`,
        });
      }
      fmIds.add(id);
    }

    for (const fm of failureModes) {
      const seenPairs = new Set<string>();
      for (let i = 0; i < fm.affectedTraces.length; i++) {
        const at = fm.affectedTraces[i]!;
        const key = `${at.filename} ${at.traceId}`;
        if (seenPairs.has(key)) {
          issues.push({
            code: "WHET_FM_DUPLICATE_AFFECTED_TRACE",
            severity: "error",
            file: "failure_modes.json",
            path: `${fm.id}.affectedTraces[${i}]`,
            message: `Duplicate affectedTraces entry on "${fm.id}": (${at.filename}, ${at.traceId}).`,
            hint: `Remove the duplicate entry from "${fm.id}.affectedTraces".`,
          });
          continue;
        }
        seenPairs.add(key);

        const file = traceFiles.get(at.filename);
        if (!file) {
          // Either the file is missing or never landed under traces/.
          issues.push({
            code: "WHET_FM_MISSING_TRACE_FILE",
            severity: "error",
            file: "failure_modes.json",
            path: `${fm.id}.affectedTraces[${i}].filename`,
            message: `Failure mode "${fm.id}" references trace file "traces/${at.filename}" which does not exist.`,
            hint: `Either restore traces/${at.filename}, or remove this entry from "${fm.id}.affectedTraces".`,
          });
          continue;
        }
        if (!file.parsedCleanly && file.traces.size === 0) {
          // File couldn't be parsed at all → invariant errors would be noise. The parse
          // errors are already reported.
          continue;
        }
        const trace = file.traces.get(at.traceId);
        if (!trace) {
          issues.push({
            code: "WHET_FM_MISSING_TRACE_ID",
            severity: "error",
            file: "failure_modes.json",
            path: `${fm.id}.affectedTraces[${i}].traceId`,
            message: `Failure mode "${fm.id}" references trace "${at.traceId}" which is not present in traces/${at.filename}.`,
            hint: `Either add the trace to traces/${at.filename}, fix the traceId, or remove this entry.`,
          });
          continue;
        }
        if (!trace.failureModeIds.includes(fm.id)) {
          issues.push({
            code: "WHET_FM_BACKLINK_MISSING",
            severity: "error",
            file: `traces/${at.filename}`,
            path: `${at.traceId}.failureModeIds`,
            message: `Trace "${at.traceId}" is listed under failure mode "${fm.id}" but its failureModeIds[] does not include "${fm.id}".`,
            hint: `Add "${fm.id}" to traces/${at.filename} → ${at.traceId}.failureModeIds, or remove the trace from "${fm.id}.affectedTraces".`,
          });
        }
      }
    }

    // Orphan FM references on traces.
    for (const [fileName, parsed] of traceFiles) {
      for (const trace of parsed.traces.values()) {
        for (const fmId of trace.failureModeIds) {
          if (!fmIds.has(fmId)) {
            issues.push({
              code: "WHET_TRACE_DANGLING_FM_REF",
              severity: "error",
              file: `traces/${fileName}`,
              path: `${trace.id}.failureModeIds`,
              message: `Trace "${trace.id}" references failure mode "${fmId}", but no such failure mode exists in failure_modes.json.`,
              hint: `Either add a failure mode with id "${fmId}" to failure_modes.json, or remove "${fmId}" from this trace's failureModeIds[].`,
            });
          }
        }
      }
    }
  }

  return finalize(rootPath, issues, fileCount);
}

function finalize(
  rootPath: string,
  issues: ValidationIssue[],
  fileCount: number,
): ValidationReport {
  return {
    ok: issues.length === 0,
    rootPath,
    summary: { fileCount, issueCount: issues.length },
    issues,
  };
}

// ---------------------------------------------------------------------------
// Reporters
// ---------------------------------------------------------------------------

export function reportText(report: ValidationReport): string {
  const lines: string[] = [];
  if (report.issues.length === 0) {
    lines.push(
      styleText(
        "green",
        `✓ Validation passed (${report.summary.fileCount} file${
          report.summary.fileCount === 1 ? "" : "s"
        } checked)`,
      ),
    );
    return `${lines.join("\n")}\n`;
  }

  const grouped = new Map<string, ValidationIssue[]>();
  for (const iss of report.issues) {
    const key = iss.file ?? "(global)";
    const arr = grouped.get(key) ?? [];
    arr.push(iss);
    grouped.set(key, arr);
  }

  for (const [file, fileIssues] of grouped) {
    lines.push(styleText("bold", file));
    for (const iss of fileIssues) {
      const loc = iss.line !== undefined ? `:${iss.line}` : "";
      const head = `  ${styleText("red", iss.code)}${loc}${
        iss.path ? ` ${styleText("dim", `[${iss.path}]`)}` : ""
      }`;
      lines.push(head);
      lines.push(`    ${iss.message}`);
      lines.push(`    ${styleText("dim", `Hint: ${iss.hint}`)}`);
    }
    lines.push("");
  }

  lines.push(
    styleText(
      "red",
      `✗ Validation failed: ${report.summary.issueCount} issue${
        report.summary.issueCount === 1 ? "" : "s"
      } across ${report.summary.fileCount} file${
        report.summary.fileCount === 1 ? "" : "s"
      } checked`,
    ),
  );
  return `${lines.join("\n")}\n`;
}

export function reportJson(report: ValidationReport): string {
  return `${JSON.stringify(
    {
      ok: report.ok,
      summary: report.summary,
      issues: report.issues,
    },
    null,
    2,
  )}\n`;
}
