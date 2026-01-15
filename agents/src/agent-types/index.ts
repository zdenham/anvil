import { research } from "./research.js";
import { execution } from "./execution.js";
import { merge } from "./merge.js";
import { simple } from "./simple.js";

// Re-export merge agent types and functions for dynamic prompt building
export { buildMergeAgentPrompt } from "./merge.js";
export type {
  MergeContext,
  WorkflowMode,
} from "./merge-types.js";

export interface AgentConfig {
  name: string;
  description: string;
  model?: string;
  tools: { type: "preset"; preset: "claude_code" };
  appendedPrompt: string;
}

const agents: Record<string, AgentConfig> = {
  research,
  execution,
  merge,
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
