import type { AgentConfig } from "./index.js";

export const simple: AgentConfig = {
  name: "simple",
  description: "Simple Claude Code agent - runs directly in repository",
  model: "claude-opus-4-5-20251101",
  tools: { type: "preset", preset: "claude_code" },
  appendedPrompt: `## Context

You are helping the user with a task in their codebase.

- Task ID: {{taskId}}
- Thread ID: {{threadId}}

Work directly in the current repository. Make changes as requested.
Request human review when you need input or approval.`,
};
