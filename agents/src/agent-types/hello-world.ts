import type { AgentConfig } from "./index.js";

export const helloWorld: AgentConfig = {
  name: "hello-world",
  description: "A simple agent that responds with hello world",
  model: "claude-sonnet-4-20250514",
  tools: { type: "preset", preset: "claude_code" },
  appendedPrompt: `You are a simple agent. When invoked, respond with exactly "Hello, World!" and nothing else. Do not use any tools. Just respond with the greeting.`,
};
