import type { AgentConfig } from "./index.js";
import { composePrompt, PLAN_CONVENTIONS } from "./shared-prompts.js";

const BASE_PROMPT = `## Context

You are helping the user with a task in their codebase.

- Task ID: {{taskId}}
- Thread ID: {{threadId}}

Work directly in the current repository. Make changes as requested.
Request human review when you need input or approval.`;

export const simple: AgentConfig = {
  name: "simple",
  description: "Simple Claude Code agent - runs directly in repository",
  model: "claude-opus-4-5-20251101",
  tools: { type: "preset", preset: "claude_code" },
  appendedPrompt: composePrompt(BASE_PROMPT, PLAN_CONVENTIONS),
};
