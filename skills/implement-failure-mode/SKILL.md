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
7. **Check for a model test command.** Look for the `## Model test command` section in `tracebound/<agent_name>/tracebound.config.md`. This section must contain a `Command:` line with the CLI to use for live verification. See the "Verification" section below for how it is used.

   **If the section is absent or has no `Command:` line**, say:

   > I don't have a way to test my changes against the live model. I can still implement the fix and run the project's sanity checks (typecheck, lint, unit tests), but I won't be able to invoke the model to confirm the failure is actually resolved.
   >
   > **Do you want to proceed anyway? (y/n)**
   > If yes, I'll implement and run sanity checks only — verification will be marked as `incomplete`.
   > If you want live model testing, add a `## Model test command` section to `tracebound/<agent_name>/tracebound.config.md` with a `Command:` line, then re-run this skill.

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

### Live model testing (if Model test command is available)

Read the `Command:` line from the `## Model test command` section of `tracebound/<agent_name>/tracebound.config.md`.

The command must be invocable as:
```
<command> --input "<user-message>"
```
or equivalent (the exact flag name may differ — use whatever the config specifies). It must print the agent's response to stdout and exit 0 on success.

For each trace in the cohort:

1. Run the model test command with the trace's `input`.
2. Capture the output.
3. Check the output against every acceptance criterion from the spec that is evaluable without a full session replay (typically: "must contain tool call X", "must not claim Y without calling Z", "must match pattern W").
4. Record: `traceId`, input used, output received, pass/fail per criterion, reason if fail.

If a replay command is also configured (`npm run agent:replay -- --trace-ids <file>`), run it too for the full cohort:

```bash
jq -r --arg fmid "<id>" \
  'select(.failureModeIds | index($fmid) != null) | .id' \
  tracebound/<agent_name>/traces/*.jsonl > /tmp/cohort-<id>.txt

npm run agent:replay -- --trace-ids /tmp/cohort-<id>.txt
```

### Evaluate results

**Pass:** all acceptance criteria met for every tested trace, all sanity checks green.

**Partial pass:** most criteria met; note which traces or criteria are still failing and why.

**Fail:** acceptance criteria not met, or model consistently reproducing the original failure.

### Incomplete verification (no model test command)

If the model test command was not available and the user chose to proceed anyway:
- Record that live model testing was not performed.
- The status is set to `verified (sanity-checks only)` — represent this in `tracebound/<agent_name>/failure_modes.json` as `status = "verifying"` with a note in the FM description that live model tests are still pending.
- Print clearly: "Sanity checks passed but the fix has not been verified against the live model. Add a `## Model test command` to `tracebound/<agent_name>/tracebound.config.md` and re-run this skill (or use `verify-failure-mode`) to complete verification."
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
- **Ask before proceeding without a model test command.** The "y/n" gate in preflight step 7 is mandatory — never silently skip live verification.
- **Write `failure_modes.json` and run `tracebound validate --agent <agent_name>` after every status change.** Self-correct if it fails.
- **Use `jq` / `jq -c` for shell-level JSON.** Never `grep`/`sed`/`awk` against JSON.
- **One failure mode per invocation.** The approval loop is per-FM.
- **No commits, no pushes, no PRs.** Leave the working tree dirty and stop.
- **Minimal changes only.** If the spec says nothing about it, don't touch it.

## Output contract

After this skill completes successfully:

- All acceptance criteria in `SPEC.md` are satisfied.
- All project sanity checks pass.
- `tracebound/<agent_name>/failure_modes.json` has `status = "verified"` (or `"verifying"` if live model tests were skipped with user consent).
- `npx tracebound validate --agent <agent_name>` passes.
- No file under `tracebound/<other-agent>/` has been read or written.
- No commits, pushes, or PRs have been made.
