import test from "node:test";
import { strict as assert } from "node:assert";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  AGENT_NAME_RE,
  listAgents,
  resolveAgentRootForInit,
  resolveAgentRootForRead,
} from "../commands/agent-root.ts";

async function makeTmp(): Promise<string> {
  return await mkdtemp(join(tmpdir(), "tracebound-agent-root-"));
}

async function makeAgent(cwd: string, name: string): Promise<void> {
  const dir = join(cwd, "tracebound", name);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "tracebound.config.md"), "# stub\n", "utf8");
}

// ---------- AGENT_NAME_RE ----------

test("AGENT_NAME_RE accepts conventional CLI slugs", () => {
  for (const ok of ["bot", "support-bot", "agent_v2", "a", "1agent", "a1_b2-c3"]) {
    assert.equal(AGENT_NAME_RE.test(ok), true, `should accept "${ok}"`);
  }
});

test("AGENT_NAME_RE rejects empty strings, uppercase, dots, spaces, and bad starts", () => {
  for (const bad of ["", "Agent", "agent.v2", "agent v2", "_agent", "-agent", "agent!"]) {
    assert.equal(AGENT_NAME_RE.test(bad), false, `should reject "${bad}"`);
  }
});

// ---------- resolveAgentRootForInit ----------

test("resolveAgentRootForInit rejects a missing agent name", async (t) => {
  const cwd = await makeTmp();
  t.after(() => rm(cwd, { recursive: true, force: true }));

  await assert.rejects(
    () => resolveAgentRootForInit({ cwd }),
    /agent name is required/,
  );
});

test("resolveAgentRootForInit rejects an invalid agent name", async (t) => {
  const cwd = await makeTmp();
  t.after(() => rm(cwd, { recursive: true, force: true }));

  await assert.rejects(
    () => resolveAgentRootForInit({ cwd, agent: "Bad Name" }),
    /invalid agent name/,
  );
});

test("resolveAgentRootForInit returns paths even when the dir does not yet exist", async (t) => {
  const cwd = await makeTmp();
  t.after(() => rm(cwd, { recursive: true, force: true }));

  const r = await resolveAgentRootForInit({ cwd, agent: "fresh" });

  assert.equal(r.agentName, "fresh");
  assert.equal(r.rootPath, join(cwd, "tracebound", "fresh"));
  assert.equal(r.rootContainer, join(cwd, "tracebound"));
});

// ---------- resolveAgentRootForRead ----------

test("resolveAgentRootForRead rejects a missing agent name and lists existing agents", async (t) => {
  const cwd = await makeTmp();
  t.after(() => rm(cwd, { recursive: true, force: true }));

  await makeAgent(cwd, "alpha");
  await makeAgent(cwd, "beta");

  await assert.rejects(
    () => resolveAgentRootForRead({ cwd }),
    /--agent <name> is required.*alpha.*beta/s,
  );
});

test("resolveAgentRootForRead rejects an unknown agent and lists existing agents", async (t) => {
  const cwd = await makeTmp();
  t.after(() => rm(cwd, { recursive: true, force: true }));

  await makeAgent(cwd, "alpha");

  await assert.rejects(
    () => resolveAgentRootForRead({ cwd, agent: "ghost" }),
    /no such agent.*alpha/s,
  );
});

test("resolveAgentRootForRead reports '(none)' when no agents exist at all", async (t) => {
  const cwd = await makeTmp();
  t.after(() => rm(cwd, { recursive: true, force: true }));

  await assert.rejects(
    () => resolveAgentRootForRead({ cwd, agent: "ghost" }),
    /no such agent.*none/s,
  );
});

test("resolveAgentRootForRead returns a result for an existing agent", async (t) => {
  const cwd = await makeTmp();
  t.after(() => rm(cwd, { recursive: true, force: true }));

  await makeAgent(cwd, "alpha");

  const r = await resolveAgentRootForRead({ cwd, agent: "alpha" });
  assert.equal(r.agentName, "alpha");
  assert.equal(r.rootPath, join(cwd, "tracebound", "alpha"));
});

// ---------- listAgents ----------

test("listAgents returns [] when tracebound/ is missing", async (t) => {
  const cwd = await makeTmp();
  t.after(() => rm(cwd, { recursive: true, force: true }));

  const agents = await listAgents(cwd);
  assert.deepEqual(agents, []);
});

test("listAgents returns subdirs with tracebound.config.md, sorted alphabetically", async (t) => {
  const cwd = await makeTmp();
  t.after(() => rm(cwd, { recursive: true, force: true }));

  await makeAgent(cwd, "zebra");
  await makeAgent(cwd, "apple");
  await mkdir(join(cwd, "tracebound", "no-config"), { recursive: true });

  const agents = await listAgents(cwd);
  assert.deepEqual(
    agents.map((a) => a.name),
    ["apple", "zebra"],
  );
});
