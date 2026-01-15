# Runner Updates

**`agents/src/runner.ts`**

## Changes Required

- Accept `--task-id` as optional (null initially)
- Register `UserPromptSubmit` hook for task context injection
- Handle branch switching after routing (triggered by CLI commands)
- Pass workspace directory to hook for `.tasks/` access
- Load skills from `agents/skills/` directory

## Hook Registration

The runner needs to:
1. Load the `injectTaskContext` hook from `agents/src/hooks/task-context.ts`
2. Register it for the `UserPromptSubmit` lifecycle event
3. Pass the workspace directory in the hook context

## Skill Loading

The runner needs to:
1. Scan `agents/skills/` directory for `.md` files
2. Register each file as an available skill
3. Make skills accessible via the `Skill` tool

## Files to Modify

- `agents/src/runner.ts` - Optional taskId, hook registration, skill loading, branch management
