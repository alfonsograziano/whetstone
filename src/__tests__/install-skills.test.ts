import test from "node:test";
import { strict as assert } from "node:assert";
import {
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  bundledSkillsDir,
  runInstallSkills,
  DEFAULT_TARGET,
} from "../commands/install-skills.ts";

async function makeTmpDir(): Promise<string> {
  return await mkdtemp(join(tmpdir(), "tracebound-install-skills-"));
}

async function listSkillNames(root: string): Promise<string[]> {
  const { readdir } = await import("node:fs/promises");
  const entries = await readdir(root, { withFileTypes: true });
  return entries
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
}

test("bundledSkillsDir resolves to the repo's skills/ directory", async () => {
  const dir = bundledSkillsDir();
  const s = await stat(dir);
  assert.equal(s.isDirectory(), true);
  const names = await listSkillNames(dir);
  assert.ok(names.includes("analyze-traces"));
  assert.ok(names.includes("create-adapter"));
  assert.ok(names.includes("research-failure-mode"));
  assert.ok(names.includes("implement-failure-mode"));
});

test("runInstallSkills copies every bundled skill into the default target on a clean directory", async (t) => {
  const cwd = await makeTmpDir();
  t.after(() => rm(cwd, { recursive: true, force: true }));

  const bundled = await listSkillNames(bundledSkillsDir());
  const result = await runInstallSkills({ cwd });

  assert.equal(result.selfInstallSkipped, false);
  assert.equal(result.dryRun, false);
  assert.equal(result.targetDir, join(cwd, DEFAULT_TARGET));
  assert.deepEqual(result.installed, bundled);
  assert.deepEqual(result.upToDate, []);
  assert.deepEqual(result.skipped, []);

  for (const skill of bundled) {
    const targetPath = join(result.targetDir, skill, "SKILL.md");
    const s = await stat(targetPath);
    assert.equal(s.isFile(), true);
  }
});

test("runInstallSkills is idempotent: a second run reports every skill as up-to-date", async (t) => {
  const cwd = await makeTmpDir();
  t.after(() => rm(cwd, { recursive: true, force: true }));

  const first = await runInstallSkills({ cwd });
  assert.ok(first.installed.length > 0);

  const second = await runInstallSkills({ cwd });
  assert.deepEqual(second.installed, []);
  assert.deepEqual(second.upToDate.sort(), first.installed.slice().sort());
  assert.deepEqual(second.skipped, []);
});

test("runInstallSkills leaves user-edited skills untouched by default", async (t) => {
  const cwd = await makeTmpDir();
  t.after(() => rm(cwd, { recursive: true, force: true }));

  const first = await runInstallSkills({ cwd });
  const bundled = first.installed.slice().sort();

  const skill = "analyze-traces";
  const targetPath = join(cwd, DEFAULT_TARGET, skill, "SKILL.md");
  const userContent = "# user-edited\n";
  await writeFile(targetPath, userContent, "utf8");

  const result = await runInstallSkills({ cwd });
  assert.deepEqual(result.installed, []);
  assert.deepEqual(
    result.upToDate.slice().sort(),
    bundled.filter((s) => s !== skill),
  );
  assert.deepEqual(result.skipped, [skill]);

  const after = await readFile(targetPath, "utf8");
  assert.equal(after, userContent);
});

test("runInstallSkills --force overwrites user-edited skills", async (t) => {
  const cwd = await makeTmpDir();
  t.after(() => rm(cwd, { recursive: true, force: true }));

  await runInstallSkills({ cwd });

  const skill = "analyze-traces";
  const targetPath = join(cwd, DEFAULT_TARGET, skill, "SKILL.md");
  const userContent = "# user-edited\n";
  await writeFile(targetPath, userContent, "utf8");

  const result = await runInstallSkills({ cwd, force: true });
  assert.ok(result.installed.includes(skill));
  assert.equal(result.skipped.length, 0);

  const bundledRaw = await readFile(
    join(bundledSkillsDir(), skill, "SKILL.md"),
    "utf8",
  );
  const after = await readFile(targetPath, "utf8");
  assert.equal(after, bundledRaw);
});

test("runInstallSkills --dry-run writes nothing", async (t) => {
  const cwd = await makeTmpDir();
  t.after(() => rm(cwd, { recursive: true, force: true }));

  const bundled = await listSkillNames(bundledSkillsDir());
  const result = await runInstallSkills({ cwd, dryRun: true });

  assert.equal(result.dryRun, true);
  assert.deepEqual(result.installed, bundled);
  assert.equal(result.upToDate.length, 0);

  await assert.rejects(
    () => stat(join(result.targetDir, "analyze-traces", "SKILL.md")),
    /ENOENT/,
  );
});

test("runInstallSkills honours --target for a custom install location", async (t) => {
  const cwd = await makeTmpDir();
  t.after(() => rm(cwd, { recursive: true, force: true }));

  const result = await runInstallSkills({
    cwd,
    target: "my/custom/skills",
  });

  assert.equal(result.targetDir, join(cwd, "my", "custom", "skills"));
  const s = await stat(join(result.targetDir, "analyze-traces", "SKILL.md"));
  assert.equal(s.isFile(), true);
});

test("runInstallSkills skips silently when --cwd is the tracebound package itself", async (t) => {
  const cwd = await makeTmpDir();
  t.after(() => rm(cwd, { recursive: true, force: true }));

  await writeFile(
    join(cwd, "package.json"),
    `${JSON.stringify({ name: "@nearform/tracebound" }, null, 2)}\n`,
    "utf8",
  );

  const result = await runInstallSkills({ cwd });
  assert.equal(result.selfInstallSkipped, true);
  assert.equal(result.installed.length, 0);
  await assert.rejects(
    () => stat(join(cwd, ".claude")),
    /ENOENT/,
  );
});

test("runInstallSkills rejects --cwd that does not exist", async () => {
  const missing = join(
    tmpdir(),
    `tracebound-missing-${process.pid}-${Date.now()}`,
  );
  await assert.rejects(
    () => runInstallSkills({ cwd: missing }),
    /does not exist/,
  );
});

test("runInstallSkills rejects --cwd that is a file, not a directory", async (t) => {
  const cwd = await makeTmpDir();
  t.after(() => rm(cwd, { recursive: true, force: true }));
  const filePath = join(cwd, "not-a-dir");
  await writeFile(filePath, "x", "utf8");

  await assert.rejects(
    () => runInstallSkills({ cwd: filePath }),
    /not a directory/,
  );
});
