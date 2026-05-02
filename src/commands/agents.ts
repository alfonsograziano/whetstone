import { listAgents } from "./agent-root.ts";

export interface AgentSummary {
  name: string;
  path: string;
}

export interface AgentsReport {
  agents: AgentSummary[];
}

export interface AgentsOptions {
  cwd?: string;
}

export async function runAgents(
  options: AgentsOptions = {},
): Promise<AgentsReport> {
  const agents = await listAgents(options.cwd);
  return { agents };
}

export function reportText(report: AgentsReport): string {
  if (report.agents.length === 0) return "";
  return `${report.agents.map((a) => a.name).join("\n")}\n`;
}

export function reportJson(report: AgentsReport): string {
  return `${JSON.stringify({ agents: report.agents }, null, 2)}\n`;
}
