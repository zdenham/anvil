# Thread Store Consolidation Plan

## Problem Statement

The current architecture has **two separate thread stores**:

1. `useThreadStore` - holds `{ [threadId]: ThreadMetadata }` from `metadata.json`
2. `useThreadUIStore` - holds **global singleton** state for "the active thread" from `state.json`

This causes the bug: when switching threads, the old thread's state lingers in the global `useThreadUIStore` because:
- It's not scoped per thread
- `refreshThreadState()` returns early without resetting when `state.json` doesn't exist yet
- UI displays stale messages from the previous thread

## Proposed Architecture

**Single store with shape:**

```typescript
interface ThreadStoreState {
  // All thread metadata (always in memory, lightweight)
  threads: Record<string, ThreadMetadata>;

  // Currently active thread
  activeThreadId: string | null;

  // Lazily-loaded states keyed by threadId
  threadStates: Record<string, ThreadState>;

  // Loading state for the active thread
  activeThreadLoading: boolean;

  // Error state keyed by threadId (for load failures)
  threadErrors: Record<string, string>;
}
```

**Key principle:** Disk is truth. State is loaded from disk when `activeThreadId` changes and stored in `threadStates[threadId]`. The active thread's state is derived: `threadStates[activeThreadId]`.

## Why Two Levels (Metadata vs State)?

The split is intentional because of **data size**:

| File | Data | Size | Load Strategy |
|------|------|------|---------------|
| `metadata.json` | id, taskId, agentType, status, turns, git | ~1-2 KB | Load all at hydration |
| `state.json` | messages, fileChanges, toolStates | **10 KB - 10 MB+** | Load on-demand |

A thread with 50+ turns can have megabytes of message history. Loading all thread states at startup would be prohibitively slow.

## Implementation Plan

### Step 1: Add `activeThreadId` to Thread Store

Modify `src/entities/threads/store.ts`:

```typescript
interface ThreadStoreState {
  threads: Record<string, ThreadMetadata>;
  activeThreadId: string | null;
  threadStates: Record<string, ThreadState>;
  activeThreadLoading: boolean;
  threadErrors: Record<string, string>;
  _hydrated: boolean;
}

interface ThreadStoreActions {
  // Existing
  hydrate: (threads: Record<string, ThreadMetadata>) => void;
  getThread: (id: string) => ThreadMetadata | undefined;
  // ... existing methods

  // New
  setActiveThread: (threadId: string | null) => void;
  setThreadState: (threadId: string, state: ThreadState | null) => void;
  setActiveThreadLoading: (loading: boolean) => void;
  setThreadError: (threadId: string, error: string | null) => void;

  // Derived getter (or use selector)
  getActiveThreadState: () => ThreadState | undefined;
}
```

**Note:** `getActiveThreadState()` is just `threadStates[activeThreadId]` - no separate `setActiveThreadState` needed.

### Step 2: Update Thread Service

Modify `src/entities/threads/service.ts`:

```typescript
// Rename refreshThreadState → loadThreadState
async loadThreadState(threadId: string): Promise<void> {
  const store = useThreadStore.getState();
  store.setActiveThreadLoading(true);
  store.setThreadError(threadId, null); // Clear any previous error

  try {
    const thread = this.get(threadId);
    if (!thread) {
      logger.warn(`Thread ${threadId} not found`);
      return;
    }

    const statePath = await this.getStatePath(threadId);
    if (!statePath) return;

    const stateJson = await persistence.readJson<ThreadState>(statePath);
    if (!stateJson) {
      // New thread - no state yet, that's OK
      logger.debug(`No state.json for ${threadId} yet`);
      return;
    }

    // Store state keyed by threadId - naturally handles race conditions
    store.setThreadState(threadId, stateJson);
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    logger.error(`Failed to load thread state for ${threadId}:`, err);
    store.setThreadError(threadId, errorMessage);
  } finally {
    // Only clear loading if we're still the active thread (handles race condition)
    if (useThreadStore.getState().activeThreadId === threadId) {
      store.setActiveThreadLoading(false);
    }
  }
}

// Called when workspace activates a thread
setActiveThread(threadId: string): void {
  const store = useThreadStore.getState();
  store.setActiveThread(threadId);
  this.loadThreadState(threadId);
}
```

### Step 3: Update Event Listeners

Modify `src/entities/threads/listeners.ts`:

```typescript
// AGENT_STATE now only updates if it's the active thread
eventBus.on(EventName.AGENT_STATE, async ({ threadId }) => {
  const store = useThreadStore.getState();
  if (store.activeThreadId === threadId) {
    await threadService.loadThreadState(threadId);
  }
});

// AGENT_COMPLETED also guards on active thread for state refresh
eventBus.on(EventName.AGENT_COMPLETED, async ({ threadId }) => {
  try {
    const store = useThreadStore.getState();
    // Always refresh metadata (lightweight)
    await threadService.refreshById(threadId);
    // Only refresh state if this is the active thread
    if (store.activeThreadId === threadId) {
      await threadService.loadThreadState(threadId);
    }
  } catch (e) {
    logger.error(`[ThreadListener] Failed to refresh completed thread ${threadId}:`, e);
  }
});
```

### Step 4: Update TaskWorkspace

Modify `src/components/workspace/task-workspace.tsx`:

```typescript
// Stable empty references to avoid re-renders from ?? creating new objects
const EMPTY_MESSAGES: MessageParam[] = [];
const EMPTY_FILE_CHANGES = new Map<string, FileChange>();
const EMPTY_TOOL_STATES: Record<string, ToolExecutionState> = {};

// Before (using global useThreadUIStore)
const { threadId: uiThreadId, messages, fileChanges, toolStates, status, metadata } = useThreadUIStore();

// After (derived from consolidated store)
const activeThreadId = useThreadStore(s => s.activeThreadId);
const activeState = useThreadStore(s =>
  s.activeThreadId ? s.threadStates[s.activeThreadId] : undefined
);
const activeMetadata = useThreadStore(s =>
  s.activeThreadId ? s.threads[s.activeThreadId] : undefined
);
const isLoading = useThreadStore(s => s.activeThreadLoading);
const loadError = useThreadStore(s =>
  s.activeThreadId ? s.threadErrors[s.activeThreadId] : undefined
);

// Messages - direct from state
const messages = activeState?.messages ?? EMPTY_MESSAGES;

// FileChanges - convert from array (disk format) to Map (UI format)
const fileChanges = useMemo(() => {
  if (!activeState?.fileChanges?.length) return EMPTY_FILE_CHANGES;
  const map = new Map<string, FileChange>();
  for (const change of activeState.fileChanges) {
    map.set(change.path, change);
  }
  return map;
}, [activeState?.fileChanges]);

// Tool states - direct from state
const toolStates = activeState?.toolStates ?? EMPTY_TOOL_STATES;

// Status - map "complete" (agent format) to "completed" (UI format)
const status = activeState?.status === "complete" ? "completed" : activeState?.status ?? "idle";

// Working directory - from metadata (not state)
const workingDirectory = activeMetadata?.workingDirectory ?? "";
```

**Key points:**
- `fileChanges`: `ThreadState` stores as `FileChange[]` (array), UI needs `Map<string, FileChange>`. Convert in a `useMemo` to avoid creating new Map on every render.
- `status`: Agent emits `"complete"`, UI expects `"completed"`. Map in the selector.
- `workingDirectory`: Comes from `ThreadMetadata` (always loaded), not `ThreadState` (lazy loaded). Use `threads[activeThreadId]` not `threadStates[activeThreadId]`.

### Step 5: Update TaskWorkspace Thread Loading

The current code in `TaskWorkspace` calls `threadService.refreshThreadState(activeThreadId)` in a `useEffect`. Replace this with `setActiveThread`:

```typescript
// Before (in TaskWorkspace)
useEffect(() => {
  if (activeThreadId) {
    threadService.refreshThreadState(activeThreadId);
  }
}, [activeThreadId]);

// After
useEffect(() => {
  if (activeThreadId) {
    threadService.setActiveThread(activeThreadId);
  }
}, [activeThreadId]);
```

This ensures the consolidated store's `activeThreadId` is set before loading state, enabling proper race condition handling.

### Step 6: Delete useThreadUIStore

Remove the entire `useThreadUIStore` from `store.ts` after migration is complete.

**Items to remove:**
- `ThreadUIState` interface
- `ThreadUIActions` interface
- `initialUIState` constant
- `useThreadUIStore` store
- `selectMessages`, `selectFileChanges`, `selectStatus`, `selectIsStreaming` selectors
- Streaming helper methods that are now obsolete with disk-first architecture:
  - `appendMessage()` - no longer needed, full state is read from disk on each `AGENT_STATE` event
  - `setFileChange()` - no longer needed, same reason
  - `setStatus()` - status is derived from `threadStates[activeThreadId]?.status`
  - `reset()` - clearing happens naturally when `activeThreadId` changes and new state is loaded

## Complexity & Risks

### 1. Streaming Performance

**Risk:** During agent execution, `AGENT_STATE` events fire rapidly (every tool call, every message chunk). With the new architecture, each event triggers `loadThreadState()` which reads from disk.

**Mitigation:** Already in place - Node writes to disk, events just signal "disk changed". No additional reads needed beyond current behavior.

**Alternative:** If disk reads prove too slow, add debouncing:
```typescript
const debouncedLoad = debounce(loadThreadState, 50);
```

### 2. React Re-renders

**Risk:** With all thread state in one store, any update could trigger widespread re-renders.

**Mitigation:** Use Zustand's selective subscriptions:
```typescript
// Only re-render when active thread's messages change
const messages = useThreadStore(s => {
  const activeId = s.activeThreadId;
  return activeId ? s.threadStates[activeId]?.messages ?? [] : [];
});
```

### 3. Race Conditions

**Risk:** User switches threads rapidly; old thread's state arrives after new thread is activated.

**Mitigation:** Naturally handled by keying state by `threadId`:
```typescript
setThreadState: (threadId, state) => {
  // State goes to the correct slot regardless of timing
  // Active thread state is derived from threadStates[activeThreadId]
  set(prev => {
    if (state) {
      return { threadStates: { ...prev.threadStates, [threadId]: state } };
    }
    // Remove thread state without lodash omit
    const { [threadId]: _, ...rest } = prev.threadStates;
    return { threadStates: rest };
  });
},

setThreadError: (threadId, error) => {
  set(prev => {
    if (error) {
      return { threadErrors: { ...prev.threadErrors, [threadId]: error } };
    }
    const { [threadId]: _, ...rest } = prev.threadErrors;
    return { threadErrors: rest };
  });
}
```

Since we store by `threadId` and derive the active state via `threadStates[activeThreadId]`, late-arriving updates for old threads simply go to their correct slot and don't affect what's displayed.

### 4. Initial Load (No state.json)

**Risk:** Brand new thread has no `state.json` yet.

**Current bug:** Old architecture shows previous thread's messages.
**New behavior:** Shows empty state (correct!).

### 5. Multiple Windows

**Risk:** If multiple task panels exist, they share the same store.

**Assessment:** Current architecture has same issue - `useThreadUIStore` is global. The consolidated store doesn't make this worse. Future work could scope stores per window if needed.

## Files to Modify

| File | Changes |
|------|---------|
| `src/entities/threads/store.ts` | Add activeThread fields, threadErrors, remove `useThreadUIStore` and all its types/selectors |
| `src/entities/threads/service.ts` | Add `setActiveThread`, `loadThreadState`; remove `refreshThreadState` |
| `src/entities/threads/listeners.ts` | Guard AGENT_STATE and AGENT_COMPLETED on activeThreadId |
| `src/entities/threads/index.ts` | Remove `useThreadUIStore` export, update any re-exported types |
| `src/components/workspace/task-workspace.tsx` | Use consolidated store selectors, add fileChanges array→Map conversion |
| `src/components/workspace/threads-list.tsx` | Update any useThreadUIStore usage (verify if any) |
| `src/components/workspace/action-panel.tsx` | Update any useThreadUIStore usage (verify if any) |

**No changes needed:**
| `src/hooks/use-action-state.ts` | Only uses `useThreadStore.threads[threadId]` for metadata - unaffected |

## Migration Strategy

1. **Add new fields** to `useThreadStore` alongside existing code
2. **Implement new service methods** that use new fields
3. **Update consumers one by one** to use new store shape
4. **Delete `useThreadUIStore`** once all consumers migrated
5. **Clean up** - remove dead code paths

This allows incremental migration without breaking the app.

## Alternative Considered: Full State Caching

We could cache ALL thread states in memory:

```typescript
threads: Record<string, ThreadMetadata & { state?: ThreadState }>
```

**Rejected because:**
- Memory bloat with many threads
- Stale cache complexity (when does cached state expire?)
- No clear benefit over lazy loading

## Success Criteria

1. Switching tasks/threads shows correct conversation immediately
2. No stale messages from previous thread
3. Empty state shown correctly for new threads
4. Streaming updates work during agent execution
5. Performance acceptable (no perceptible lag on thread switch)
6. Rapid thread switching doesn't cause loading state flicker or incorrect states
7. Thread load errors are displayed to user (not silent failures)
