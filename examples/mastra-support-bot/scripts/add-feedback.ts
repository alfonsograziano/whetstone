#!/usr/bin/env -S node --experimental-strip-types --no-warnings
// Attach a feedback record to an existing Mastra trace.
//
// Usage:
//   node scripts/add-feedback.ts \
//     --trace-id <id> \
//     --value down \
//     --comment "claimed a refund was processed without calling issue_refund"

import { parseArgs, styleText } from "node:util";

const { values } = parseArgs({
  args: process.argv.slice(2),
  options: {
    "trace-id": { type: "string" },
    value: { type: "string" },
    comment: { type: "string" },
    type: { type: "string", default: "thumbs" },
    source: { type: "string", default: "user" },
    "user-id": { type: "string", default: "cli-user" },
    "mastra-url": { type: "string", default: "http://localhost:4111" },
    help: { type: "boolean", short: "h", default: false },
  },
});

if (values.help) {
  console.log(`Attach feedback to a Mastra trace via the observability API.

Required:
  --trace-id <id>    The trace to annotate (from \`scripts/chat.ts\`)
  --value <v>        Feedback value: 'up' | 'down' | a number | free text
  --comment <text>   Annotation comment

Optional:
  --type <t>         Feedback type (default: thumbs). Common: thumbs, rating, correction
  --source <s>       Feedback source (default: user). Common: user, sme, qa, admin
  --user-id <id>     User id recorded with the feedback (default: cli-user)
  --mastra-url <url> Mastra server (default: http://localhost:4111)
  -h, --help         Show this help
`);
  process.exit(0);
}

const missing = (["trace-id", "value", "comment"] as const).filter((k) => !values[k]);
if (missing.length) {
  console.error(styleText("red", `error: missing required flag(s): ${missing.map((k) => `--${k}`).join(", ")}`));
  console.error(styleText("dim", "run with --help for usage"));
  process.exit(2);
}

const baseUrl = values["mastra-url"]!.replace(/\/$/, "");

const rawValue = values.value!;
const numeric = Number(rawValue);
const value: string | number = Number.isFinite(numeric) && rawValue.trim() !== "" ? numeric : rawValue;

const body = {
  feedback: {
    feedbackType: values.type!,
    value,
    comment: values.comment!,
    feedbackSource: values.source!,
    feedbackUserId: values["user-id"]!,
    traceId: values["trace-id"]!,
  },
};

const res = await fetch(`${baseUrl}/api/observability/feedback`, {
  method: "POST",
  headers: { "content-type": "application/json", accept: "application/json" },
  body: JSON.stringify(body),
});

if (!res.ok) {
  const text = await res.text().catch(() => "");
  console.error(styleText("red", `error: POST /api/observability/feedback → ${res.status} ${res.statusText}`));
  if (text) console.error(text);
  process.exit(1);
}

const result = (await res.json().catch(() => ({}))) as { feedback?: { feedbackId?: string } };
const feedbackId = result.feedback?.feedbackId;

console.log(
  styleText("green", "✓ feedback recorded"),
  styleText("dim", `(traceId=${values["trace-id"]}${feedbackId ? `, feedbackId=${feedbackId}` : ""})`),
);
