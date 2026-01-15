# Plan 01: Agent Output Async (Disk-First)

## Dependencies

None - can run in parallel with Plan 02.

## Goal

Make agent process write to disk BEFORE emitting events to stdout.

## Files to Modify

| File | Action |
|------|--------|
| `agents/src/output.ts` | Make `emitState()` async, write disk first |
| `agents/src/runner.ts` | Await all output function calls |

## Implementation

### 1. Update `agents/src/output.ts`

Change `emitState()` from sync to async:

```typescript
export async function emitState(): Promise<void> {
  state.timestamp = Date.now();
  const payload = { ...state };

  // 1. FIRST: Write to disk (must complete before emitting)
  if (threadWriter) {
    try {
      await threadWriter.writeState(payload);
    } catch (err) {
      logger.warn(`[output] ThreadWriter failed: ${err}, trying direct write`);
      writeFileSync(statePath, JSON.stringify(payload, null, 2));
    }
  } else {
    writeFileSync(statePath, JSON.stringify(payload, null, 2));
  }

  // 2. THEN: Emit event (can include payload for optimistic updates)
  console.log(JSON.stringify({ type: "state", state: payload }));
}
```

### 2. Update All Callers in `output.ts`

Functions that call `emitState()` must be async and await it:

- `initState()` → `async initState()`
- `appendUserMessage()` → `async appendUserMessage()`
- `appendAssistantMessage()` → `async appendAssistantMessage()`
- `appendToolResult()` → `async appendToolResult()`
- `markToolRunning()` → `async markToolRunning()`
- `updateFileChange()` → `async updateFileChange()`
- `complete()` → `async complete()`
- `error()` → `async error()`

### 3. Update `agents/src/runner.ts`

Add `await` to all output function calls:

```typescript
// Example changes needed:
await initState(...);
await appendUserMessage(...);
await appendAssistantMessage(...);
// etc.
```

## Validation

- Agent still outputs events to stdout
- `state.json` is written BEFORE event appears in stdout
- No unhandled promise rejections
