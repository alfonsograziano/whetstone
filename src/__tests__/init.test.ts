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

test("runInit creates the full whetstone/ tree on a clean directory", async (t) => {
  const cwd = await makeTmpDir();
  t.after(() => rm(cwd, { recursive: true, force: true }));

  const result = await runInit({ cwd });

  assert.equal(result.rootPath, join(cwd, "whetstone"));
  assert.equal(result.created.length, 2);
  assert.equal(result.skipped.length, 0);

  for (const sub of ["traces", "failure_modes", "adapters"]) {
    const s = await stat(join(cwd, "whetstone", sub));
    assert.equal(s.isDirectory(), true);
  }

  const configRaw = await readFile(
    join(cwd, "whetstone", "whetstone.config.md"),
    "utf8",
  );
  assert.match(configRaw, /^# Whetstone config/);

  const fmRaw = await readFile(
    join(cwd, "whetstone", "failure_modes.json"),
    "utf8",
  );
  const fmParsed = JSON.parse(fmRaw);
  assert.deepEqual(fmParsed, { failureModes: [] });
  assert.equal(FailureModesFileSchema.safeParse(fmParsed).success, true);
});

test("runInit is idempotent: re-running reports every file as skipped", async (t) => {
  const cwd = await makeTmpDir();
  t.after(() => rm(cwd, { recursive: true, force: true }));

  await runInit({ cwd });
  const second = await runInit({ cwd });

  assert.equal(second.created.length, 0);
  assert.equal(second.skipped.length, 2);
});

test("runInit rejects --cwd that does not exist", async () => {
  const missing = join(tmpdir(), `whetstone-missing-${process.pid}-${Date.now()}`);
  await assert.rejects(
    () => runInit({ cwd: missing }),
    /does not exist/,
  );
});

test("runInit rejects --cwd that is a file, not a directory", async (t) => {
  const cwd = await makeTmpDir();
  t.after(() => rm(cwd, { recursive: true, force: true }));
  const filePath = join(cwd, "not-a-dir");
  await writeFile(filePath, "x", "utf8");

  await assert.rejects(() => runInit({ cwd: filePath }), /not a directory/);
});

test("runInit preserves user-edited files on re-run", async (t) => {
  const cwd = await makeTmpDir();
  t.after(() => rm(cwd, { recursive: true, force: true }));

  await runInit({ cwd });
  const fmPath = join(cwd, "whetstone", "failure_modes.json");
  const userContent = `${JSON.stringify(
    { failureModes: [{ touched: "by user" }] },
    null,
    2,
  )}\n`;
  await writeFile(fmPath, userContent, "utf8");

  await runInit({ cwd });

  const after = await readFile(fmPath, "utf8");
  assert.equal(after, userContent);
});
