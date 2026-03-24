# Plan: Refactor Agent System Prompts to Use claude_code Preset

## Goal

Use the Claude Agent SDK's built-in `claude_code` preset for ALL agents, which provides both a standard system prompt and tools, then append agent-specific instructions on top.

## Current State

- Each agent defines its own `systemPrompt` using `composePrompt()` with `BASE_PROMPT` + agent-specific sections
- Each agent explicitly lists its tools: `["Read", "Glob", "Grep", "Edit", "Write", "Bash"]`
- The `AgentConfig` interface already supports `{ type: "preset"; preset: "claude_code" }` but it's not used
- **runner.ts has fallback tools (lines 395-402)** that must be removed

## Available Presets

Currently, `claude_code` is the **only** preset available in the Claude Agent SDK. It provides the Claude Code system prompt and standard tool configuration.

## Files to Modify

1. `agents/src/agent-types/index.ts` - Update AgentConfig interface
2. `agents/src/agent-types/entrypoint.ts` - Use preset + agent-specific prompt
3. `agents/src/agent-types/execution.ts` - Use preset + agent-specific prompt
4. `agents/src/agent-types/review.ts` - Use preset + agent-specific prompt
5. `agents/src/agent-types/merge.ts` - Use preset + agent-specific prompt
6. `agents/src/agent-types/shared-prompts.ts` - Remove BASE_PROMPT, keep agent-specific sections
7. `agents/src/runner.ts` - Handle preset and append agent-specific instructions

## Implementation Steps

### Step 1: Update AgentConfig Interface

In `agents/src/agent-types/index.ts`:
- Change `tools` to **required** preset (not optional): `tools: { type: "preset"; preset: "claude_code" }`
- Add `appendedPrompt` field for agent-specific instructions that get appended to the preset's system prompt
- Remove optional `systemPrompt` field (no longer needed, we use the preset's)

```typescript
export interface AgentConfig {
  name: string;
  description: string;
  model?: string;
  tools: { type: "preset"; preset: "claude_code" }; // REQUIRED, not optional
  appendedPrompt: string; // Agent-specific instructions appended to preset
}
```

### Step 2: Update shared-prompts.ts

- Remove `BASE_PROMPT` (SDK preset provides the base)
- Keep all agent-specific sections (ROLE, WORKFLOW, CAPABILITIES, etc.)
- Keep `TASK_CONTEXT`, `COMMIT_STRATEGY`, `ANVIL_CLI_CORE`, etc. (these are Anvil-specific)
- Keep `composePrompt()` helper for assembling agent-specific sections

### Step 3: Update Each Agent Type

For each agent (entrypoint, execution, review, merge):
- Change `tools` from explicit array to `{ type: "preset", preset: "claude_code" }`
- Rename `systemPrompt` to `appendedPrompt`
- Remove `BASE_PROMPT` from the composed sections
- Keep agent-specific sections that add Anvil-specific behavior

Example for execution agent:
```typescript
export const execution: AgentConfig = {
  name: "Execution",
  description: "Implements code based on task plan",
  model: "claude-opus-4-5-20251101",
  tools: { type: "preset", preset: "claude_code" },
  appendedPrompt: composePrompt(
    ROLE,
    TASK_CONTEXT,
    CAPABILITIES,
    WORKFLOW,
    COMMIT_STRATEGY,
    MINIMAL_CHANGES,
    ANVIL_CLI_CORE,
    HUMAN_REVIEW_TOOL,
    GUIDELINES
  ),
};
```

### Step 4: Update runner.ts

**DELETE the fallback tools array** (lines 395-402):
```typescript
// DELETE THIS FALLBACK:
tools: agentConfig.tools ?? [
  "Read",
  "Write",
  "Edit",
  "Glob",
  "Grep",
  "Bash",
],
```

Replace with direct preset usage (no fallback needed since tools is now required):
```typescript
tools: agentConfig.tools, // Always { type: "preset", preset: "claude_code" }
```

**Update `buildSystemPrompt()` and `query()` call:**
- Pass tools preset directly to the SDK
- Append `config.appendedPrompt` to the preset's system prompt
- The SDK handles the base claude_code system prompt, we append our agent-specific content

```typescript
const result = query({
  prompt: args.prompt,
  options: {
    cwd: args.cwd,
    model: agentConfig.model ?? "claude-opus-4-5-20251101",
    // Pass preset directly - NO FALLBACK
    tools: agentConfig.tools,
    // Append our agent-specific instructions
    systemPrompt: buildAgentSpecificPrompt(agentConfig, context),
    permissionMode: "bypassPermissions",
    // ...
  },
});
```

The `buildAgentSpecificPrompt()` function will:
1. Take the agent's `appendedPrompt`
2. Interpolate template variables ({{taskId}}, {{branchName}}, etc.)
3. Append runtime context (git status, environment)

## Verification

1. Run `pnpm typecheck` in agents directory
2. Test each agent type with a sample task to verify:
   - SDK preset tools are available
   - Agent-specific behavior works correctly
   - Template variable interpolation still works
