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
### Targeted trace replay
Command: `npm run agent:replay -- --failure-mode <id>`

This command must:
- Consume the failure-mode cohort `input` values (for example via `--failure-mode <id>` or a JSONL file exported from `failure_modes.json`).
- Invoke the agent on every captured input and emit a structured pass/fail outcome for each replayed trace.
- Exit 0 when all traces replay successfully and non-zero when the replay cannot run to completion.

If this subsection is absent or the `Command:` line is missing, `implement-failure-mode` will warn and fall back to the Eval suites or Sanity checks documented below.

### Eval suites
- `npm run agent:eval -- --scenario <name>` — runs a named scenario from `evals/scenarios/*.yaml`
- `npm run prompt:diff` — prints diff between deployed prompt and working tree

List every regression suite or scenario runner that should execute after a targeted replay succeeds. Include any flags required to scope the run to this failure mode.

### Sanity checks
- `npm run typecheck`
- `npm run lint`
- `npm test -- --run`

Document quick-running commands teams must execute when no higher-fidelity verification mode is available. `implement-failure-mode` will surface a warning if only these checks are present.
-->

## Harden the fix (optional)

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
