---
name: create-adapter
description: Use this skill whenever the user wants to create a Tracebound adapter — a CLI script that reads a raw traces file (JSON or JSONL) from a third-party system and converts it into the Tracebound on-disk format (one JSONL index file under `tracebound/<agent>/traces/` + one raw file per trace under `tracebound/<agent>/traces/original/`). Trigger on phrases like "create an adapter for…", "write a converter for my traces", "I have traces from X, help me import them", "build an adapter script", or "convert this JSON dump to Tracebound format". The skill inspects a concrete example of the source data, designs the field mapping, and generates a ready-to-run CLI script scoped to one agent.
---

# create-adapter

Generates a CLI adapter script that reads a source trace file and writes Tracebound-shape output for a specific agent. The script is the artifact; this skill leaves it on disk and stops. The user runs it whenever they have a new dump to import.

## Inputs

- **agent_name (required)** — the agent whose `traces/` directory the script will write into. If the user did not specify one, run `npx tracebound agents` and ask which agent to operate on. Stop until the user confirms. Print "Operating on agent: `<agent_name>`" before doing any other work.
- **example_input (required)** — a sample of the source data. Either:
  - A file path the user provides (the skill reads it), or
  - JSON pasted directly into the conversation.
  A single representative object or a small array (3–5 entries) is enough. The skill only needs to understand the shape.
- **language (optional)** — target language for the generated script. Default: **Node.js** (zero-dependency, ESM). Other supported values: `python`. If the user requests a language not listed here, ask for clarification before proceeding.
- **out (optional)** — where to write the generated script. Default: `tracebound/<agent_name>/adapters/<slug>.js` (or `.py`), where `<slug>` is a short lowercased name derived from the source system (e.g. `langfuse.js`, `datadog.py`).

## Preflight

1. **A concrete example is available.** If the user has not provided sample data, ask for it before doing anything else. Do not guess the source schema.
2. **The output directory exists.** `tracebound/<agent_name>/adapters/` must exist. If it doesn't, ask the user to run `tracebound init <agent_name>` first.
3. **Language is clear.** If the user mentioned a language that isn't Node.js or Python, ask.

## Workflow

### 1. Inspect the example

Read the example input carefully. Identify:

- **Trace ID** — a unique identifier per trace (string or number). Note the field name.
- **User turn / input** — the human-side of the conversation. May be a string, a nested messages array, or a span attribute.
- **Agent turn / output** — the assistant's final reply. May be a string, a nested object, or the last message in a messages array.
- **Feedback signals** — thumbs, ratings, comments, SME annotations, or any signal that indicates quality. Note field names, value ranges, and sources. There may be none — that is fine; the script will emit empty `feedback: []`.
- **Raw payload boundary** — what counts as "one trace". In a flat JSON array each element is one trace. In a JSONL file each line is one trace. In a nested object there may be a key (e.g. `"traces"`, `"events"`, `"rows"`) that holds the array.

Summarise your findings to the user in one short paragraph before writing any code: "I see traces shaped like X. I'll map `foo` → `input`, `bar` → `output`, and `baz.rating` → `feedback`. Does that look right?" Wait for confirmation (or a correction) before proceeding.

### 2. Design the mapping

Produce an explicit mapping table (markdown or code comments) that shows:

| Tracebound field | Source field(s) | Transformation |
|---|---|---|
| `id` | `trace.id` | cast to string |
| `input` | `trace.messages[0].content` | extract text |
| `output` | `trace.messages[-1].content` | extract text |
| `feedback[].sentiment` | `trace.rating` | `>= 3 → "positive"`, else `"negative"` |
| `feedback[].source` | `trace.rater_type` | map to `"user" \| "sme" \| "other"` |
| `feedback[].comment` | `trace.comment` | pass through; omit entry if null |
| `originalTraceFile` | — | `"original/<id>.json"` (computed; relative to `tracebound/<agent_name>/traces/`) |

For `sentiment`: if the source has a thumbs field, `"up"` → `"positive"`, `"down"` → `"negative"`. If it's a numeric rating, use ≥ 50% of the max scale as the positive threshold. If there is no feedback field at all, emit `feedback: []` and document that in a comment.

For `source`: map `"user"`, `"customer"`, `"end_user"` → `"user"`; `"sme"`, `"qa"`, `"reviewer"`, `"annotator"`, `"admin"` → `"sme"`; anything else → `"other"`.

### 3. Generate the script

#### Node.js (default)

Follow the [node-cli-script skill](../../.agents/skills/node-cli-script/SKILL.md) patterns exactly:

- Shebang: `#!/usr/bin/env -S node --experimental-strip-types --no-warnings` (TypeScript) or `#!/usr/bin/env node` (plain JS)
- ESM, `node:` prefixed imports
- `parseArgs` for argument parsing — **one positional argument**: the input file path
- `styleText` for all terminal output
- `fs/promises` for file I/O
- Zero npm dependencies (no `zod`, no `axios`, no `lodash`)
- Top-level `await`

**Required CLI interface:**

```
node tracebound/<agent_name>/adapters/<name>.js <input-file> [options]

Positionals:
  <input-file>   Path to the source JSON or JSONL file

Options:
  --out <path>   Output JSONL path (default: tracebound/<agent_name>/traces/<name>-<YYYY-MM-DD>.jsonl)
  --dry-run      Print the first 3 records without writing anything
  -h, --help     Show this help
```

The agent name is *baked into the generated script's defaults* — no `--agent` flag, because the script lives under that agent's `adapters/` directory and only ever writes to that agent's `traces/`. If the user wants the same source system imported for two agents, generate two scripts (one per agent).

**Script structure (sections in order):**

```js
#!/usr/bin/env node
// <SourceSystem> → Tracebound adapter for agent "<agent_name>".
//
// Reads <description of source format> and writes:
//   tracebound/<agent_name>/traces/<name>-<YYYY-MM-DD>.jsonl  — JSONL index (one line per trace)
//   tracebound/<agent_name>/traces/original/<id>.json          — raw trace per entry
//
// Usage:
//   node tracebound/<agent_name>/adapters/<name>.js <input-file>

import { parseArgs, styleText } from 'node:util';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname, basename } from 'node:path';

const AGENT_NAME = '<agent_name>';        // baked in at generation time
const DEFAULT_TRACES_DIR = `tracebound/${AGENT_NAME}/traces`;

// ---------- Args ----------
// ---------- Helpers: field extraction ----------
// ---------- Helpers: mapping to Tracebound shape ----------
// ---------- Main ----------
```

**The main loop must:**

1. Read and parse the input file (handle both JSON array and JSONL — auto-detect by trying `JSON.parse` first, then falling back to line-by-line).
2. For each source trace:
   a. Extract `id` (coerce to string; if missing, generate `crypto.randomUUID()`).
   b. Extract `input` and `output` (strings; fall back to `""` with a `--verbose` warning).
   c. Build `feedback[]` array — only include entries where at least a sentiment can be inferred. Omit entries where comment and sentiment are both absent.
   d. Write the raw source object to `tracebound/<agent_name>/traces/original/<id>.json` (pretty-printed, 2-space indent).
   e. Push the Tracebound record onto the output array.
3. Write the output JSONL: one `JSON.stringify(record)` per line, newline-terminated.
4. Print a summary: `✓ Wrote N traces to <out> (M skipped)`.

**Skipped traces** — a trace is skipped (not written) when it has no extractable `id`, `input`, and `output` all at once. Log each skip with `styleText('yellow', ...)` and a reason.

#### Python (if requested)

Use the standard library only: `argparse`, `json`, `pathlib`, `datetime`, `sys`, `uuid`. No `pip install`.

```
python tracebound/<agent_name>/adapters/<name>.py <input-file> [--out PATH] [--dry-run]
```

Same logic as the Node.js version. Use `pathlib.Path` for all paths. Write each raw trace with `json.dump(trace, f, indent=2)`.

### 4. Verify the script

After generating the script, run it against the example input:

```bash
node tracebound/<agent_name>/adapters/<name>.js <example-file> --dry-run
```

Check that:
- The script exits 0.
- The `--dry-run` output shows 3 records with the correct shape.
- `id`, `input`, `output` are non-empty strings.
- `originalTraceFile` is `"original/<id>.json"`.
- `analysis.status` is `"pending"`.
- `failureModeIds` is `[]`.

If the dry run fails, fix the script before proceeding.

Then run it for real against the example:

```bash
node tracebound/<agent_name>/adapters/<name>.js <example-file>
```

Finally, verify the output passes Tracebound validation:

```bash
npx tracebound validate --agent <agent_name>
```

If validate fails on a `WHET_SCHEMA_TRACE` error, the field mapping is wrong — fix the extractor and re-run. If it fails on `WHET_STRUCT_MISSING`, the user needs to run `tracebound init <agent_name>` first.

### 5. Wrap up

Tell the user:
- Where the script was written.
- The exact command to run it on a real dump.
- What fields were **not** mapped (e.g. "latency, model version") — so they know what's lost.
- Whether feedback was found. If not: "No feedback fields were detected in the example; all traces will have `feedback: []`. You can enrich them later or add a `--feedback-file` argument to a future version."

Stop. Do not commit, push, or open PRs.

## Output contract

After the skill completes:

- `tracebound/<agent_name>/adapters/<name>.js` (or `.py`) exists and is executable.
- Running it against the example input exits 0.
- `npx tracebound validate --agent <agent_name>` passes on the generated output.
- Every generated trace record conforms to the Tracebound Trace schema (see below).
- No file under `tracebound/<other-agent>/` has been read or written.

## Tracebound Trace schema (what the script must emit)

One JSON object per line in the output JSONL. All fields required unless marked optional.

| Field | Type | Notes |
|---|---|---|
| `id` | string | Unique per file. Coerce numbers to string. Generate UUID if missing. |
| `input` | string | The human/user turn. Never null — use `""` as last resort. |
| `output` | string | The agent/assistant turn. Never null — use `""` as last resort. |
| `feedback` | array | May be empty. Each entry must have `sentiment`, `source`, `comment`. |
| `feedback[].sentiment` | `"positive" \| "negative"` | |
| `feedback[].source` | `"user" \| "sme" \| "other"` | |
| `feedback[].comment` | string | Non-empty. If the source has no comment, synthesise one from the signal value (e.g. `"rating=2"`). |
| `originalTraceFile` | string | Always `"original/<id>.json"`. Relative to `tracebound/<agent_name>/traces/`. |
| `failureModeIds` | array | Always `[]` on first import. |
| `analysis.status` | `"pending"` | Always `"pending"` on first import. |
| `analysis.analyzedAt` | null | |
| `analysis.notes` | null | |

## Hard rules

- **One agent per script.** The agent name is baked into the generated script's defaults. Never read or write under `tracebound/<other-agent>/`. If two agents need the same source system, generate two scripts — once per agent.
- **Never guess the source schema.** Always inspect a concrete example first and confirm the mapping with the user before generating code.
- **Zero runtime dependencies for Node.js.** No `npm install`. The script must run with `node script.js` out of the box.
- **One positional argument.** The input file path is the only required argument. Everything else is optional with sensible defaults.
- **Validate after running.** Always run `npx tracebound validate --agent <agent_name>` and fix any issues before stopping.
- **Do not modify existing JSONL files.** The adapter always writes a new timestamped file. It never merges into or overwrites an existing trace file.
- **No commits, no pushes.** Leave the working tree dirty and stop.
