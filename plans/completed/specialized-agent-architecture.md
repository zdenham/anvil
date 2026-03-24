# Specialized Agent Architecture

Replace skills-based composition with three purpose-built agents, each with a tailored system prompt.

## Current State

- Single "main" agent uses `/route` skill to handle task routing
- Skills loaded from `agents/skills/*.md` as plugins
- System prompts are minimal; behavior comes from skill instructions
- `coder` and `simplifier` agents exist but aren't the primary entrypoint

## Target Architecture

Three independent agents, each kicked off by frontend/user:

### 1. Entrypoint Agent (`entrypoint.ts`)

**Purpose:** Task creation, refinement, planning, and research. The first agent users interact with.

**Capabilities:**
- Code exploration (Read, Glob, Grep)
- Write access for planning docs (Write to `~/.anvil/` directory and task `content.md`)
- Arbitrary Bash for research (strongly encouraged to use anvil CLI)
- Anvil CLI for task management (create, associate, update)

**System Prompt Includes:**
- Task routing logic (from current `route.md`)
- Instructions to write plans to `content.md`
- How to structure task descriptions
- Strong encouragement to use anvil CLI for task operations
- When to recommend moving to execution

**Model:** claude-opus-4

**Note:** This agent transforms from the current `main.ts`.

### 2. Execution Agent (`execution.ts`)

**Purpose:** Implements code based on task plan.

**Capabilities:**
- Full tool access (Read, Glob, Grep, Edit, Write, Bash)
- Anvil CLI for status updates
- Git operations (commits per file)

**System Prompt Includes:**
- Clean code, minimal changes philosophy
- Per-file commit strategy
- Reference task's `content.md` for context
- Focus on implementation, not planning

**Model:** claude-opus-4

### 3. Review Agent (`review.ts`)

**Purpose:** Reviews code changes, suggests refinements.

**Capabilities:**
- Read-only (Read, Glob, Grep, Bash)
- Edit tool available for making fixes when requested
- Anvil CLI for status updates

**System Prompt Includes:**
- Code review checklist (correctness, style, edge cases)
- How to read diffs from task branch
- Structured feedback format
- When to approve vs request changes

**Model:** claude-opus-4

## Implementation Plan

### Step 1: Transform main.ts → entrypoint.ts

Rename `agents/src/agent-types/main.ts` to `entrypoint.ts` and rewrite:
- Port task routing logic from `route.md` skill into system prompt
- Add Write tool for `~/.anvil/` directory access
- Add anvil CLI reference with strong encouragement to use it
- Set model to claude-opus-4

### Step 2: Create Execution Agent

**File:** `agents/src/agent-types/execution.ts`

System prompt should include:
1. Implementation focus
2. Per-file commit strategy
3. Reference to task content.md for requirements
4. Minimal changes philosophy

Tools: `["Read", "Glob", "Grep", "Edit", "Write", "Bash"]`

### Step 3: Create Review Agent

**File:** `agents/src/agent-types/review.ts`

System prompt should include:
1. Code review methodology
2. How to examine task branch diffs
3. Structured feedback format
4. Approval criteria

Tools: `["Read", "Glob", "Grep", "Edit", "Bash"]`

### Step 4: Update Runner

In `agents/src/runner.ts`:
1. Add `buildSystemPrompt()` function to interpolate `{{taskId}}`, `{{taskSlug}}`, `{{branchName}}`
2. Remove skill plugin loading (lines ~298-311)
3. Remove all hook registration and handling

### Step 5: Clean Up

1. Delete `agents/skills/` directory
2. Delete `agents/src/hooks/task-context.ts`
3. Delete `agents/src/agent-types/coder.ts`
4. Delete `agents/src/agent-types/simplifier.ts`
5. Update `agents/src/agent-types/index.ts` to export new agents only

### Step 6: Update Agent Registry

Update `agents/src/agent-types/index.ts`:
- Export: entrypoint, execution, review
- Remove: main, coder, simplifier

Final structure:
```
agents/src/agent-types/
├── index.ts          # Updated exports
├── entrypoint.ts     # Transformed from main.ts
├── execution.ts      # New
└── review.ts         # New
```

## Files to Modify

| File | Action |
|------|--------|
| `agents/src/agent-types/main.ts` | Rename to entrypoint.ts, rewrite |
| `agents/src/agent-types/execution.ts` | Create |
| `agents/src/agent-types/review.ts` | Create |
| `agents/src/agent-types/coder.ts` | Delete |
| `agents/src/agent-types/simplifier.ts` | Delete |
| `agents/src/agent-types/index.ts` | Update exports |
| `agents/src/runner.ts` | Remove skill loading, remove hooks, add template interpolation |
| `agents/src/hooks/task-context.ts` | Delete |
| `agents/skills/` | Delete entire directory |

## System Prompt Structure

Each agent's system prompt is a **template** that gets populated at runtime with task context:

```typescript
export const agentName: AgentConfig = {
  name: "Agent Name",
  description: "One-line description",
  model: "claude-opus-4-20250514",
  systemPrompt: `
## Role
[What this agent does]

## Current Task
Task ID: {{taskId}}
Task Slug: {{taskSlug}}
Branch: {{branchName}}

Use \`anvil tasks get --slug={{taskSlug}}\` to fetch current task state.

## Capabilities
[What tools are available and when to use them]

## Workflow
[Step-by-step process]

## Anvil CLI Reference
[Commands this agent should use - STRONGLY PREFER using anvil CLI for task operations]

## Guidelines
[Behavioral rules]
`,
  tools: [...],
};
```

## Why No Hooks?

The current `injectTaskContext` hook reads task state from disk on each turn. Problems:
- Stale data if agent updates task via CLI
- Extra complexity
- Hook runs before agent sees its own changes

Instead, pass task ID/slug in the system prompt template. The agent can:
1. Query current state via `anvil tasks get` when needed
2. See results of its own CLI calls (title changes, status updates, etc.)
3. Have a dynamic, always-fresh view of task state

## Runner Changes

The runner needs to interpolate template variables before sending to Claude:

```typescript
function buildSystemPrompt(config: AgentConfig, context: { taskId?: string, taskSlug?: string, branchName?: string }): string {
  let prompt = config.systemPrompt;
  prompt = prompt.replace(/\{\{taskId\}\}/g, context.taskId ?? 'none');
  prompt = prompt.replace(/\{\{taskSlug\}\}/g, context.taskSlug ?? 'none');
  prompt = prompt.replace(/\{\{branchName\}\}/g, context.branchName ?? 'none');
  return prompt;
}
```

## Migration Notes

- Frontend passes task context (taskId, slug, branch) when invoking runner
- Runner interpolates these into the system prompt template
- Thread metadata already has `agentType` field - this enables different agents per turn
- Task `content.md` becomes the handoff mechanism between agents
- Agents use `anvil tasks get` to fetch fresh state when needed
- Agent handoff mechanism (how frontend knows when to switch agents) is future work
