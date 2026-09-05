import {
  mkdir,
  readdir,
  readFile,
  stat,
  writeFile,
} from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
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
  const here = dirname(fileURLToPath(import.meta.url));
  return resolve(here, "..", "..", "skills");
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw err;
  }
}

async function listSkillNames(skillsRoot: string): Promise<string[]> {
  const entries = await readdir(skillsRoot, { withFileTypes: true });
  return entries
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
}

async function isOwnPackageDir(cwdAbsolute: string): Promise<boolean> {
  const pkgPath = join(cwdAbsolute, "package.json");
  try {
    const raw = await readFile(pkgPath, "utf8");
    const pkg = JSON.parse(raw) as { name?: unknown };
    return pkg.name === "@nearform/tracebound";
  } catch {
    return false;
  }
}

export async function runInstallSkills(
  options: InstallSkillsOptions = {},
): Promise<InstallSkillsResult> {
  const cwdInput = options.cwd ?? process.cwd();
  const cwdAbsolute = resolve(cwdInput);

  const cwdInfo = await stat(cwdAbsolute).catch((err) => {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(`--cwd path does not exist: ${cwdAbsolute}`);
    }
    throw err;
  });
  if (!cwdInfo.isDirectory()) {
    throw new Error(`--cwd path is not a directory: ${cwdAbsolute}`);
  }

  if (await isOwnPackageDir(cwdAbsolute)) {
    return {
      cwdAbsolute,
      targetDir: "",
      installed: [],
      upToDate: [],
      skipped: [],
      dryRun: options.dryRun ?? false,
      selfInstallSkipped: true,
    };
  }

  const targetRelative = options.target ?? DEFAULT_TARGET;
  const targetDir = resolve(cwdAbsolute, targetRelative);

  const bundledDir = bundledSkillsDir();
  if (!(await pathExists(bundledDir))) {
    throw new Error(
      `bundled skills directory not found: ${bundledDir}. This CLI install is missing the 'skills/' directory.`,
    );
  }

  const dryRun = options.dryRun ?? false;
  if (!dryRun) {
    await mkdir(targetDir, { recursive: true });
  }

  const skills = await listSkillNames(bundledDir);
  const result: InstallSkillsResult = {
    cwdAbsolute,
    targetDir,
    installed: [],
    upToDate: [],
    skipped: [],
    dryRun,
    selfInstallSkipped: false,
  };

  for (const skill of skills) {
    const sourcePath = join(bundledDir, skill, "SKILL.md");
    const targetPath = join(targetDir, skill, "SKILL.md");

    if (!(await pathExists(sourcePath))) {
      continue;
    }

    const sourceContents = await readFile(sourcePath, "utf8");

    if (!(await pathExists(targetPath))) {
      if (!dryRun) {
        await mkdir(dirname(targetPath), { recursive: true });
        await writeFile(targetPath, sourceContents, "utf8");
      }
      result.installed.push(skill);
      continue;
    }

    const targetContents = await readFile(targetPath, "utf8");
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
  const lines: string[] = [];

  if (result.selfInstallSkipped) {
    lines.push(
      `${styleText(
        "dim",
        `skipped: cwd is the @nearform/tracebound package itself (${result.cwdAbsolute})`,
      )}`,
    );
    return lines.join("\n") + "\n";
  }

  if (result.installed.length > 0) {
    for (const skill of result.installed) {
      const verb = result.dryRun ? "would install" : "installed";
      lines.push(
        `${styleText("green", "✓")} ${verb}: ${join(result.targetDir, skill)}`,
      );
    }
  }

  if (result.upToDate.length > 0) {
    lines.push(
      `${styleText("dim", `up-to-date: ${result.upToDate.join(", ")}`)}`,
    );
  }

  if (result.skipped.length > 0) {
    for (const skill of result.skipped) {
      lines.push(
        `${styleText(
          "yellow",
          "!",
        )} skipped (modified locally, use --force to overwrite): ${join(
          result.targetDir,
          skill,
        )}`,
      );
    }
  }

  lines.push("");
  lines.push(
    `${styleText(
      "dim",
      `${result.installed.length} installed, ${result.upToDate.length} up-to-date, ${result.skipped.length} skipped`,
    )} → ${result.targetDir}`,
  );

  return lines.join("\n") + "\n";
}
