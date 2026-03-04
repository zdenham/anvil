# Diagnose Disk Refresh Frequency

Investigate why streaming and tool rendering feel less smooth after implementing event-driven state sync, by instrumenting all disk-refresh code paths.

## Phases

- [x] Add logging to gap-detection and disk-fallback paths
- [x] Add metrics counters for disk reads during streaming

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Current State: What's Logged vs Not

### Logged (existing)
| Trigger | Log | Location |
|---|---|---|
| Pipeline sequence gap (socket-level) | `[agent-service] SEQ GAP: expected X, got Y` | `agent-service.ts:107` |
| Heartbeat staleness recovery | `[state-recovery] Recovering state from disk` | `state-recovery.ts:32` |
| Heartbeat status transitions | `[heartbeat] Thread X degraded/stale/recovered` | `heartbeat-store.ts:207-219` |

### NOT Logged (blind spots)
| Trigger | What happens silently | Location |
|---|---|---|
| **State delta chain gap** | `loadThreadState()` called (full state.json disk read) | `listeners.ts:174-176` |
| **State delta chain bootstrap** (no base state) | `loadThreadState()` fallback when `full` missing | `listeners.ts:161-163` |
| **State delta error catch** | `loadThreadState()` disk fallback on any error | `listeners.ts:189-191` |
| **Stream delta chain gap** | Stream cleared, chain state deleted | `streaming-store.ts:46-51` |
| **Stream delta bootstrap** (no chain, no full) | Returns `state` unchanged (silent no-op) | `streaming-store.ts:42-43` |

## Root Cause Hypotheses for Smoothness Regression

### 1. Every `AGENT_STATE_DELTA` triggers a metadata disk read (HIGH LIKELIHOOD)

`listeners.ts:140` — **every single state delta event** calls `threadService.refreshById(threadId)`, which does:
1. `findThreadPath()` → checks disk for file existence (cached after first hit)
2. `appData.readJson()` → reads + parses `metadata.json` from disk
3. `ThreadMetadataSchema.safeParse()` → Zod validation
4. `_applyUpdate()` → zustand store update → re-render

During active streaming, the agent emits a state delta on every `emitState()` call — which happens on **every tool start, tool complete, message append, and usage update**. That's potentially dozens of metadata disk reads per second during tool-heavy operations.

This was previously the same (AGENT_STATE also called refreshById), so this alone isn't a regression. But combined with the new delta processing overhead, it adds up.

### 2. Frequent chain gaps causing full state.json reads (UNKNOWN — NOT INSTRUMENTED)

If `previousEventId` mismatches happen frequently, each gap triggers a full `loadThreadState()` — reading, parsing, and Zod-validating the entire `state.json` (which grows with every message). There is **zero logging** when this happens, so we have no idea how often it occurs.

Possible causes of frequent gaps:
- Reconnect queue collapsing events and resetting `previousEventId`
- Race between socket events and Tauri event bridge delivery
- Events arriving out of order through the broadcast pipeline

### 3. Legacy `AGENT_STATE` still fires alongside `AGENT_STATE_DELTA` (POSSIBLE)

The agent-side `sendState()` method still exists in `hub/client.ts:191` and is NOT removed. If any code path still calls `sendState()` instead of `sendStateEvent()`, both events fire for the same state change. The AGENT_STATE handler (`listeners.ts:113`) does a **full loadThreadState() on every call** — no delta optimization at all.

The `output.ts` code correctly uses `sendStateEvent()`, but `sendState()` is still exported and available. Need to verify nothing else calls it.

### 4. `structuredClone` + `applyPatch` overhead (LOWER LIKELIHOOD)

`listeners.ts:169` — `structuredClone(currentState)` is called on every intact chain patch application. For large state objects, this deep clone could be expensive. But this only matters if the chain is intact (no gap), so it's an "either-or" with hypothesis #2.

## Instrumentation Plan

### Phase 1: Add logging to gap-detection paths

Add `logger.warn()` calls to every silent disk-fallback path:

**`listeners.ts` — AGENT_STATE_DELTA handler:**
```ts
// Line ~155: Full sync (no base state)
logger.warn(`[ThreadListener] STATE_DELTA full-sync: no base state for ${threadId}, previousEventId=${previousEventId}`);

// Line ~162: Full missing fallback
logger.warn(`[ThreadListener] STATE_DELTA full-sync fallback: previousEventId=null but no full payload for ${threadId}`);

// Line ~174: Chain gap detected
logger.warn(`[ThreadListener] STATE_DELTA CHAIN GAP for ${threadId}: expected=${lastAppliedEventId[threadId]}, got previousEventId=${previousEventId} — falling back to disk`);

// Line ~189: Error fallback
logger.warn(`[ThreadListener] STATE_DELTA error fallback for ${threadId}, reading from disk`);
```

**`streaming-store.ts` — applyDelta:**
```ts
// Line ~46: Stream chain gap
console.warn(`[streaming-store] STREAM_DELTA CHAIN GAP for ${threadId}: expected=${lastStreamEventId[threadId]}, got previousEventId=${previousEventId} — clearing stream`);
```

### Phase 2: Add counters

Add a simple counter store (or reuse heartbeat store's gapStats) to track per-thread:
- `diskReads.metadata` — count of `refreshById` calls
- `diskReads.fullState` — count of `loadThreadState` calls
- `diskReads.gapTriggered` — subset of fullState that were gap-triggered
- `deltaApplied` — count of successful patch applications (no disk read)

This gives a ratio: if `gapTriggered / totalDeltas` is high, the event chain is broken frequently and deltas aren't helping.

## Quick Check (No Code Changes)

Before implementing, you can get partial signal by:
1. Enabling `localStorage.setItem('debug:events', 'true')` — turns on verbose event bridge logging
2. Watching console for `[agent-service] SEQ GAP` messages — these indicate socket-level gaps (which often precede chain gaps)
3. Checking heartbeat store's `gapStats` in React DevTools — shows cumulative gap counts

If you see frequent SEQ GAPs, the event chain will be broken just as often (they share the same transport). If you see zero SEQ GAPs, the chain gaps are caused by something else (event ordering, race conditions).
