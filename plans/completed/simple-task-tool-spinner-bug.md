# Bug Diagnosis: Tool Calls Showing Spinners in Old Threads (Simple Task View)

## Status: FIXED ✅

## Problem Summary

When opening older threads in the simple task view, tool calls display spinners as if they are in a loading state, **indefinitely** - not just during initial load.

## Root Cause Identified ✅

**The bug is in the agent process**: When a conversation is resumed, tool states from previous turns are **overwritten with empty state** instead of being preserved and merged.

### Specific Issue

Tool calls from **previous turns** show spinners indefinitely, while tool calls from the **latest turn** render correctly. This happens because:

1. When resuming a conversation, `loadPriorState()` only extracts `messages` and `sessionId` from the history file - it **ignores `toolStates`**
2. `initState()` initializes `toolStates` as an empty object `{}`
3. When the SDK replays prior tool calls, `markToolRunning()` creates new entries with `status: "running"`
4. These entries **never get marked complete** because the prior results are in message history, not streamed

### Evidence from Logs

```
Tool state lookup {"toolId":"toolu_018szvFKdDBKv5m3zEKLgYNQ","toolName":"Read",
  "toolStatesKeys":["toolu_01MhTjg6oha76kDrmhi6xZ6e","toolu_012ZvDF4gUypL2gXDbEjifzk"],
  "foundState":false,"resolvedStatus":"running"}
```

The `toolStates` object only contains 2 tool IDs from the current turn, but the component is looking up tool IDs from previous turns that don't exist in the map.

## Fix Applied ✅

### Changes Made

| File | Change |
|------|--------|
| `agents/src/runners/shared.ts` | Added `toolStates` to `PriorState` interface |
| `agents/src/runner.ts` | Updated `loadPriorState()` to extract `toolStates` from history file |
| `agents/src/output.ts` | Updated `initState()` to accept `priorToolStates` parameter and use it |
| `agents/src/runners/shared.ts` | Updated `runAgentLoop()` to pass `priorToolStates` to `initState()` |

### How the Fix Works

1. `loadPriorState()` now extracts `toolStates` from the state.json file alongside `messages` and `sessionId`
2. `initState()` accepts a new `priorToolStates` parameter and uses it instead of `{}`
3. When resuming a conversation, all prior tool states are preserved
4. Prior tool calls show their correct completion status instead of "running"

---

## Previous Investigation (for reference)

### Key Observation

The spinners **continue to spin indefinitely**, which rules out the initial "race condition during async load" hypothesis. If the state was eventually loading correctly, the spinners would stop after the store updates.

This suggests one of the following root causes:

1. **State is never being loaded** for the thread
2. **toolStates are not being persisted** correctly to state.json
3. **toolStates exist on disk but aren't being read/parsed** correctly
4. **Store update is not triggering a re-render** in the component

### Verification: Data on Disk

Checking an actual state.json file confirms **toolStates ARE correctly persisted**:

```json
"toolStates": {
  "toolu_01LsM5NW5KaZEDJ6NkGqvqzf": {
    "status": "complete",
    "result": "...",
    "isError": false,
    "toolName": "Task"
  },
  "toolu_01KwVPF9i9TSxXZtwBp2L6Tu": {
    "status": "complete",
    ...
  }
}
```

So the data IS on disk. The problem is somewhere in the loading/rendering pipeline.

## Debug Logs Added

Debug logs have been added to trace the issue:

### 1. SimpleTaskWindow (`simple-task-window.tsx:159-172`)
```typescript
logger.info(`[SimpleTaskWindow] Tool states debug`, {
  threadId,
  hasActiveState: !!activeState,
  hasToolStates: !!activeState?.toolStates,
  toolStatesKeys: Object.keys(toolStates),
  toolStatesCount: Object.keys(toolStates).length,
  toolStatesSnapshot: JSON.stringify(toolStates).slice(0, 500),
  storeHasAnyStates: storeThreadStatesKeys.length > 0,
  storeThreadStatesKeys: storeThreadStatesKeys,
  currentThreadInStore: storeThreadStatesKeys.includes(threadId),
});
```

### 2. AssistantMessage (`assistant-message.tsx:66-74`)
```typescript
logger.info(`[AssistantMessage] Tool state lookup`, {
  toolId: block.id,
  toolName: block.name,
  hasToolStates: !!toolStates,
  toolStatesKeys: toolStates ? Object.keys(toolStates) : [],
  foundState: !!toolStates?.[block.id],
  resolvedStatus: state.status,
});
```

### 3. ThreadStore (`store.ts:113-116`)
```typescript
logger.info(`[ThreadStore] setThreadState called`, {
  ...
  hasToolStates: !!state?.toolStates,
  toolStatesKeys: state?.toolStates ? Object.keys(state.toolStates) : [],
  toolStatesCount: state?.toolStates ? Object.keys(state.toolStates).length : 0,
});
```

### 4. ThreadService (`service.ts:622-625`)
```typescript
logger.info(`[threadService.loadThreadState] Setting thread state for ${threadId}`, {
  ...
  hasToolStates: !!result.data.toolStates,
  toolStatesKeys: result.data.toolStates ? Object.keys(result.data.toolStates) : [],
  toolStatesCount: result.data.toolStates ? Object.keys(result.data.toolStates).length : 0,
});
```

## What to Look For in Logs

When reproducing the bug, check the logs for these scenarios:

### Scenario A: State Never Loaded
```
[SimpleTaskWindow] Tool states debug { hasActiveState: false, ... }
```
- No `[threadService.loadThreadState]` log appears
- **Cause**: `loadThreadState()` is never being called or fails silently

### Scenario B: State Loaded But toolStates Missing
```
[threadService.loadThreadState] Setting thread state { hasToolStates: false, ... }
[SimpleTaskWindow] Tool states debug { hasActiveState: true, hasToolStates: false }
```
- **Cause**: Schema parsing is stripping toolStates, or disk read is incomplete

### Scenario C: State Loaded But Component Not Re-rendering
```
[ThreadStore] setThreadState called { hasToolStates: true, toolStatesCount: 5 }
[SimpleTaskWindow] Tool states debug { hasActiveState: false, currentThreadInStore: false }
```
- Store updates but component doesn't see it
- **Cause**: Selector not reacting to store changes, or threadId mismatch

### Scenario D: State Loaded, Component Sees It, But Still Shows Spinner
```
[SimpleTaskWindow] Tool states debug { hasToolStates: true, toolStatesKeys: [...] }
[AssistantMessage] Tool state lookup { foundState: false, resolvedStatus: "running" }
```
- **Cause**: Tool ID mismatch between messages and toolStates keys

## Hypotheses to Test

### Hypothesis 1: loadThreadState() Not Being Called

The `setActiveThread()` method in `threadService` calls `loadThreadState()`:

```typescript
setActiveThread(threadId: string | null): void {
  store.setActiveThread(threadId);
  if (threadId) {
    this.loadThreadState(threadId);  // This is NOT awaited
  }
}
```

Note that `loadThreadState()` is async but **not awaited**. The component might be using a stale threadId before the async call completes and updates the store.

### Hypothesis 2: Multiple SimpleTaskWindow Instances

If multiple simple-task panels are opened/closed quickly, the `activeThreadId` might get overwritten, and the `loadThreadState()` result might be discarded:

```typescript
// In loadThreadState finally block:
if (useThreadStore.getState().activeThreadId === threadId) {
  store.setActiveThreadLoading(false);
}
```

This check protects against race conditions, but if the threadId changes before loading completes, the state might never be set.

### Hypothesis 3: Zustand Selector Not Triggering Re-render

The selector `(s) => s.threadStates[threadId]` might not be re-evaluated if Zustand thinks the reference hasn't changed. However, this is unlikely since we're spreading a new object.

## Next Steps

1. **Reproduce the bug** and check the console logs
2. Based on which logs appear (or don't appear), narrow down the root cause
3. The logs will tell us:
   - Is `loadThreadState` being called?
   - Is the state being parsed with toolStates?
   - Is the store being updated?
   - Is the component seeing the update?
   - Are the tool IDs matching?

## Key Files

| File | Line | Purpose |
|------|------|---------|
| `src/components/simple-task/simple-task-window.tsx` | 71, 155-172 | Subscribes to store, extracts toolStates |
| `src/components/thread/assistant-message.tsx` | 64, 66-74 | Fallback logic for missing tool state |
| `src/entities/threads/service.ts` | 560-635, 642-650 | loadThreadState, setActiveThread |
| `src/entities/threads/store.ts` | 108-126 | setThreadState action |
| `core/types/events.ts` | 219 | ThreadStateSchema with toolStates |
