import {
  mkdir,
  readdir,
  readFile,
  realpath,
  stat,
  writeFile,
} from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { styleText } from "node:util";

export interface InstallSkillsOptions {
  cwd?: string;
  target?: string;
  force?: boolean;
  dryRun?: boolean;
}

export interface InstallSkillsResult {
  cwdAbsolute: string;
  targetDir: string;
  installed: string[];
  upToDate: string[];
  skipped: string[];
  dryRun: boolean;
  selfInstallSkipped: boolean;
}

export const DEFAULT_TARGET = ".claude/skills/tracebound";

export function bundledSkillsDir(): string {
  return resolve(import.meta.dirname, "..", "..", "skills");
}

async function listSkillNames(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  return entries
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
}

async function isOwnPackageDir(cwdAbsolute: string): Promise<boolean> {
  const pkgPath = join(cwdAbsolute, "package.json");
  let raw: string;
  try {
    raw = await readFile(pkgPath, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw new Error(`could not read ${pkgPath}`, { cause: err });
  }
  let pkg: { name?: unknown };
  try {
    pkg = JSON.parse(raw) as { name?: unknown };
  } catch (err) {
    throw new Error(`malformed JSON in ${pkgPath}`, { cause: err });
  }
  return pkg.name === "@nearform/tracebound";
}

async function readIfExists(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw new Error(`could not read ${path}`, { cause: err });
  }
}

export async function runInstallSkills(
  options: InstallSkillsOptions = {},
): Promise<InstallSkillsResult> {
  const cwdAbsolute = resolve(options.cwd ?? process.cwd());

  let cwdStat;
  try {
    cwdStat = await stat(cwdAbsolute);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(`--cwd path does not exist: ${cwdAbsolute}`);
    }
    throw new Error(`could not stat --cwd path: ${cwdAbsolute}`, {
      cause: err,
    });
  }
  if (!cwdStat.isDirectory()) {
    throw new Error(`--cwd path is not a directory: ${cwdAbsolute}`);
  }

  const dryRun = options.dryRun ?? false;

  if (await isOwnPackageDir(cwdAbsolute)) {
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
  let bundledStat;
  try {
    bundledStat = await stat(bundledDir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(
        `bundled skills directory not found: ${bundledDir}. This CLI install is missing the 'skills/' directory.`,
      );
    }
    throw err;
  }
  if (!bundledStat.isDirectory()) {
    throw new Error(
      `bundled skills path is not a directory: ${bundledDir}. This CLI install is corrupted.`,
    );
  }

  const cwdReal = await realpath(cwdAbsolute);
  const targetDir = resolve(cwdReal, options.target ?? DEFAULT_TARGET);
  if (targetDir !== cwdReal && !targetDir.startsWith(cwdReal + sep)) {
    throw new Error(
      `--target must resolve inside --cwd: ${targetDir} is outside ${cwdAbsolute}`,
    );
  }
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

  for (const skill of await listSkillNames(bundledDir)) {
    const sourcePath = join(bundledDir, skill, "SKILL.md");
    const targetPath = join(targetDir, skill, "SKILL.md");

    const sourceContents = await readIfExists(sourcePath);
    if (sourceContents === undefined) continue;

    const targetContents = await readIfExists(targetPath);

    if (targetContents === undefined) {
      if (!dryRun) {
        await mkdir(dirname(targetPath), { recursive: true });
        await writeFile(targetPath, sourceContents, "utf8");
      }
      result.installed.push(skill);
      continue;
    }

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
