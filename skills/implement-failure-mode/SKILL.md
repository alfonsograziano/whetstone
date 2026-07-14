---
name: implement-failure-mode
description: Use this skill whenever the user wants to implement an approved fix spec for a failure mode and verify that it works. Trigger on phrases like "implement fm_…", "start the implementation for fm_…", "the spec is approved, proceed", "implement and verify fm_…", or any request to move a failure mode from spec_approved into implemented and verified state. Requires a SPEC.md that has been approved (status fix_approved). Use research-failure-mode first if no spec exists yet.
---

# implement-failure-mode

Tracebound's implementation and verification skill. Operates on a single agent at a time. Takes one failure mode id with an approved `SPEC.md`, implements the fix in the agent's working tree, runs sanity checks, and verifies the fix by invoking the model with test inputs derived from the failure mode's cohort. Stops after verification and leaves the working tree ready for the user to review.

This skill edits agent code. It does not commit, push, or open PRs.

## Inputs

- **agent_name (required)** — the agent that owns the failure mode. If the user did not specify one, run `npx tracebound agents` and ask which agent to operate on. Stop until the user confirms. Print "Operating on agent: `<agent_name>`" before doing any other work.
- **failure_mode_id (required)** — the `id` of the failure mode to implement, e.g. `fm_2026_04_hallucinated_action`.

## Preflight (run before touching anything)

If any of these fail, stop and tell the user.

1. **Working tree is in a Tracebound project.** `tracebound/<agent_name>/tracebound.config.md`, `tracebound/<agent_name>/failure_modes.json`, and `tracebound/<agent_name>/traces/` all exist.
2. **The catalogue is valid.** Run `npx tracebound validate --agent <agent_name>`. If non-zero, show the output and stop.
3. **The failure mode exists.** Run `npx tracebound fm get <id> --agent <agent_name>`. Print the record.
4. **The spec exists.** `tracebound/<agent_name>/failure_modes/<id>/SPEC.md` must exist and contain all required sections (What's failing, Root cause, Proposed fix, Acceptance criteria, Test plan). If missing, tell the user to run `research-failure-mode` first.
5. **Status is actionable.** Status must be `fix_approved`, `fix_in_progress`, `verifying`, or `regressed`. If `spec_drafted`, the spec hasn't been approved — ask: "The spec hasn't been marked as approved yet. Did you review and approve it? (y/n)". If yes, set `status = "fix_approved"` and continue. If no, stop and direct the user to `research-failure-mode`. If the status is `verified`, `hardened`, `wont_fix`, `closed`, or `duplicate_of:…`, tell the user and stop.
6. **Read the project config.** Load `tracebound/<agent_name>/tracebound.config.md`. Quote the **Hard rules** section back to the user before doing any work.
7. **Enumerate verification modes.** Inspect the `## Verify the fix` section in `tracebound/<agent_name>/tracebound.config.md` and capture:
   - The `Command:` line (or equivalent instructions) under `### Targeted trace replay`. This is the primary verification path and must consume the failure-mode cohort `input` values.
   - Every command listed under `### Eval suites`.
   - Every command listed under `### Sanity checks (fallback)`.

   Summarize what you found to the user. If the targeted replay command is missing but one or more eval suites are documented, say you'll rely on those suites instead. If the section is missing entirely or only sanity checks are present, say:

   > I don't have any eval suites or targeted trace replay instructions in `## Verify the fix`. I can implement the fix and run the project's sanity checks, but I won't be able to replay the failure mode's `input` or run dedicated evals to confirm the regression is gone.
   >
   > **Do you want to proceed anyway? (y/n)**
   > If we proceed, I'll run the sanity checks only and mark verification as incomplete until replay instructions are added.

   Wait for the user's answer before proceeding. If "n", stop.

---

## Phase 1 — Plan

**Goal:** break the implementation into small, reviewable steps. Skip this phase for trivial single-file changes (one function, ≤ ~30 lines) — note "Skipping plan — change is small" and go straight to Phase 2.

Read `tracebound/<agent_name>/failure_modes/<id>/SPEC.md` in full. Pay special attention to:
- "Open questions and SME inputs required" — if any items are unresolved and not marked as accepted known risks, stop and ask the user whether to proceed.
- "Proposed fix" — the exact changes to make.
- "Acceptance criteria" — what the implementation must satisfy.
- "Test plan" — how verification will be run.

Write `tracebound/<agent_name>/failure_modes/<id>/PLAN.md`:

```markdown
# Implementation Plan: <failure mode title>

**Spec:** [SPEC.md](./SPEC.md)
**Failure mode:** `<id>`

## Steps

1. <Specific file + what changes>  
   _Done when:_ <observable outcome>
2. …

## Files to change

| File | Change |
|------|--------|
| `path/to/file` | <description> |

## Sanity checks (from tracebound/<agent_name>/tracebound.config.md)

<Copy the sanity-check commands from the config here so they're visible inline.>
```

Print the plan. State you're proceeding to implementation.

---

## Phase 2 — Implement

**Goal:** make the code change described in the spec's "Proposed fix" and satisfy every acceptance criterion.

Update `tracebound/<agent_name>/failure_modes.json`: set `status = "fix_in_progress"`, `lastUpdated = <UTC ISO>`. Run `npx tracebound validate --agent <agent_name>`. Self-correct if it fails.

### Branching

If `tracebound/<agent_name>/tracebound.config.md` specifies a branching rule (e.g. "Always work on `tracebound/<failure_mode_id>` branches"), create the branch before touching code. The branch name template stays as the user configured it — `tracebound/<id>` here is a *git branch name*, not a file path:

```bash
git checkout -b tracebound/<id>
```

### Making changes

For each step in the plan:

1. Read the target file(s) in full before editing.
2. Make the minimal change that satisfies the acceptance criterion.
3. Run the project's sanity checks (from `tracebound/<agent_name>/tracebound.config.md` "Sanity checks" section)
4. If any check fails, fix it before moving to the next step. Do not accumulate failing checks.

**Constraints:**
- Honor every hard rule from `tracebound/<agent_name>/tracebound.config.md`. If a rule says "never modify `agent/src/payments/**` without a human in the loop", stop before touching those files and ask.
- Do not refactor beyond what the spec requires.
- Do not add unrelated tests, docs, or comments to files you haven't touched for this fix.
- If an acceptance criterion proves impossible to satisfy without violating a hard rule or touching an SME-blocked area, stop, explain why, and ask the user how to proceed.

When all acceptance criteria are satisfied and all sanity checks pass:

Print:
- Every file changed (one line: path + what changed).
- Confirmation that all sanity checks passed.

---

## Phase 3 — Verify

**Goal:** confirm the fix resolves the actual failure by invoking the model against the cohort.

Update `tracebound/<agent_name>/failure_modes.json`: set `status = "verifying"`, `lastUpdated = <UTC ISO>`. Run `npx tracebound validate --agent <agent_name>`. Self-correct if it fails.

### Build the test cohort

```bash
jq -c --arg fmid "<id>" 'select(.failureModeIds | index($fmid) != null)' \
  tracebound/<agent_name>/traces/*.jsonl
```

For each trace in the cohort, note the `input` field — this is the user message to replay.

### Targeted trace replay (preferred)

If the config listed any commands under `### Targeted trace replay`, run them now. Follow the contract documented in the config — the command must consume the cohort `input` values (via a failure-mode id flag, a JSONL file, or per-trace `--input` invocations).

- When a command expects a cohort file (flags like `--cohort`, `--trace-ids`, or similar), generate it from the traces you collected above. Use `jq` to emit the format the config describes (trace ids, JSONL, etc.), write it to a temp file, and pass that path to the command.
- When a command replays a single `input` per invocation (e.g. `npm run agent:invoke -- --input "<message>"`), run it once per trace using the stored `input`. Capture stdout and the exit code.
- After each replay, check the output against every acceptance criterion from the spec that can be evaluated without a full transcript diff. Record `traceId`, the command run, the output, and pass/fail notes.

If no targeted replay commands were provided, explicitly note that live cohort replay could not be executed and move on to the eval suites or sanity-check fallback below.

### Eval suites

Run every command captured under `### Eval suites`. If a targeted replay ran first, these suites provide additional coverage; if no replay command exists, explain that the eval suites are now the primary verification signal. Capture the full output, exit status, and any metrics each suite prints, and map any failures back to acceptance criteria or spec expectations.

### Sanity checks (fallback)

Commands listed under `### Sanity checks (fallback)` prove only that the project still builds/tests cleanly. Run them when:
- you must proceed without replay/eval coverage (with explicit user consent from preflight step 7), or
- the config describes them as additional gates to run regardless.

Note clearly that these checks do not exercise the failure-mode cohort. Record their outputs alongside the targeted replay/eval results.

### Evaluate results

**Pass:** all acceptance criteria met for every tested trace, all sanity checks green.

**Partial pass:** most criteria met; note which traces or criteria are still failing and why.

**Fail:** acceptance criteria not met, or model consistently reproducing the original failure.

### Incomplete verification (sanity checks only)

If no targeted trace replay or eval suite could be run (because the config lacked them and the user explicitly approved proceeding with sanity checks only), record that live verification is incomplete:
- Leave `status = "verifying"` in `tracebound/<agent_name>/failure_modes.json` and add a short note summarizing which verification commands are still missing.
- Print clearly: "Sanity checks passed but the fix has not been replayed against the failure mode. Add targeted replay or eval instructions under `## Verify the fix` (including a `### Targeted trace replay` command) and re-run this skill or `verify-failure-mode` to complete verification."
- Stop. Do not set status to `verified`.

### Update status

**On pass:**
- Set `status = "verified"`, `lastUpdated = <UTC ISO>` in `tracebound/<agent_name>/failure_modes.json`.
- Run `npx tracebound validate --agent <agent_name>`. Self-correct if it fails.

**On fail or partial:**
- Set `status = "regressed"`, `lastUpdated = <UTC ISO>`.
- Run `npx tracebound validate --agent <agent_name>`. Self-correct if it fails.
- Print the failing traces and criteria. Ask the user how to proceed: return to implementation, revise the spec, or mark `wont_fix`.

---

## Phase 4 — Final stop ⏸

**On verified:**

Print:
- "✓ Fix verified for agent `<agent_name>`, fm `<id>`."
- Table of files changed.
- Verification results: N traces tested, N passed, N failed (if any).
- Next steps:
  - Review the diff (`git diff`) and merge / push when ready.
  - Optionally run the `harden` skill to turn this fix into a permanent regression check.
  - Run `npx tracebound status --agent <agent_name>` to see other open failure modes for this agent.

**Hard stop.** The skill is done. Do not commit, push, or open PRs.

---

## Hard rules

- **Read the spec before touching anything.** The spec is the contract — implement what it says, nothing more.
- **Sanity checks must pass at every step.** Don't move to the next acceptance criterion while a check is failing.
- **Honor all hard rules from `tracebound/<agent_name>/tracebound.config.md`.** Quote them at the start of the transcript. Stop and ask if a rule blocks a necessary change.
- **One agent per invocation.** Never read or write under `tracebound/<other-agent>/`. The agent name scopes every Tracebound-side read and write this skill performs.
- **Ask before proceeding when only sanity checks are available.** The confirm/cancel gate in preflight step 7 is mandatory — never silently proceed when the config lacks targeted replay and eval coverage.
- **Write `failure_modes.json` and run `tracebound validate --agent <agent_name>` after every status change.** Self-correct if it fails.
- **Use `jq` / `jq -c` for shell-level JSON.** Never `grep`/`sed`/`awk` against JSON.
- **One failure mode per invocation.** The approval loop is per-FM.
- **No commits, no pushes, no PRs.** Leave the working tree dirty and stop.
- **Minimal changes only.** If the spec says nothing about it, don't touch it.

## Output contract

After this skill completes successfully:

- All acceptance criteria in `SPEC.md` are satisfied.
- All project sanity checks pass.
- `tracebound/<agent_name>/failure_modes.json` has `status = "verified"` when targeted replay and/or eval suites passed, or remains `"verifying"` if only sanity checks were run with user consent.
- `npx tracebound validate --agent <agent_name>` passes.
- No file under `tracebound/<other-agent>/` has been read or written.
- No commits, pushes, or PRs have been made.
