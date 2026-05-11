# Spec: Multi-agent support

> **Status:** Complete
> **Created:** 2026-05-01
> **Folder:** specs/multi-agent-support

---

## User input

> Currently tracebound supports one agent basically.
> The issue is that, usually, a codebase can have multiple agents.
>
> The idea is: when I run tracebound init, I specify the agent name as CLI argument.
>
> This creates a `tracebound/agent/[everythingElse]`
>
> This way I can have multiple "tracebound" instances, one per agent.

Follow-up clarifications:

- *CLI shape for non-init commands — `--agent <name>` flag? auto-pick when only one agent exists?* → "If I don't specify the agent, error."
- *Backwards compatibility — break the flat layout entirely?* → "I don't need to be backward compatible."
- *Aggregate views — `tracebound status` per-agent only, or also `--all`?* → "I like to have the per-agent, if I don't give the flag, you can assume that's all."
- *New `tracebound agents` command to list configured agents?* → "Sure."

---

## Context

Tracebound today assumes one agent per repo: `tracebound init` scaffolds a single flat tree at `tracebound/{tracebound.config.md, failure_modes.json, traces/, failure_modes/, adapters/}` and every CLI command + skill resolves paths against that fixed root. In real codebases — especially monorepos and platform repos — teams ship more than one LLM agent (a customer-support bot, an internal RAG agent, a code-review bot), and each agent has its own prompt, tools, traces, failure-mode catalogue, and SMEs.

The current layout forces those teams to either pick one agent to track and ignore the others, or keep a separate fork/clone of Tracebound per agent — both of which defeat the "diffable artefact in your repo" model the PRD is built around.

This spec introduces a per-agent namespace: every Tracebound artefact lives under `tracebound/<agent-name>/...` from now on. The agent name becomes a required parameter on `init` and a required `--agent` flag on every other command. Multiple agents coexist as siblings under `tracebound/`. Skills accept the agent name as input and pass it through to the CLI.

**Affected roles:**
- **Agent engineers** owning more than one agent in the same repo — the primary beneficiaries.
- **Coding agents** running the Tracebound skills — each invocation now scopes itself to one named agent.
- **Operators** picking up a project for the first time — need to discover which agents are configured (`tracebound agents`).

This is a breaking change against the v0.1.0 layout. There is no v1.0 in the wild yet, so no compatibility shim is required.

---

## Non-Goals

- Cross-agent queries or aggregations (e.g. "show all failure modes across every agent"). `status`, `validate`, `trace get`, `fm get` operate on one agent at a time.
- Migration tooling for existing flat-layout `tracebound/` directories. Pre-1.0 break; users move their files manually.
- Any change to the **shape** of `tracebound.config.md`, `failure_modes.json`, the `Trace` schema, or the `FailureMode` schema. Only the *location* changes.
- Per-agent CLI configuration files, agent registries, or an agent-discovery service. Agents are discovered by listing subdirectories of `tracebound/`.
- Renaming or restructuring skills. Each skill keeps its current name and purpose; only its inputs and the paths it reads/writes change.
- Backwards compatibility with the flat `tracebound/tracebound.config.md` layout.
- Any change to how adapters are written. Adapters still live under `tracebound/<agent>/adapters/`; their script body is unchanged.
- Renaming the `tracebound/` root directory itself.

---

## Acceptance Criteria

### CLI — `init`

1. `tracebound init <agent-name>` creates `tracebound/<agent-name>/{tracebound.config.md, failure_modes.json, traces/, traces/original/, failure_modes/, adapters/}` and exits 0.
2. `tracebound init` (no positional argument) exits non-zero with a usage error naming `<agent-name>` as required.
3. `tracebound init <agent-name>` is idempotent: re-running on an existing agent reports every file as skipped and does not overwrite user edits to `tracebound.config.md` or `failure_modes.json`.
4. Two different agent names create two sibling directories under `tracebound/` that do not interfere with each other.
5. The agent name is validated: must match `^[a-z0-9][a-z0-9_-]*$` (lowercase, digits, underscores, hyphens; must start with letter/digit). Invalid names exit non-zero with a clear error and do not create any files.

### CLI — `validate`, `status`, `trace get`, `fm get`

6. Every non-init command requires an `--agent <name>` flag (alias `-a`). Omitting it exits non-zero with a usage error that names the flag and lists the agents currently present under `tracebound/` (if any).
7. Passing `--agent <name>` where `tracebound/<agent-name>/` does not exist exits non-zero (exit code 2) with a "no such agent" error and the list of agents that do exist.
8. With `--agent <name>` set, each command operates against `tracebound/<agent-name>/` exactly as it did against `tracebound/` before this change. No other behaviour changes — exit codes, JSON schemas, and human-readable output are preserved.
9. `--agent` works alongside `--cwd`; `--cwd` resolves the repo root, `--agent` selects the namespace inside it.

### CLI — new `agents` command

10. `tracebound agents` prints, one per line, the name of every subdirectory under `tracebound/` that contains at least a `tracebound.config.md` file. Exit 0 even if zero agents are configured (empty output).
11. `tracebound agents --json` emits `{ "agents": [{ "name": "<n>", "path": "<absolute path>" }] }` sorted alphabetically by name. Exit 0 in all healthy cases.
12. `tracebound agents --help` and `tracebound --help` both list the new command.
13. Subdirectories under `tracebound/` that do not contain a `tracebound.config.md` are skipped silently (do not appear in the listing) so partially-initialised or unrelated folders do not pollute the output.

### Skills

14. Every skill in `skills/` accepts an `agent_name` input as a **required** parameter. If the user invokes a skill without one, the skill runs `tracebound agents` and asks the user which agent to operate on before doing anything else.
15. Every shell command and file path in every skill that previously referenced `tracebound/<thing>` references `tracebound/<agent_name>/<thing>` instead. Every CLI invocation passes `--agent <agent_name>`.
16. The skills' Hard Rules sections explicitly state that the agent name scopes the skill's reads and writes and that the skill must not touch artefacts under any other agent's directory.

### Templates

17. The `tracebound init <agent-name>` command writes `templates/tracebound.config.md` verbatim into `tracebound/<agent-name>/tracebound.config.md` — no per-agent substitution is required.

### Tests

18. `npm test` passes. Existing tests are updated to pass an agent name; new tests cover: name validation, `init` rejecting missing/invalid names, two agents living side by side, every non-init command erroring without `--agent`, `--agent` selecting the right namespace, and the `agents` listing (including the empty case and the "missing config.md" skip rule).

### Docs

19. The README and any inline CLI `--help` text reflect the new layout, the required `--agent` flag, and the new `agents` command. The "Quick start" example uses a concrete agent name (e.g. `tracebound init support-bot`).

---

## Constraints

- **Pre-1.0 break.** No backwards-compatibility shim, no `--legacy-flat` mode, no auto-migration. Users with existing flat `tracebound/` layouts move their files manually; release notes will call this out.
- **CLI ergonomics must mirror existing conventions.** `--agent`/`-a` is added uniformly; `--cwd`/`-C` and `--json` keep their current meanings on every command.
- **Schema files (`src/schemas/*`) are not modified.** Only the *path resolution* changes.
- **Skills stay portable** — plain markdown, no project-specific runtime, no assumption that any particular coding assistant runs them.
- **No new runtime dependencies.** The project is currently `zod` only (plus dev `typescript`, `@types/node`); keep it that way.
- **Hard rule from the project's own config still holds:** any shell-level JSON manipulation in skills uses `jq`, never `grep`/`sed`/`awk`.

---

## Technical Notes

- Today's `runInit({ cwd })` in `src/commands/init.ts` mkdirs `tracebound/` under `cwd` and then `traces/`, `failure_modes/`, `adapters/`, `traces/original/` under it. The change is mechanically: insert `<agent-name>` between `tracebound/` and the rest, and validate the agent name before any filesystem op.
- Every other command (`validate`, `status`, `trace-get`, `fm-get`) currently computes `rootPath = join(cwd, "tracebound")`. They will all compute `rootPath = join(cwd, "tracebound", agentName)` after resolving the `--agent` flag.
- The `tracebound/` directory itself becomes a namespace container only — no files live directly under it. The `agents` command treats it as such.
- The current CLI's switch in `src/cli.ts` uses an ad-hoc `case "trace": / case "fm":` pattern for two-word commands; the new `agents` command is single-word and slots in next to `init`/`validate`/`status` without disturbing that.
- The 4 existing skills (`analyze-traces`, `research-failure-mode`, `implement-failure-mode`, `create-adapter`) all need their preflight checks, path references, and CLI invocations updated. None of their core logic changes.
- The existing `cli-validate` PLAN.md is a good style reference for the implementation plan that will follow this spec.

---

## Decision Log

| Decision | Rationale |
|----------|-----------|
| Required `--agent` flag on every non-init command, no auto-pick when one agent exists. | User-specified. Avoids silent behaviour change when a second agent is later added. |
| Break the flat layout outright; no compatibility shim. | User-specified. Project is pre-1.0; cost of a shim outweighs the benefit at this stage. |
| New `tracebound agents` command. | User-approved. Skills need a way to list configured agents to prompt the user when no `agent_name` is supplied. `agents` is the canonical entry point. |
| `tracebound status` is always per-agent (via `--agent`); no `--all` aggregate. | User-specified. Aggregate views are a future enhancement; per-agent scope keeps v1 scope tight. |
| Agent name validated against `^[a-z0-9][a-z0-9_-]*$`. | Keeps directory names cross-platform-safe and skill-friendly (no spaces, no quoting). Conventional for CLI tool slugs. |
| `tracebound agents` filters to subdirs containing `tracebound.config.md`. | The presence of the config is the sentinel for "this is a real agent directory" and avoids surfacing partial inits or unrelated folders. |
