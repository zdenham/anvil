# Refresh Repository State After Onboarding

## Problem Statement

After completing onboarding and calling `createFromFolder()` to set up a repository with worktrees:

1. The repository does not appear in the Settings page
2. Task creation fails with "no repository" error
3. The repository exists on disk (visible in anvil-dev directory)

## Root Cause Analysis

### The Real Bug: Missing Event Emission

`createFromFolder()` in `src/entities/repositories/service.ts:310` only updates the local store:

```typescript
useRepoStore.getState()._applyCreate(repo);
```

It **never emits** the `REPOSITORY_CREATED` event.

Meanwhile, the infrastructure for cross-window sync is already in place:

- `event-bridge.ts:42` has `REPOSITORY_CREATED` in `BROADCAST_EVENTS`
- `listeners.ts:11-17` has a listener that calls `refresh()` on this event

But nothing triggers the event!

### Why Hydration Timing Was a Red Herring

The original diagnosis focused on hydration replacing the store after `createFromFolder()`. However:

1. For fresh installs, `bootstrap()` only runs AFTER onboarding completes (App.tsx:24-35)
2. By then, `settings.json` is already on disk
3. `hydrateEntities()` reads from disk - if the file exists, it should be found

The real issue is **multi-window sync**:

- All windows hydrate from disk on startup
- When a repo is added during onboarding, other windows have already hydrated
- Without a `REPOSITORY_CREATED` event, they never learn about the new repo

### Current Flow (Broken)

```
OnboardingFlow.tsx                          Other Windows
─────────────────                          ─────────────
1. User selects repository
2. createFromFolder(path)
   ├─ Writes settings.json to disk
   ├─ Detects worktrees
   └─ Calls _applyCreate(repo) → LOCAL store updated
   └─ ❌ NO EVENT EMITTED
3. onComplete()
                                           Already hydrated, never notified
                                           Store is stale ❌
```

### Fixed Flow

```
OnboardingFlow.tsx                          Other Windows
─────────────────                          ─────────────
1. User selects repository
2. createFromFolder(path)
   ├─ Writes settings.json to disk
   ├─ Detects worktrees
   ├─ Calls _applyCreate(repo) → LOCAL store updated
   └─ ✅ EMITS REPOSITORY_CREATED event
3. onComplete()
                                           Listener receives event
                                           Calls repoService.refresh(name)
                                           Store updated from disk ✅
```

## Solution: Emit REPOSITORY_CREATED Event

### Implementation

#### 1. Add event emission to `createFromFolder()` in `src/entities/repositories/service.ts`

```typescript
import { eventBus } from "../events";
import { EventName } from "@core/types/events.js";

// At the end of createFromFolder(), after _applyCreate():
useRepoStore.getState()._applyCreate(repo);

// Emit event for cross-window sync
eventBus.emit(EventName.REPOSITORY_CREATED, { name: repo.name });

return repo;
```

#### 2. Also add to `create()` method for consistency

The same pattern should apply to the `create()` method (line 171-217):

```typescript
useRepoStore.getState()._applyCreate(repo);
eventBus.emit(EventName.REPOSITORY_CREATED, { name: repo.name });
return repo;
```

#### 3. Verify `delete()` and `update()` emit their events

Check that these methods also emit `REPOSITORY_DELETED` and `REPOSITORY_UPDATED` respectively.

## Files to Modify

| File                                   | Change                                                                        |
| -------------------------------------- | ----------------------------------------------------------------------------- |
| `src/entities/repositories/service.ts` | Add `eventBus.emit(EventName.REPOSITORY_CREATED, ...)` after `_applyCreate()` |

## Testing

1. Fresh install - complete onboarding with a repository
2. Verify repository appears in Settings page immediately
3. Verify task creation works with the selected repository
4. Open a second window before adding a repo, verify it syncs after creation
5. Check logs for `[event-bridge] OUTGOING: mitt "repository:created"` message

## Notes

- The listener already exists and calls `refresh()` - we just need to trigger it
- Echo prevention in event-bridge prevents infinite loops (same window ignores its own broadcasts)
- For the originating window, `_applyCreate()` handles local state; the event is for OTHER windows
