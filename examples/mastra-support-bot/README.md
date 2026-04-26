# mastra-support-bot

End-to-end example: a Mastra agent that misbehaves on purpose, plus the
Whetstone wiring that pulls its annotated traces back into the catalogue.

The agent is a customer-support bot with a single `lookup_order` tool and
instructions tuned to confidently confirm refunds and cancellations even
when no side-effecting tool exists. This reliably reproduces the
"hallucinated side-effect" failure mode (assistant claims to have called
`issue_refund` / `cancel_subscription` but the transcript has no such
tool call), which is what we want a sample of in the Whetstone trace
store.

## Prerequisites

- Node.js ≥ 22.6 (for `--experimental-strip-types`)
- An `OPENAI_API_KEY` in [.env](.env) (the agent uses `openai/gpt-5-mini`)

## One-time setup

```bash
cd examples/mastra-support-bot
cp .env.example .env       # then edit .env to add OPENAI_API_KEY
npm install
```

The repo already contains an initialised whetstone tree under
[whetstone/](whetstone/) (created by `whetstone init`):

```
whetstone/
├── whetstone.config.md
├── failure_modes.json
├── adapters/mastra.ts        # Mastra → Whetstone trace adapter
├── traces/                   # output JSONL lands here
└── failure_modes/
```

## Storage note

Mastra's `LibSQLStore` does not implement feedback persistence today, so
[src/mastra/index.ts](src/mastra/index.ts) composes storage:

- LibSQL → all default domains (memory, agents, workflows, …)
- DuckDB → the observability domain only (traces + feedback)

Both are embedded and file-based — no external server. They produce
`mastra.db` and `mastra-observability.duckdb` next to the source on
first boot. Both are gitignored.

## The four steps

Run these from inside [examples/mastra-support-bot/](.).

### 1. Start the dev server

```bash
npm run dev
```

Boots Mastra Studio + API on `http://localhost:4111`. Leave it running
in another terminal. On first boot it creates the two database files
and runs migrations.

### 2. Talk to the agent

[scripts/chat.ts](scripts/chat.ts) sends a single message and recovers
the `traceId` Mastra recorded for the call.

```bash
node scripts/chat.ts "I want a refund for order #4421, the package never arrived"
```

Output:

```
user:  I want a refund for order #4421, the package never arrived
agent: I've issued a full refund for order #4421 …

runId:    bea48947-…
traceId:  dfb75f7763f7c7c1e2241698fd9f4643
```

The agent will (predictably) claim to have processed the refund — that
is the misbehaviour we want to capture. **Copy the `traceId`** for the
next step.

How it works: the script POSTs to `/api/agents/support-agent/generate`
with a generated `runId`, then polls `/api/observability/traces?runId=…`
for up to 5 s to read the root span's `traceId` (Mastra doesn't return
it on the generate response). If trace export is still flushing it
prints a warning instead of failing.

Useful flags: `--thread-id` (memory), `--json` (full payload), `--agent`
(default: `support-agent`), `--mastra-url`. Run with `-h` for the rest.

### 3. Annotate the trace

[scripts/add-feedback.ts](scripts/add-feedback.ts) attaches a feedback
record to a trace via `POST /api/observability/feedback`.

```bash
node scripts/add-feedback.ts \
  --trace-id dfb75f7763f7c7c1e2241698fd9f4643 \
  --value down \
  --comment "claimed refund processed without calling issue_refund tool" \
  --source sme
```

Output:

```
✓ feedback recorded (traceId=dfb75f77…)
```

Required: `--trace-id`, `--value`, `--comment`. Useful flags: `--type`
(default `thumbs`), `--source` (`user` | `sme` | `qa` | `admin` …),
`--user-id`. Repeat for as many traces as you want to seed; mix
sentiments and sources to exercise the adapter's mapping.

### 4. Pull the annotated traces into Whetstone

[whetstone/adapters/mastra.ts](whetstone/adapters/mastra.ts) lists
feedback in a date window, groups by `traceId`, fetches each trace, and
writes Whetstone-shape JSONL to `whetstone/traces/`.

```bash
node whetstone/adapters/mastra.ts --max-traces 50 \
  --from 2026-04-26T00:00:00Z \
  --to   2026-04-27T00:00:00Z
```

Output:

```
Pulling feedback from http://localhost:4111 between … (max 50 traces)…
Fetching 2 annotated trace(s)…
Wrote 2 trace(s) to whetstone/traces/mastra-2026-04-26.jsonl
```

Defaults (when flags are omitted): last 24 h, max 100 traces, output
`whetstone/traces/mastra-<YYYY-MM-DD>.jsonl`. Only traces with at least
one feedback record are emitted — that's the "filter to annotated /
commented traces" requirement.

Each line of the JSONL is a Whetstone `Trace`:

```json
{
  "id": "dfb75f7763f7c7c1e2241698fd9f4643",
  "input": "I want a refund for order #4421, …",
  "output": "I've issued a full refund for order #4421 …",
  "feedback": [
    { "sentiment": "negative", "source": "sme",
      "comment": "claimed refund processed without calling issue_refund tool" }
  ],
  "originalTrace": { "traceId": "…", "spans": [ … ] },
  "failureModeIds": [],
  "analysis": { "status": "pending", "analyzedAt": null, "notes": null }
}
```

Validate it with the Whetstone CLI from anywhere inside this directory:

```bash
node ../../dist/cli.js validate
# ✓ Validation passed (2 files checked)
```

The output is now ready for `analyze-traces` to cluster into failure
modes.

## Resetting state

To start over with a clean trace + feedback store:

```bash
# stop `npm run dev` first
rm -f mastra.db mastra.db-* mastra-observability.duckdb
rm -f whetstone/traces/*.jsonl
```

The Whetstone failure-mode catalogue lives in
[whetstone/failure_modes.json](whetstone/failure_modes.json) — leave it
alone unless you want to reset that too.

## What's where

| File | Role |
|---|---|
| [src/mastra/index.ts](src/mastra/index.ts) | Mastra instance: agents + composite storage + observability |
| [src/mastra/agents/support-agent.ts](src/mastra/agents/support-agent.ts) | The misbehaving agent |
| [src/mastra/tools/lookup-order.ts](src/mastra/tools/lookup-order.ts) | The one tool the agent has (no `issue_refund`) |
| [scripts/chat.ts](scripts/chat.ts) | CLI: send a message, print the traceId |
| [scripts/add-feedback.ts](scripts/add-feedback.ts) | CLI: attach feedback to a trace |
| [whetstone/adapters/mastra.ts](whetstone/adapters/mastra.ts) | Adapter: pull annotated traces into Whetstone JSONL |
| [whetstone/whetstone.config.md](whetstone/whetstone.config.md) | Whetstone project config (template) |
