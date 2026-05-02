import test from "node:test";
import { strict as assert } from "node:assert";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runInit } from "../commands/init.ts";
import {
  reportJson,
  reportText,
  runAgents,
} from "../commands/agents.ts";

async function makeTmp(): Promise<string> {
  return await mkdtemp(join(tmpdir(), "whetstone-agents-"));
}

test("runAgents on a directory with no whetstone/ returns empty list (exit 0)", async (t) => {
  const cwd = await makeTmp();
  t.after(() => rm(cwd, { recursive: true, force: true }));

  const report = await runAgents({ cwd });
  assert.deepEqual(report.agents, []);
  assert.equal(reportText(report), "");
});

test("runAgents on an empty whetstone/ returns empty list", async (t) => {
  const cwd = await makeTmp();
  t.after(() => rm(cwd, { recursive: true, force: true }));

  await mkdir(join(cwd, "whetstone"), { recursive: true });

  const report = await runAgents({ cwd });
  assert.deepEqual(report.agents, []);
});

test("runAgents lists each subdirectory that contains whetstone.config.md", async (t) => {
  const cwd = await makeTmp();
  t.after(() => rm(cwd, { recursive: true, force: true }));

  await runInit({ cwd, agent: "alpha" });
  await runInit({ cwd, agent: "beta" });

  const report = await runAgents({ cwd });

  assert.equal(report.agents.length, 2);
  assert.deepEqual(
    report.agents.map((a) => a.name),
    ["alpha", "beta"],
  );
});

test("runAgents skips subdirectories that don't contain whetstone.config.md", async (t) => {
  const cwd = await makeTmp();
  t.after(() => rm(cwd, { recursive: true, force: true }));

  await runInit({ cwd, agent: "real" });
  // A bare directory with no config should not appear.
  await mkdir(join(cwd, "whetstone", "phantom"), { recursive: true });
  // A directory whose "config" is actually a directory, not a file, should also be skipped.
  await mkdir(join(cwd, "whetstone", "weird", "whetstone.config.md"), {
    recursive: true,
  });

  const report = await runAgents({ cwd });

  assert.deepEqual(
    report.agents.map((a) => a.name),
    ["real"],
  );
});

test("runAgents output is sorted alphabetically", async (t) => {
  const cwd = await makeTmp();
  t.after(() => rm(cwd, { recursive: true, force: true }));

  await runInit({ cwd, agent: "zebra" });
  await runInit({ cwd, agent: "apple" });
  await runInit({ cwd, agent: "mango" });

  const report = await runAgents({ cwd });

  assert.deepEqual(
    report.agents.map((a) => a.name),
    ["apple", "mango", "zebra"],
  );
});

test("reportText emits one agent name per line, newline-terminated", async (t) => {
  const cwd = await makeTmp();
  t.after(() => rm(cwd, { recursive: true, force: true }));

  await runInit({ cwd, agent: "alpha" });
  await runInit({ cwd, agent: "beta" });

  const report = await runAgents({ cwd });
  assert.equal(reportText(report), "alpha\nbeta\n");
});

test("reportJson emits the documented shape", async (t) => {
  const cwd = await makeTmp();
  t.after(() => rm(cwd, { recursive: true, force: true }));

  await runInit({ cwd, agent: "alpha" });

  const report = await runAgents({ cwd });
  const parsed = JSON.parse(reportJson(report)) as {
    agents: Array<{ name: string; path: string }>;
  };

  assert.equal(parsed.agents.length, 1);
  assert.equal(parsed.agents[0]!.name, "alpha");
  assert.match(parsed.agents[0]!.path, /whetstone\/alpha$/);
});

test("reportJson on an empty list emits { agents: [] }", async (t) => {
  const cwd = await makeTmp();
  t.after(() => rm(cwd, { recursive: true, force: true }));

  const report = await runAgents({ cwd });
  const parsed = JSON.parse(reportJson(report));
  assert.deepEqual(parsed, { agents: [] });
});

test("a stray file under whetstone/ does not crash and is not listed", async (t) => {
  const cwd = await makeTmp();
  t.after(() => rm(cwd, { recursive: true, force: true }));

  await runInit({ cwd, agent: "real" });
  await writeFile(join(cwd, "whetstone", "stray.txt"), "hi", "utf8");

  const report = await runAgents({ cwd });
  assert.deepEqual(
    report.agents.map((a) => a.name),
    ["real"],
  );
});
