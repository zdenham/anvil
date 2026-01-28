# Optimistic Thread Prompt Fix

## Problem

When a thread is created from the spotlight, users see a **350-400ms flash to empty state** before the first user message appears. This happens because the optimistic thread prompt gets overwritten by a disk refresh.

## Root Cause

Race condition between optimistic thread creation and disk refresh:

1. **21:53:20.389** - `THREAD_OPTIMISTIC_CREATED` event fires with `prompt: "hello"` (length 7)
2. **21:53:20.389** - `threadService.createOptimistic()` creates thread in store with `turns[0].prompt = "hello"`
3. **21:53:20.396** - `ContentPane` selector sees `hasPrompt: true` and renders optimistic message
4. **21:53:20.402** - `THREAD_CREATED` event fires → `refreshById()` reads from disk
5. **21:53:20.402** - `_applyUpdate()` **overwrites** thread with disk version (which may have empty `turns` array)
6. **21:53:20.402** - `ContentPane` selector now sees `hasPrompt: false` → **renders empty state**
7. **21:53:20.766** - `AGENT_STATE` event arrives with messages → UI finally shows content

The ~370ms gap between steps 6 and 7 is the "flash to empty state" users experience.

## Solution

Add an `_isOptimistic` flag to thread metadata that signals to `refreshById` that it should **preserve optimistic data** (specifically the prompt) when merging with disk state.

### Implementation

#### 1. Add `_isOptimistic` flag to ThreadMetadata type

```typescript
// src/entities/threads/types.ts
export interface ThreadMetadata {
  // ... existing fields

  /** Internal flag - true if this is an optimistic thread not yet confirmed from disk */
  _isOptimistic?: boolean;
}
```

#### 2. Set flag in `createOptimistic()`

```typescript
// src/entities/threads/service.ts - createOptimistic()
createOptimistic(params: { ... }): void {
  const optimisticThread: ThreadMetadata = {
    // ... existing fields
    _isOptimistic: true,  // Mark as optimistic
    turns: params.prompt
      ? [{
          index: 0,
          prompt: params.prompt,
          startedAt: now,
          completedAt: null,
        }]
      : [],
  };
  // ...
}
```

#### 3. Preserve prompt in `refreshById()` when updating optimistic thread

```typescript
// src/entities/threads/service.ts - refreshById()
async refreshById(threadId: string): Promise<void> {
  const path = await findThreadPath(threadId);
  if (!path) {
    // ... existing handling
    return;
  }

  const raw = await persistence.readJson(`${path}/metadata.json`);
  const result = raw ? ThreadMetadataSchema.safeParse(raw) : null;
  if (result?.success) {
    const diskMetadata = result.data;
    const existingThread = useThreadStore.getState().threads[threadId];

    // If existing thread was optimistic, preserve the prompt if disk doesn't have it
    if (existingThread?._isOptimistic) {
      const optimisticPrompt = existingThread.turns[0]?.prompt;
      const diskHasPrompt = diskMetadata.turns[0]?.prompt;

      if (optimisticPrompt && !diskHasPrompt) {
        // Merge: use disk metadata but preserve optimistic prompt
        diskMetadata.turns = existingThread.turns;
      }

      // Clear the optimistic flag since we now have disk confirmation
      delete diskMetadata._isOptimistic;
    }

    useThreadStore.getState()._applyUpdate(threadId, diskMetadata);
  }
}
```

### Why This Works

1. When spotlight creates thread, it's marked `_isOptimistic: true` with the prompt in `turns[0]`
2. When `THREAD_CREATED` fires and `refreshById` runs:
   - If disk has the prompt → use disk version (prompt preserved)
   - If disk doesn't have prompt yet → preserve optimistic prompt
3. The `_isOptimistic` flag is cleared after first disk confirmation
4. Future refreshes (from `AGENT_STATE`, etc.) work normally since flag is cleared

### Files to Modify

1. `src/entities/threads/types.ts` - Add `_isOptimistic?: boolean` to `ThreadMetadata`
2. `src/entities/threads/service.ts` - Set flag in `createOptimistic()`, check in `refreshById()`

### Testing

1. Create thread from spotlight with a prompt
2. Verify user message appears immediately (no flash to empty)
3. Verify message persists through agent run completion
4. Verify refreshing the window still shows correct data (flag doesn't persist to disk)

## Alternative Considered

**Don't emit `THREAD_CREATED` until metadata is fully written with prompt** - This would require changes to the agent backend and wouldn't solve cases where disk writes are slow.

The `_isOptimistic` flag approach is simpler, fully frontend-side, and handles all race conditions gracefully.
