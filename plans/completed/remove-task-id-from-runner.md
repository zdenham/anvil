# Plan: Remove task-id from Agent Runner + Clean Up Dead Arguments

## Problem

The agent runner is failing with:
```
Missing required argument: --task-id
```

The UI (agent-service.ts) passes `--repo-id` but the runner (SimpleRunnerStrategy) expects `--task-id`. This is a mismatch from the tasks→threads refactor where tasks have been deprecated.

Additionally, there are two arguments that are dead code:
- `--agent` - Only one agent type exists (`"simple"`), making this redundant
- `--agent-mode` - Parsed but never consumed; permission behavior is hardcoded elsewhere

## Current State

### UI Side (agent-service.ts:294-303)
```typescript
const commandArgs = [
  runnerPath,
  "--agent", "simple",              // ← Dead: only "simple" exists
  "--repo-id", options.repoId,      // ← Passing repo-id
  "--thread-id", options.threadId,
  "--cwd", options.sourcePath,
  "--prompt", options.prompt,
  "--mort-dir", mortDir,
  "--agent-mode", agentMode,        // ← Dead: never used
];
```

### Runner Side (SimpleRunnerStrategy.ts)
- Expects `--task-id` argument (line 92-94)
- Throws error if missing (line 117-119)
- Internally converts `taskId` to `repoId` (line 185): `const repoId = taskId;`

### Dead Arguments Analysis

**`--agent`:**
- `AgentType` is literally `"simple"` - a single-value type (types.ts:5)
- Runner validates it must be "simple" and throws if anything else (runner.ts:115)
- Was probably designed for multiple agent types (research, merge, execution) that have been removed
- Currently serves no purpose since there's only one valid value

**`--agent-mode`:**
- Defines 3 modes: `"normal" | "plan" | "auto-accept"` (core/types/agent-mode.ts)
- Gets parsed and stored in `RunnerConfig.agentMode` (simple-runner-strategy.ts:111)
- **Never actually used** - the runner always uses `permissionMode: "bypassPermissions"` hardcoded in shared.ts:400
- It's dead code

## Solution

1. Replace `--task-id` with `--repo-id` in the runner to match what the UI is sending
2. Remove `--agent` argument - hardcode "simple" behavior since it's the only option
3. Remove `--agent-mode` argument - it's parsed but never consumed

## Files to Modify

### 1. agents/src/runners/simple-runner-strategy.ts

**Changes:**
- Rename `--task-id` argument to `--repo-id` in parseArgs()
- Update config property from `taskId` to `repoId`
- Remove the internal conversion `const repoId = taskId;`
- Update validation error message
- Remove `--agent` case (no longer needed)
- Remove `--agent-mode` case (dead code)

### 2. agents/src/runners/types.ts

**Changes:**
- Rename `taskId` property to `repoId` in RunnerConfig interface
- Remove `agent: AgentType` property (hardcode "simple" behavior)
- Remove `agentMode?: AgentMode` property (dead code)
- Remove `AgentType` type export
- Update any JSDoc comments

### 3. agents/src/runner.ts

**Changes:**
- Remove `getStrategy()` function that dispatches on `--agent` flag
- Hardcode `SimpleRunnerStrategy` directly since it's the only option
- Remove `AgentType` imports

### 4. agents/src/runners/simple-runner-strategy.test.ts

**Changes:**
- Update test cases to use `--repo-id` instead of `--task-id`
- Update assertions to check for `repoId` instead of `taskId`
- Remove `--agent simple` from test args
- Remove `--agent-mode` tests (dead code)

### 5. agents/src/testing/runner-config.ts

**Changes:**
- Update test helper to use `--repo-id` instead of `--task-id`
- Remove `--agent` and `--agent-mode` from buildSimpleRunnerArgs

### 6. agents/src/testing/types.ts

**Changes:**
- Remove `agent: "simple"` from test config type (if applicable)

### 7. src/lib/agent-service.ts (UI side)

**Changes:**
- Remove `--agent simple` from commandArgs
- Remove `--agent-mode` from commandArgs

### 8. core/types/agent-mode.ts

**Changes:**
- Consider removing this file entirely if `AgentMode` is no longer used anywhere

## Implementation Steps

1. **Update RunnerConfig type** (types.ts)
   - Change `taskId?: string` to `repoId?: string`
   - Remove `agent: AgentType`
   - Remove `agentMode?: AgentMode`

2. **Update runner.ts**
   - Remove `getStrategy()` function
   - Directly instantiate `SimpleRunnerStrategy`

3. **Update SimpleRunnerStrategy** (simple-runner-strategy.ts)
   - Change `--task-id` to `--repo-id` in parseArgs switch statement
   - Remove `--agent` case
   - Remove `--agent-mode` case
   - Change `config.taskId` to `config.repoId`
   - Update validation: `if (!config.repoId)` with error "Missing required argument: --repo-id"
   - In setup(): Remove `const repoId = taskId;` line, use `config.repoId` directly
   - Update destructuring: `const { cwd, repoId, threadId, ... } = config;`

4. **Update UI** (agent-service.ts)
   - Remove `"--agent", "simple"` from commandArgs
   - Remove `"--agent-mode", agentMode` from commandArgs

5. **Update tests** (simple-runner-strategy.test.ts)
   - Replace `--task-id` with `--repo-id` in all test command args
   - Remove `--agent simple` from test args
   - Remove agent-mode tests
   - Update expectations to check `repoId` property

6. **Update test runner config** (runner-config.ts)
   - Change `--task-id` to `--repo-id` in buildSimpleRunnerArgs
   - Remove `--agent` and `--agent-mode`

7. **Clean up dead code**
   - Remove `AgentType` type if no longer used
   - Consider removing `core/types/agent-mode.ts` if `AgentMode` is unused elsewhere

## Verification

After implementation:
1. Run `pnpm test` in agents/ directory to verify tests pass
2. Run the full test suite
3. Manually test spawning a simple agent from spotlight

## Notes

- The `worktreeId` is also derived from what was `taskId` - for simple agents this can be the same as `repoId` or derived from `threadId`
- UI changes needed: remove `--agent` and `--agent-mode` from agent-service.ts
- This change aligns the codebase with the threads-first architecture where tasks no longer exist
- Removing dead arguments simplifies both the UI and runner, reducing maintenance burden
