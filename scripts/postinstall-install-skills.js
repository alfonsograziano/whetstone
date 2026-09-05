import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const cliPath = join(here, "..", "dist", "cli.js");
const cwd = process.env.INIT_CWD ?? ".";

const result = spawnSync(
  process.execPath,
  [cliPath, "install-skills", "--cwd", cwd],
  { stdio: "inherit" },
);

if (result.signal !== null) {
  process.stderr.write(
    `install-skills child terminated by signal ${result.signal}\n`,
  );
}

process.exit(result.status ?? 1);
