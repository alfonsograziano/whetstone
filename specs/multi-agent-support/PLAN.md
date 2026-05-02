# Plan: Multi-agent support

> **Status:** Complete
> **Created:** 2026-05-01
> **Spec source:** [SPEC.md](./SPEC.md)

---

## Approach

Insert the agent name between `whetstone/` and the rest of the tree at every read/write site. The change is mechanical and centred on path resolution. A new shared helper in [src/commands/agent-root.ts](../../src/commands/agent-root.ts) _(new file)_ — `resolveAgentRoot({ cwd, agent })` returning `{ cwdAbsolute, rootPath, agentName }` — replaces the ad-hoc `join(cwdAbsolute, "whetstone")` lines in [src/commands/init.ts:78](../../src/commands/init.ts#L78), [src/commands/validate.ts:191](../../src/commands/validate.ts#L191), [src/commands/status.ts:162](../../src/commands/status.ts#L162), [src/commands/trace-get.ts:52](../../src/commands/trace-get.ts#L52), and [src/commands/fm-get.ts:45](../../src/commands/fm-get.ts#L45). The helper validates the name format on init (`^[a-z0-9][a-z0-9_-]*$`, AC 5) and on read commands rejects non-existent agents with an error message that lists the agents that do exist (AC 7).

`init` takes the agent name as a required positional argument; every other command grows a required `--agent`/`-a` flag in its `parseArgs` schema in [src/cli.ts](../../src/cli.ts). A new `whetstone agents` command lives in [src/commands/agents.ts](../../src/commands/agents.ts) _(new file)_ and is dispatched alongside `init`/`validate`/`status` in `main()`'s switch ([src/cli.ts:352-380](../../src/cli.ts#L352-L380)). All four skills under [skills/](../../skills/) gain an `agent_name` required input and substitute `whetstone/<agent_name>/` everywhere they previously hardcoded `whetstone/`. Tests in [src/__tests__/](../../src/__tests__/) are parameterised with a fixture agent name and grow new tests covering the multi-agent surface. README quick-start gets a concrete agent name.

---

## Trade-offs

- **Shared helper vs. inline path resolution.** Five commands today repeat the cwd-resolution + `join(cwd, "whetstone")` lines. With agent-name validation, existence checks, and a sixth command (`agents`) added on top, inlining a sixth time would multiply by six the places error messages need to stay in sync. Chose the helper. Cost: one new file; existing test patterns are unchanged.
- **Agent-name validation: init-only vs. everywhere.** Could enforce `^[a-z0-9][a-z0-9_-]*$` on every command that takes `--agent`. Chose to enforce only on `init` (write side) and fall back to existence checks on read commands. A directory that exists is, by definition, accepted. A user who hand-creates `whetstone/My_Agent/` can read with `--agent My_Agent` even though `init` would refuse to create it. The looseness is one-way (read-only) and avoids duplicating the validator in five places.
- **`agents` exit code when `whetstone/` is missing.** Could exit 2 like `status` does today (treats absence as "could not run"), or exit 0 with empty output (treats absence as "zero agents configured"). Chose the latter — AC 10 says "Exit 0 even if zero agents are configured" and "no agents yet" is the natural reading of an absent root. `agents` is an inventory question, not an operation; the answer to the question on an empty repo is *zero*.
- **Positional agent name on init vs. `--agent` flag everywhere.** Could uniformly use the flag. Chose positional because `init` is *creating* the agent — the agent name is the subject of the command, not a context flag — and the user described it that way in the spec. Cost: tiny inconsistency between init and other commands; mitigated by identical flag style everywhere else.
- **One task for "update all skills" vs. one task per skill.** Chose one task per skill. The edits are mechanical but each skill has its own preflight checks, hard-rule sections, and example commands — splitting keeps each diff reviewable on its own and lets implementation be checkpointed.

---

## Tasks

### Foundation

- [x] Add `resolveAgentRoot()` helper at [src/commands/agent-root.ts](../../src/commands/agent-root.ts) _(new file)_ exporting `AGENT_NAME_RE`, `resolveAgentRootForInit({ cwd, agent })`, and `resolveAgentRootForRead({ cwd, agent })`. The init variant validates name format and resolves the path *without* requiring it to exist. The read variant resolves the path and asserts the agent dir exists, otherwise throws with a message listing existing agents (read by `listAgents(rootContainer)` — also new in this file, used by the `agents` command). Both variants return `{ cwdAbsolute, rootContainer, rootPath, agentName }` where `rootContainer = <cwd>/whetstone` and `rootPath = <cwd>/whetstone/<agent>`. **(AC 5, 7, 9)**. **Done when:** the file exists, exports the three symbols, typechecks, and unit-test stubs in `src/__tests__/agent-root.test.ts` _(new)_ cover: invalid name throws on init resolver; valid name returns the right path; missing-agent on read resolver throws with the existing-agents list.

### Commands — wire path resolution to the helper

- [x] Update [src/commands/init.ts](../../src/commands/init.ts) to take `agent: string` on `InitOptions`, replace the `cwdAbsolute`/`rootPath` block at lines 60–78 with a call to `resolveAgentRootForInit`, and write the same files at the new `rootPath`. Keep `SUBDIRS` exported (the validate command imports it). Keep the same per-file write-if-missing semantics. **(AC 1, 3, 4, 5)**. **Done when:** `runInit({ cwd, agent: "x" })` creates `whetstone/x/...`; `runInit({ cwd })` (missing agent) throws; `runInit({ cwd, agent: "BAD NAME" })` throws with a name-format error.
- [x] Update [src/commands/validate.ts](../../src/commands/validate.ts) to take `agent: string` on `ValidateOptions`, replace the `cwdAbsolute`/`rootPath` block (lines 178–191) with `resolveAgentRootForRead`, and confirm the `WHET_STRUCT_MISSING` issue path message at lines 198–203 still reads correctly when the *agent root* (not the bare `whetstone/`) is the thing missing — adjust copy if needed. **(AC 6, 7, 8, 9)**. **Done when:** `runValidate({ cwd, agent: "x" })` validates `whetstone/x/`; `runValidate({ cwd })` throws (handled by the CLI as exit 2); `runValidate({ cwd, agent: "ghost" })` throws "no such agent: ghost. Available: …".
- [x] Update [src/commands/status.ts](../../src/commands/status.ts) the same way: add `agent` to `StatusOptions`, replace lines 149–168 with the helper call, update the `whetstone/ directory not found` message at line 165 to reflect the agent root. **(AC 6, 7, 8, 9)**. **Done when:** `runStatus({ cwd, agent: "x" })` returns the report for `whetstone/x/`; missing agent throws via the helper.
- [x] Update [src/commands/trace-get.ts](../../src/commands/trace-get.ts): add `agent` to `TraceGetOptions`, replace the cwd/root resolution at lines 43–57 with the helper. **(AC 6, 7, 8, 9)**. **Done when:** `runTraceGet(id, { cwd, agent: "x" })` searches only `whetstone/x/traces/`.
- [x] Update [src/commands/fm-get.ts](../../src/commands/fm-get.ts): add `agent` to `FmGetOptions`, replace lines 36–50 with the helper. **(AC 6, 7, 8, 9)**. **Done when:** `runFmGet(id, { cwd, agent: "x" })` reads only `whetstone/x/failure_modes.json`.

### New `agents` command

- [x] Add [src/commands/agents.ts](../../src/commands/agents.ts) _(new file)_ exporting `runAgents({ cwd })` returning `{ agents: { name, path }[] }` and the two reporters (`reportText`, `reportJson`) matching the existing reporter signature on [src/commands/status.ts](../../src/commands/status.ts). The function reads `<cwd>/whetstone/`, lists subdirectories, filters to those that contain a regular file `whetstone.config.md`, sorts alphabetically. Returns an empty list (not an error) when `whetstone/` itself is missing or empty. The text reporter prints one name per line (or nothing if empty); the JSON reporter emits `{ "agents": [{ "name", "path" }] }`. **(AC 10, 11, 13)**. **Done when:** unit test for an empty repo prints nothing exit 0; for a repo with `whetstone/a/`, `whetstone/b/whetstone.config.md`, `whetstone/c/` (no config) returns `["b"]` only; `--json` emits the documented shape sorted by name.

### CLI wiring

- [x] Update [src/cli.ts](../../src/cli.ts) top-level `USAGE` (lines 26–43) and `INIT_USAGE` (lines 45–57) plus `VALIDATE_USAGE` / `TRACE_GET_USAGE` / `FM_GET_USAGE` / `STATUS_USAGE` to (a) document the new positional on `init`, (b) add `--agent <name>` (alias `-a`) on the others, (c) add a one-line entry for the new `agents` command in the top-level usage. Add `AGENTS_USAGE` constant. **(AC 2, 6, 12, 19)**. **Done when:** `whetstone --help` lists `agents`; `whetstone init --help` shows the positional; every other `--help` lists `--agent`/`-a`.
- [x] Update [`runInitCommand`](../../src/cli.ts#L162-L184): switch `parseArgs` to `allowPositionals: true`, take the first positional as the agent name, fail with exit 2 + a usage error when missing. Pass it through to `runInit`. **(AC 1, 2)**. **Done when:** `whetstone init` prints "Error: <agent-name> is required" and exits 2; `whetstone init my-bot` succeeds.
- [x] Update `runValidateCommand`, `runStatusCommand`, `runTraceGetCommand`, `runFmGetCommand` in [src/cli.ts](../../src/cli.ts): each `parseArgs` schema gains `agent: { type: "string", short: "a" }`. Missing `--agent` → fail with exit 2 + usage error that includes the list of agents under `whetstone/` (call `listAgents()` from the helper file; safe even when `whetstone/` is missing). On `runX` throw "no such agent", convert to exit-2 fail with the same listing. **(AC 6, 7)**. **Done when:** each command without `--agent` exits 2 with a message naming the flag; with a non-existent agent, exits 2 with the existing-agents list; with a valid `--agent`, runs end-to-end.
- [x] Add `runAgentsCommand(argv)` in [src/cli.ts](../../src/cli.ts) mirroring `runStatusCommand`'s shape (parses `--cwd`, `--json`, `--help`, no positionals), and add `case "agents":` to `main()`'s switch beside `case "status":` ([src/cli.ts:352-380](../../src/cli.ts#L352-L380)). **(AC 10, 11, 12)**. **Done when:** `whetstone agents` prints the listing; `whetstone agents --json | jq .` emits valid JSON; `whetstone agents --help` prints `AGENTS_USAGE`.

### Tests

- [x] Update [src/__tests__/init.test.ts](../../src/__tests__/init.test.ts): every `runInit({ cwd })` call grows `agent: "test-agent"`. Path assertions change from `cwd, "whetstone"` to `cwd, "whetstone", "test-agent"`. Add new tests: (a) `runInit({ cwd })` (no agent) rejects with a clear message; (b) `runInit({ cwd, agent: "BAD NAME" })` rejects with a name-format error and creates no files; (c) `runInit({ cwd, agent: "a" })` then `runInit({ cwd, agent: "b" })` produces two sibling dirs with independent files. **(AC 1, 2, 3, 4, 5, 18)**. **Done when:** `node --test src/__tests__/init.test.ts` is green.
- [x] Update [src/__tests__/validate.test.ts](../../src/__tests__/validate.test.ts): the helper functions `traceLine`, `fmsFile`, etc. don't change; every `cwd, "whetstone"` path becomes `cwd, "whetstone", "test-agent"`; every `runValidate({ cwd })` becomes `runValidate({ cwd, agent: "test-agent" })`. Add tests: (a) `runValidate({ cwd })` (no agent) throws; (b) `runValidate({ cwd, agent: "ghost" })` throws "no such agent" listing existing agents; (c) two agents side-by-side validate independently — corruption in one doesn't surface as issues in the other. **(AC 6, 7, 8, 18)**. **Done when:** `node --test src/__tests__/validate.test.ts` is green and the two-agent isolation case is covered.
- [x] Update [src/__tests__/status.test.ts](../../src/__tests__/status.test.ts) the same way: thread `agent: "test-agent"` through every fixture-write helper and call site. Add a "no `--agent` throws" and a "two agents are independent" test. **(AC 6, 7, 8, 18)**. **Done when:** `node --test src/__tests__/status.test.ts` is green.
- [x] Update [src/__tests__/get.test.ts](../../src/__tests__/get.test.ts) (covers both `trace-get` and `fm-get`): same pattern. Specifically verify that `runTraceGet(id, { cwd, agent: "a" })` returns null when the matching trace lives only in agent `b`'s files. **(AC 6, 7, 8, 18)**. **Done when:** `node --test src/__tests__/get.test.ts` is green and the cross-agent isolation is asserted.
- [x] Add [src/__tests__/agents.test.ts](../../src/__tests__/agents.test.ts) _(new file)_: covers the empty case (no `whetstone/`, then empty `whetstone/`), the "one valid + one missing-config sibling" case, and the JSON shape. Use `mkdtemp` + `runInit` in the same idiom as the other tests. **(AC 10, 11, 13, 18)**. **Done when:** `node --test src/__tests__/agents.test.ts` is green; every assertion in AC 10/11/13 has a corresponding test.
- [x] Add [src/__tests__/agent-root.test.ts](../../src/__tests__/agent-root.test.ts) _(new file)_: direct unit tests of the helper's three exports. Edge cases: empty agent, name with uppercase, name with spaces, name starting with `-`, missing dir on read resolver lists agents, missing dir + missing `whetstone/` lists nothing. **(AC 5, 7, 18)**. **Done when:** `node --test src/__tests__/agent-root.test.ts` is green.

### Skills

- [x] Update [skills/analyze-traces/SKILL.md](../../skills/analyze-traces/SKILL.md): add `agent_name` (required) to **Inputs**; if missing, run `npx whetstone agents` and ask which to use before doing anything else. Replace every `whetstone/<thing>` path (16 sites — full count from grep is in Technical Notes) with `whetstone/<agent_name>/<thing>`. Update every `npx whetstone …` invocation to add `--agent <agent_name>`. Add to **Hard rules**: "The agent name scopes all reads and writes; never touch `whetstone/<other-agent>/`." Update the `description` frontmatter only if it directly references a path (it does on line 3 — adjust to `whetstone/<agent>/traces/`). **(AC 14, 15, 16)**. **Done when:** no remaining occurrence of `whetstone/traces`, `whetstone/failure_modes`, `whetstone/whetstone.config.md`, or `whetstone/adapters` (without the `<agent_name>` segment) in the file; every `npx whetstone` invocation includes `--agent`.
- [x] Update [skills/research-failure-mode/SKILL.md](../../skills/research-failure-mode/SKILL.md) the same way (12+ path sites; use `grep -n 'whetstone/' skills/research-failure-mode/SKILL.md` to find them). Don't forget the SPEC path at line 117 and the `mkdir -p` at line 114. **(AC 14, 15, 16)**. **Done when:** same as above for this file.
- [x] Update [skills/implement-failure-mode/SKILL.md](../../skills/implement-failure-mode/SKILL.md) the same way. Special-case the branching example at line 87–90: `git checkout -b whetstone/<id>` is a *git branch name*, not a path — leave it as is. **(AC 14, 15, 16)**. **Done when:** all *path* references include `<agent_name>`; the branch-name example is unchanged.
- [x] Update [skills/create-adapter/SKILL.md](../../skills/create-adapter/SKILL.md) the same way (14 path sites). Update the generated-script defaults: `--out` default becomes `whetstone/<agent>/traces/<name>-<YYYY-MM-DD>.jsonl`; raw payloads land at `whetstone/<agent>/traces/original/<id>.json`. The script template's CLI section needs an `--agent` (or positional) so the generated adapter knows where to write. Update the verification step's `npx whetstone validate` to include `--agent <agent_name>`. **(AC 14, 15, 16)**. **Done when:** all path references include `<agent_name>` and the generated-script template's CLI documents the agent input.

### Templates and docs

- [x] Verify [templates/whetstone.config.md](../../templates/whetstone.config.md) needs no change (the agent name is the directory it lands in; no field inside the template references it). If a comment line referencing the layout is now misleading, update it. **(AC 17)**. **Done when:** a fresh `runInit({ cwd, agent: "x" })` writes the unchanged template body verbatim into `whetstone/x/whetstone.config.md` and the test assertion on `/^# Whetstone config/` still holds.
- [x] Update [README.md](../../README.md): Quick start §1 changes `whetstone init` → `whetstone init support-bot` and the directory tree example shows `whetstone/support-bot/{...}`. CLI reference table grows the `agents` row. Each per-command section under `## CLI reference` adds the `-a, --agent <name>` line. The skills table and skill-trigger examples thread an agent name. **(AC 19)**. **Done when:** every fenced code block under "Quick start" and "CLI reference" reflects the new shape; no remaining example shows the bare `whetstone/whetstone.config.md` path.

### Sanity

- [x] Run `npm run typecheck` && `npm test` && `npm run build`, then exercise the built binary: `node dist/cli.js init my-bot -C /tmp/fixture`, `node dist/cli.js agents -C /tmp/fixture`, `node dist/cli.js validate --agent my-bot -C /tmp/fixture`, `node dist/cli.js status --agent my-bot -C /tmp/fixture --json | jq .`. **(AC 18, 19)**. **Done when:** all commands exit 0 except the deliberate-error checks; help text is current.

---

## Technical Notes

### Files to change

| File | Change |
|------|--------|
| [src/commands/agent-root.ts](../../src/commands/agent-root.ts) _(new)_ | `AGENT_NAME_RE`, `listAgents`, `resolveAgentRootForInit`, `resolveAgentRootForRead`. |
| [src/commands/agents.ts](../../src/commands/agents.ts) _(new)_ | `runAgents`, text + JSON reporters. |
| [src/commands/init.ts](../../src/commands/init.ts) | Take `agent` on `InitOptions`; use `resolveAgentRootForInit`; write at the agent path. |
| [src/commands/validate.ts](../../src/commands/validate.ts) | `agent` on `ValidateOptions`; `resolveAgentRootForRead`; structure-missing copy mentions `whetstone/<agent>/`. |
| [src/commands/status.ts](../../src/commands/status.ts) | Same pattern. |
| [src/commands/trace-get.ts](../../src/commands/trace-get.ts) | Same pattern. |
| [src/commands/fm-get.ts](../../src/commands/fm-get.ts) | Same pattern. |
| [src/cli.ts](../../src/cli.ts) | New `agents` command + USAGE; `--agent`/`-a` on the four read commands; positional on `init`. |
| [src/__tests__/init.test.ts](../../src/__tests__/init.test.ts) | Thread `agent`; new tests per AC. |
| [src/__tests__/validate.test.ts](../../src/__tests__/validate.test.ts) | Thread `agent`; new tests per AC. |
| [src/__tests__/status.test.ts](../../src/__tests__/status.test.ts) | Thread `agent`; new tests per AC. |
| [src/__tests__/get.test.ts](../../src/__tests__/get.test.ts) | Thread `agent`; new tests per AC. |
| [src/__tests__/agents.test.ts](../../src/__tests__/agents.test.ts) _(new)_ | Cover AC 10, 11, 13. |
| [src/__tests__/agent-root.test.ts](../../src/__tests__/agent-root.test.ts) _(new)_ | Helper unit tests. |
| [skills/analyze-traces/SKILL.md](../../skills/analyze-traces/SKILL.md) | `agent_name` input + path rewrites + `--agent` on every CLI call. |
| [skills/research-failure-mode/SKILL.md](../../skills/research-failure-mode/SKILL.md) | Same. |
| [skills/implement-failure-mode/SKILL.md](../../skills/implement-failure-mode/SKILL.md) | Same; preserve `git checkout -b whetstone/<id>` branch-name example. |
| [skills/create-adapter/SKILL.md](../../skills/create-adapter/SKILL.md) | Same; generated-script default `--out` includes the agent. |
| [README.md](../../README.md) | Quick start example uses an agent name; CLI reference adds `agents` and `-a/--agent`. |
| [templates/whetstone.config.md](../../templates/whetstone.config.md) | Verify unchanged; touch only if a comment misleads. |

### Key references

- Existing helper-resolution pattern (the one being replaced): [src/commands/init.ts:60-77](../../src/commands/init.ts#L60-L77).
- Existing CLI parser shape per command: [src/cli.ts:162-184](../../src/cli.ts#L162-L184) (`runInitCommand`), [src/cli.ts:186-218](../../src/cli.ts#L186-L218) (`runValidateCommand`).
- Existing reporter pair (`reportText`/`reportJson`): [src/commands/status.ts:273-377](../../src/commands/status.ts#L273-L377). The new `agents.ts` mirrors this signature so [src/cli.ts](../../src/cli.ts) can dispatch it the same way.
- `SUBDIRS` constant exported for cross-command reuse: [src/commands/init.ts:19](../../src/commands/init.ts#L19) — keep exported.
- Test scaffolding idiom (`mkdtemp` + `t.after(rm…)` + `runInit` to seed): [src/__tests__/init.test.ts:10-12](../../src/__tests__/init.test.ts#L10-L12).
- Path reference counts (from grep, for skill rewrites): analyze-traces 16, research-failure-mode 13, implement-failure-mode 9, create-adapter 14. Run `grep -nE 'whetstone/(traces|failure_modes|whetstone\.config\.md|adapters)' skills/*/SKILL.md` to enumerate before each skill task.

### Agent-name regex

```
^[a-z0-9][a-z0-9_-]*$
```

Allowed: lowercase letters, digits, underscores, hyphens. Must start with a letter or digit (not `-` or `_`). No dots, no spaces, no uppercase. Conventional CLI slug shape; keeps directory names cross-platform-safe and quote-free in shell commands. Single source of truth for the regex is `AGENT_NAME_RE` in `src/commands/agent-root.ts`.

### Error message shape

When a read command is invoked without `--agent` or with a non-existent agent, the CLI prints (to stderr, exit 2):

```
Error: <reason>
Available agents: a, b, c
(or "Available agents: (none — run 'whetstone init <name>' to create one)")
```

The "available agents" footer is a single source of truth — produced by `listAgents()` in the helper file — so the `agents` command, the missing-flag path, and the not-found path all stay in sync.

### Skill input frontmatter

Each skill currently lists Inputs as a markdown bullet list, not YAML frontmatter. Don't introduce frontmatter-level inputs — keep the existing **Inputs** section style for consistency. Just add `agent_name` (required) at the top of the list and reference it in the preflight checks.

### Commands

```sh
npm run typecheck
npm test
npm run build

# Smoke-test the built binary
node dist/cli.js --help
node dist/cli.js init my-bot -C /tmp/fixture
node dist/cli.js init other-bot -C /tmp/fixture
node dist/cli.js agents -C /tmp/fixture
node dist/cli.js agents -C /tmp/fixture --json | jq .
node dist/cli.js validate --agent my-bot -C /tmp/fixture
node dist/cli.js status -a my-bot -C /tmp/fixture
node dist/cli.js trace get trc_x -a my-bot -C /tmp/fixture     # exits 1 (not found)
node dist/cli.js fm get fm_x -a my-bot -C /tmp/fixture         # exits 1 (not found)

# Negative cases
node dist/cli.js init                                           # exit 2, missing agent
node dist/cli.js init "Bad Name"                                # exit 2, name-format
node dist/cli.js validate -C /tmp/fixture                       # exit 2, missing --agent
node dist/cli.js validate -a ghost -C /tmp/fixture              # exit 2, no such agent
```

### Notes

- The `agents` command treats `<cwd>/whetstone/` as a namespace container only — no files live directly under it after this change, so a stray file there is benign (filtered out by the "must be a directory containing `whetstone.config.md`" rule).
- The PRD ([PRD.md §3 non-goals](../../PRD.md), [PRD.md §6.2](../../PRD.md)) still holds: the CLI never writes user code, never commits, never pushes. This change preserves that — the only filesystem writes are inside `whetstone/<agent>/` and they're scaffold/validation only.
- The hard rule in [templates/whetstone.config.md](../../templates/whetstone.config.md) line 70 (use `jq` for shell-level JSON manipulation) does not apply to in-process TypeScript; it governs the shell boundary in skills. Skills that grep against JSON in this plan must still use `jq`, just with the new `whetstone/<agent>/...` path.
- Skill instructions should make the agent-name input *visible* to the user — they should see "operating on agent X" in the skill's first line of output. This protects against accidentally analysing the wrong agent's traces.
- `git checkout -b whetstone/<id>` in [skills/implement-failure-mode/SKILL.md:90](../../skills/implement-failure-mode/SKILL.md#L90) is a *git branch name*, not a directory path. Don't insert `<agent_name>` there. (If the user wants per-agent branching they can configure it themselves in `whetstone.config.md`.)
- After this change, the `examples/` directory under the repo root may contain example projects with the old layout. They are fixtures, not part of the CLI; if they're consumed by tests, update them. If not, leave them and add a one-liner to the README noting the layout change.
