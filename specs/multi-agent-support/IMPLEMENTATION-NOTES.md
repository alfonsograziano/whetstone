# Implementation Notes: Multi-agent support

> **Date:** 2026-05-01

---

## Summary

Inserted an agent-name segment between `whetstone/` and the rest of the tree at every read/write site. New file [src/commands/agent-root.ts](../../src/commands/agent-root.ts) absorbs path resolution, name validation (`^[a-z0-9][a-z0-9_-]*$`), and existence checks; the five existing commands now delegate to it. New `whetstone agents` command lists every subdirectory of `whetstone/` that contains a `whetstone.config.md`. `init` takes a positional agent name; every other command grows a required `--agent`/`-a` flag. All four skills updated to thread `agent_name` through inputs, paths, and CLI invocations. Tests parameterised with a fixture agent and grew multi-agent isolation cases. 88 tests pass; built binary smoke-tested end-to-end.

---

## Deviations from the Plan

- **Helper API split into two functions, not one.** The plan named a single `resolveAgentRoot()`. In code I split it into `resolveAgentRootForInit` (validates name format, allows missing dir) and `resolveAgentRootForRead` (requires existence, lists existing agents on failure) — same intent as the plan's tasks but cleaner call sites. `listAgents()` is exported separately for the `agents` command and the CLI's "available agents" error footer.
- **Removed unused `isAbsolute`/`resolve` imports from `validate.ts`/`status.ts`/`trace-get.ts`/`fm-get.ts`** when the helper took over. The plan didn't call this out but the typecheck would have failed otherwise — small bookkeeping deviation, no behaviour change.

---

## Surprises & Discoveries

- **Tests had a hidden coupling to the old "missing whetstone/" error path.** The original `validate.test.ts` test "missing whetstone/ directory reports WHET_STRUCT_MISSING and stops" relied on `runValidate` returning a one-issue report when `whetstone/` was absent. Under the new design `resolveAgentRootForRead` throws *before* the validator runs — that test became "missing agent directory rejects with 'no such agent'" via `assert.rejects`. A handful of similar tests in `status.test.ts` and `get.test.ts` shifted from "throws with `/whetstone\/ directory not found/`" to "throws with `/no such agent/`", which is more accurate to the new model.
- **The grep tool in this shell session silently returned no matches even when content was clearly present.** I had to fall back to `Read`-based verification instead of `grep` to confirm edits. Didn't affect correctness but slowed iteration.

---

## Judgment Calls

- **Agent-name validation happens on init only, not on `--agent`.** A user who hand-creates `whetstone/My_Agent/` (uppercase, would fail init's regex) can still read it via `--agent My_Agent` because read commands check existence, not name format. Looser-on-read is one-way and avoids duplicating the regex check across every parser. This is documented in the spec's Decision Log and reinforced in the `agent-root.test.ts` fixtures.
- **`--agent` short flag is `-a`, not something else.** No conflict with existing flags (`-C` for cwd, `-h` for help). Mirrors common CLI conventions.
- **`whetstone agents` exits 0 with empty output when `whetstone/` is absent**, matching AC 10. Treats absence as "zero agents configured" rather than as an IO error. This means a fresh repo that's never been initialised gets an empty answer rather than an exit-2 error — which is the natural reading of "list the agents in this repo: none".
- **Generated adapter scripts bake the agent name in as a constant**, not a `--agent` flag. The script lives under that agent's `adapters/` directory and writes only to that agent's `traces/`; making the agent a flag would invite cross-agent writes. The skill's hard rules say "if two agents need the same source system, generate two scripts."
- **The `git checkout -b whetstone/<id>` example in `implement-failure-mode/SKILL.md` was left untouched** — it's a git branch name (the user's branching convention), not a path. Added a one-line note in the skill explaining this so future readers don't try to "fix" it.

---

## Sanity Checks

| Check | Result | Notes |
|-------|--------|-------|
| `npm run typecheck` | ✓ | Clean. |
| `npm test` | ✓ | 88 tests pass, 0 fail. |
| `npm run build` | ✓ | `dist/cli.js` produced. |
| Built-binary smoke | ✓ | `--help`, `init`, `agents`, `agents --json`, `validate`, `status`, `trace get`, `fm get` all behave as specified. Negative cases (missing positional, invalid name, missing flag, non-existent agent) all exit 2 with informative messages. |

---

## Out of Scope Observations

- **`templates/whetstone.config.md` references an `ingest-traces` skill that does not exist** in the repo (only `analyze-traces`, `research-failure-mode`, `implement-failure-mode`, `create-adapter` are in `skills/`). Pre-existing typo in the template; not changed under this spec.
- **The `examples/` directory** contains older example projects but none are referenced by tests, so no migration was needed. If the user later adds examples that exercise the layout, those will need to be re-cut to the multi-agent shape.
- **No `harden` skill exists yet** despite repeated PRD references. Out of scope for this change.

---

## Remaining Work

- None — every task in PLAN.md is checked off and every acceptance criterion in SPEC.md is met.
