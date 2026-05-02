---
name: research-failure-mode
description: Use this skill whenever the user wants to investigate a failure mode, understand its root cause, gather evidence from traces, identify what SME input is needed, and draft a fix spec for human review. Trigger on phrases like "research fm_…", "investigate this failure mode", "draft a spec for fm_…", "understand why fm_… is happening", "what's causing fm_…", or any request to move a failure mode from discovered/triaged into a specced, reviewable state. This skill is read-only with respect to agent code — it only reads traces, source, and config, then writes a SPEC.md and updates failure_modes.json status. Use implement-failure-mode after the spec is approved.
---

# research-failure-mode

Whetstone's investigation and spec-drafting skill. Operates on a single agent at a time. Takes one failure mode id, builds a deep understanding of what's failing and why, flags anything that requires SME input or external change, and produces a `SPEC.md` for human review. Stops at a hard approval gate — no code is touched until the user signs off on the spec.

This skill is **read-only with respect to the agent codebase.** It reads traces, reads source code, and writes `whetstone/<agent_name>/failure_modes/<id>/SPEC.md` plus status updates to `whetstone/<agent_name>/failure_modes.json`. It never edits agent code, never commits, never pushes.

## Inputs

- **agent_name (required)** — the agent that owns the failure mode. If the user did not specify one, run `npx whetstone agents` and ask which agent to operate on. Stop until the user confirms. Print "Operating on agent: `<agent_name>`" before doing any other work.
- **failure_mode_id (required)** — the `id` of the failure mode to research, e.g. `fm_2026_04_hallucinated_action`. If the user didn't provide one, run `npx whetstone status --agent <agent_name>` to list open failure modes and ask which to work on.

## Preflight (run before touching anything)

If any of these fail, stop and tell the user. Do not try to repair the project from this skill.

1. **Working tree is in a Whetstone project.** `whetstone/<agent_name>/whetstone.config.md`, `whetstone/<agent_name>/failure_modes.json`, and `whetstone/<agent_name>/traces/` all exist.
2. **The catalogue is valid.** Run `npx whetstone validate --agent <agent_name>`. If it exits non-zero, show the output and stop — a broken catalogue must be fixed before further analysis.
3. **The failure mode exists.** Run `npx whetstone fm get <id> --agent <agent_name>`. If "not found", stop. Print the returned record so both you and the user can see the current state.
4. **The failure mode is researchable.** Status must be one of: `discovered`, `triaged`, `investigating`, `regressed`. If it's already `spec_drafted`, `fix_approved`, `fix_in_progress`, `verifying`, `verified`, or `hardened`, tell the user — a spec may already exist at `whetstone/<agent_name>/failure_modes/<id>/SPEC.md` — and ask whether they want to revise it or continue to implementation. If `wont_fix`, `closed`, or `duplicate_of:…`, stop.
5. **Read the project config.** Load `whetstone/<agent_name>/whetstone.config.md`. Quote the **Hard rules** section back to the user before doing any work so they're always visible in the transcript.

---

## Step 1 — Load the failure mode and build the full cohort

```bash
npx whetstone fm get <id> --agent <agent_name>
```

`affectedTraces[]` on the failure mode is a capped sample (≤ 10 entries). The authoritative cohort is every trace across all JSONL files whose `failureModeIds[]` includes this id:

```bash
jq -c --arg fmid "<id>" 'select(.failureModeIds | index($fmid) != null)' \
  whetstone/<agent_name>/traces/*.jsonl
```

For each trace in the cohort, also load the raw provider payload to see the full transcript, tool calls, and metadata:

```bash
cat whetstone/<agent_name>/traces/$(jq -r .originalTraceFile <<< '<trace-json-line>')
```

> **Do NOT preload all raw payloads at once.** Read them one at a time as you analyse each trace. Loading every raw trace upfront will exhaust the context window on any non-trivial cohort.

Note for each trace:
- What the user asked for.
- What the agent produced (from `output`).
- Every tool call (or absence of one) in the raw payload.
- What the feedback signals said (`feedback[].comment`, `feedback[].source`).
- Any SME annotations (`source: "sme"`).

Look for the pattern that unifies the cohort. What is the *common* failure? Surface differences (different user phrasings, different flow branches) should not distract from the shared root cause.

Update `whetstone/<agent_name>/failure_modes.json`: set `status = "investigating"`, `lastUpdated = <UTC ISO>`. Run `npx whetstone validate --agent <agent_name>`. Self-correct if it fails.

---

## Step 2 — Read the agent source

Use the "Agent under test" section of `whetstone/<agent_name>/whetstone.config.md` to locate the repo root.

Read every source file relevant to the failure. Common starting points:
- System prompt / prompt templates — look for instructions (or gaps in instructions) that govern the failing behaviour.
- Tool definitions and tool-call routing — look for missing guards, wrong argument shapes, incorrect preconditions.
- Response generation and post-processing — look for logic that could produce the observed bad output.
- Any validators, guardrails, or output parsers that should have caught this but didn't.

Cross-reference with trace evidence at every step: *was this prompt section active when the trace ran? Was this tool available? Which code path executed?*

---

## Step 3 — Form hypotheses

Write 1–3 numbered hypotheses. Each must:
- Name a **specific artefact**: file path + line range (or prompt section heading), not just "the prompt" or "the tool logic".
- Explain the **causal chain**: the artefact does X → which allows/causes Y → which produces the observed failure Z in the trace evidence.
- State **confidence**: high / medium / low, with a one-sentence justification.

Be concrete. "The prompt doesn't constrain the model" is not a hypothesis. "Lines 42–47 of `agent/prompts/system.md` describe the refund confirmation message but do not require a preceding `issue_refund` tool call — so the model can produce the confirmation text on any plausible-sounding request without actually invoking the tool" is a hypothesis.

If you cannot form a concrete hypothesis for a trace (the raw payload is too thin, the feedback is ambiguous, the failure pattern is unclear), note it explicitly — it becomes an open question for the SME.

---

## Step 4 — Identify SME inputs and external blockers

Not every root cause is fully visible from the codebase. Flag anything that requires knowledge or action outside the agent's code:

**Types of SME input to flag:**
- **Business rule ambiguity** — the code could be implementing two different policies; an SME must confirm which is correct. ("Is a zero-amount refund allowed for subscription cancellations? The prompt doesn't say and the traces show inconsistent handling.")
- **Upstream data issues** — the failure may be caused by malformed or unexpected data coming from an external system, not a bug in the agent. ("Three of five traces show `order_status: null` in the tool response — this may be an upstream API issue, not an agent bug.")
- **Missing ground truth** — no trace in the cohort shows the correct behaviour, so the acceptance criterion can't be derived purely from evidence. ("We have no positive examples of a correctly handled partial-refund flow — an SME needs to provide one.")
- **Sensitive areas** — the fix may touch a hard-ruled area (e.g. `agent/src/payments/**`). Flag it clearly before writing a spec that proposes changes there.
- **External system changes** — the fix requires a change in an upstream service, data pipeline, or third-party config that the agent engineer cannot make alone.

For each blocker, state:
- What you need to know or what needs to change.
- Who owns it (if knowable from the config or trace metadata).
- Whether the spec can be written with a placeholder assumption, or whether research must pause until resolved.

If there are open blockers that prevent writing a reliable spec, stop after this step, present the blockers to the user, and ask whether to proceed with placeholder assumptions or wait for SME input.

---

## Step 5 — Write SPEC.md

Create the spec directory if it doesn't exist:

```bash
mkdir -p whetstone/<agent_name>/failure_modes/<id>
```

Write `whetstone/<agent_name>/failure_modes/<id>/SPEC.md`:

```markdown
# Research Spec: <failure mode title>

**Failure mode:** `<id>`
**Status:** Draft — awaiting approval
**Date:** <YYYY-MM-DD>

## What's failing

<2–4 sentences. What goes wrong, in what flows, with what observable effect.
More precise than the failure mode description — this is the diagnosis.>

## Evidence summary

<Bullet list. One line per cohort trace (use traceId). What each trace shows.
Call out any SME-annotated traces separately — they carry the most signal.>

| Trace | What it shows |
|-------|---------------|
| `trc_…` | <one-line observation> |

## Root cause

<The specific artefact(s) responsible. File + line range. Causal chain.
If multiple hypotheses remain, list them ranked by confidence.>

**Primary hypothesis (confidence: high/medium/low):**
<artefact + causal chain>

**Alternative hypothesis (if any):**
<artefact + causal chain>

## Open questions and SME inputs required

> Leave this section blank if there are none. If present, each item is a blocker
> or a risk that the implementer must be aware of.

- [ ] **[Business rule]** <question> — Owner: <name/team if known>
- [ ] **[Upstream data]** <what may be wrong externally> — Owner: <name/team>
- [ ] **[Missing ground truth]** <what example/confirmation is needed>
- [ ] **[Sensitive area]** <what hard-ruled code may be touched> — requires human in the loop

*If any of these are unresolved, the implementer should not proceed until they are
answered or explicitly accepted as known risks.*

## Proposed fix

<What to change and why, in problem-space terms — not a diff.
"Add a guard that …", "Modify the prompt at section X to require …",
"Replace the tool-arg builder at line N to …"
One bullet per distinct change if multiple are needed.>

## Acceptance criteria

<Numbered list. Each criterion must be checkable from a trace or test output —
no subjective criteria. Must be specific enough that the implementer can write a
concrete test against each one.>

1. <Observable outcome that a passing fix must produce.>
2. …

## Test plan

<How the implementer should verify the fix. Reference eval/scenario/replay commands
from whetstone.config.md where applicable. If the "Model test command" section of
the config is set, describe what inputs to run through it and what outputs to expect.
If no automated test covers this pattern, say so explicitly — the implementer will
need to construct one or perform a manual replay.>

## Out of scope

<Optional. What related issues this fix deliberately does not address.>
```

Be specific. A vague acceptance criterion produces a vague implementation and a broken verify phase. If you cannot write a concrete, checkable criterion, you don't understand the fix yet — go back to steps 3–4.

---

## Step 6 — Update status

Update `whetstone/<agent_name>/failure_modes.json`: set `status = "spec_drafted"`, `lastUpdated = <UTC ISO>`.

Run `npx whetstone validate --agent <agent_name>`. Self-correct if it fails.

---

## Step 7 — Approval gate ⏸

Print a summary of the spec back to the user.

If there are open items in the "Open questions and SME inputs required" section, highlight them prominently:

> ⚠ **This spec has open questions.** The items listed above require SME input or external action before implementation begins. The implementer should not proceed until they are resolved or explicitly accepted as known risks.

Ask: **"Does this spec look right? Any corrections or open questions to resolve before implementation?"**

**Hard stop.** Wait for the user's response. A reply of "approved", "looks good", "proceed", or similar means the spec is accepted as-is. If the user requests changes, update `SPEC.md`, re-print the relevant sections, and ask again. Do not auto-approve.

When approved:
- Update `whetstone/<agent_name>/failure_modes.json`: set `status = "fix_approved"`, `lastUpdated = <UTC ISO>`.
- Run `npx whetstone validate --agent <agent_name>`. Self-correct if it fails.
- Print: "Spec approved. Run the `implement-failure-mode` skill with agent=`<agent_name>` and fm=`<id>` to begin implementation."

---

## Hard rules

- **This skill never edits agent code.** Read-only with respect to everything except `whetstone/<agent_name>/failure_modes/<id>/SPEC.md` and `whetstone/<agent_name>/failure_modes.json`.
- **One agent per invocation.** Never read or write under `whetstone/<other-agent>/`. The agent name scopes every read and write this skill performs.
- **Spec approval is a hard gate.** Do not mark status `fix_approved` until the user explicitly approves.
- **Write `failure_modes.json` and run `whetstone validate --agent <agent_name>` after every change.** Self-correct if it fails.
- **Use `jq` / `jq -c` for all shell-level JSON.** Never `grep`/`sed`/`awk` against JSON.
- **Load raw trace payloads on demand**, one at a time. Do not preload the entire cohort.
- **Surface SME blockers early.** If open questions prevent a reliable spec, stop after Step 4 and ask the user before drafting.
- **No commits, no pushes, no PRs.** Leave the working tree dirty and stop.
- **Honor all hard rules from `whetstone/<agent_name>/whetstone.config.md`.** Quote them at the start of the transcript.

## Output contract

After this skill runs to completion:

- `whetstone/<agent_name>/failure_modes/<id>/SPEC.md` exists with all required sections filled in.
- `whetstone/<agent_name>/failure_modes.json` has `status = "fix_approved"` for this failure mode (set only after explicit user approval).
- `npx whetstone validate --agent <agent_name>` passes.
- No agent code has been modified.
- No file under `whetstone/<other-agent>/` has been read or written.
