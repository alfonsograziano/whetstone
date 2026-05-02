---
name: analyze-traces
description: Use this skill whenever the user asks to analyze, classify, cluster, or harvest failure modes from a Whetstone trace file (JSONL under `whetstone/<agent>/traces/`). Trigger on phrases like "run analyze-traces", "process this langfuse dump", "cluster the failures in traces/foo.jsonl", "update failure_modes.json from these traces", or any request to batch-process production agent traces into a failure-mode catalogue. The skill takes ONE agent and ONE trace file per invocation, filters traces with negative feedback signals, classifies each into existing or newly-created failure modes (biased toward reuse), and writes back enriched traces + an updated `failure_modes.json` — running `whetstone validate --agent <agent>` after every batch and self-correcting until it passes.
---

# analyze-traces

Whetstone's trace-clustering pass. Operates on a single agent at a time. Takes one JSONL file under `whetstone/<agent_name>/traces/`, processes its pending negatively-signalled traces in batches, and either matches each one to an existing failure mode, refines an existing failure mode's scope, or creates a new failure mode. Writes back transactionally to the trace file (in place) and `whetstone/<agent_name>/failure_modes.json`; runs `whetstone validate --agent <agent_name>` after every batch; on validation failure, reads the structured error report and self-corrects.

This skill is a closed-loop workflow over the user's working tree. It does not commit, push, or open PRs — it leaves the tree ready and stops. The user reviews the diff and decides what to ship. Recovery from a bad write is the user's working tree under git; the skill does not snapshot.

## Inputs

- **agent_name (required)** — the agent whose traces to analyze. If the user did not specify one, run `npx whetstone agents` and ask which agent to operate on. Stop until the user confirms. Print "Operating on agent: `<agent_name>`" before doing any other work.
- **trace_file (optional)** — path under `whetstone/<agent_name>/traces/`, e.g. `whetstone/support-bot/traces/langfuse-2026-04-26.jsonl`. If the user doesn't name a file, list the contents of `whetstone/<agent_name>/traces/` sorted by mtime descending, **propose the most recently modified file** ("Analyze `whetstone/<agent_name>/traces/langfuse-2026-04-27.jsonl` — the most recent? Or pick another."), and wait for confirmation. If the directory is empty, stop and tell the user.
- **batch_size (optional)** — default from `whetstone/<agent_name>/whetstone.config.md` ("Batch sizing" section); fallback `20`.
- **max_batches (optional)** — default from the same section; fallback `10`. After this, stop and tell the user how many traces remain so they can resume.

## Preflight (run before touching anything)

If any of these fail, stop and tell the user. Don't try to repair the project from this skill.

1. **Working tree is in a Whetstone project.** `whetstone/<agent_name>/whetstone.config.md`, `whetstone/<agent_name>/failure_modes.json`, and `whetstone/<agent_name>/traces/` all exist.
2. **The catalogue is already valid.** Run `npx whetstone validate --agent <agent_name>`. If it exits non-zero, stop — the project is in an inconsistent state and analyzing more traces will only compound the problem. Show the validate output and ask the user to fix the issues first.
3. **The chosen file exists** under `whetstone/<agent_name>/traces/` and parses as JSONL (one JSON object per non-blank line).
4. **Read the project config** (`whetstone/<agent_name>/whetstone.config.md`). Honor the configured batch size, any project-specific filter rules, and the hard rules. Quote the hard rules back to the user before the first batch so they're visible in the transcript.

## Workflow

### 1. Load context

Read into memory:

- `whetstone/<agent_name>/whetstone.config.md` — for batch sizing, filter rules, and hard rules.
- `whetstone/<agent_name>/failure_modes.json` — current catalogue. Index by `id`. Note titles, descriptions, and tags so you can reason about matches.
- The chosen trace file, line by line.

> **Do NOT preload `originalTraceFile` content for all traces upfront.** Each trace stores a path pointer (e.g. `"original/trc_abc123.json"`). Read those files on demand — only for the traces in the current batch, and only when classifying. Loading all raw traces at once defeats the purpose of splitting them out and will exhaust the context window on large files.

For inspecting JSON from the shell, prefer `jq` / `jq -c`. Don't `grep`/`sed`/`awk` against JSON — JSON's structure isn't line-oriented and a stray reformat or new field will silently break those filters.

### 2. Determine the eligible set and slice the batch

A trace is **eligible for analysis** when both:
- `analysis.status == "pending"`, AND
- it has at least one negative signal — `feedback[].sentiment == "negative"`. (If the project's config defines additional filter rules, apply them on top.)

Build the eligible set with `jq`, in file order:

```bash
jq -c 'select(.analysis.status == "pending" and ((.feedback // []) | any(.sentiment == "negative")))' \
  whetstone/<agent_name>/traces/<file>.jsonl
```

A pending trace with **no** negative signal is out of scope for this skill — when the time comes to process the batch, mark its `analysis.status = "skipped"` with a one-line note ("no negative feedback signals"). That satisfies the output contract that every processed trace ends in either `analyzed` or `skipped`.

Take the first `batch_size` traces from the eligible set; that's batch 1. Subsequent batches walk forward in file order. Stop after `max_batches` and report the remaining count.

### 3. Per batch — classify, write, validate

For each batch (cap at `max_batches`):

1. **Classify each trace in the batch.** For each one, choose between three options using the decision tree in §4 below.

    - A trace may match multiple failure modes if it genuinely exhibits multiple distinct failures.
    - A trace whose negative signal has no observable failure (e.g. thumbs-down on a correct answer) should be **skipped** with an explanatory note — don't manufacture a failure mode to absorb it.

2. **Apply the writes.** See §5 for exact field shapes.

    - **For each classified trace:** set `analysis.status = "analyzed"`, `analysis.analyzedAt = <current UTC ISO>`, `analysis.notes = <one-line classification rationale>`, and append the matched / refined / created failure-mode id(s) to `failureModeIds[]` (de-duplicate). Don't touch `input`, `output`, `feedback`, or `originalTrace` — those are adapter-owned.
    - **For pending-but-out-of-scope traces in the batch slice** (negative-signalled but no observable failure, or signal but ambiguous): set `analysis.status = "skipped"`, `analysis.notes = "<reason>"`. Don't touch `failureModeIds[]`.
    - **For each affected failure mode:** append `{ filename, traceId }` to `affectedTraces[]` (de-duplicate by `(filename, traceId)`); update `lastUpdated`. Then **enforce the 10-trace cap** — see the rule below. For newly created failure modes: pick `id = fm_<UTC year>_<UTC month>_<slug>` (slug = lowercased ASCII title with spaces → underscores, max ~6 words, no dates or trace ids), set `status = "discovered"`, `discoveredAt`, `lastUpdated`, `tags`, `title`, `description`, `affectedTraces`.

    > **10-trace cap on `affectedTraces[]`.** Each failure mode keeps at most **10** example traces. The list is a representative sample, not a full index — the canonical record of which traces belong to a failure mode is the `failureModeIds[]` backlink on each trace. After appending the new entry, if `affectedTraces[]` now has more than 10 entries, drop the oldest ones (by position in the array — earlier entries are older) until exactly 10 remain. When dropping an entry, do **not** touch the corresponding trace record — its `failureModeIds[]` backlink stays intact. This is intentional: `failureModeIds[]` on the trace is the source of truth; `affectedTraces[]` on the FM is a capped sample for human inspection.

3. **Write to disk.** Rewrite the trace file from memory (JSONL is line-structured; a full rewrite is needed for in-place edits). Pretty-print `failure_modes.json` with 2-space indent and a trailing newline.

4. **Validate, and self-correct on failure.** Run `npx whetstone validate --agent <agent_name> --json` (the JSON output is structured: each issue carries `code`, `file`, `line` (for JSONL), `path` (dotted JSON path), `message`, and `hint`).

    - On pass (exit 0): move to the next batch.
    - On fail (non-zero): read each issue, identify the offending field (the `path` is precise), apply a targeted fix, re-run, and re-validate. Loop. Common fixes by `code`:
        - `WHET_SCHEMA_TRACE` / `WHET_SCHEMA_FAILURE_MODES`: a field has the wrong type or is missing — re-derive the value (e.g. timestamp formatting, missing `tags: []`).
        - `WHET_FM_DUPLICATE_ID`: you generated a slug collision — append a disambiguator to the new FM's id and rewrite all references in this batch.
        - `WHET_FM_DUPLICATE_AFFECTED_TRACE`: you appended `(filename, traceId)` twice — drop the duplicate.
        - `WHET_FM_MISSING_TRACE_ID` / `WHET_FM_MISSING_TRACE_FILE`: the FM points at a trace that isn't in the file — fix the `affectedTraces` entry to match the trace's actual `id` and `filename`.
        - `WHET_FM_BACKLINK_MISSING`: the trace's `failureModeIds[]` doesn't include the FM that lists it — add the id back to the trace.
        - `WHET_TRACE_DANGLING_FM_REF`: a trace references an FM that doesn't exist — either the FM creation was dropped (re-add it) or the reference is stale (remove it from the trace).
    - If you've looped 5 times on the same batch without converging, stop and surface the remaining issues to the user — that's a classification or schema bug that needs human eyes.

After each batch passes validate, summarise to the user in one line: "Batch N: M traces analyzed, K skipped, J failure modes touched (X new, Y refined)."

### 4. Classification heuristics — match, refine, or create?

The catalogue is the agent's persistent memory of "what's broken." Fragmenting it dilutes severity signals and forces the same fix work to be repeated; over-coarsening it makes individual fixes too vague to land. Bias toward **reuse**, but reuse means *the right* reuse.

#### Step 1 — Read the failure

In one sentence, pin down what actually went wrong:
- What did the user / SME complain about?
- What did the assistant produce, or fail to produce?
- What's the underlying cause? Read the raw trace file on demand to inspect tool calls, messages, and metadata:

  ```bash
  cat whetstone/<agent_name>/traces/$(jq -r .originalTraceFile <path/to/trace-line.json>)
  # or, working from a batch of extracted lines:
  cat whetstone/<agent_name>/traces/original/<traceId>.json
  ```

  Look for: missing tool calls, wrong tool args, hallucinated content, broken JSON, latency spikes, refusals, off-topic responses.

If you can't pin it down (the `originalTrace` is too thin, the feedback is ambiguous), set `analysis.status = "skipped"` with a note saying so. Don't force a classification you don't believe in.

#### Step 2 — Match against existing failure modes

Read each existing FM's `title` + `description`. For each, ask:

> If an engineer fixed this trace's failure, would the fix likely be the same code change as for traces already in this failure mode?

If yes for any FM → **match.** Append `(filename, traceId)` to that FM's `affectedTraces[]`, append the FM id to the trace's `failureModeIds[]`. A trace may match multiple FMs.

The "same fix" lens beats surface-feature matching. Two traces that both involve refunds but fail for completely different reasons are different failure modes; two traces that look very different on the surface (one a refund, one a password reset) but share the same hallucinated-side-effect cause are the same failure mode.

#### Step 3 — Refine an existing failure mode

Sometimes the trace clearly belongs to an existing cluster but the cluster's `description` doesn't yet mention the specific shape you're seeing. **Match + refine**:

- Append the trace as in step 2.
- Edit the FM's `description` to broaden it — generalize the language, add the new sub-pattern as a phrase or short clause. Don't duplicate sentences.
- Update `lastUpdated`.

Refine when the new sub-pattern shares the same root cause and fix path, and a future engineer reading the description should be able to recognize all sub-patterns at a glance. Don't refine just because the wording feels rough — only when the new trace teaches you something the description didn't already say.

#### Step 4 — Create a new failure mode (last resort)

Only create when, after step 2, no existing FM passes the "would the fix be the same?" test. Before pulling the trigger, double-check:

- Is this really a new fix path, or are you over-fitting to surface differences (different domain words, different tool names) that share a deeper cause?
- Could two existing FMs be merged to cover this trace's pattern? (If yes, that's a separate cleanup the user should do — for now, prefer match+refine over create.)

When you create:
- `id`: `fm_<UTC year>_<UTC month>_<slug>`. Slug: lowercase ASCII, underscores for spaces, max ~6 words, no dates or trace ids. Examples: `fm_2026_04_hallucinated_action`, `fm_2026_04_refund_amount_off_by_one`.
- `title`: one line, problem-side ("Agent X when Y"), not solution-side.
- `description`: 2-4 sentences. What goes wrong, in what flows, what evidence to look for. No hypothesis about the fix — that's the fix-failure-mode skill's job.
- `status`: `"discovered"`.
- `tags`: 1-3 lowercase, hyphenated tags from the failure pattern (e.g. `tool-use`, `hallucination`, `latency`, `refusal`, `format`).
- `discoveredAt` and `lastUpdated`: current UTC ISO timestamp.
- `affectedTraces`: the one trace that motivated this FM. More will accrue as later batches match against it.

#### Worked examples

- **Clean match.** Refund flow; assistant says "I've processed your refund"; `originalTrace.toolCalls` shows no `issue_refund`. Existing FM: `fm_2026_04_hallucinated_action`. → **match**: same root cause, same fix.
- **Refine.** Existing FM description mentions only refunds; new trace shows the same pattern in a password-reset flow. → **match + refine**: broaden the description to "refund and account-mutation flows."
- **Looks similar, actually different.** Existing FM: hallucinated action. New trace: assistant calls `issue_refund` correctly but with `amount=42` instead of £4.20. → **create**: argument-formation bug, not a hallucination; different fix path. Could be `fm_2026_04_refund_amount_off_by_one`.
- **Out of scope.** Trace has `feedback: [{ sentiment: "negative", source: "user", comment: "took too long" }]` but the response is otherwise correct. No tool failures, no hallucination. → **skip** with note "user complained about latency; out of scope for content-failure analysis."
- **Matches multiple.** Trace shows both a malformed tool-args call *and* a hallucinated success message. → **match both** existing FMs; the trace's `failureModeIds[]` and each FM's `affectedTraces[]` both get the entry.

### 5. Schemas — what the writes must conform to

Mirrors `src/schemas/trace.ts` and `src/schemas/failure-mode.ts`. Validated by `whetstone validate` on every batch.

#### Trace (one JSON object per non-blank line in `whetstone/<agent_name>/traces/<file>.jsonl`)

| Field | Type | Notes |
|---|---|---|
| `id` | string | Globally unique. Adapter-owned — do **not** modify. |
| `input` | string | Adapter-owned. |
| `output` | string | Adapter-owned. |
| `feedback` | array | Adapter-owned. Used to gate eligibility. |
| `feedback[].sentiment` | `"positive" \| "negative"` | |
| `feedback[].source` | `"user" \| "sme" \| "other"` | |
| `feedback[].comment` | string | |
| `originalTraceFile` | string | Path relative to `whetstone/<agent_name>/traces/` pointing to the raw provider payload (e.g. `"original/trc_abc123.json"`). Read on demand per-batch entry — do **not** preload all files. Don't modify. |
| `failureModeIds` | array of string | **You append.** Each entry must reference an existing `id` in `failure_modes.json`. De-duplicate. |
| `analysis.status` | `"pending" \| "analyzed" \| "skipped" \| "error"` | **You set this.** End state must be `analyzed` or `skipped`. |
| `analysis.analyzedAt` | string (ISO 8601 UTC) or null | **You set** when status flips to `analyzed`. |
| `analysis.notes` | string or null | **You set** with a one-line classification rationale (or skip reason). |

#### FailureMode (one entry in `whetstone/<agent_name>/failure_modes.json`'s `failureModes[]` array)

| Field | Type | Notes |
|---|---|---|
| `id` | string | `fm_<UTC year>_<UTC month>_<slug>` for new entries. Globally unique. |
| `title` | string | One human-readable line, problem-side. |
| `description` | string | 2-4 sentences. **Refine** when broadening to cover a new sub-pattern. |
| `status` | enum (see below) | New entries: `discovered`. Don't move existing entries' status from this skill. |
| `severity` | string or null | Leave null for new entries unless the user has tagged it. |
| `tags` | array of string | Lowercase, hyphenated. New entries: 1-3 tags. |
| `discoveredAt` | ISO 8601 UTC or null | Set on creation. |
| `lastUpdated` | ISO 8601 UTC or null | **Update** every time you touch the FM. |
| `affectedTraces` | array | **You append**, then cap at 10. Oldest entries (lowest index) are dropped when the list exceeds 10. This is a sample for human inspection — the authoritative backlink lives on the trace's `failureModeIds[]`. |
| `affectedTraces[].filename` | string | Basename under `whetstone/<agent_name>/traces/`, not the full path. |
| `affectedTraces[].traceId` | string | Must match an existing trace's `id` inside that file. |

`status` enum (only `discovered` is valid for new entries from this skill):
`discovered | triaged | investigating | spec_drafted | fix_approved | fix_in_progress | verifying | verified | regressed | hardening | hardened | wont_fix | closed | duplicate_of:fm_<id>`

#### Cross-file invariants enforced by `whetstone validate`

- All FM ids unique.
- Every `affectedTraces[]` entry: file exists under `whetstone/<agent_name>/traces/`, trace with that `id` exists in that file.
- Bidirectional: trace listed under FM ⇒ trace's `failureModeIds[]` includes that FM's id.
- No duplicate `(filename, traceId)` per FM.
- No `failureModeIds[]` on a trace that doesn't resolve to an FM.

> Note: the inverse is not an invariant — a trace may have an FM id in `failureModeIds[]` without appearing in that FM's `affectedTraces[]` (because it was evicted by the 10-trace cap). `whetstone validate` does not flag this.


### 6. Wrap up

When you've either exhausted eligible traces or hit `max_batches`:

- Run `npx whetstone validate --agent <agent_name>` one final time as a belt-and-braces check.
- Print a final summary: total traces analyzed / skipped, failure modes created / refined.
- If pending traces remain (because you hit `max_batches`), tell the user the count and how to resume ("re-invoke with the same file; the next eligible batch starts at trace N").
- Stop. Do not commit, do not push, do not stage. The user reviews the diff and decides what to ship.

## Output contract

After the skill runs to completion:

- Every trace in any processed batch has `analysis.status ∈ {"analyzed", "skipped"}`. No `pending` left in any processed batch.
- Every `failureModeIds[]` entry on a trace resolves to an entry in `whetstone/<agent_name>/failure_modes.json` (bidirectional invariant).
- Every `affectedTraces[]` entry on a failure mode points to an extant trace in its named file.
- Other files under `whetstone/<agent_name>/traces/` are untouched.
- `npx whetstone validate --agent <agent_name>` passes.
- No file under `whetstone/<other-agent>/` is read or written.

## Hard rules

- **Use `jq` / `jq -c` for shell-level JSON.** Never `grep`/`sed`/`awk` against JSON. JSON's structure isn't line-oriented; line-tools will silently mis-handle valid JSON and surface failures as wrong answers, not as parse errors.
- **One agent and one file per invocation.** Never read or write under `whetstone/<other-agent>/`. The agent name scopes every read and write this skill performs. If they have multiple files, call the skill once per file (and once per agent).
- **Validate after every batch and self-correct.** The catalogue is the source of truth; partial writes corrupt it. Read the structured validate report and fix issues by `path`, then re-validate. Stop and surface to the user only after 5 unsuccessful loops on the same batch.
- **No commits, no pushes, no PRs.** This skill leaves the working tree dirty and stops. Publishing is the user's call.
- **Honor the project's hard rules** from `whetstone/<agent_name>/whetstone.config.md`. Quote them in your first response so the user sees them.
- **Cap `affectedTraces[]` at 10 per failure mode.** After appending, drop oldest entries (lowest index) until ≤ 10 remain. Never remove the corresponding trace's `failureModeIds[]` backlink — the trace keeps its FM reference even when evicted from the sample list.
