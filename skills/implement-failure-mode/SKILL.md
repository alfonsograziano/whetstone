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
7. **Map verification modes.** Locate the `## Verify the fix` section in `tracebound/<agent_name>/tracebound.config.md` and categorise what it provides:
   - **Eval suites** — CLI commands that run broader evaluations.
   - **Targeted trace replays** — commands or scripts that consume the failure mode's trace `input` (JSONL, newline-delimited strings, etc.) and report pass/fail per trace.
   - **Sanity checks** — fallback commands (lint, unit tests, typechecks) to run when higher-signal modes are absent.

   Store the commands you find for later phases and print a summary to the user so they know what will be run.

   - If the section does not list any targeted trace replay commands, print a warning that live replay of the failure cohort is unavailable and that verification will rely on eval suites and/or sanity checks until the config is updated.
   - If the section lists neither eval suites nor targeted trace replays (only sanity checks), say:

     > I don't have any eval suites or targeted trace replay commands in `tracebound/<agent_name>/tracebound.config.md` → `## Verify the fix`. I can still implement the fix and run the project's sanity checks, but I won't be able to replay the failure cohort or run evals to confirm the fix actually works.
     >
     > **Do you want to proceed with sanity checks only? (y/n)**
     > If yes, I'll implement and run the configured sanity checks — verification will be marked as `incomplete`.
     > If you want higher-signal verification, add entries under `### Targeted trace replays` or `### Eval suites` in the config's `## Verify the fix` section, then re-run this skill.

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

### Run targeted trace replays (if configured)

If the config listed targeted replay commands, follow those instructions verbatim. Unless told otherwise, create a temporary JSONL file with one entry per trace using the failure mode's `input`:

```bash
jq -c --arg fmid "<id>" 'select(.failureModeIds | index($fmid) != null) | { input }' \
  tracebound/<agent_name>/traces/*.jsonl > /tmp/<id>-inputs.jsonl
```

For each targeted replay command:

1. Prepare the inputs in the format the config describes (per-trace `--input`, JSONL file, newline-delimited strings, etc.). When a command expects per-trace invocations, iterate over every trace in the cohort.
2. Run the command and capture its output (stdout + stderr, exit code).
3. Compare the observed behaviour against the acceptance criteria from the spec. Record per trace: `traceId`, input used, output received, pass/fail per criterion, reason if fail.
4. If the config instructions appear conflicting (e.g. two commands that require incompatible input shapes), stop and ask the user how to proceed.

### Run eval suites (if configured)

For each eval suite command captured during preflight:

1. Execute it exactly as documented.
2. Capture the output and exit code.
3. Note which acceptance criteria each suite covers. If a suite fails, record the failure details and surface them to the user.

### Evaluate results

**Pass:** every targeted replay and eval suite succeeds, acceptance criteria are met for every tested trace, and all sanity checks are green.

**Partial pass:** some criteria remain unmet or a subset of traces still fails. List the failing commands/traces and the reasons.

**Fail:** targeted replays or eval suites reproduce the failure, or acceptance criteria are not satisfied.

### Verification limited to sanity checks

If neither targeted replays nor eval suites were available and the user agreed to proceed with sanity checks only:
- Record that verification relied solely on sanity checks.
- Reflect this in `tracebound/<agent_name>/failure_modes.json` as `status = "verifying"` with a note that higher-signal verification is pending.
- Print clearly: "Sanity checks passed but the fix has not been verified against the failure cohort. Add targeted trace replay and/or eval entries under `## Verify the fix` in `tracebound/<agent_name>/tracebound.config.md`, then re-run this skill (or use `verify-failure-mode`) to complete verification."
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
- **Ask before proceeding when only sanity checks are available.** The "y/n" gate in preflight step 7 is mandatory — never silently skip higher-signal verification without consent.
- **Write `failure_modes.json` and run `tracebound validate --agent <agent_name>` after every status change.** Self-correct if it fails.
- **Use `jq` / `jq -c` for shell-level JSON.** Never `grep`/`sed`/`awk` against JSON.
- **One failure mode per invocation.** The approval loop is per-FM.
- **No commits, no pushes, no PRs.** Leave the working tree dirty and stop.
- **Minimal changes only.** If the spec says nothing about it, don't touch it.

## Output contract

After this skill completes successfully:

- All acceptance criteria in `SPEC.md` are satisfied.
- All project sanity checks pass.
- `tracebound/<agent_name>/failure_modes.json` has `status = "verified"` (or `"verifying"` if targeted replays / eval suites were unavailable and the user approved sanity-checks-only verification).
- `npx tracebound validate --agent <agent_name>` passes.
- No file under `tracebound/<other-agent>/` has been read or written.
- No commits, pushes, or PRs have been made.
