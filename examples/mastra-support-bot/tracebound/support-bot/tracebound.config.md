# Tracebound config

<!--
This file teaches Tracebound the project specifics every skill needs to do its job.
It is read by every skill before it acts. Edit freely; commit it like any other doc.
-->

## Agent under test

<!--
- Name: `<your-agent>`
- Repo root: `./agent`
- Entry point: `npm run agent:start`
-->

## Adapters

<!--
- Langfuse: env `LANGFUSE_HOST`, `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`
- Pull window: last 24h, page size 100

Add or remove adapters under `adapters/`. The `ingest-traces` skill calls these.
-->

## Verify the fix

<!--
Document the commands to run after a fix to prove the failure is resolved.

### Targeted trace replay
- `npm run agent:replay -- --cohort traces/hallucinated-action.jsonl` — replays the captured failure-mode cohort; each trace `input` should now pass.

### Eval suites
- `npm run agent:eval -- --scenario support-bot` — runs the scenario built for this agent; describe how to read the output and interpret failures.

### Sanity checks (fallback)
- `npm run typecheck`
- `npm run lint`
- `npm test -- --run`
If only these checks are available, call it out so the implementer can warn and confirm before relying on them.
-->

## Optional hardening (golden datasets & scorers)

<!--
- Golden dataset path: `evals/golden/`. New entries land as JSONL files named after the failure mode.
- Deterministic scorer path: `evals/scorers/*.ts`. Each scorer exports a `(trace) => { pass: boolean, reason?: string }` function.
- LLM-as-judge scorer path: `evals/scorers/*.judge.md`. Each judge is a markdown prompt + rubric; the runner injects the trace.
- Run all scorers locally with: `npm run evals:run -- --suite all`
-->

## Hard rules

<!--
- Never modify `agent/src/payments/**` without a human in the loop.
- Never push to `main`. Always work on `tracebound/<failure_mode_id>` branches.
- Redact PII before committing trace fixtures.
- For any shell-level JSON manipulation (reading, filtering, slicing files under `traces/` or `failure_modes.json`), use `jq` — never `grep`/`sed`/`awk` against JSON.
-->

## Batch sizing

<!--
- `analyze-traces` batch size: 20
- Max batches per `analyze-traces` invocation: 10
-->
