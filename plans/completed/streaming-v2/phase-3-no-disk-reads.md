# Phase 3: No Disk Reads During Streaming

Parent: [readme.md](./readme.md) | Full design: [streaming-architecture-v2.md](../streaming-architecture-v2.md#phase-3-no-disk-reads-during-streaming)

## Goal

Remove disk reads from the hot path (`AGENT_STATE_DELTA` and deprecated `AGENT_STATE` handlers) during streaming. Heartbeat-based staleness recovery in `state-recovery.ts` is preserved as a safety net — it provides independent fault detection and should not be suppressed.

## Dependencies

- **Phase 1** must be complete (action-based emission replaces patches; shared reducer + seq-based gap detection)
- **Phase 2** must be complete (unified store with `ThreadStateMachine` handles gap detection)

## Phases

- [x] Phase 3a: Remove `refreshById()` and `loadThreadState()` from `AGENT_STATE_DELTA` handler, sync usage from ThreadState in-memory
- [x] Phase 3b: Remove deprecated `AGENT_STATE` handler
- [x] Phase 3c: Write tests verifying no disk reads during streaming
- [x] Phase 3d: Run full test suite, verify no regressions

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Files to Modify

| File | Change |
|------|--------|
| `src/entities/threads/listeners.ts` | Remove disk reads from `AGENT_STATE_DELTA`, remove deprecated `AGENT_STATE` handler, add `syncUsageFromState()` helper |
| `src/entities/threads/__tests__/listeners.test.ts` | Add tests for no-disk-reads-during-streaming |

**Not modified:** `src/lib/state-recovery.ts` — heartbeat-based recovery is kept as-is. It provides independent fault detection that's valuable even when deltas are flowing (e.g., agent hangs mid-delta, delta pipeline silently breaks).

---

## Complete Disk-Read Inventory

Every disk read call in `listeners.ts` with exact locations and dispositions:

### In `AGENT_STATE_DELTA` handler (line 138-204)

| Line | Call | Purpose | Disposition |
|------|------|---------|-------------|
| 142 | `threadService.refreshById(threadId)` | Reads `metadata.json` for usage data | **Remove** — usage is in ThreadState (`cumulativeUsage`, `lastCallUsage` fields). Extract from `full` payload or from store's `threadStates[threadId]` after patch apply. |
| 152 | `threadService.refreshById(thread.parentThreadId)` | Cascade parent cost display | **Defer** — move to `AGENT_COMPLETED` handler only. Parent cost display during streaming is not critical. |
| 168 | `threadService.loadThreadState(threadId)` | Full-sync fallback when `previousEventId=null` but no `full` payload | **Remove** — after Phase 0, agent always sends `full` with `previousEventId=null`. Log error + reset chain if somehow hit. |
| 184 | `threadService.loadThreadState(threadId)` | Chain gap recovery | **Replace** — reset `lastAppliedEventId[threadId]` (delete it). Next event with `previousEventId=null` (periodic full from Phase 0) will re-sync within ~1s. |
| 201 | `threadService.loadThreadState(threadId)` | Error recovery in catch block | **Replace** — same as gap: reset chain, wait for next periodic full from agent. |

### In `AGENT_STATE` handler (line 114-135) — DEPRECATED

| Line | Call | Purpose | Disposition |
|------|------|---------|-------------|
| 117 | `threadService.refreshById(threadId)` | Metadata for old protocol | **Remove entire handler** — `AGENT_STATE` is marked deprecated, kept for backwards compat. After Phase 0, all agents use `AGENT_STATE_DELTA`. |
| 121 | `threadService.loadThreadState(threadId)` | Load full state from disk | Same — remove entire handler. |
| 131 | `threadService.refreshById(thread.parentThreadId)` | Cascade parent cost | Same — remove entire handler. |

### In `AGENT_COMPLETED` handler (line 207-233) — KEEP

| Line | Call | Purpose | Disposition |
|------|------|---------|-------------|
| 211 | `threadService.refreshById(threadId)` | Final metadata refresh | **Keep** — completion is the correct time for disk reconciliation. |
| 219 | `threadService.loadThreadState(threadId)` | Final state reconciliation | **Keep** — ensures committed messages match disk. |
| 228 | `threadService.refreshById(thread.parentThreadId)` | Cascade parent cost on completion | **Keep** — deferred from streaming, now runs here. |

### In other handlers (not streaming — NO CHANGES)

| Handler | Line | Call | Disposition |
|---------|------|------|-------------|
| `THREAD_CREATED` | 77 | `refreshById` | **Keep** — one-time on creation |
| `THREAD_UPDATED` | 85 | `refreshById` | **Keep** — infrequent metadata updates |
| `THREAD_STATUS_CHANGED` | 99 | `refreshById` | **Keep** — status transitions |
| `THREAD_NAME_GENERATED` | 252 | `refreshById` | **Keep** — one-time on name gen |

### In `state-recovery.ts` — NO CHANGES

| Line | Call | Purpose | Disposition |
|------|------|---------|-------------|
| 35 | `threadService.loadThreadState(threadId)` in `recoverStateFromDisk()` | Heartbeat staleness recovery | **Keep** — independent safety net. If heartbeats go stale, disk recovery is the right response regardless of delta flow. |
| 68 | `recoverStateFromDisk(threadId)` in `startRecoveryPolling()` | Periodic polling fallback | **Keep** — same reasoning. Heartbeat staleness means something is wrong; disk read is appropriate. |

---

## Phase 3a: Remove disk reads from `AGENT_STATE_DELTA`

### Why `refreshById` exists today

The agent writes usage data to both `state.json` (full ThreadState) and `metadata.json`. The listener calls `refreshById()` to read `metadata.json` from disk on every delta so the sidebar cost display updates. But this data is already in ThreadState:

- `ThreadState.cumulativeUsage` (tokens totals)
- `ThreadState.lastCallUsage` (per-call snapshot)

These fields are patched in via JSON Patch deltas or included in `full` snapshots. After applying the delta to the store, `useThreadStore.getState().threadStates[threadId]` already has the latest usage.

### Code changes

**File: `src/entities/threads/listeners.ts`**

Replace the entire `AGENT_STATE_DELTA` handler (lines 138-204) with:

```ts
// Agent state delta — patch-based state updates with chain gap detection
eventBus.on(EventName.AGENT_STATE_DELTA, ({ id, previousEventId, threadId, patches, full }: EventPayloads[typeof EventName.AGENT_STATE_DELTA]) => {
  try {
    const store = useThreadStore.getState();
    if (store.activeThreadId !== threadId) {
      // Not the active thread — just track chain position, skip state work
      lastAppliedEventId[threadId] = id;
      useStreamingStore.getState().clearStream(threadId);
      return;
    }

    if (previousEventId === null || !lastAppliedEventId[threadId]) {
      // Full sync: first event, process restart, or no base state
      if (full) {
        diskReadStats.recordFullStateRead(threadId);
        store.setThreadState(threadId, full);
        lastAppliedEventId[threadId] = id;
      } else {
        // After Phase 0, agent always sends full with previousEventId=null.
        // If we hit this, the agent is misbehaving — reset chain and wait.
        logger.warn(`[ThreadListener] STATE_DELTA: previousEventId=null but no full payload for ${threadId} — resetting chain, waiting for next full`);
        delete lastAppliedEventId[threadId];
        return;
      }
    } else if (previousEventId === lastAppliedEventId[threadId]) {
      // Chain intact — apply patches
      diskReadStats.recordDeltaApplied(threadId);
      const currentState = store.threadStates[threadId];
      if (currentState && patches.length > 0) {
        const patched = applyPatch(structuredClone(currentState), patches);
        store.setThreadState(threadId, patched.newDocument);
      }
      lastAppliedEventId[threadId] = id;
    } else {
      // Chain broken — gap detected. Reset chain, wait for agent's next periodic full (~1s).
      logger.warn(`[ThreadListener] STATE_DELTA CHAIN GAP for ${threadId}: expected=${lastAppliedEventId[threadId]}, got previousEventId=${previousEventId} — resetting chain`);
      diskReadStats.recordGapTriggeredRead(threadId);
      delete lastAppliedEventId[threadId];
      // Do NOT fall back to disk. Phase 0 guarantees a full snapshot within ~1s.
      return;
    }

    // Sync usage from ThreadState into thread metadata store (for sidebar display)
    syncUsageFromState(threadId, store);

    // Clear streaming content AFTER replacement data is in the store
    useStreamingStore.getState().clearStream(threadId);
  } catch (e) {
    logger.error(`[ThreadListener] Failed to apply state delta for ${threadId}:`, e);
    // On error, reset chain — wait for next periodic full from agent
    logger.warn(`[ThreadListener] STATE_DELTA error for ${threadId}, resetting chain`);
    diskReadStats.recordGapTriggeredRead(threadId);
    delete lastAppliedEventId[threadId];
  }
});
```

Add a new helper function (above `setupThreadListeners`):

```ts
/**
 * Syncs usage fields from ThreadState into thread metadata (in-memory only).
 * Replaces the disk read that refreshById() was doing during streaming.
 * The sidebar cost display reads from thread metadata, so we copy
 * cumulativeUsage and lastCallUsage from the applied ThreadState.
 */
function syncUsageFromState(threadId: string, store: ReturnType<typeof useThreadStore.getState>): void {
  const threadState = store.threadStates[threadId];
  if (!threadState) return;

  const thread = store.threads[threadId];
  if (!thread) return;

  const hasUsageChanged =
    threadState.cumulativeUsage !== thread.cumulativeUsage ||
    threadState.lastCallUsage !== thread.lastCallUsage;

  if (hasUsageChanged) {
    store._applyUpdate(threadId, {
      ...thread,
      cumulativeUsage: threadState.cumulativeUsage,
      lastCallUsage: threadState.lastCallUsage,
      updatedAt: Date.now(),
    });
  }
}
```

### What this removes

- `threadService.refreshById(threadId)` — was on line 142, called on every single AGENT_STATE_DELTA event
- `threadService.refreshById(thread.parentThreadId)` — was on line 152, cascade on every delta
- `threadService.loadThreadState(threadId)` — was on lines 168, 184, 201 (three separate disk reads)
- `diskReadStats.recordMetadataRead(threadId)` — was on line 141, no longer needed

### What this adds

- `syncUsageFromState()` helper that copies usage from ThreadState to thread metadata in-memory
- Chain reset on gap (delete `lastAppliedEventId[threadId]`) instead of disk fallback

---

## Phase 3b: Remove deprecated `AGENT_STATE` handler

### Code changes

**File: `src/entities/threads/listeners.ts`**

Delete the entire `AGENT_STATE` handler block (lines 112-135):

```ts
// DELETE THIS ENTIRE BLOCK:
// Agent state updates — DEPRECATED: kept for backwards compat during migration.
// New agents send "state_event" (AGENT_STATE_DELTA) with patch-based diffs.
eventBus.on(EventName.AGENT_STATE, async ({ threadId }: EventPayloads[typeof EventName.AGENT_STATE]) => {
  // ... all of lines 114-135
});
```

This handler contains two disk reads (`refreshById` on line 117, `loadThreadState` on line 121) plus a parent cascade (`refreshById` on line 131). After Phase 0, all agents emit `AGENT_STATE_DELTA` exclusively.

If backwards compat is still needed during rollout, keep the handler but replace disk reads with a chain reset + log warning. In that case:

```ts
// Agent state updates — DEPRECATED: triggers full sync from next delta
eventBus.on(EventName.AGENT_STATE, ({ threadId }: EventPayloads[typeof EventName.AGENT_STATE]) => {
  logger.warn(`[ThreadListener] Received deprecated AGENT_STATE for ${threadId} — resetting chain for delta re-sync`);
  delete lastAppliedEventId[threadId];
  useStreamingStore.getState().clearStream(threadId);
});
```

---

## Phase 3c: Tests

### Test: no disk reads during streaming sequence

**File: `src/entities/threads/__tests__/listeners.test.ts`**

Add a new describe block:

```ts
describe("no disk reads during streaming (Phase 3)", () => {
  it("AGENT_STATE_DELTA does not call refreshById or loadThreadState", async () => {
    const threadId = "streaming-thread";
    useThreadStore.getState().setActiveThread(threadId);

    // Simulate a full sync delta (first event)
    triggerEvent(EventName.AGENT_STATE_DELTA, {
      id: "evt-1",
      previousEventId: null,
      threadId,
      patches: [],
      full: {
        messages: [],
        fileChanges: [],
        workingDirectory: "/tmp",
        status: "running",
        timestamp: Date.now(),
        toolStates: {},
      },
    });

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(threadService.refreshById).not.toHaveBeenCalled();
    expect(threadService.loadThreadState).not.toHaveBeenCalled();
  });

  it("AGENT_STATE_DELTA chain gap does not fall back to disk", async () => {
    const threadId = "gap-thread";
    useThreadStore.getState().setActiveThread(threadId);

    // Apply first event to establish chain
    triggerEvent(EventName.AGENT_STATE_DELTA, {
      id: "evt-1",
      previousEventId: null,
      threadId,
      patches: [],
      full: {
        messages: [],
        fileChanges: [],
        workingDirectory: "/tmp",
        status: "running",
        timestamp: Date.now(),
        toolStates: {},
      },
    });

    await new Promise((resolve) => setTimeout(resolve, 0));

    // Now send event with wrong previousEventId (gap)
    triggerEvent(EventName.AGENT_STATE_DELTA, {
      id: "evt-3",
      previousEventId: "evt-2", // gap: we applied evt-1, not evt-2
      threadId,
      patches: [],
    });

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(threadService.loadThreadState).not.toHaveBeenCalled();
    expect(threadService.refreshById).not.toHaveBeenCalled();
  });

  it("AGENT_COMPLETED still reads from disk", async () => {
    const threadId = "completed-thread";
    useThreadStore.getState().setActiveThread(threadId);

    triggerEvent(EventName.AGENT_COMPLETED, { threadId, exitCode: 0 });

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(threadService.refreshById).toHaveBeenCalledWith(threadId);
    expect(threadService.loadThreadState).toHaveBeenCalledWith(threadId);
  });

  it("syncs usage from ThreadState into metadata store", async () => {
    const threadId = "usage-sync-thread";
    const thread = createThreadMetadata({ id: threadId });
    useThreadStore.getState()._applyCreate(thread);
    useThreadStore.getState().setActiveThread(threadId);

    const fullState = {
      messages: [],
      fileChanges: [],
      workingDirectory: "/tmp",
      status: "running" as const,
      timestamp: Date.now(),
      toolStates: {},
      cumulativeUsage: {
        inputTokens: 1000,
        outputTokens: 500,
        cacheCreationTokens: 0,
        cacheReadTokens: 200,
      },
      lastCallUsage: {
        inputTokens: 100,
        outputTokens: 50,
        cacheCreationTokens: 0,
        cacheReadTokens: 20,
      },
    };

    triggerEvent(EventName.AGENT_STATE_DELTA, {
      id: "evt-1",
      previousEventId: null,
      threadId,
      patches: [],
      full: fullState,
    });

    await new Promise((resolve) => setTimeout(resolve, 0));

    // Usage should be synced to thread metadata (not via disk read)
    const updatedThread = useThreadStore.getState().threads[threadId];
    expect(updatedThread.cumulativeUsage).toEqual(fullState.cumulativeUsage);
    expect(updatedThread.lastCallUsage).toEqual(fullState.lastCallUsage);
  });
});
```

---

## Gap Recovery Flow (No Disk)

After these changes, gap recovery works purely via events:

```
State delta chain gap detected (previousEventId mismatch):
  1. Delete lastAppliedEventId[threadId] (reset chain tracking)
  2. Return early — do NOT clear UI state (user sees last known good state)
  3. Agent's periodic full snapshot (Phase 0, every ~20 deltas) arrives
     with previousEventId=null and full payload
  4. Full snapshot handler applies complete state, resumes chain

State delta error (applyPatch throws):
  1. Same as gap — delete lastAppliedEventId[threadId], reset chain
  2. Wait for next periodic full from agent

Full-sync without full payload (previousEventId=null but no full):
  1. Log warning (indicates pre-Phase-0 agent or bug)
  2. Reset chain — do NOT read from disk
  3. Wait for next emission with full payload

AGENT_COMPLETED:
  1. refreshById(threadId) — final metadata reconciliation
  2. loadThreadState(threadId) — final state reconciliation from disk
  3. clearStream(threadId) — clean up ephemeral streaming state
  4. refreshById(parentThreadId) — cascade parent cost display
  This is the ONLY point where disk reads happen after streaming starts.

Heartbeat staleness (state-recovery.ts) — PRESERVED:
  1. If heartbeat goes stale, recoverStateFromDisk() fires as before
  2. Polling continues every 3s until heartbeat resumes or thread completes
  3. This is an independent safety net — catches agent hangs, delta pipeline
     failures, and other cases where event chain alone isn't sufficient
```

---

## Summary of Disk Reads Removed

| Call site | Calls per agent run | Replaced by |
|-----------|-------------------|-------------|
| `refreshById` in AGENT_STATE_DELTA (line 142) | Once per delta (~100s-1000s) | `syncUsageFromState()` — in-memory copy |
| `refreshById` parent cascade in AGENT_STATE_DELTA (line 152) | Once per delta | Deferred to AGENT_COMPLETED |
| `loadThreadState` full-sync fallback (line 168) | Rare | Chain reset, wait for periodic full |
| `loadThreadState` chain gap (line 184) | Occasional | Chain reset, wait for periodic full |
| `loadThreadState` error fallback (line 201) | Rare | Chain reset, wait for periodic full |
| `refreshById` in AGENT_STATE (line 117) | Deprecated handler | Handler removed |
| `loadThreadState` in AGENT_STATE (line 121) | Deprecated handler | Handler removed |
| `refreshById` parent in AGENT_STATE (line 131) | Deprecated handler | Handler removed |

## Disk Reads Kept

| Call site | When | Why |
|-----------|------|-----|
| `refreshById` in AGENT_COMPLETED (line 211) | Once per run | Final metadata reconciliation |
| `loadThreadState` in AGENT_COMPLETED (line 219) | Once per run | Final state reconciliation |
| `refreshById` parent in AGENT_COMPLETED (line 228) | Once per run | Cascade cost display |
| `refreshById` in THREAD_CREATED (line 77) | Once per thread | Creation confirmation |
| `refreshById` in THREAD_UPDATED (line 85) | Infrequent | Metadata updates |
| `refreshById` in THREAD_STATUS_CHANGED (line 99) | Few per run | Status transitions |
| `refreshById` in THREAD_NAME_GENERATED (line 252) | Once per thread | Name display |
| `recoverStateFromDisk` in state-recovery.ts (line 35) | When heartbeat stale | Independent safety net |
| `recoverStateFromDisk` in state-recovery.ts (line 68) | Every 3s when stale | Polling fallback |

## Verification

- `pnpm test` passes in both `src/` and `agents/` packages
- Manual: start an agent, verify sidebar cost updates without `refreshById` log lines during AGENT_STATE_DELTA events
- Manual: simulate gap (disconnect hub briefly), verify UI recovers from next periodic full without disk read
- `diskReadStats` dashboard: `metadataReads` and `fullStateReads` should be 0 during streaming delta handling, non-zero only at completion
