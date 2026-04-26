#!/usr/bin/env -S node --experimental-strip-types --no-warnings
// Send a single message to a Mastra agent over the dev-server HTTP API and
// print the response plus the traceId that observability recorded for it.
//
// Usage:
//   node scripts/chat.ts "I want a refund for order #4421"
//   node scripts/chat.ts --agent supportAgent --thread-id t-1 "hello"

import { parseArgs, styleText } from "node:util";
import { randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";

const { values, positionals } = parseArgs({
  args: process.argv.slice(2),
  options: {
    agent: { type: "string", default: "support-agent" },
    "mastra-url": { type: "string", default: "http://localhost:4111" },
    "thread-id": { type: "string" },
    "resource-id": { type: "string" },
    "run-id": { type: "string" },
    json: { type: "boolean", default: false },
    help: { type: "boolean", short: "h", default: false },
  },
  allowPositionals: true,
});

if (values.help || positionals.length === 0) {
  console.log(`Send a chat message to a Mastra agent and print the traceId.

Usage:
  node scripts/chat.ts [options] <message...>

Options:
  --agent <id>          Agent registry key (default: support-agent)
  --mastra-url <url>    Mastra dev server (default: http://localhost:4111)
  --thread-id <id>      Conversation thread (enables memory if configured)
  --resource-id <id>    Resource id for memory scoping
  --run-id <id>         Override the generated runId (default: random UUID)
  --json                Print full JSON output instead of pretty text
  -h, --help            Show this help
`);
  process.exit(values.help ? 0 : 2);
}

const baseUrl = values["mastra-url"]!.replace(/\/$/, "");
const message = positionals.join(" ");
const runId = values["run-id"] ?? randomUUID();

async function postGenerate(): Promise<{ text: string; raw: unknown }> {
  const res = await fetch(`${baseUrl}/api/agents/${encodeURIComponent(values.agent!)}/generate`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({
      messages: [{ role: "user", content: message }],
      runId,
      threadId: values["thread-id"],
      resourceId: values["resource-id"],
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`POST /api/agents/${values.agent}/generate → ${res.status} ${res.statusText}\n${body}`);
  }
  const raw = (await res.json()) as { text?: string };
  return { text: raw.text ?? "", raw };
}

async function findTraceIdForRun(): Promise<string | null> {
  const params = new URLSearchParams({ runId, perPage: "5", page: "0" });
  const url = `${baseUrl}/api/observability/traces?${params.toString()}`;
  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (!res.ok) return null;
  const body = (await res.json()) as { spans?: Array<{ traceId?: string; runId?: string }> };
  const span = body.spans?.find((s) => s?.runId === runId) ?? body.spans?.[0];
  return span?.traceId ?? null;
}

async function pollTraceId(maxMs = 5000, stepMs = 250): Promise<string | null> {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    const id = await findTraceIdForRun();
    if (id) return id;
    await sleep(stepMs);
  }
  return null;
}

const { text, raw } = await postGenerate();
const traceId = await pollTraceId();

if (values.json) {
  console.log(JSON.stringify({ traceId, runId, response: raw }, null, 2));
} else {
  console.log(styleText(["bold", "cyan"], "user:"), message);
  console.log(styleText(["bold", "green"], "agent:"), text);
  console.log();
  console.log(
    styleText("dim", "runId:   "),
    runId,
  );
  console.log(
    styleText("dim", "traceId: "),
    traceId ?? styleText("yellow", "(not found — trace export may still be flushing)"),
  );
}
