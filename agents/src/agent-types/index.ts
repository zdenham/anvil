import { simple } from "./simple.js";

export interface AgentConfig {
  name: string;
  description: string;
  model?: string;
  tools: { type: "preset"; preset: "claude_code" };
  appendedPrompt: string;
}

const agents: Record<string, AgentConfig> = {
  simple,
};

export function getAgentConfig(type: string): AgentConfig {
  const config = agents[type];
  if (!config) {
    throw new Error(`Unknown agent type: ${type}`);
  }
  return config;
}

export function listAgentTypes(): string[] {
  return Object.keys(agents);
}
