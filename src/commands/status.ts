import { createReadStream } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { styleText } from "node:util";

import {
  FailureModesFileSchema,
  type FailureMode,
} from "../schemas/index.ts";
import { resolveAgentRootForRead } from "./agent-root.ts";

const LIFECYCLE_ORDER = [
  "discovered",
  "triaged",
  "investigating",
  "spec_drafted",
  "fix_approved",
  "fix_in_progress",
  "verifying",
  "verified",
  "regressed",
  "hardening",
  "hardened",
  "wont_fix",
  "closed",
  "duplicate_of",
] as const;

const RECENT_LIMIT = 5;

export interface StatusFailureModeSummary {
  id: string;
  title: string;
  status: string;
  lastUpdated: string | null;
}

export interface StatusTraceFileSummary {
  filename: string;
  totalTraces: number;
  pendingTraces: number;
}

export interface StatusReport {
  /** Absolute path to the `tracebound/<agent>/` root that was inspected. */
  rootPath: string;
  catalogue: {
    totalFailureModes: number;
    /** Counts keyed by lifecycle state; `duplicate_of:*` collapses to "duplicate_of". */
    byStatus: Record<string, number>;
    recentlyUpdated: StatusFailureModeSummary[];
    specsAwaitingApproval: StatusFailureModeSummary[];
  };
  traces: {
    fileCount: number;
    pendingCount: number;
    perFile: StatusTraceFileSummary[];
    /** Number of raw trace files stored under traces/original/. */
    originalTraceCount: number;
  };
}

export interface StatusOptions {
  cwd?: string;
  agent?: string;
}

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

function bucketStatus(status: string): string {
  return status.startsWith("duplicate_of:") ? "duplicate_of" : status;
}

function summary(fm: FailureMode): StatusFailureModeSummary {
  return {
    id: fm.id,
    title: fm.title,
    status: fm.status,
    lastUpdated: fm.lastUpdated ?? null,
  };
}

/** Sort by lastUpdated desc, falling back to id for stability. Nulls sort last. */
function compareByRecency(
  a: StatusFailureModeSummary,
  b: StatusFailureModeSummary,
): number {
  if (a.lastUpdated && b.lastUpdated) {
    if (a.lastUpdated > b.lastUpdated) return -1;
    if (a.lastUpdated < b.lastUpdated) return 1;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  }
  if (a.lastUpdated) return -1;
  if (b.lastUpdated) return 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

async function summariseTraceFile(
  absPath: string,
): Promise<{ totalTraces: number; pendingTraces: number }> {
  let totalTraces = 0;
  let pendingTraces = 0;

  const stream = createReadStream(absPath, { encoding: "utf8" });
  const rl = createInterface({ input: stream, crlfDelay: Infinity });

  for await (const raw of rl) {
    const line = raw.trim();
    if (line === "") continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    totalTraces += 1;
    if (
      parsed &&
      typeof parsed === "object" &&
      "analysis" in parsed &&
      (parsed as { analysis?: { status?: unknown } }).analysis?.status ===
        "pending"
    ) {
      pendingTraces += 1;
    }
  }

  return { totalTraces, pendingTraces };
}

export async function runStatus(
  options: StatusOptions = {},
): Promise<StatusReport> {
  const { rootPath, agentName } = await resolveAgentRootForRead({
    cwd: options.cwd,
    agent: options.agent,
  });

  // Catalogue.
  const fmPath = join(rootPath, "failure_modes.json");
  const fmInfo = await inspectPath(fmPath);
  if (!fmInfo.exists || !fmInfo.isFile) {
    throw new Error(
      `failure_modes.json is missing under ${rootPath}. Run "tracebound init ${agentName}" or "tracebound validate --agent ${agentName}" to recover.`,
    );
  }

  const raw = await readFile(fmPath, "utf8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(
      `failure_modes.json is not valid JSON (${(err as Error).message}). Run "tracebound validate --agent ${agentName}" for details.`,
    );
  }
  const result = FailureModesFileSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(
      `failure_modes.json does not match the FailureModesFile schema. Run "tracebound validate --agent ${agentName}" for the structured report.`,
    );
  }

  const failureModes = result.data.failureModes;
  const byStatus: Record<string, number> = {};
  for (const fm of failureModes) {
    const bucket = bucketStatus(fm.status);
    byStatus[bucket] = (byStatus[bucket] ?? 0) + 1;
  }
  // Reorder by lifecycle, then any extras alphabetically (defensive against new states).
  const orderedByStatus: Record<string, number> = {};
  for (const key of LIFECYCLE_ORDER) {
    if (byStatus[key] !== undefined) orderedByStatus[key] = byStatus[key];
  }
  for (const key of Object.keys(byStatus).sort()) {
    if (orderedByStatus[key] === undefined) orderedByStatus[key] = byStatus[key]!;
  }

  const allSummaries = failureModes.map(summary).sort(compareByRecency);
  const recentlyUpdated = allSummaries.slice(0, RECENT_LIMIT);
  const specsAwaitingApproval = allSummaries.filter(
    (s) => s.status === "spec_drafted",
  );

  // Traces.
  const tracesDir = join(rootPath, "traces");
  const tracesInfo = await inspectPath(tracesDir);
  const perFile: StatusTraceFileSummary[] = [];
  let pendingCount = 0;

  let originalTraceCount = 0;

  if (tracesInfo.exists && tracesInfo.isDir) {
    const entries = (await readdir(tracesDir))
      .filter((n) => n.endsWith(".jsonl"))
      .sort();
    for (const name of entries) {
      const abs = join(tracesDir, name);
      const info = await inspectPath(abs);
      if (!info.isFile) continue;
      const counts = await summariseTraceFile(abs);
      perFile.push({ filename: name, ...counts });
      pendingCount += counts.pendingTraces;
    }

    const originalDir = join(tracesDir, "original");
    const originalInfo = await inspectPath(originalDir);
    if (originalInfo.exists && originalInfo.isDir) {
      const origEntries = await readdir(originalDir);
      for (const name of origEntries) {
        const info = await inspectPath(join(originalDir, name));
        if (info.isFile) originalTraceCount += 1;
      }
    }
  }

  return {
    rootPath,
    catalogue: {
      totalFailureModes: failureModes.length,
      byStatus: orderedByStatus,
      recentlyUpdated,
      specsAwaitingApproval,
    },
    traces: {
      fileCount: perFile.length,
      pendingCount,
      perFile,
      originalTraceCount,
    },
  };
}

// ---------------------------------------------------------------------------
// Reporters
// ---------------------------------------------------------------------------

function pad(n: number, width: number): string {
  return String(n).padStart(width, " ");
}

export function reportText(report: StatusReport): string {
  const lines: string[] = [];
  const { catalogue, traces } = report;

  lines.push(
    styleText(
      "bold",
      `Catalogue: ${catalogue.totalFailureModes} failure mode${
        catalogue.totalFailureModes === 1 ? "" : "s"
      }`,
    ),
  );

  if (catalogue.totalFailureModes === 0) {
    lines.push(
      `  ${styleText("dim", "(empty — no failure modes recorded yet)")}`,
    );
  } else {
    const labelWidth = Math.max(
      ...Object.keys(catalogue.byStatus).map((k) => k.length),
    );
    const countWidth = Math.max(
      ...Object.values(catalogue.byStatus).map((v) => String(v).length),
    );
    for (const [status, count] of Object.entries(catalogue.byStatus)) {
      const label = status.padEnd(labelWidth, " ");
      const flag =
        status === "spec_drafted" && count > 0
          ? styleText("dim", "  ← awaiting approval")
          : "";
      lines.push(`  ${label}  ${pad(count, countWidth)}${flag}`);
    }
  }

  lines.push("");
  lines.push(
    styleText(
      "bold",
      `Traces: ${traces.fileCount} file${
        traces.fileCount === 1 ? "" : "s"
      }, ${traces.pendingCount} pending`,
    ),
  );
  if (traces.fileCount === 0) {
    lines.push(`  ${styleText("dim", "(no .jsonl files under traces/)")}`);
  } else {
    const nameWidth = Math.max(...traces.perFile.map((f) => f.filename.length));
    for (const f of traces.perFile) {
      const pendingLabel =
        f.pendingTraces > 0
          ? styleText("yellow", `${f.pendingTraces} pending`)
          : styleText("dim", "0 pending");
      lines.push(
        `  ${f.filename.padEnd(nameWidth, " ")}  ${pad(
          f.totalTraces,
          4,
        )} traces, ${pendingLabel}`,
      );
    }
    if (traces.originalTraceCount > 0) {
      lines.push(
        `  ${styleText("dim", `${traces.originalTraceCount} raw file${traces.originalTraceCount === 1 ? "" : "s"} in traces/original/`)}`,
      );
    }
  }

  if (catalogue.recentlyUpdated.length > 0) {
    lines.push("");
    lines.push(styleText("bold", "Recently updated:"));
    for (const fm of catalogue.recentlyUpdated) {
      const ts = fm.lastUpdated ?? styleText("dim", "no timestamp");
      lines.push(`  ${fm.id}  ${styleText("dim", `(${fm.status}, ${ts})`)}`);
      lines.push(`    ${fm.title}`);
    }
  }

  if (catalogue.specsAwaitingApproval.length > 0) {
    lines.push("");
    lines.push(
      styleText(
        "bold",
        `SPECs awaiting approval: ${catalogue.specsAwaitingApproval.length}`,
      ),
    );
    for (const fm of catalogue.specsAwaitingApproval) {
      const ts = fm.lastUpdated ?? styleText("dim", "no timestamp");
      lines.push(`  ${fm.id}  ${styleText("dim", `(${ts})`)}`);
      lines.push(`    ${fm.title}`);
    }
  }

  return `${lines.join("\n")}\n`;
}

export function reportJson(report: StatusReport): string {
  return `${JSON.stringify(
    {
      rootPath: report.rootPath,
      catalogue: report.catalogue,
      traces: report.traces,
    },
    null,
    2,
  )}\n`;
}
