import test from "node:test";
import { strict as assert } from "node:assert";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runInit } from "../commands/init.ts";
import { FailureModesFileSchema } from "../schemas/index.ts";

async function makeTmpDir(): Promise<string> {
  return await mkdtemp(join(tmpdir(), "whetstone-init-"));
}

const AGENT = "test-agent";

test("runInit creates the full whetstone/<agent>/ tree on a clean directory", async (t) => {
  const cwd = await makeTmpDir();
  t.after(() => rm(cwd, { recursive: true, force: true }));

  const result = await runInit({ cwd, agent: AGENT });

  assert.equal(result.rootPath, join(cwd, "whetstone", AGENT));
  assert.equal(result.created.length, 2);
  assert.equal(result.skipped.length, 0);

  for (const sub of ["traces", "failure_modes", "adapters"]) {
    const s = await stat(join(cwd, "whetstone", AGENT, sub));
    assert.equal(s.isDirectory(), true);
  }

  const configRaw = await readFile(
    join(cwd, "whetstone", AGENT, "whetstone.config.md"),
    "utf8",
  );
  assert.match(configRaw, /^# Whetstone config/);

  const fmRaw = await readFile(
    join(cwd, "whetstone", AGENT, "failure_modes.json"),
    "utf8",
  );
  const fmParsed = JSON.parse(fmRaw);
  assert.deepEqual(fmParsed, { failureModes: [] });
  assert.equal(FailureModesFileSchema.safeParse(fmParsed).success, true);
});

test("runInit is idempotent: re-running reports every file as skipped", async (t) => {
  const cwd = await makeTmpDir();
  t.after(() => rm(cwd, { recursive: true, force: true }));

  await runInit({ cwd, agent: AGENT });
  const second = await runInit({ cwd, agent: AGENT });

  assert.equal(second.created.length, 0);
  assert.equal(second.skipped.length, 2);
});

test("runInit rejects --cwd that does not exist", async () => {
  const missing = join(tmpdir(), `whetstone-missing-${process.pid}-${Date.now()}`);
  await assert.rejects(
    () => runInit({ cwd: missing, agent: AGENT }),
    /does not exist/,
  );
});

test("runInit rejects --cwd that is a file, not a directory", async (t) => {
  const cwd = await makeTmpDir();
  t.after(() => rm(cwd, { recursive: true, force: true }));
  const filePath = join(cwd, "not-a-dir");
  await writeFile(filePath, "x", "utf8");

  await assert.rejects(
    () => runInit({ cwd: filePath, agent: AGENT }),
    /not a directory/,
  );
});

test("runInit preserves user-edited files on re-run", async (t) => {
  const cwd = await makeTmpDir();
  t.after(() => rm(cwd, { recursive: true, force: true }));

  await runInit({ cwd, agent: AGENT });
  const fmPath = join(cwd, "whetstone", AGENT, "failure_modes.json");
  const userContent = `${JSON.stringify(
    { failureModes: [{ touched: "by user" }] },
    null,
    2,
  )}\n`;
  await writeFile(fmPath, userContent, "utf8");

  await runInit({ cwd, agent: AGENT });

  const after = await readFile(fmPath, "utf8");
  assert.equal(after, userContent);
});

test("runInit rejects when no agent name is provided", async (t) => {
  const cwd = await makeTmpDir();
  t.after(() => rm(cwd, { recursive: true, force: true }));

  await assert.rejects(
    () => runInit({ cwd }),
    /agent name is required/,
  );
});

test("runInit rejects an invalid agent name and creates no files", async (t) => {
  const cwd = await makeTmpDir();
  t.after(() => rm(cwd, { recursive: true, force: true }));

  await assert.rejects(
    () => runInit({ cwd, agent: "Bad Name" }),
    /invalid agent name/,
  );

  // Confirm nothing was written under whetstone/.
  const containerInfo = await stat(join(cwd)).catch(() => null);
  assert.ok(containerInfo);
  await assert.rejects(
    () => stat(join(cwd, "whetstone")),
    /ENOENT/,
  );
});

test("runInit accepts hyphens, underscores, and digits in the agent name", async (t) => {
  const cwd = await makeTmpDir();
  t.after(() => rm(cwd, { recursive: true, force: true }));

  await runInit({ cwd, agent: "agent-1_v2" });
  const s = await stat(join(cwd, "whetstone", "agent-1_v2", "whetstone.config.md"));
  assert.equal(s.isFile(), true);
});

test("two different agent names produce independent sibling directories", async (t) => {
  const cwd = await makeTmpDir();
  t.after(() => rm(cwd, { recursive: true, force: true }));

  await runInit({ cwd, agent: "agent-a" });
  await runInit({ cwd, agent: "agent-b" });

  // Mutating one should not affect the other.
  const aFm = join(cwd, "whetstone", "agent-a", "failure_modes.json");
  await writeFile(aFm, `${JSON.stringify({ failureModes: [{ marker: "a" }] }, null, 2)}\n`);

  const bFmRaw = await readFile(
    join(cwd, "whetstone", "agent-b", "failure_modes.json"),
    "utf8",
  );
  assert.deepEqual(JSON.parse(bFmRaw), { failureModes: [] });
});
