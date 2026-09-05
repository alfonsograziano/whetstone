import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { styleText } from "node:util";

export interface InstallSkillsOptions {
  cwd?: string;
  target?: string;
  force?: boolean;
  dryRun?: boolean;
}

export interface InstallSkillsResult {
  /** Absolute path to the resolved cwd. */
  cwdAbsolute: string;
  /** Absolute path to the directory skills were copied into. */
  targetDir: string;
  /** Skill names copied (or that would be copied in dry-run). */
  installed: string[];
  /** Skill names that already match the bundled content. */
  upToDate: string[];
  /** Skill names that exist locally with different content and were left untouched. */
  skipped: string[];
  /** True when no write was performed because of --dry-run. */
  dryRun: boolean;
  /** True when install was skipped because cwd is the tracebound package itself. */
  selfInstallSkipped: boolean;
}

export const DEFAULT_TARGET = ".claude/skills/tracebound";

/**
 * Absolute path to the directory holding the bundled skills in the installed
 * package. Resolves `<package-root>/skills` regardless of whether this file is
 * running from `src/commands/` (source/tests) or `dist/commands/` (built CLI).
 */
export function bundledSkillsDir(): string {
  return resolve(import.meta.dirname, "..", "..", "skills");
}

function listSkillNames(root: string): string[] {
  return readdirSync(root, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
}

function isOwnPackageDir(cwdAbsolute: string): boolean {
  try {
    const pkg = JSON.parse(
      readFileSync(join(cwdAbsolute, "package.json"), "utf8"),
    ) as { name?: unknown };
    return pkg.name === "@nearform/tracebound";
  } catch {
    return false;
  }
}

export async function runInstallSkills(
  options: InstallSkillsOptions = {},
): Promise<InstallSkillsResult> {
  const cwdAbsolute = resolve(options.cwd ?? process.cwd());

  let cwdStat;
  try {
    cwdStat = statSync(cwdAbsolute);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(`--cwd path does not exist: ${cwdAbsolute}`);
    }
    throw err;
  }
  if (!cwdStat.isDirectory()) {
    throw new Error(`--cwd path is not a directory: ${cwdAbsolute}`);
  }

  const dryRun = options.dryRun ?? false;

  if (isOwnPackageDir(cwdAbsolute)) {
    return {
      cwdAbsolute,
      targetDir: "",
      installed: [],
      upToDate: [],
      skipped: [],
      dryRun,
      selfInstallSkipped: true,
    };
  }

  const bundledDir = bundledSkillsDir();
  if (!existsSync(bundledDir)) {
    throw new Error(
      `bundled skills directory not found: ${bundledDir}. This CLI install is missing the 'skills/' directory.`,
    );
  }

  const targetDir = resolve(cwdAbsolute, options.target ?? DEFAULT_TARGET);
  if (!dryRun) {
    await mkdir(targetDir, { recursive: true });
  }

  const result: InstallSkillsResult = {
    cwdAbsolute,
    targetDir,
    installed: [],
    upToDate: [],
    skipped: [],
    dryRun,
    selfInstallSkipped: false,
  };

  for (const skill of listSkillNames(bundledDir)) {
    const sourcePath = join(bundledDir, skill, "SKILL.md");
    const targetPath = join(targetDir, skill, "SKILL.md");

    if (!existsSync(sourcePath)) continue;

    const sourceContents = readFileSync(sourcePath, "utf8");
    const targetExists = existsSync(targetPath);

    if (!targetExists) {
      if (!dryRun) {
        await mkdir(dirname(targetPath), { recursive: true });
        await writeFile(targetPath, sourceContents, "utf8");
      }
      result.installed.push(skill);
      continue;
    }

    const targetContents = readFileSync(targetPath, "utf8");
    if (targetContents === sourceContents) {
      result.upToDate.push(skill);
      continue;
    }

    if (options.force) {
      if (!dryRun) {
        await writeFile(targetPath, sourceContents, "utf8");
      }
      result.installed.push(skill);
      continue;
    }

    result.skipped.push(skill);
  }

  return result;
}

export function reportText(result: InstallSkillsResult): string {
  if (result.selfInstallSkipped) {
    return (
      styleText(
        "dim",
        `skipped: cwd is the @nearform/tracebound package itself (${result.cwdAbsolute})`,
      ) + "\n"
    );
  }

  const lines: string[] = [];
  const verb = result.dryRun ? "would install" : "installed";

  for (const skill of result.installed) {
    lines.push(
      `${styleText("green", "✓")} ${verb}: ${join(result.targetDir, skill)}`,
    );
  }
  if (result.upToDate.length > 0) {
    lines.push(
      styleText("dim", `up-to-date: ${result.upToDate.join(", ")}`),
    );
  }
  for (const skill of result.skipped) {
    lines.push(
      `${styleText("yellow", "!")} skipped (modified locally, use --force to overwrite): ${join(result.targetDir, skill)}`,
    );
  }

  lines.push("");
  lines.push(
    styleText(
      "dim",
      `${result.installed.length} installed, ${result.upToDate.length} up-to-date, ${result.skipped.length} skipped → ${result.targetDir}`,
    ),
  );

  return lines.join("\n") + "\n";
}
