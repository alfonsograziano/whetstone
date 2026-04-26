# Whetstone config — mastra-support-bot

This file teaches Whetstone the project specifics every skill needs to do its
job. It is read by every skill before it acts. Edit freely; commit it like
any other doc.

## Agent under test

- **Name:** `support-agent` (Mastra registry id; see [src/mastra/agents/support-agent.ts](../src/mastra/agents/support-agent.ts))
- **Repo root:** the parent of this `whetstone/` directory (i.e. `examples/mastra-support-bot/`)
- **Framework:** [Mastra](https://mastra.ai), Node ≥ 22.6, native TypeScript via `--experimental-strip-types`
- **Model:** `openai/gpt-5-mini` (configured on the agent; needs `OPENAI_API_KEY`)
- **Entry point:** `npm run dev` — boots Mastra Studio + REST API on `http://localhost:4111`. Must be running for any of the scripts below.

The agent misbehaves *on purpose* — its instructions push it to confidently
confirm refunds and cancellations, but it only has a `lookup_order` tool. The
result is a reliable supply of "hallucinated side-effect" traces.

## Storage

Composite store wired in [src/mastra/index.ts](../src/mastra/index.ts):

- **LibSQL** (`mastra.db`) — default domains (memory, agents, workflows, …)
- **DuckDB** (`mastra-observability.duckdb`) — observability domain only (traces + feedback)

DuckDB is only there because LibSQL doesn't yet implement feedback persistence. Both files are local and gitignored.

## Adapters

Single adapter, [whetstone/adapters/mastra.ts](adapters/mastra.ts):

```bash
node whetstone/adapters/mastra.ts \
  --max-traces 50 \
  --from 2026-04-26T00:00:00Z \
  --to   2026-04-27T00:00:00Z
# defaults: last 24h, max 100 traces, --mastra-url http://localhost:4111
# output:   whetstone/traces/mastra-<YYYY-MM-DD>.jsonl
```

What it does: lists `/api/observability/feedback` in the date window,
groups by `traceId`, fetches each trace via
`/api/observability/traces/:traceId`, and emits one Whetstone-shape
record per line. **Only traces with at least one feedback record are
emitted** — that is the "annotated traces" filter.

## Helper scripts (interactive, used to seed traces)

These are not adapters — they're how a human (or skill) drives the live
agent so there's something to ingest. Both target the running dev
server.

| Command | What it does |
|---|---|
| `node scripts/chat.ts "<message>"` | Sends one message to `support-agent`, prints the agent's reply and the `traceId` recorded by observability. Pass `--thread-id` for memory, `--json` for the full payload, `-h` for the rest. |
| `node scripts/add-feedback.ts --trace-id <id> --value <v> --comment "<text>"` | POSTs a feedback record to the trace via `/api/observability/feedback`. Optional: `--type` (default `thumbs`), `--source` (`user`/`sme`/`qa`/…), `--user-id`. |

The chat tool generates a `runId`, passes it to
`/api/agents/support-agent/generate`, then polls
`/api/observability/traces?runId=…` for up to 5s to recover the
`traceId` (Mastra doesn't return it on the generate response).


## Sanity checks

This example has no test suite or linter — there's no production code
under test, just the demo agent. Treat sanity-checking as:

- `npm run dev` boots cleanly and `http://localhost:4111/api/agents` returns `support-agent`.

## Eval / scenario tools

Not wired for this example. The closest thing to "replay" is re-running
`scripts/chat.ts` against the same prompt and inspecting the new trace
in Studio. Add real eval/scenario commands here if you grow this past
the demo.

## Golden datasets & scorers

Not configured. The optional `harden` skill expects `evals/golden/` and
`evals/scorers/` paths; if you opt into hardening for a failure mode,
add those directories and document the runner here.

## Hard rules

- **Never auto-commit, push, or open PRs.** Skills edit files and stop; the user owns shared-state actions.
- **Use `jq` for any shell-level JSON manipulation** of `traces/` or `failure_modes.json`. No `grep`/`sed`/`awk` against JSON. In-process TS uses `JSON.parse`/`stringify` normally.
- **Don't commit secrets.** `.env` is gitignored; trace fixtures may contain agent inputs/outputs — redact before committing if you turn the demo into anything real.
- **`mastra.db` and `mastra-observability.duckdb` are gitignored** by design. Treat them as ephemeral; the source of truth for traces is the JSONL under `whetstone/traces/`.

## Batch sizing

- `analyze-traces` batch size: 20
- Max batches per `analyze-traces` invocation: 10
