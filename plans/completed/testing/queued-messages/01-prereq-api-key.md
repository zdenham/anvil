# 01 - Prerequisite: Add API Key to spawnSimpleAgent

## Dependencies

None - can start immediately.

## Parallel With

02-agent-stdin-stream, 03-frontend-queuing

## Scope

Fix `spawnSimpleAgent` and `resumeSimpleAgent` in `src/lib/agent-service.ts` to pass `ANTHROPIC_API_KEY` in the environment, matching the behavior of `spawnAgentWithOrchestration`.

## Problem

Currently, `spawnSimpleAgent` does NOT pass the API key:

```typescript
// Current (broken)
const command = Command.create("node", commandArgs, {
  cwd: options.sourcePath,
  env: {
    NODE_PATH: nodeModulesPath,
    MORT_DATA_DIR: mortDir,
    PATH: shellPath,
  },
});
```

## Implementation

### File: `src/lib/agent-service.ts`

In `spawnSimpleAgent`, add API key retrieval and injection:

```typescript
export async function spawnSimpleAgent(options: SpawnSimpleAgentOptions): Promise<void> {
  // ... existing setup ...

  // Get API key from settings or env
  const settings = settingsService.get();
  const apiKey = settings.anthropicApiKey || import.meta.env.VITE_ANTHROPIC_API_KEY;

  if (!apiKey) {
    throw new Error("Anthropic API key not configured");
  }

  const command = Command.create("node", commandArgs, {
    cwd: options.sourcePath,
    env: {
      ANTHROPIC_API_KEY: apiKey,  // ADD THIS
      NODE_PATH: nodeModulesPath,
      MORT_DATA_DIR: mortDir,
      PATH: shellPath,
    },
  });

  // ... rest of function ...
}
```

Apply the same fix to `resumeSimpleAgent`.

### Note on Placement

Add the API key retrieval and validation near the top of the function, after the existing `getRunnerPaths()` and `getShellPath()` calls, but before building `commandArgs`. This matches the pattern used in `spawnAgentWithOrchestration` (lines 193-199 in current file).

## Verification

1. Start a simple task
2. Check agent logs for successful API calls (no auth errors)
3. Agent should be able to make LLM requests

**Additional verification steps:**
- Verify the settings store is hydrated before `spawnSimpleAgent` is called (this happens at app startup via `hydrateEntities()`)
- Test with API key only in settings (no env var)
- Test with API key only in env var (no settings)

## Files Modified

- `src/lib/agent-service.ts`

## Implementation Notes

The `settingsService.get()` function returns a `WorkspaceSettings` object from the Zustand store. The property is `anthropicApiKey` (not `apiKey`), which is typed as `string | null`. The fallback to `import.meta.env.VITE_ANTHROPIC_API_KEY` handles development scenarios where the key may be set via environment.
