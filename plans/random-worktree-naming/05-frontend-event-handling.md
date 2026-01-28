# Sub-Plan 05: Frontend Event Handling

## Overview
Handle the `WORKTREE_NAME_GENERATED` event in the frontend event bridge, calling the Tauri worktree rename command.

## Dependencies
- **02-event-system.md** - Needs `WORKTREE_NAME_GENERATED` event type

## Steps

### Step 1: Add Event Handler in Event Bridge

**File:** `src/lib/event-bridge.ts`

First, check the existing structure of the event bridge to understand the pattern. Then add a handler for the new event.

Add import if needed:
```typescript
import { EventName } from "@core/types/events";
```

Find the event handling switch/if block and add:

```typescript
case EventName.WORKTREE_NAME_GENERATED: {
  const { worktreeId, repoId, name } = payload as EventPayloads[typeof EventName.WORKTREE_NAME_GENERATED];

  // Call worktree rename via Tauri
  // Note: Need to find the correct service method - likely in worktreeService
  try {
    await worktreeService.rename(repoId, worktreeId, name);
    console.log(`[event-bridge] Renamed worktree ${worktreeId} to "${name}"`);
  } catch (error) {
    console.error(`[event-bridge] Failed to rename worktree ${worktreeId}:`, error);
    // Non-blocking - log and continue
  }
  break;
}
```

### Step 2: Verify Worktree Rename Service Exists

Check that `worktreeService.rename()` exists and understand its signature:

**File to check:** `src/entities/worktrees/service.ts`

If the method doesn't exist or has a different signature, adjust accordingly. The Tauri command is `worktree_rename` based on the original plan.

### Step 3: Handle Edge Cases

Consider these edge cases in the handler:

1. **Worktree deleted before rename:** Check if worktree exists before renaming
2. **Name conflict:** The Tauri backend should handle this, but add logging
3. **User-named worktree:** Frontend should only apply if worktree has `isAutoNamed: true`

If `isAutoNamed` tracking is implemented (see 06-ui-integration), add a check:

```typescript
case EventName.WORKTREE_NAME_GENERATED: {
  const { worktreeId, repoId, name } = payload;

  // Only rename auto-named worktrees
  const worktree = await worktreeService.get(repoId, worktreeId);
  if (!worktree?.isAutoNamed) {
    console.log(`[event-bridge] Skipping rename for user-named worktree ${worktreeId}`);
    break;
  }

  try {
    await worktreeService.rename(repoId, worktreeId, name);
    // Also update isAutoNamed to false so future renames are ignored
    await worktreeService.update(repoId, worktreeId, { isAutoNamed: false });
  } catch (error) {
    console.error(`[event-bridge] Failed to rename worktree:`, error);
  }
  break;
}
```

## Verification
1. TypeScript compiles without errors
2. Event is handled when received from agent stdout
3. Worktree rename is called correctly
4. Errors are logged but don't crash the app
5. UI updates to show new name

## Output
- Modified `src/lib/event-bridge.ts`
