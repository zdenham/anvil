# Stream 2A: State Management Functions

**Depends on:** Stream 1 (schema)
**Blocks:** Stream 3A (MessageHandler)
**Parallel with:** Streams 2B, 2C

## Goal

Add state management functions for tool lifecycle tracking.

## File to Modify

`agents/src/output.ts`

## Implementation

### 1. Update `markToolRunning` signature

```typescript
/**
 * Mark a tool as running (called when assistant message has tool_use).
 */
export function markToolRunning(toolUseId: string, toolName: string): void {
  state.toolStates[toolUseId] = { status: "running", toolName };
  emitState();
}
```

### 2. Add `markToolComplete` function

```typescript
/**
 * Mark a tool as complete (called when user message has tool result).
 * Replaces the hook-based appendToolResult for completion tracking.
 *
 * NOTE: This updates tool STATE only. It does NOT add messages to history.
 * Message history is built directly from SDK messages.
 */
export function markToolComplete(
  toolUseId: string,
  result: string,
  isError: boolean
): void {
  const existingState = state.toolStates[toolUseId];
  const toolName = existingState?.toolName;

  // Defensive validation: toolName should exist from markToolRunning
  if (!toolName) {
    logger.warn(
      `[markToolComplete] toolName missing for ${toolUseId}. ` +
      `This may indicate messages arrived out of order.`
    );
  }

  state.toolStates[toolUseId] = {
    status: isError ? "error" : "complete",
    result,
    isError,
    toolName,  // Preserve from running state
  };
  emitState();
}
```

## Migration Note

The existing `markToolRunning` may only take `toolUseId`. Update all call sites to pass `toolName` as well. Search for:

```bash
grep -r "markToolRunning" agents/src/
```

## Verification

```bash
pnpm typecheck
pnpm test:agents
```
