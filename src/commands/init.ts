import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { styleText } from "node:util";

const TEMPLATE_PATH = join(
  import.meta.dirname,
  "..",
  "..",
  "templates",
  "whetstone.config.md",
);

const FAILURE_MODES_SEED = `${JSON.stringify(
  { failureModes: [] },
  null,
  2,
)}\n`;

const SUBDIRS = ["traces", "failure_modes", "adapters"] as const;

export interface InitOptions {
  cwd?: string;
}

export interface InitResult {
  /** Absolute path to the created `whetstone/` directory. */
  rootPath: string;
  created: string[];
  skipped: string[];
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

async function writeIfMissing(
  absPath: string,
  contents: string | Uint8Array,
  result: InitResult,
): Promise<void> {
  if (await pathExists(absPath)) {
    result.skipped.push(absPath);
    process.stdout.write(
      `${styleText("dim", `skipped (exists): ${absPath}`)}\n`,
    );
    return;
  }
  await writeFile(absPath, contents);
  result.created.push(absPath);
  process.stdout.write(`created: ${absPath}\n`);
}

export async function runInit(options: InitOptions = {}): Promise<InitResult> {
  const cwdInput = options.cwd ?? process.cwd();
  const cwdAbsolute = isAbsolute(cwdInput)
    ? cwdInput
    : resolve(process.cwd(), cwdInput);

  let cwdStat;
  try {
    cwdStat = await stat(cwdAbsolute);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(`--cwd path does not exist: ${cwdAbsolute}`);
    }
    throw err;
  }
  if (!cwdStat.isDirectory()) {
    throw new Error(`--cwd path is not a directory: ${cwdAbsolute}`);
  }

  const rootPath = join(cwdAbsolute, "whetstone");
  const result: InitResult = { rootPath, created: [], skipped: [] };

  await mkdir(rootPath, { recursive: true });
  for (const sub of SUBDIRS) {
    await mkdir(join(rootPath, sub), { recursive: true });
  }

  const templateContents = await readFile(TEMPLATE_PATH, "utf8");

  await writeIfMissing(
    join(rootPath, "whetstone.config.md"),
    templateContents,
    result,
  );

  await writeIfMissing(
    join(rootPath, "failure_modes.json"),
    FAILURE_MODES_SEED,
    result,
  );

  process.stdout.write(
    `${styleText("green", `✓ Whetstone initialised at ${rootPath}`)}\n`,
  );

  return result;
}
