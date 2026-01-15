# Stream 2B: Test Assertions

**Depends on:** Stream 1 (schema with toolName)
**Blocks:** Nothing critical (but needed for Stream 4 tests)
**Parallel with:** Streams 2A, 2C

## Goal

Fix `usedTools()` assertion to read `toolName` from state values instead of keys (which are UUIDs).

## File to Modify

`agents/src/testing/assertions.ts`

## Problem

Current implementation checks `toolStates` keys expecting tool names, but keys are actually `toolUseId` UUIDs like `toolu_01234...`.

## Implementation

### Fix `usedTools()`

```typescript
/**
 * Assert agent used all of the specified tools.
 * Checks toolName field in tool states (not the keys, which are UUIDs).
 */
usedTools(toolNames: string[]): this {
  const usedToolNames = new Set<string>();

  for (const state of this.output.states) {
    for (const toolState of Object.values(state.state.toolStates ?? {})) {
      if (toolState.toolName) {
        usedToolNames.add(toolState.toolName);
      }
    }
  }

  const missing = toolNames.filter((name) => !usedToolNames.has(name));
  if (missing.length > 0) {
    throw new Error(
      `Tools not used: [${missing.join(", ")}]. ` +
      `Used tools: [${Array.from(usedToolNames).join(", ")}]`
    );
  }
  return this;
}
```

### Fix `didNotUseTools()`

```typescript
/**
 * Assert agent did not use any of the specified tools.
 */
didNotUseTools(toolNames: string[]): this {
  const usedToolNames = new Set<string>();

  for (const state of this.output.states) {
    for (const toolState of Object.values(state.state.toolStates ?? {})) {
      if (toolState.toolName) {
        usedToolNames.add(toolState.toolName);
      }
    }
  }

  const found = toolNames.filter((name) => usedToolNames.has(name));
  if (found.length > 0) {
    throw new Error(`Expected tools not to be used but found: [${found.join(", ")}]`);
  }
  return this;
}
```

## Breaking Change Warning

Tests using `usedTools()` may have been incorrectly passing before. After this fix, they will correctly validate tool usage. Review all tests using these assertions.

## Verification

```bash
pnpm test:agents
```

Expect some tests may need updates if they were relying on the broken behavior.
