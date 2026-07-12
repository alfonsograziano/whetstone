## Summary
- Replaced the legacy verification blocks in the config template and example with a unified `## Verify the fix` section plus optional `## Harden the fix` guidance.
- Updated README and PRD documentation to describe the new verification contract, including targeted trace replays that reuse the failure-mode `input` field.
- Revised the `implement-failure-mode` and `research-failure-mode` skills to parse `## Verify the fix`, prioritize targeted replays and eval suites, and retain the consent gate when only sanity checks are available.

## Files changed
- templates/tracebound.config.md
- examples/mastra-support-bot/tracebound/support-bot/tracebound.config.md
- README.md
- PRD.md
- skills/implement-failure-mode/SKILL.md
- skills/research-failure-mode/SKILL.md

## Verification
```bash
npm test
npm warn Unknown env config "store-dir". This will stop working in the next major version of npm. See `npm help npmrc` for supported config options.

> @nearform/tracebound@0.1.0 test
> node --test src/__tests__/*.test.ts

✔ AGENT_NAME_RE accepts conventional CLI slugs (18.412171ms)
✔ AGENT_NAME_RE rejects empty strings, uppercase, dots, spaces, and bad starts (0.627347ms)
✔ resolveAgentRootForInit rejects a missing agent name (199.556955ms)
✔ resolveAgentRootForInit rejects an invalid agent name (22.366491ms)
✔ resolveAgentRootForInit returns paths even when the dir does not yet exist (14.642268ms)
✔ resolveAgentRootForRead rejects a missing agent name and lists existing agents (50.251703ms)
✔ resolveAgentRootForRead rejects an unknown agent and lists existing agents (34.392747ms)
✔ resolveAgentRootForRead reports '(none)' when no agents exist at all (26.047391ms)
✔ resolveAgentRootForRead returns a result for an existing agent (35.004398ms)
✔ listAgents returns [] when tracebound/ is missing (15.758006ms)
✔ listAgents returns subdirs with tracebound.config.md, sorted alphabetically (20.943007ms)
✔ runAgents on a directory with no tracebound/ returns empty list (exit 0) (48.828319ms)
✔ runAgents on an empty tracebound/ returns empty list (11.052334ms)
created: /tmp/tracebound-agents-pl4oFY/tracebound/alpha/tracebound.config.md
created: /tmp/tracebound-agents-pl4oFY/tracebound/alpha/failure_modes.json
✓ Tracebound initialised at /tmp/tracebound-agents-pl4oFY/tracebound/alpha
created: /tmp/tracebound-agents-pl4oFY/tracebound/beta/tracebound.config.md
created: /tmp/tracebound-agents-pl4oFY/tracebound/beta/failure_modes.json
✓ Tracebound initialised at /tmp/tracebound-agents-pl4oFY/tracebound/beta
✔ runAgents lists each subdirectory that contains tracebound.config.md (30.782949ms)
created: /tmp/tracebound-agents-0STKHS/tracebound/real/tracebound.config.md
created: /tmp/tracebound-agents-0STKHS/tracebound/real/failure_modes.json
✓ Tracebound initialised at /tmp/tracebound-agents-0STKHS/tracebound/real
✔ runAgents skips subdirectories that don't contain tracebound.config.md (21.12494ms)
created: /tmp/tracebound-agents-LBnouC/tracebound/zebra/tracebound.config.md
created: /tmp/tracebound-agents-LBnouC/tracebound/zebra/failure_modes.json
✓ Tracebound initialised at /tmp/tracebound-agents-LBnouC/tracebound/zebra
created: /tmp/tracebound-agents-LBnouC/tracebound/apple/tracebound.config.md
created: /tmp/tracebound-agents-LBnouC/tracebound/apple/failure_modes.json
✓ Tracebound initialised at /tmp/tracebound-agents-LBnouC/tracebound/apple
created: /tmp/tracebound-agents-LBnouC/tracebound/mango/tracebound.config.md
created: /tmp/tracebound-agents-LBnouC/tracebound/mango/failure_modes.json
✓ Tracebound initialised at /tmp/tracebound-agents-LBnouC/tracebound/mango
✔ runAgents output is sorted alphabetically (35.931254ms)
created: /tmp/tracebound-agents-Azvj3o/tracebound/alpha/tracebound.config.md
created: /tmp/tracebound-agents-Azvj3o/tracebound/alpha/failure_modes.json
✓ Tracebound initialised at /tmp/tracebound-agents-Azvj3o/tracebound/alpha
created: /tmp/tracebound-agents-Azvj3o/tracebound/beta/tracebound.config.md
created: /tmp/tracebound-agents-Azvj3o/tracebound/beta/failure_modes.json
✓ Tracebound initialised at /tmp/tracebound-agents-Azvj3o/tracebound/beta
✔ reportText emits one agent name per line, newline-terminated (23.93883ms)
created: /tmp/tracebound-agents-lqJyTK/tracebound/alpha/tracebound.config.md
created: /tmp/tracebound-agents-lqJyTK/tracebound/alpha/failure_modes.json
✓ Tracebound initialised at /tmp/tracebound-agents-lqJyTK/tracebound/alpha
✔ reportJson emits the documented shape (15.663509ms)
✔ reportJson on an empty list emits { agents: [] } (5.294246ms)
created: /tmp/tracebound-agents-GNLGVN/tracebound/real/tracebound.config.md
created: /tmp/tracebound-agents-GNLGVN/tracebound/real/failure_modes.json
✓ Tracebound initialised at /tmp/tracebound-agents-GNLGVN/tracebound/real
✔ a stray file under tracebound/ does not crash and is not listed (15.285849ms)
created: /tmp/tracebound-get-iBMZES/tracebound/test-agent/tracebound.config.md
created: /tmp/tracebound-get-iBMZES/tracebound/test-agent/failure_modes.json
✓ Tracebound initialised at /tmp/tracebound-get-iBMZES/tracebound/test-agent
✔ trace get: finds a trace in a single file (65.208326ms)
created: /tmp/tracebound-get-6IG8uQ/tracebound/test-agent/tracebound.config.md
created: /tmp/tracebound-get-6IG8uQ/tracebound/test-agent/failure_modes.json
✓ Tracebound initialised at /tmp/tracebound-get-6IG8uQ/tracebound/test-agent
✔ trace get: returns null when id is absent (21.374195ms)
created: /tmp/tracebound-get-QYv0av/tracebound/test-agent/tracebound.config.md
created: /tmp/tracebound-get-QYv0av/tracebound/test-agent/failure_modes.json
✓ Tracebound initialised at /tmp/tracebound-get-QYv0av/tracebound/test-agent
✔ trace get: searches across multiple files in sorted order (26.240184ms)
created: /tmp/tracebound-get-94C66R/tracebound/test-agent/tracebound.config.md
created: /tmp/tracebound-get-94C66R/tracebound/test-agent/failure_modes.json
✓ Tracebound initialised at /tmp/tracebound-get-94C66R/tracebound/test-agent
✔ trace get: skips malformed lines and keeps scanning (15.575944ms)
created: /tmp/tracebound-get-3i3Wa3/tracebound/test-agent/tracebound.config.md
created: /tmp/tracebound-get-3i3Wa3/tracebound/test-agent/failure_modes.json
✓ Tracebound initialised at /tmp/tracebound-get-3i3Wa3/tracebound/test-agent
✔ trace get: empty traces/ returns null without error (16.656576ms)
✔ trace get: throws when cwd does not exist (3.352288ms)
✔ trace get: throws when agent is absent (6.15523ms)
created: /tmp/tracebound-get-KKzeSw/tracebound/alpha/tracebound.config.md
created: /tmp/tracebound-get-KKzeSw/tracebound/alpha/failure_modes.json
✓ Tracebound initialised at /tmp/tracebound-get-KKzeSw/tracebound/alpha
✔ trace get: throws when --agent is missing (20.6638ms)
created: /tmp/tracebound-get-I27KAH/tracebound/alpha/tracebound.config.md
created: /tmp/tracebound-get-I27KAH/tracebound/alpha/failure_modes.json
✓ Tracebound initialised at /tmp/tracebound-get-I27KAH/tracebound/alpha
created: /tmp/tracebound-get-I27KAH/tracebound/beta/tracebound.config.md
created: /tmp/tracebound-get-I27KAH/tracebound/beta/failure_modes.json
✓ Tracebound initialised at /tmp/tracebound-get-I27KAH/tracebound/beta
✔ trace get: traces in another agent are not visible (71.072861ms)
✔ formatTraceText: not found (1.62435ms)
created: /tmp/tracebound-get-z4Qu27/tracebound/test-agent/tracebound.config.md
created: /tmp/tracebound-get-z4Qu27/tracebound/test-agent/failure_modes.json
✓ Tracebound initialised at /tmp/tracebound-get-z4Qu27/tracebound/test-agent
✔ formatTraceText: found trace is pretty-printed JSON (42.46132ms)
✔ formatTraceJson: not found has found:false (0.682718ms)
created: /tmp/tracebound-get-IhwgPX/tracebound/test-agent/tracebound.config.md
created: /tmp/tracebound-get-IhwgPX/tracebound/test-agent/failure_modes.json
✓ Tracebound initialised at /tmp/tracebound-get-IhwgPX/tracebound/test-agent
✔ formatTraceJson: found has found:true plus file and line (45.97646ms)
created: /tmp/tracebound-get-Zg0HfB/tracebound/test-agent/tracebound.config.md
created: /tmp/tracebound-get-Zg0HfB/tracebound/test-agent/failure_modes.json
✓ Tracebound initialised at /tmp/tracebound-get-Zg0HfB/tracebound/test-agent
✔ fm get: finds a failure mode by id (26.484475ms)
created: /tmp/tracebound-get-pMbNMT/tracebound/test-agent/tracebound.config.md
created: /tmp/tracebound-get-pMbNMT/tracebound/test-agent/failure_modes.json
✓ Tracebound initialised at /tmp/tracebound-get-pMbNMT/tracebound/test-agent
✔ fm get: returns null when id is absent (12.263404ms)
created: /tmp/tracebound-get-sa6fhG/tracebound/test-agent/tracebound.config.md
created: /tmp/tracebound-get-sa6fhG/tracebound/test-agent/failure_modes.json
✓ Tracebound initialised at /tmp/tracebound-get-sa6fhG/tracebound/test-agent
✔ fm get: empty catalogue returns null (11.818723ms)
created: /tmp/tracebound-get-kLJVrC/tracebound/test-agent/tracebound.config.md
created: /tmp/tracebound-get-kLJVrC/tracebound/test-agent/failure_modes.json
✓ Tracebound initialised at /tmp/tracebound-get-kLJVrC/tracebound/test-agent
✔ fm get: throws when failure_modes.json is malformed JSON (13.013346ms)
created: /tmp/tracebound-get-7CZlZB/tracebound/test-agent/tracebound.config.md
created: /tmp/tracebound-get-7CZlZB/tracebound/test-agent/failure_modes.json
✓ Tracebound initialised at /tmp/tracebound-get-7CZlZB/tracebound/test-agent
✔ fm get: throws when failure_modes.json fails schema (14.991461ms)
✔ fm get: throws when cwd does not exist (1.487764ms)
✔ fm get: throws when agent is absent (6.384125ms)
created: /tmp/tracebound-get-6B1EJw/tracebound/alpha/tracebound.config.md
created: /tmp/tracebound-get-6B1EJw/tracebound/alpha/failure_modes.json
✓ Tracebound initialised at /tmp/tracebound-get-6B1EJw/tracebound/alpha
✔ fm get: throws when --agent is missing (11.660815ms)
created: /tmp/tracebound-get-usSxse/tracebound/alpha/tracebound.config.md
created: /tmp/tracebound-get-usSxse/tracebound/alpha/failure_modes.json
✓ Tracebound initialised at /tmp/tracebound-get-usSxse/tracebound/alpha
created: /tmp/tracebound-get-usSxse/tracebound/beta/tracebound.config.md
created: /tmp/tracebound-get-usSxse/tracebound/beta/failure_modes.json
✓ Tracebound initialised at /tmp/tracebound-get-usSxse/tracebound/beta
✔ fm get: failure modes in one agent are not visible to another (26.864776ms)
✔ formatFmText: not found (0.994566ms)
created: /tmp/tracebound-get-WWwQ19/tracebound/test-agent/tracebound.config.md
created: /tmp/tracebound-get-WWwQ19/tracebound/test-agent/failure_modes.json
✓ Tracebound initialised at /tmp/tracebound-get-WWwQ19/tracebound/test-agent
✔ formatFmText: found prints id (14.017863ms)
✔ formatFmJson: not found has found:false (0.68914ms)
created: /tmp/tracebound-get-3e0BDM/tracebound/test-agent/tracebound.config.md
created: /tmp/tracebound-get-3e0BDM/tracebound/test-agent/failure_modes.json
✓ Tracebound initialised at /tmp/tracebound-get-3e0BDM/tracebound/test-agent
✔ formatFmJson: found has found:true (23.515096ms)
created: /tmp/tracebound-init-92USKb/tracebound/test-agent/tracebound.config.md
created: /tmp/tracebound-init-92USKb/tracebound/test-agent/failure_modes.json
✓ Tracebound initialised at /tmp/tracebound-init-92USKb/tracebound/test-agent
✔ runInit creates the full tracebound/<agent>/ tree on a clean directory (49.653234ms)
created: /tmp/tracebound-init-vY4NzT/tracebound/test-agent/tracebound.config.md
created: /tmp/tracebound-init-vY4NzT/tracebound/test-agent/failure_modes.json
✓ Tracebound initialised at /tmp/tracebound-init-vY4NzT/tracebound/test-agent
skipped (exists): /tmp/tracebound-init-vY4NzT/tracebound/test-agent/tracebound.config.md
skipped (exists): /tmp/tracebound-init-vY4NzT/tracebound/test-agent/failure_modes.json
✓ Tracebound initialised at /tmp/tracebound-init-vY4NzT/tracebound/test-agent
✔ runInit is idempotent: re-running reports every file as skipped (21.293271ms)
✔ runInit rejects --cwd that does not exist (3.57935ms)
✔ runInit rejects --cwd that is a file, not a directory (9.093024ms)
created: /tmp/tracebound-init-p352xM/tracebound/test-agent/tracebound.config.md
created: /tmp/tracebound-init-p352xM/tracebound/test-agent/failure_modes.json
✓ Tracebound initialised at /tmp/tracebound-init-p352xM/tracebound/test-agent
skipped (exists): /tmp/tracebound-init-p352xM/tracebound/test-agent/tracebound.config.md
skipped (exists): /tmp/tracebound-init-p352xM/tracebound/test-agent/failure_modes.json
✓ Tracebound initialised at /tmp/tracebound-init-p352xM/tracebound/test-agent
✔ runInit preserves user-edited files on re-run (16.672551ms)
✔ runInit rejects when no agent name is provided (4.01827ms)
✔ runInit rejects an invalid agent name and creates no files (4.496668ms)
created: /tmp/tracebound-init-psJcKv/tracebound/agent-1_v2/tracebound.config.md
created: /tmp/tracebound-init-psJcKv/tracebound/agent-1_v2/failure_modes.json
✓ Tracebound initialised at /tmp/tracebound-init-psJcKv/tracebound/agent-1_v2
✔ runInit accepts hyphens, underscores, and digits in the agent name (14.353761ms)
created: /tmp/tracebound-init-XBJsBv/tracebound/agent-a/tracebound.config.md
created: /tmp/tracebound-init-XBJsBv/tracebound/agent-a/failure_modes.json
✓ Tracebound initialised at /tmp/tracebound-init-XBJsBv/tracebound/agent-a
created: /tmp/tracebound-init-XBJsBv/tracebound/agent-b/tracebound.config.md
created: /tmp/tracebound-init-XBJsBv/tracebound/agent-b/failure_modes.json
✓ Tracebound initialised at /tmp/tracebound-init-XBJsBv/tracebound/agent-b
✔ two different agent names produce independent sibling directories (26.490341ms)
created: /tmp/tracebound-status-Wlf7RV/tracebound/test-agent/tracebound.config.md
created: /tmp/tracebound-status-Wlf7RV/tracebound/test-agent/failure_modes.json
✓ Tracebound initialised at /tmp/tracebound-status-Wlf7RV/tracebound/test-agent
✔ empty catalogue from runInit reports zero failure modes (104.169106ms)
created: /tmp/tracebound-status-jyp9pq/tracebound/test-agent/tracebound.config.md
created: /tmp/tracebound-status-jyp9pq/tracebound/test-agent/failure_modes.json
✓ Tracebound initialised at /tmp/tracebound-status-jyp9pq/tracebound/test-agent
✔ counts failure modes by status, ordered by lifecycle (93.084564ms)
created: /tmp/tracebound-status-OoZmpq/tracebound/test-agent/tracebound.config.md
created: /tmp/tracebound-status-OoZmpq/tracebound/test-agent/failure_modes.json
✓ Tracebound initialised at /tmp/tracebound-status-OoZmpq/tracebound/test-agent
✔ recentlyUpdated is sorted by lastUpdated desc, capped at 5 (89.639472ms)
created: /tmp/tracebound-status-yvSHma/tracebound/test-agent/tracebound.config.md
created: /tmp/tracebound-status-yvSHma/tracebound/test-agent/failure_modes.json
✓ Tracebound initialised at /tmp/tracebound-status-yvSHma/tracebound/test-agent
✔ specsAwaitingApproval contains every spec_drafted FM (46.327571ms)
created: /tmp/tracebound-status-TzOybn/tracebound/test-agent/tracebound.config.md
created: /tmp/tracebound-status-TzOybn/tracebound/test-agent/failure_modes.json
✓ Tracebound initialised at /tmp/tracebound-status-TzOybn/tracebound/test-agent
✔ trace files report total + pending counts; malformed lines are ignored (78.830074ms)
✔ missing agent dir throws (15.576321ms)
created: /tmp/tracebound-status-CitYtV/tracebound/alpha/tracebound.config.md
created: /tmp/tracebound-status-CitYtV/tracebound/alpha/failure_modes.json
✓ Tracebound initialised at /tmp/tracebound-status-CitYtV/tracebound/alpha
✔ missing --agent throws with available list (58.840506ms)
created: /tmp/tracebound-status-PnRrkV/tracebound/test-agent/tracebound.config.md
created: /tmp/tracebound-status-PnRrkV/tracebound/test-agent/failure_modes.json
✓ Tracebound initialised at /tmp/tracebound-status-PnRrkV/tracebound/test-agent
✔ malformed failure_modes.json throws with hint to validate (89.377426ms)
created: /tmp/tracebound-status-XPP28I/tracebound/test-agent/tracebound.config.md
created: /tmp/tracebound-status-XPP28I/tracebound/test-agent/failure_modes.json
✓ Tracebound initialised at /tmp/tracebound-status-XPP28I/tracebound/test-agent
✔ schema-invalid failure_modes.json throws with hint to validate (195.598647ms)
created: /tmp/tracebound-status-zaOlCZ/tracebound/test-agent/tracebound.config.md
created: /tmp/tracebound-status-zaOlCZ/tracebound/test-agent/failure_modes.json
✓ Tracebound initialised at /tmp/tracebound-status-zaOlCZ/tracebound/test-agent
✔ text report mentions total, pending, and SPEC count (61.560305ms)
created: /tmp/tracebound-status-0FMozb/tracebound/test-agent/tracebound.config.md
created: /tmp/tracebound-status-0FMozb/tracebound/test-agent/failure_modes.json
✓ Tracebound initialised at /tmp/tracebound-status-0FMozb/tracebound/test-agent
✔ json report is valid JSON with the expected shape (39.901697ms)
created: /tmp/tracebound-status-vjYt2a/tracebound/alpha/tracebound.config.md
created: /tmp/tracebound-status-vjYt2a/tracebound/alpha/failure_modes.json
✓ Tracebound initialised at /tmp/tracebound-status-vjYt2a/tracebound/alpha
created: /tmp/tracebound-status-vjYt2a/tracebound/beta/tracebound.config.md
created: /tmp/tracebound-status-vjYt2a/tracebound/beta/failure_modes.json
✓ Tracebound initialised at /tmp/tracebound-status-vjYt2a/tracebound/beta
✔ two agents are independent: writing to one doesn't show up in the other's status (45.547159ms)
created: /tmp/tracebound-validate-EmD3JE/tracebound/test-agent/tracebound.config.md
created: /tmp/tracebound-validate-EmD3JE/tracebound/test-agent/failure_modes.json
✓ Tracebound initialised at /tmp/tracebound-validate-EmD3JE/tracebound/test-agent
✔ clean tree from runInit passes validation (52.466165ms)
✔ missing agent directory rejects with 'no such agent' (4.668717ms)
created: /tmp/tracebound-validate-2Az8fd/tracebound/alpha/tracebound.config.md
created: /tmp/tracebound-validate-2Az8fd/tracebound/alpha/failure_modes.json
✓ Tracebound initialised at /tmp/tracebound-validate-2Az8fd/tracebound/alpha
created: /tmp/tracebound-validate-2Az8fd/tracebound/beta/tracebound.config.md
created: /tmp/tracebound-validate-2Az8fd/tracebound/beta/failure_modes.json
✓ Tracebound initialised at /tmp/tracebound-validate-2Az8fd/tracebound/beta
✔ missing --agent rejects with the list of available agents (30.8498ms)
created: /tmp/tracebound-validate-DDn9Bl/tracebound/test-agent/tracebound.config.md
created: /tmp/tracebound-validate-DDn9Bl/tracebound/test-agent/failure_modes.json
✓ Tracebound initialised at /tmp/tracebound-validate-DDn9Bl/tracebound/test-agent
✔ missing required file reports WHET_STRUCT_MISSING per file (17.620755ms)
created: /tmp/tracebound-validate-33J8Om/tracebound/test-agent/tracebound.config.md
created: /tmp/tracebound-validate-33J8Om/tracebound/test-agent/failure_modes.json
✓ Tracebound initialised at /tmp/tracebound-validate-33J8Om/tracebound/test-agent
✔ missing subdir reports WHET_STRUCT_MISSING (20.218607ms)
created: /tmp/tracebound-validate-WAIKM5/tracebound/test-agent/tracebound.config.md
created: /tmp/tracebound-validate-WAIKM5/tracebound/test-agent/failure_modes.json
✓ Tracebound initialised at /tmp/tracebound-validate-WAIKM5/tracebound/test-agent
✔ malformed failure_modes.json reports WHET_PARSE_FAILURE_MODES (21.683718ms)
created: /tmp/tracebound-validate-xEhak3/tracebound/test-agent/tracebound.config.md
created: /tmp/tracebound-validate-xEhak3/tracebound/test-agent/failure_modes.json
✓ Tracebound initialised at /tmp/tracebound-validate-xEhak3/tracebound/test-agent
✔ schema error in failure_modes.json reports WHET_SCHEMA_FAILURE_MODES (22.505291ms)
created: /tmp/tracebound-validate-aQSZk7/tracebound/test-agent/tracebound.config.md
created: /tmp/tracebound-validate-aQSZk7/tracebound/test-agent/failure_modes.json
✓ Tracebound initialised at /tmp/tracebound-validate-aQSZk7/tracebound/test-agent
✔ malformed trace line reports WHET_PARSE_TRACE with line number, doesn't abort the file (61.147563ms)
created: /tmp/tracebound-validate-CcnkHa/tracebound/test-agent/tracebound.config.md
created: /tmp/tracebound-validate-CcnkHa/tracebound/test-agent/failure_modes.json
✓ Tracebound initialised at /tmp/tracebound-validate-CcnkHa/tracebound/test-agent
✔ schema error in trace reports WHET_SCHEMA_TRACE with line number (17.465665ms)
created: /tmp/tracebound-validate-Yb25ER/tracebound/test-agent/tracebound.config.md
created: /tmp/tracebound-validate-Yb25ER/tracebound/test-agent/failure_modes.json
✓ Tracebound initialised at /tmp/tracebound-validate-Yb25ER/tracebound/test-agent
✔ duplicate failure-mode ids report WHET_FM_DUPLICATE_ID (14.493042ms)
created: /tmp/tracebound-validate-Biq0is/tracebound/test-agent/tracebound.config.md
created: /tmp/tracebound-validate-Biq0is/tracebound/test-agent/failure_modes.json
✓ Tracebound initialised at /tmp/tracebound-validate-Biq0is/tracebound/test-agent
✔ missing trace file referenced by FM reports WHET_FM_MISSING_TRACE_FILE (13.231786ms)
created: /tmp/tracebound-validate-IS39GU/tracebound/test-agent/tracebound.config.md
created: /tmp/tracebound-validate-IS39GU/tracebound/test-agent/failure_modes.json
✓ Tracebound initialised at /tmp/tracebound-validate-IS39GU/tracebound/test-agent
✔ missing trace id in existing file reports WHET_FM_MISSING_TRACE_ID (15.033109ms)
created: /tmp/tracebound-validate-p53T8c/tracebound/test-agent/tracebound.config.md
created: /tmp/tracebound-validate-p53T8c/tracebound/test-agent/failure_modes.json
✓ Tracebound initialised at /tmp/tracebound-validate-p53T8c/tracebound/test-agent
✔ missing backlink reports WHET_FM_BACKLINK_MISSING (14.636833ms)
created: /tmp/tracebound-validate-N0jYDe/tracebound/test-agent/tracebound.config.md
created: /tmp/tracebound-validate-N0jYDe/tracebound/test-agent/failure_modes.json
✓ Tracebound initialised at /tmp/tracebound-validate-N0jYDe/tracebound/test-agent
✔ duplicate (filename, traceId) on a FM reports WHET_FM_DUPLICATE_AFFECTED_TRACE (17.250002ms)
created: /tmp/tracebound-validate-QAGgUN/tracebound/test-agent/tracebound.config.md
created: /tmp/tracebound-validate-QAGgUN/tracebound/test-agent/failure_modes.json
✓ Tracebound initialised at /tmp/tracebound-validate-QAGgUN/tracebound/test-agent
✔ dangling failureModeIds[] on a trace reports WHET_TRACE_DANGLING_FM_REF (23.610078ms)
created: /tmp/tracebound-validate-XkG4LY/tracebound/test-agent/tracebound.config.md
created: /tmp/tracebound-validate-XkG4LY/tracebound/test-agent/failure_modes.json
✓ Tracebound initialised at /tmp/tracebound-validate-XkG4LY/tracebound/test-agent
✔ clean bidirectional FM ↔ trace pair passes (16.563907ms)
created: /tmp/tracebound-validate-X5G2fz/tracebound/test-agent/tracebound.config.md
created: /tmp/tracebound-validate-X5G2fz/tracebound/test-agent/failure_modes.json
✓ Tracebound initialised at /tmp/tracebound-validate-X5G2fz/tracebound/test-agent
✔ unparseable trace file does not produce noisy invariant errors against itself (31.149974ms)
created: /tmp/tracebound-validate-ksTH72/tracebound/test-agent/tracebound.config.md
created: /tmp/tracebound-validate-ksTH72/tracebound/test-agent/failure_modes.json
✓ Tracebound initialised at /tmp/tracebound-validate-ksTH72/tracebound/test-agent
✔ reportJson emits stable parsable shape (13.155656ms)
created: /tmp/tracebound-validate-gr6pq2/tracebound/test-agent/tracebound.config.md
created: /tmp/tracebound-validate-gr6pq2/tracebound/test-agent/failure_modes.json
✓ Tracebound initialised at /tmp/tracebound-validate-gr6pq2/tracebound/test-agent
✔ reportText surfaces the code and hint for every issue (13.636685ms)
✔ runValidate rejects --cwd that does not exist (2.034407ms)
created: /tmp/tracebound-validate-fe7BFL/tracebound/alpha/tracebound.config.md
created: /tmp/tracebound-validate-fe7BFL/tracebound/alpha/failure_modes.json
✓ Tracebound initialised at /tmp/tracebound-validate-fe7BFL/tracebound/alpha
created: /tmp/tracebound-validate-fe7BFL/tracebound/beta/tracebound.config.md
created: /tmp/tracebound-validate-fe7BFL/tracebound/beta/failure_modes.json
✓ Tracebound initialised at /tmp/tracebound-validate-fe7BFL/tracebound/beta
✔ two agents validated independently — issues in one don't surface in the other (28.468269ms)
ℹ tests 88
ℹ suites 0
ℹ pass 88
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 6269.790917
```

```bash
npm run typecheck
npm warn Unknown env config "store-dir". This will stop working in the next major version of npm. See `npm help npmrc` for supported config options.

> @nearform/tracebound@0.1.0 typecheck
> tsc --noEmit
```

## Deviations / Known issues
- None.

## Fix Cycle 1
- No reviewer issues were raised; no code changes were required.
- Verification:
  - npm run typecheck
  - npm test
