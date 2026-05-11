import { readdir, stat } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";

export const AGENT_NAME_RE = /^[a-z0-9][a-z0-9_-]*$/;

const AGENT_NAME_HINT =
  "Agent names must match /^[a-z0-9][a-z0-9_-]*$/ (lowercase letters, digits, underscores, hyphens; must start with a letter or digit).";

export interface ResolveAgentRootResult {
  /** Absolute path to the resolved cwd. */
  cwdAbsolute: string;
  /** Absolute path to `<cwd>/tracebound` — the namespace container. */
  rootContainer: string;
  /** Absolute path to `<cwd>/tracebound/<agent>`. */
  rootPath: string;
  /** The validated agent name. */
  agentName: string;
}

interface PathInfo {
  exists: boolean;
  isDir: boolean;
  isFile: boolean;
}

async function inspectPath(p: string): Promise<PathInfo> {
  try {
    const s = await stat(p);
    return { exists: true, isDir: s.isDirectory(), isFile: s.isFile() };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return { exists: false, isDir: false, isFile: false };
    }
    throw err;
  }
}

async function resolveCwd(cwd?: string): Promise<string> {
  const cwdInput = cwd ?? process.cwd();
  const cwdAbsolute = isAbsolute(cwdInput)
    ? cwdInput
    : resolve(process.cwd(), cwdInput);

  const info = await inspectPath(cwdAbsolute);
  if (!info.exists) {
    throw new Error(`--cwd path does not exist: ${cwdAbsolute}`);
  }
  if (!info.isDir) {
    throw new Error(`--cwd path is not a directory: ${cwdAbsolute}`);
  }
  return cwdAbsolute;
}

/**
 * List the agents under `<cwd>/tracebound/`. An agent is a subdirectory that
 * contains a `tracebound.config.md` file. Returns an empty list (not an error)
 * when the container is missing or empty. Sorted alphabetically.
 */
export async function listAgents(
  cwd?: string,
): Promise<{ name: string; path: string }[]> {
  const cwdAbsolute = await resolveCwd(cwd);
  const rootContainer = join(cwdAbsolute, "tracebound");

  const containerInfo = await inspectPath(rootContainer);
  if (!containerInfo.exists || !containerInfo.isDir) {
    return [];
  }

  let entries: string[];
  try {
    entries = await readdir(rootContainer);
  } catch {
    return [];
  }
  entries.sort();

  const agents: { name: string; path: string }[] = [];
  for (const name of entries) {
    const agentPath = join(rootContainer, name);
    const info = await inspectPath(agentPath);
    if (!info.isDir) continue;
    const configInfo = await inspectPath(join(agentPath, "tracebound.config.md"));
    if (!configInfo.exists || !configInfo.isFile) continue;
    agents.push({ name, path: agentPath });
  }
  return agents;
}

function formatAvailable(agents: { name: string }[]): string {
  if (agents.length === 0) {
    return "(none — run 'tracebound init <name>' to create one)";
  }
  return agents.map((a) => a.name).join(", ");
}

/**
 * Resolve the agent root for write commands (init). Validates the agent-name
 * format and returns the path WITHOUT requiring it to exist on disk.
 */
export async function resolveAgentRootForInit(options: {
  cwd?: string;
  agent?: string;
}): Promise<ResolveAgentRootResult> {
  const agent = options.agent;
  if (!agent || agent.trim() === "") {
    throw new Error("agent name is required");
  }
  if (!AGENT_NAME_RE.test(agent)) {
    throw new Error(`invalid agent name: "${agent}". ${AGENT_NAME_HINT}`);
  }

  const cwdAbsolute = await resolveCwd(options.cwd);
  const rootContainer = join(cwdAbsolute, "tracebound");
  const rootPath = join(rootContainer, agent);

  return { cwdAbsolute, rootContainer, rootPath, agentName: agent };
}

/**
 * Resolve the agent root for read commands. Requires that
 * `<cwd>/tracebound/<agent>/` already exists; if not, throws an error that
 * includes the list of agents that do exist.
 */
export async function resolveAgentRootForRead(options: {
  cwd?: string;
  agent?: string;
}): Promise<ResolveAgentRootResult> {
  const agent = options.agent;
  if (!agent || agent.trim() === "") {
    const agents = await listAgents(options.cwd);
    throw new Error(
      `--agent <name> is required. Available agents: ${formatAvailable(agents)}`,
    );
  }

  const cwdAbsolute = await resolveCwd(options.cwd);
  const rootContainer = join(cwdAbsolute, "tracebound");
  const rootPath = join(rootContainer, agent);

  const info = await inspectPath(rootPath);
  if (!info.exists || !info.isDir) {
    const agents = await listAgents(cwdAbsolute);
    throw new Error(
      `no such agent: "${agent}". Available agents: ${formatAvailable(agents)}`,
    );
  }

  return { cwdAbsolute, rootContainer, rootPath, agentName: agent };
}
