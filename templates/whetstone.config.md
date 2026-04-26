# Whetstone config

This file teaches Whetstone the project specifics every skill needs to do its job.
It is read by every skill before it acts. Edit freely; commit it like any other doc.

## Agent under test

- Name: `<your-agent>`
- Repo root: `./agent`
- Entry point: `npm run agent:start`

## Adapters

- Langfuse: env `LANGFUSE_HOST`, `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`
- Pull window: last 24h, page size 100

Add or remove adapters under `adapters/`. The `ingest-traces` skill calls these.

## Sanity checks (run before any code change is committed)

- `npm run typecheck`
- `npm run lint`
- `npm test -- --run`

## Eval / scenario tools (the agent may invoke these freely)

- `npm run agent:eval -- --scenario <name>` — runs a named scenario from `evals/scenarios/*.yaml`
- `npm run agent:replay -- --trace-ids <file>` — replays a list of trace IDs against the current agent build, emits pass/fail per trace
- `npm run prompt:diff` — prints diff between deployed prompt and working tree

## Golden datasets & scorers (used by the optional `harden` skill)

- Golden dataset path: `evals/golden/`. New entries land as JSONL files named after the failure mode.
- Deterministic scorer path: `evals/scorers/*.ts`. Each scorer exports a `(trace) => { pass: boolean, reason?: string }` function.
- LLM-as-judge scorer path: `evals/scorers/*.judge.md`. Each judge is a markdown prompt + rubric; the runner injects the trace.
- Run all scorers locally with: `npm run evals:run -- --suite all`

## Hard rules

- Never modify `agent/src/payments/**` without a human in the loop.
- Never push to `main`. Always work on `whetstone/<failure_mode_id>` branches.
- Redact PII before committing trace fixtures.
- For any shell-level JSON manipulation (reading, filtering, slicing files under `traces/` or `failure_modes.json`), use `jq` — never `grep`/`sed`/`awk` against JSON.

## Batch sizing

- `analyze-traces` batch size: 20
- Max batches per `analyze-traces` invocation: 10
