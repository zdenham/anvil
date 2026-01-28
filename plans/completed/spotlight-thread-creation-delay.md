# Spotlight Thread Creation Delay Investigation & Fix

## Problem Statement

When creating a thread from the spotlight by pressing Enter, there is a noticeable delay before the thread becomes visible in the main window. This should feel instantaneous.

## Current Flow Analysis

When Enter is pressed in the spotlight:

```
User presses Enter
    ↓
spotlight.activateResult() [spotlight.tsx:626]
    ├─→ [NOT AWAITED] createSimpleThread()
    │   ├─→ loadSettings(slug) [line 254] — 20-50ms
    │   ├─→ showMainWindowWithView() [line 326] — AWAITED
    │   │   └─→ Rust: show_main_window_with_view() [lib.rs:375]
    │   │       ├─→ window.show()
    │   │       ├─→ window.set_focus()
    │   │       └─→ window.emit("set-content-pane-view")
    │   │           └─→ MainWindowLayout receives event [main-window-layout.tsx:81]
    │   │               └─→ contentPanesService.setActivePaneView()
    │   │                   └─→ ThreadContent mounts
    │   │                       └─→ threadService.refreshById() [IF thread not in store]
    │   │
    │   └─→ spawnSimpleAgent() [agent-service.ts:290]
    │       ├─→ ensureShellInitialized() [line 321] — 100-500ms FIRST RUN
    │       ├─→ getRunnerPaths()
    │       ├─→ getShellPath()
    │       ├─→ fs.exists() checks
    │       └─→ Command.create().spawn()
    │
    └─→ hideSpotlight() [line 756] — AWAITED
```

## Identified Bottlenecks

### 1. Shell Initialization Delay (Critical - First Run Only)
**Location:** `src/lib/agent-service.ts:73-114`

On first app run, `ensureShellInitialized()` runs a login shell to capture the user's PATH (for nvm/fnm/volta). This can take **100-500ms**.

**Solution:** Pre-initialize shell environment at app startup instead of lazily on first thread creation.

### 2. Settings Load in Critical Path
**Location:** `src/components/spotlight/spotlight.tsx:254`

`loadSettings(slug)` is called synchronously in `createSimpleThread()` before opening the panel. Adds **20-50ms**.

**Solution:**
- Cache settings in memory after first load
- Or move settings load to happen concurrently with showing the window

### 3. Thread Not in Store on First Render
**Location:** `src/components/content-pane/thread-content.tsx:122-129`

When `ThreadContent` mounts, if the thread isn't in the store, it calls `threadService.refreshById(threadId)` which reads from disk. This causes a brief empty/loading state.

**Solution:** Create thread metadata in the store immediately (optimistic) before spawning the agent.

### 4. Sequential Operations That Could Be Parallel
Several operations in `spawnSimpleAgent()` happen sequentially but could be parallelized:
- `ensureShellInitialized()`
- `getRunnerPaths()`
- `getShellPath()`
- `fs.exists()` checks

### 5. Excessive Logging Overhead
`spawnSimpleAgent()` has extensive debug logging that adds latency in the critical path.

## Recommended Fixes (Priority Order)

### Phase 1: Optimistic UI with Broadcast (Immediate Impact)

1. **Create thread metadata immediately in store AND broadcast to all windows**
   - Before `showMainWindowWithView()`, add the thread to the store with optimistic metadata
   - **Critically: Emit `THREAD_CREATED` event immediately** so other windows receive it via the event bridge
   - ThreadContent will then find the thread immediately without disk read
   - The first user message should be included in the optimistic thread metadata

2. **Show window first, then spawn agent**
   - Reorder operations: show window → spawn agent (not concurrent)
   - User sees the thread pane immediately with the first message visible

**Existing Infrastructure to Leverage:**
- `src/lib/optimistic.ts` - Generic optimistic helper with rollback support
- `src/entities/threads/store.ts` - Has `_applyCreate()` and `_applyOptimistic()` methods
- `src/entities/threads/service.ts:450-464` - Already has `createOptimistic()` method
- `src/lib/event-bridge.ts` - Already broadcasts `THREAD_CREATED` to all windows via Tauri

```typescript
// In createSimpleThread():

// 1. Create optimistic thread metadata immediately WITH first message
const firstMessage: ThreadMessage = {
  role: "user",
  content: [{ type: "text", text: inputValue }],
  timestamp: Date.now(),
};

threadService.createOptimistic({
  id: threadId,
  repoId: settings.id,
  worktreeId,
  status: "pending",
  messages: [firstMessage],
});

// 2. BROADCAST to all windows immediately so other windows see the thread
eventBus.emit(EventName.THREAD_CREATED, { threadId, repoId: settings.id });

// 3. Show window (now ThreadContent will find thread in store)
await showMainWindowWithView({ type: "thread", threadId });

// 4. THEN spawn agent in background (don't block)
spawnSimpleAgent({ ... }).catch(handleError);
```

**Why Broadcast is Critical:**
- The spotlight window may be separate from the main window
- Without broadcast, only the spotlight window's store has the optimistic thread
- The main window would call `threadService.refreshById()` which reads from disk (thread doesn't exist yet)
- Broadcasting ensures ALL windows have the thread in their stores before showing the UI

### Phase 2: Shell Pre-initialization

1. **Pre-initialize shell at app startup**
   - In `src/lib/agent-service.ts`, export an `initializeOnAppStart()` function
   - Call it from the main window's initial load
   - Subsequent thread creations will have shell already initialized

```typescript
// New function in agent-service.ts
export async function warmupAgentEnvironment(): Promise<void> {
  // Pre-warm shell environment in background
  await ensureShellInitialized();
  // Optionally pre-resolve runner paths too
  await getRunnerPaths();
}
```

### Phase 3: Settings Caching

1. **Cache settings by slug**
   - After `loadSettings(slug)` succeeds, cache the result
   - Subsequent calls for same slug return cached value instantly

### Phase 4: Parallel Operations

1. **Parallelize in spawnSimpleAgent()**
```typescript
// Instead of sequential:
const [shellPath, paths] = await Promise.all([
  getShellPath(),
  getRunnerPaths(),
]);
```

## Implementation Order

1. **Phase 1** - Optimistic UI with Broadcast (biggest perceived improvement)
   - Use existing `createOptimistic()` method in thread service (already exists!)
   - **Emit `THREAD_CREATED` event immediately after optimistic creation**
   - Modify spotlight's `createSimpleThread()` to:
     a. Create optimistic thread with first user message
     b. Broadcast event so all windows receive it
     c. Show window
     d. Spawn agent (non-blocking)

2. **Phase 2** - Shell pre-init (fixes first-run delay)
   - Add warmup function
   - Call from main window mount
   - ~1 hour

3. **Phase 3** - Settings cache (minor optimization)
   - Add LRU cache for settings
   - ~30 minutes

4. **Phase 4** - Parallel operations (polish)
   - Refactor spawnSimpleAgent
   - ~1 hour

## Files to Modify

- `src/components/spotlight/spotlight.tsx` - Reorder operations, add optimistic creation + broadcast
- `src/lib/agent-service.ts` - Add warmup function, parallelize operations
- `src/entities/threads/service.ts` - `createOptimistic()` already exists (lines 450-464), may need to add message support
- `src/entities/threads/store.ts` - Already has `_applyCreate()` and `_applyOptimistic()` methods
- `src/entities/threads/listeners.ts` - May need to update to handle optimistic threads gracefully (avoid re-reading from disk when thread is already in store)
- `src/components/main-window/main-window-layout.tsx` - Call warmup on mount
- `src/lib/event-bridge.ts` - Already configured to broadcast `THREAD_CREATED` events

## Success Metrics

- Thread pane visible within **50ms** of Enter press (currently 200-850ms)
- No visible "loading" state for thread content
- First-run and subsequent-run times should be equivalent

## Testing Plan

1. Add timing instrumentation to measure each phase
2. Test first-run vs subsequent-run scenarios
3. Test with slow disk I/O (simulate)
4. Test with multiple rapid thread creations
