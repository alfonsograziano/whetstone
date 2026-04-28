#!/usr/bin/env -S node --experimental-strip-types --no-warnings
// Mastra → Whetstone adapter.
//
// Pulls feedback (annotations / comments) from a running Mastra server
// (typically `mastra dev` on http://localhost:4111), groups it by trace,
// fetches each annotated trace, and writes Whetstone-shape Trace records
// as JSONL into whetstone/traces/.
//
// Only traces with at least one feedback record are emitted — this is the
// "filter to annotated/commented traces" requirement.
//
// Usage:
//   node whetstone/adapters/mastra.ts \
//     --max-traces 50 \
//     --from 2026-04-01T00:00:00Z \
//     --to   2026-04-26T23:59:59Z \
//     --mastra-url http://localhost:4111 \
//     --out whetstone/traces/mastra-2026-04-26.jsonl

import { parseArgs, styleText } from "node:util";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { z } from "zod";

// ---------- CLI args ----------

const { values } = parseArgs({
  options: {
    "max-traces": { type: "string", default: "100" },
    from: { type: "string" },
    to: { type: "string" },
    "mastra-url": { type: "string", default: "http://localhost:4111" },
    out: { type: "string" },
    "page-size": { type: "string", default: "100" },
    help: { type: "boolean", short: "h", default: false },
  },
  strict: true,
});

if (values.help) {
  console.log(`Mastra → Whetstone trace adapter

Options:
  --max-traces <n>     Maximum number of unique traces to emit (default: 100)
  --from <iso>         Start of date range (ISO 8601). Default: 24h ago
  --to <iso>           End of date range (ISO 8601). Default: now
  --mastra-url <url>   Base URL of the Mastra server (default: http://localhost:4111)
  --out <path>         Output JSONL path. Default: whetstone/traces/mastra-<YYYY-MM-DD>.jsonl
  --page-size <n>      Feedback page size, max 100 (default: 100)
  -h, --help           Show this help
`);
  process.exit(0);
}

const now = new Date();
const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

const argsSchema = z.object({
  maxTraces: z.coerce.number().int().positive().max(10_000),
  from: z.coerce.date(),
  to: z.coerce.date(),
  mastraUrl: z.string().url(),
  out: z.string().min(1),
  pageSize: z.coerce.number().int().min(1).max(100),
});

const today = now.toISOString().slice(0, 10);
const args = argsSchema.parse({
  maxTraces: values["max-traces"],
  from: values.from ?? dayAgo.toISOString(),
  to: values.to ?? now.toISOString(),
  mastraUrl: values["mastra-url"]!.replace(/\/$/, ""),
  out: values.out ?? `whetstone/traces/mastra-${today}.jsonl`,
  pageSize: values["page-size"],
});

if (args.from >= args.to) {
  console.error(styleText("red", "error: --from must be earlier than --to"));
  process.exit(2);
}

// ---------- Mastra response shapes (loose; verify on parse) ----------

const FeedbackRecordSchema = z
  .object({
    feedbackId: z.string().nullish(),
    timestamp: z.coerce.date(),
    traceId: z.string().nullish(),
    spanId: z.string().nullish(),
    feedbackSource: z.string().nullish(),
    source: z.string().nullish(),
    feedbackType: z.string(),
    value: z.union([z.number(), z.string()]),
    comment: z.string().nullish(),
    feedbackUserId: z.string().nullish(),
    metadata: z.record(z.string(), z.unknown()).nullish(),
  })
  .passthrough();

const ListFeedbackResponseSchema = z.object({
  pagination: z
    .object({
      total: z.number().optional(),
      page: z.number().optional(),
      perPage: z.union([z.number(), z.literal(false)]).optional(),
      hasMore: z.boolean().optional(),
    })
    .passthrough(),
  feedback: z.array(FeedbackRecordSchema),
});

type FeedbackRecord = z.infer<typeof FeedbackRecordSchema>;

// ---------- HTTP helpers ----------

async function getJson(url: string): Promise<unknown> {
  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`GET ${url} → ${res.status} ${res.statusText}\n${body}`);
  }
  return res.json();
}

async function listAnnotatedFeedback(): Promise<FeedbackRecord[]> {
  const collected: FeedbackRecord[] = [];
  const seenTraceIds = new Set<string>();
  let page = 0;

  while (seenTraceIds.size < args.maxTraces) {
    const params = new URLSearchParams({
      "timestamp.start": args.from.toISOString(),
      "timestamp.end": args.to.toISOString(),
      page: String(page),
      perPage: String(args.pageSize),
      "field": "timestamp",
      "direction": "DESC",
    });
    const url = `${args.mastraUrl}/api/observability/feedback?${params.toString()}`;
    const raw = await getJson(url);
    const parsed = ListFeedbackResponseSchema.parse(raw);

    for (const fb of parsed.feedback) {
      if (!fb.traceId) continue;
      collected.push(fb);
      seenTraceIds.add(fb.traceId);
      if (seenTraceIds.size >= args.maxTraces) break;
    }

    if (!parsed.pagination.hasMore || parsed.feedback.length === 0) break;
    page += 1;
  }

  return collected;
}

async function fetchTrace(traceId: string): Promise<unknown> {
  return getJson(
    `${args.mastraUrl}/api/observability/traces/${encodeURIComponent(traceId)}`,
  );
}

// ---------- Mapping into Whetstone shape ----------

type WhetstoneFeedback = {
  sentiment: "positive" | "negative";
  source: "user" | "sme" | "other";
  comment: string;
};

function inferSentiment(fb: FeedbackRecord): "positive" | "negative" {
  const t = fb.feedbackType.toLowerCase();
  if (t.includes("thumb")) {
    return String(fb.value).toLowerCase() === "up" ? "positive" : "negative";
  }
  if (typeof fb.value === "number") return fb.value >= 3 ? "positive" : "negative";
  if (t === "rating") {
    const n = Number(fb.value);
    if (Number.isFinite(n)) return n >= 3 ? "positive" : "negative";
  }
  // Free-form annotations / corrections default to negative — the SME bothered
  // to leave a comment, which is overwhelmingly because something was wrong.
  return "negative";
}

function inferSource(fb: FeedbackRecord): "user" | "sme" | "other" {
  const raw = (fb.feedbackSource ?? fb.source ?? "").toLowerCase();
  if (raw === "user" || raw === "end_user" || raw === "customer") return "user";
  if (["sme", "qa", "admin", "reviewer", "annotator"].includes(raw)) return "sme";
  return "other";
}

function toWhetstoneFeedback(fb: FeedbackRecord): WhetstoneFeedback {
  const comment = fb.comment?.trim() || `${fb.feedbackType}=${String(fb.value)}`;
  return {
    sentiment: inferSentiment(fb),
    source: inferSource(fb),
    comment,
  };
}

// Pull a clean (input, output) pair out of a Mastra trace.
//
// Mastra agent traces include an `agent_run` root span whose `input` is the
// caller's message array and whose `output.text` is the final assistant
// reply. Prefer that. For non-agent traces (workflows, raw model calls, etc.)
// fall back to the first span with a usable input/output.
function extractInputOutput(trace: unknown): { input: string; output: string } {
  const spans: any[] = (trace as any)?.spans ?? [];
  const agentRun = spans.find((s) => s?.spanType === "agent_run");
  if (agentRun) {
    return {
      input: extractInput(agentRun.input),
      output: extractOutput(agentRun.output),
    };
  }
  for (const span of spans) {
    const candidate = {
      input: extractInput(span?.input),
      output: extractOutput(span?.output),
    };
    if (candidate.input || candidate.output) return candidate;
  }
  return { input: "", output: "" };
}

function extractInput(i: unknown): string {
  if (i == null) return "";
  if (typeof i === "string") return i;
  const messages = Array.isArray(i)
    ? i
    : Array.isArray((i as any)?.messages)
      ? (i as any).messages
      : Array.isArray((i as any)?.prompt?.messages)
        ? (i as any).prompt.messages
        : null;
  if (messages) {
    const userMsg = messages.find((m: any) => m?.role === "user");
    if (userMsg) return stringifyContent(userMsg.content);
  }
  return stringifyContent(i);
}

function extractOutput(o: unknown): string {
  if (o == null) return "";
  if (typeof o === "string") return o;
  if (typeof (o as any)?.text === "string") return (o as any).text;
  if (Array.isArray((o as any)?.messages)) {
    const last = [...(o as any).messages].reverse().find((m: any) => m?.role === "assistant");
    if (last) return stringifyContent(last.content);
  }
  return stringifyContent(o);
}

function stringifyContent(c: unknown): string {
  if (c == null) return "";
  if (typeof c === "string") return c;
  if (Array.isArray(c)) {
    return c
      .map((part) => (typeof part === "string" ? part : (part as any)?.text ?? JSON.stringify(part)))
      .join("");
  }
  try {
    return JSON.stringify(c).slice(0, 4000);
  } catch {
    return String(c);
  }
}

// ---------- Main ----------

async function main() {
  console.error(
    styleText(
      "gray",
      `Pulling feedback from ${args.mastraUrl} between ${args.from.toISOString()} and ${args.to.toISOString()} (max ${args.maxTraces} traces)…`,
    ),
  );

  const feedback = await listAnnotatedFeedback();
  if (feedback.length === 0) {
    console.error(styleText("yellow", "No annotated feedback found in the given window."));
    await writeOutput([]);
    return;
  }

  const byTrace = new Map<string, FeedbackRecord[]>();
  for (const fb of feedback) {
    const arr = byTrace.get(fb.traceId!) ?? [];
    arr.push(fb);
    byTrace.set(fb.traceId!, arr);
  }

  const traceIds = [...byTrace.keys()].slice(0, args.maxTraces);
  console.error(
    styleText("gray", `Fetching ${traceIds.length} annotated trace(s)…`),
  );

  const records: unknown[] = [];
  for (const traceId of traceIds) {
    let original: unknown;
    try {
      original = await fetchTrace(traceId);
    } catch (err) {
      console.error(
        styleText("yellow", `  skip ${traceId}: ${(err as Error).message}`),
      );
      continue;
    }
    const { input, output } = extractInputOutput(original);
    const outPath = resolve(process.cwd(), args.out);
    const originalDir = resolve(dirname(outPath), "original");
    await mkdir(originalDir, { recursive: true });
    const originalFile = `${traceId}.json`;
    await writeFile(
      resolve(originalDir, originalFile),
      JSON.stringify(original, null, 2),
      "utf8",
    );
    records.push({
      id: traceId,
      input,
      output,
      feedback: byTrace.get(traceId)!.map(toWhetstoneFeedback),
      originalTraceFile: `original/${originalFile}`,
      failureModeIds: [],
      analysis: { status: "pending", analyzedAt: null, notes: null },
    });
  }

  await writeOutput(records);
  console.error(
    styleText(
      "green",
      `Wrote ${records.length} trace(s) to ${args.out}`,
    ),
  );
}

async function writeOutput(records: unknown[]): Promise<void> {
  const outPath = resolve(process.cwd(), args.out);
  const outDir = dirname(outPath);
  const originalDir = resolve(outDir, "original");
  await mkdir(originalDir, { recursive: true });
  const body = records.map((r) => JSON.stringify(r)).join("\n") + (records.length ? "\n" : "");
  await writeFile(outPath, body, "utf8");
}

main().catch((err) => {
  console.error(styleText("red", `error: ${(err as Error).message}`));
  process.exit(1);
});
