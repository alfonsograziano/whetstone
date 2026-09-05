import test, { type TestContext } from "node:test";
import {
  mkdtemp,
  readdir,
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

async function makeTmpDir(t: TestContext): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "tracebound-install-skills-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

async function listSkillNames(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  return entries
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
}

test("bundledSkillsDir resolves to the repo's skills/ directory", async (t: TestContext) => {
  const dir = bundledSkillsDir();
  const s = await stat(dir);
  t.assert.strictEqual(s.isDirectory(), true);
  const names = await listSkillNames(dir);
  t.assert.ok(names.includes("analyze-traces"));
  t.assert.ok(names.includes("create-adapter"));
  t.assert.ok(names.includes("research-failure-mode"));
  t.assert.ok(names.includes("implement-failure-mode"));
});

test("runInstallSkills copies every bundled skill into the default target on a clean directory", async (t: TestContext) => {
  const cwd = await makeTmpDir(t);

  const bundled = await listSkillNames(bundledSkillsDir());
  const result = await runInstallSkills({ cwd });

  t.assert.strictEqual(result.selfInstallSkipped, false);
  t.assert.strictEqual(result.dryRun, false);
  t.assert.strictEqual(result.targetDir, join(cwd, DEFAULT_TARGET));
  t.assert.deepStrictEqual(result.installed, bundled);
  t.assert.deepStrictEqual(result.upToDate, []);
  t.assert.deepStrictEqual(result.skipped, []);

  for (const skill of bundled) {
    const targetPath = join(result.targetDir, skill, "SKILL.md");
    const s = await stat(targetPath);
    t.assert.strictEqual(s.isFile(), true);
  }
});

test("runInstallSkills is idempotent: a second run reports every skill as up-to-date", async (t: TestContext) => {
  const cwd = await makeTmpDir(t);

  const first = await runInstallSkills({ cwd });
  t.assert.ok(first.installed.length > 0);

  const second = await runInstallSkills({ cwd });
  t.assert.deepStrictEqual(second.installed, []);
  t.assert.deepStrictEqual(second.upToDate.sort(), first.installed.slice().sort());
  t.assert.deepStrictEqual(second.skipped, []);
});

test("runInstallSkills leaves user-edited skills untouched by default", async (t: TestContext) => {
  const cwd = await makeTmpDir(t);

  const first = await runInstallSkills({ cwd });
  const bundled = first.installed.slice().sort();

  const skill = "analyze-traces";
  const targetPath = join(cwd, DEFAULT_TARGET, skill, "SKILL.md");
  const userContent = "# user-edited\n";
  await writeFile(targetPath, userContent, "utf8");

  const result = await runInstallSkills({ cwd });
  t.assert.deepStrictEqual(result.installed, []);
  t.assert.deepStrictEqual(
    result.upToDate.slice().sort(),
    bundled.filter((s) => s !== skill),
  );
  t.assert.deepStrictEqual(result.skipped, [skill]);

  const after = await readFile(targetPath, "utf8");
  t.assert.strictEqual(after, userContent);
});

test("runInstallSkills --force overwrites user-edited skills", async (t: TestContext) => {
  const cwd = await makeTmpDir(t);

  await runInstallSkills({ cwd });

  const skill = "analyze-traces";
  const targetPath = join(cwd, DEFAULT_TARGET, skill, "SKILL.md");
  const userContent = "# user-edited\n";
  await writeFile(targetPath, userContent, "utf8");

  const result = await runInstallSkills({ cwd, force: true });
  t.assert.ok(result.installed.includes(skill));
  t.assert.strictEqual(result.skipped.length, 0);

  const bundledRaw = await readFile(
    join(bundledSkillsDir(), skill, "SKILL.md"),
    "utf8",
  );
  const after = await readFile(targetPath, "utf8");
  t.assert.strictEqual(after, bundledRaw);
});

test("runInstallSkills --dry-run writes nothing", async (t: TestContext) => {
  const cwd = await makeTmpDir(t);

  const bundled = await listSkillNames(bundledSkillsDir());
  const result = await runInstallSkills({ cwd, dryRun: true });

  t.assert.strictEqual(result.dryRun, true);
  t.assert.deepStrictEqual(result.installed, bundled);
  t.assert.strictEqual(result.upToDate.length, 0);

  await t.assert.rejects(
    () => stat(join(result.targetDir, "analyze-traces", "SKILL.md")),
    /ENOENT/,
  );
});

test("runInstallSkills honours --target for a custom install location", async (t: TestContext) => {
  const cwd = await makeTmpDir(t);

  const result = await runInstallSkills({
    cwd,
    target: "my/custom/skills",
  });

  t.assert.strictEqual(result.targetDir, join(cwd, "my", "custom", "skills"));
  const s = await stat(join(result.targetDir, "analyze-traces", "SKILL.md"));
  t.assert.strictEqual(s.isFile(), true);
});

test("runInstallSkills skips silently when --cwd is the tracebound package itself", async (t: TestContext) => {
  const cwd = await makeTmpDir(t);

  await writeFile(
    join(cwd, "package.json"),
    `${JSON.stringify({ name: "@nearform/tracebound" }, null, 2)}\n`,
    "utf8",
  );

  const result = await runInstallSkills({ cwd });
  t.assert.strictEqual(result.selfInstallSkipped, true);
  t.assert.strictEqual(result.installed.length, 0);
  await t.assert.rejects(
    () => stat(join(cwd, ".claude")),
    /ENOENT/,
  );
});

test("runInstallSkills rejects --cwd that does not exist", async (t: TestContext) => {
  const missing = join(
    tmpdir(),
    `tracebound-missing-${process.pid}-${Date.now()}`,
  );
  await t.assert.rejects(
    () => runInstallSkills({ cwd: missing }),
    /does not exist/,
  );
});

test("runInstallSkills rejects --cwd that is a file, not a directory", async (t: TestContext) => {
  const cwd = await makeTmpDir(t);
  const filePath = join(cwd, "not-a-dir");
  await writeFile(filePath, "x", "utf8");

  await t.assert.rejects(
    () => runInstallSkills({ cwd: filePath }),
    /not a directory/,
  );
});

test("runInstallSkills rejects --cwd whose package.json is malformed JSON", async (t: TestContext) => {
  const cwd = await makeTmpDir(t);

  await writeFile(join(cwd, "package.json"), "{ not valid json", "utf8");

  await t.assert.rejects(
    () => runInstallSkills({ cwd }),
    /malformed JSON in .*package\.json/,
  );
});

test("runInstallSkills rejects --target that resolves outside --cwd", async (t: TestContext) => {
  const cwd = await makeTmpDir(t);
  await t.assert.rejects(
    () => runInstallSkills({ cwd, target: "../escape" }),
    /--target must resolve inside --cwd/,
  );
  await t.assert.rejects(
    () => runInstallSkills({ cwd, target: "/etc" }),
    /--target must resolve inside --cwd/,
  );
});

test("runInstallSkills accepts --target equal to --cwd", async (t: TestContext) => {
  const cwd = await makeTmpDir(t);
  const result = await runInstallSkills({ cwd, target: "." });
  t.assert.strictEqual(result.targetDir, cwd);
});
