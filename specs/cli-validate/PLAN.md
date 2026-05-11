# Plan: `tracebound validate` command

> **Status:** Draft
> **Created:** 2026-04-26
> **Spec source:** [PRD.md](../../PRD.md) §6.2 (CLI commands), §7.1 (Trace schema), §7.2 (FailureMode schema + invariants), §10 (Storage)

---

## Acceptance criteria (extracted from the PRD)

The PRD doesn't enumerate ACs for `validate` separately, so they're synthesized below from §6.2 and §7.2 and used to tag the tasks.

1. **AC 1** — Schema validation: every record in `failure_modes.json` validates against [`FailureModesFileSchema`](../../src/schemas/failure-mode.ts), and every line in every `traces/*.jsonl` file validates against [`TraceSchema`](../../src/schemas/trace.ts).
2. **AC 2** — Structure validation: required tree exists (`tracebound.config.md`, `failure_modes.json`, `traces/`, `failure_modes/`, `adapters/`).
3. **AC 3** — Cross-file invariants from §7.2 are enforced:
   - unique failure-mode `id`s,
   - for every `affectedTraces[]` entry the file `traces/<filename>` exists and contains a record with that `traceId`,
   - bidirectional links: every trace referenced from a failure mode lists that FM in its `failureModeIds[]`,
   - `affectedTraces` entries are unique per failure mode (no duplicate `(filename, traceId)` pairs).
4. **AC 4** — Exit code: `0` on pass, non-zero (`1` for validation errors, `2` for usage/IO errors) on failure.
5. **AC 5** — Human-readable output: errors include the offending file/line/path plus a one-line **Hint:** describing the fix.
6. **AC 6** — Machine-readable output: `--json` emits a structured report (matching the same shape skills already consume for `tracebound status --json`).
7. **AC 7** — CLI ergonomics: `-C/--cwd` and `-h/--help` mirror `init` (already established convention in [`src/cli.ts`](../../src/cli.ts)).
8. **AC 8** — Tests cover: clean tree passes; each invariant violation produces the expected error; `--json` shape is stable.

---

## Approach

Add a new `validate` command following the exact shape of `init`: a thin wrapper in [`src/cli.ts`](../../src/cli.ts) that calls `runValidate()` exported from [`src/commands/validate.ts`](../../src/commands/validate.ts) (new file). `runValidate()` returns a `ValidationReport` (structured list of issues) so it can be consumed by the test suite, by the CLI's text reporter, and by the `--json` reporter without re-parsing strings.

Internally, validation runs four passes in fixed order — **structure → schemas → cross-file invariants → output** — short-circuiting only the *file-level* schema passes (skipping invariant checks against a file that didn't parse), but never short-circuiting the *report* itself: every issue found is collected before printing so humans and skills get a complete list in one run. Each issue carries a stable `code` (e.g. `WHET_FM_DUPLICATE_ID`), the location, the human message, and a `hint`. The reporter formats issues grouped by file with colour via `styleText` (matching the existing init UX). Schema errors are translated from zod's `ZodError.issues` into the same `ValidationIssue` shape so the renderer is uniform.

NDJSON parsing reads each `traces/*.jsonl` line by line (streaming via `node:readline` over a file handle to keep memory bounded for large dumps) — one parse failure per line becomes one `ValidationIssue` with `line` set; the rest of the file keeps validating. Cross-file invariants build two in-memory indexes (failure modes by id; trace ids per file) so the four invariant checks are O(n).

---

## Trade-offs

- **One command file vs. split modules** — chose one `src/commands/validate.ts` with small internal helpers. The current codebase keeps each command in a single file ([`init.ts`](../../src/commands/init.ts)) and the validator is small enough (≈300–400 lines) that a folder would be ceremony. Revisit if a second consumer (`tracebound status`) wants to share invariant checks.
- **Streaming vs. `readFile` for NDJSON** — chose streaming via `readline`. `readFile + split('\n')` is shorter, but trace dumps can be tens of thousands of lines and the PRD treats them as the canonical large artifact (§5.1). Streaming costs ~10 extra lines and removes a foot-gun.
- **Fail fast vs. collect all** — chose collect-all. Skills run `validate` after every write (§6.2) and AI assistants benefit from seeing every problem in one pass instead of fix-one-rerun loops. Cost: a single broken file yields a longer report; mitigated by grouping by file.
- **Validating PRD-only fields** (`evidence.trace_count`, `regression_net`) — **explicitly skipped**. PRD §6.2 mentions them as future invariants, but §7.2 / line 331 says they're deliberately out of the v1 schema, and the zod schemas in the repo don't include them. Validating fields that don't exist in the schema would fail every project. See Open Question Q1 if this needs to change.

---

## Tasks

- [ ] Add `runValidate()` skeleton + `ValidationIssue` / `ValidationReport` types in `src/commands/validate.ts` (new file). Keep `runValidate()` pure — it returns a `ValidationReport`, never writes to stdout. **(AC 4, 6)**. **Done when:** file exists, exports `runValidate(options): Promise<ValidationReport>` and the `ValidationReport` type, typechecks.
- [ ] Implement **structure check**: verify `tracebound/tracebound.config.md`, `tracebound/failure_modes.json`, and the `traces/`, `failure_modes/`, `adapters/` subdirectories all exist. Mirror the resolution of `cwd` in [`src/commands/init.ts:60-77`](../../src/commands/init.ts#L60-L77). Missing items become `ValidationIssue`s with code `WHET_STRUCT_MISSING` and a hint like `Run "tracebound init" to scaffold the missing files.` **(AC 2, 5)**. **Done when:** unit test for a directory missing each piece reports exactly that issue.
- [ ] Implement **`failure_modes.json` schema check**: read the file, JSON-parse, then run [`FailureModesFileSchema`](../../src/schemas/failure-mode.ts#L46) safeParse. Translate any `ZodError.issues` into `ValidationIssue`s with code `WHET_SCHEMA_FAILURE_MODES`, path = the zod path joined with `.`, and a hint pointing at the offending field. JSON syntax errors get code `WHET_PARSE_FAILURE_MODES`. **(AC 1, 5)**. **Done when:** test with a malformed status string surfaces the field path and hint; test with bad JSON surfaces a parse error.
- [ ] Implement **NDJSON streaming validator** for every `*.jsonl` under `traces/`. Stream via `node:readline.createInterface({ input: fs.createReadStream(path) })`; per line: trim, skip blanks, `JSON.parse` (one issue per syntax error with `line`), then [`TraceSchema`](../../src/schemas/trace.ts#L25).safeParse (issues coded `WHET_SCHEMA_TRACE`). Continue past failures — never throw. **(AC 1, 5)**. **Done when:** test with a file containing one valid + one schema-bad + one malformed line returns exactly two issues, both with correct `line` numbers, and the validator does not throw.
- [ ] Build **trace index** during the NDJSON pass: `Map<filename, Set<traceId>>` plus `Map<traceId, { file, failureModeIds[] }>` for the bidirectional check. Keep per-file results so an unparseable file marks itself "skip invariants for this file" without aborting the whole run. **(AC 3)**. **Done when:** the index is populated for valid files and absent for unparseable ones; assertion in unit test.
- [ ] Implement **invariant: unique failure-mode ids**. Walk `failureModes[]`, collect duplicates, emit one `ValidationIssue` per duplicate with code `WHET_FM_DUPLICATE_ID` and a hint naming both occurrences. **(AC 3, 5)**. **Done when:** test with two FMs sharing an id reports exactly one issue naming both.
- [ ] Implement **invariant: affected-trace file exists**. For each `(filename, traceId)` under `affectedTraces`, check `traces/<filename>` exists; emit `WHET_FM_MISSING_TRACE_FILE` with a hint like `Either remove this entry from "${fm.id}.affectedTraces" or restore the file under traces/.` **(AC 3, 5)**. **Done when:** test with a dangling filename reports it once.
- [ ] Implement **invariant: affected-trace id exists in file**. Lookup `(filename, traceId)` in the trace index; if the file parsed but the id is missing, emit `WHET_FM_MISSING_TRACE_ID`. Skip silently if the file itself was unparseable (already reported). **(AC 3, 5)**. **Done when:** test with a typo in `traceId` reports it; test where the surrounding file is broken does not double-report.
- [ ] Implement **invariant: bidirectional link**. For each affected trace, confirm the trace's `failureModeIds[]` contains the failure mode's id; otherwise emit `WHET_FM_BACKLINK_MISSING` with a hint like `Add "${fm.id}" to traces/${file} → ${traceId}.failureModeIds, or remove the trace from ${fm.id}.affectedTraces.` **(AC 3, 5)**. **Done when:** test with a one-way link reports exactly one issue with both ends in the message.
- [ ] Implement **invariant: orphan FM reference**. For every trace, check each id in its `failureModeIds[]` exists in `failure_modes.json`; emit `WHET_TRACE_DANGLING_FM_REF` with hint `Either add this failure mode to failure_modes.json or remove "${id}" from traces/${file} → ${traceId}.failureModeIds.` **(AC 3, 5)**. **Done when:** test with a trace referencing a non-existent FM reports it once.
- [ ] Implement **invariant: unique `(filename, traceId)` per failure mode**. Inside each FM, dedupe `affectedTraces`; emit `WHET_FM_DUPLICATE_AFFECTED_TRACE` per duplicate. **(AC 3, 5)**. **Done when:** test with a duplicated entry reports it once.
- [ ] Implement the **text reporter** in `src/commands/validate.ts`: groups issues by file, prints `code`, location, message, and a `Hint:` line in dim text, using `styleText` to mirror init's palette. End with a coloured summary (`green` "✓ Validation passed (N files, M issues)" or `red` "✗ Validation failed: N issues"). **(AC 5)**. **Done when:** snapshot/golden test confirms a representative report renders with colours stripped to a stable string.
- [ ] Implement the **JSON reporter**: emit `{ ok: boolean, summary: { fileCount, issueCount }, issues: ValidationIssue[] }` to stdout when `--json` is passed. No colour, no extra prose. **(AC 6)**. **Done when:** test parses the stdout as JSON, the shape matches, and the same data is produced regardless of TTY/colour env.
- [ ] Wire up **CLI integration in [`src/cli.ts`](../../src/cli.ts)**: register the `validate` command beside `init`, add a `runValidateCommand(argv)` that uses `parseArgs` with `--cwd/-C`, `--json`, `--help/-h`, calls `runValidate()`, prints via the chosen reporter, then `process.exit(report.ok ? 0 : 1)` (falls through naturally otherwise). Update the top-level `USAGE` block to list the new command. **(AC 4, 6, 7)**. **Done when:** `tracebound validate --help` prints, `tracebound validate` runs end-to-end against a fixture tree, exit codes match.
- [ ] Add a `VALIDATE_USAGE` constant in [`src/cli.ts`](../../src/cli.ts) covering `-C/--cwd`, `--json`, `-h/--help` plus an "Exit codes" footer (`0 ok / 1 validation issues / 2 usage or IO error`). Same prose style as `INIT_USAGE`. **(AC 5, 7)**. **Done when:** `tracebound validate --help` displays it.
- [ ] Add tests at [`src/__tests__/validate.test.ts`](../../src/__tests__/validate.test.ts) (new file) covering every AC: clean tree passes; each invariant violation reported; schema error reported; NDJSON parse error doesn't crash; `--json` shape; exit code 1 on failure (via spawning the built CLI or asserting the report flag — pick the cheaper one). Use `mkdtemp` + `runInit` helpers like [`src/__tests__/init.test.ts`](../../src/__tests__/init.test.ts) does. **(AC 1, 2, 3, 4, 5, 6, 8)**. **Done when:** `npm test` is green and every error code from the issue catalogue is exercised at least once.
- [ ] Run sanity checks: `npm run typecheck`, `npm test`, then `npm run build` and execute `node dist/cli.js validate --help` to confirm the built binary loads. **(AC 7)**. **Done when:** all three exit clean.

---

## Resolved decisions

- **Q1 — Skip `evidence.trace_count` / `regression_net` invariants.** Confirmed by user: not needed. Validate only what the v1 zod schemas describe.
- **Q2 — `*.jsonl` only.** No `.ndjson` fallback.
- **Q3 — Report orphan FM references.** Add `WHET_TRACE_DANGLING_FM_REF`: a trace whose `failureModeIds[]` names an FM that does not exist in `failure_modes.json`.

---

## Technical Notes

### Files to change

| File | Change |
|------|--------|
| [`src/commands/validate.ts`](../../src/commands/validate.ts) _(new)_ | `runValidate()`, `ValidationIssue`, `ValidationReport`, structure/schema/invariant passes, text + JSON reporters. |
| [`src/cli.ts`](../../src/cli.ts) | Register `validate` in the top-level switch, add `VALIDATE_USAGE`, add `runValidateCommand(argv)` mirroring `runInitCommand` ([`src/cli.ts:53-75`](../../src/cli.ts#L53-L75)). |
| [`src/__tests__/validate.test.ts`](../../src/__tests__/validate.test.ts) _(new)_ | End-to-end tests using `mkdtemp` + `runInit` to scaffold a fixture, then mutating it to trigger each issue. |

### Key references

- Existing CLI shape to match: [`src/cli.ts:77-99`](../../src/cli.ts#L77-L99) (top-level switch), [`src/cli.ts:53-75`](../../src/cli.ts#L53-L75) (per-command parser).
- Existing command shape to match: [`src/commands/init.ts:59-105`](../../src/commands/init.ts#L59-L105) (cwd resolution + stat checks + result object).
- Schemas to validate against: [`FailureModesFileSchema`](../../src/schemas/failure-mode.ts#L46), [`TraceSchema`](../../src/schemas/trace.ts#L25). Both already exported via [`src/schemas/index.ts`](../../src/schemas/index.ts).
- Subdirectory list to verify: `traces`, `failure_modes`, `adapters` — see [`src/commands/init.ts:19`](../../src/commands/init.ts#L19) (`SUBDIRS`). Reuse this constant by exporting it from `init.ts`.
- Test idioms: `mkdtemp` + `t.after(rm…)` pattern from [`src/__tests__/init.test.ts:10-12`](../../src/__tests__/init.test.ts#L10-L12).
- Hard rule from [`tracebound.config.md`](../../templates/tracebound.config.md) line 43: shell-level JSON manipulation must use `jq`. Does **not** apply here — this is in-process TypeScript, which uses native `JSON.parse` / zod (per PRD §10 final paragraph).

### `ValidationIssue` shape (proposal)

```ts
type ValidationIssue = {
  code: string;            // e.g. "WHET_FM_DUPLICATE_ID"
  severity: "error";       // reserved field; v1 is errors-only
  file?: string;           // path relative to the tracebound/ root
  line?: number;           // 1-based for NDJSON
  path?: string;           // dotted JSON path inside the doc
  message: string;         // human sentence
  hint: string;            // one-line fix suggestion, present on every issue
};

type ValidationReport = {
  ok: boolean;
  summary: { fileCount: number; issueCount: number };
  issues: ValidationIssue[];
};
```

### Issue catalogue (single source of truth for tests + docs)

| Code | When |
|------|------|
| `WHET_STRUCT_MISSING` | Required file or subdirectory missing under `tracebound/`. |
| `WHET_PARSE_FAILURE_MODES` | `failure_modes.json` is not valid JSON. |
| `WHET_SCHEMA_FAILURE_MODES` | `failure_modes.json` parses but fails the zod schema. |
| `WHET_PARSE_TRACE` | A line in a `traces/*.jsonl` file is not valid JSON. |
| `WHET_SCHEMA_TRACE` | A trace line parses but fails `TraceSchema`. |
| `WHET_FM_DUPLICATE_ID` | Two failure modes share an `id`. |
| `WHET_FM_DUPLICATE_AFFECTED_TRACE` | Same `(filename, traceId)` listed twice on one FM. |
| `WHET_FM_MISSING_TRACE_FILE` | `affectedTraces` filename does not exist under `traces/`. |
| `WHET_FM_MISSING_TRACE_ID` | `affectedTraces` traceId not found in the (parsed) target file. |
| `WHET_FM_BACKLINK_MISSING` | Trace exists but its `failureModeIds[]` does not include the FM. |
| `WHET_TRACE_DANGLING_FM_REF` | A trace's `failureModeIds[]` references an FM that doesn't exist in `failure_modes.json`. |

### Commands

```sh
npm run typecheck
npm test
npm run build
node dist/cli.js validate --help
node dist/cli.js validate -C /tmp/some-fixture
node dist/cli.js validate --json | jq .
```

### Notes

- The PRD calls out (§3 non-goals, §6.2) that the CLI **never** writes user code, commits, pushes, or opens PRs. `validate` is read-only — no exception needed.
- Skills will invoke `validate` after every write to traces or `failure_modes.json` (PRD §6.2 + §9.1 step 5). Optimise the report for being parsed by an LLM: stable codes, one issue per object, hints actionable in isolation.
- Per the `feedback_user_owns_shared_state` memory, this is local-only — no shared state implications. Per the `feedback_jq_for_json` memory, the `jq` rule does **not** govern in-process TS code; it covers the shell boundary.
- AI-assistant ergonomics: the `hint` field is mandatory on every issue. Don't ship an issue type without a fix hint — the assistant uses it to decide what to edit next.
