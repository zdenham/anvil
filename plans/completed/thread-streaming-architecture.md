# Thread Streaming Architecture Overview

## The Problem

The streaming experience has degraded due to multiple interacting subsystems that are hard to test in isolation. Layout jank, scroll fights, and content flashes arise from timing races between these systems. This document maps the full data flow and identifies simplification opportunities.

---

## Architecture Map

### Data Flow (End-to-End)

```
Claude SDK stream events
    │
    ▼
StreamAccumulator (agents/src/lib/stream-accumulator.ts)
    │  Accumulates text/thinking deltas
    │  Throttles to 50ms intervals
    │  Emits append-only deltas via hub socket
    │
    ▼
Hub Socket (Rust Tauri ↔ Node IPC)
    │
    ├──→ STREAM_DELTA event ──→ streaming-store.ts (ephemeral blocks)
    │                               │
    │                               ▼
    │                          StreamingContent → TrickleBlock → useTrickleText
    │                          (character-by-character reveal with rAF)
    │
    └──→ AGENT_STATE_DELTA event ──→ listeners.ts (persisted state)
            │  Carries JSON Patch diffs (fast-json-patch)
            │  Event chain: id + previousEventId for gap detection
            │
            ├─ Chain intact → applyPatch() to threadStates in store
            ├─ Chain broken → full disk read fallback
            └─ After apply → clearStream(threadId) kills ephemeral content
```

### The Two Content Paths

Content appears in the UI through two parallel paths that race against each other:

1. **Ephemeral path** (fast, lossy): `STREAM_DELTA → streaming-store → StreamingContent → TrickleBlock`
   - Shows text as it arrives, character-by-character
   - Lives in `useStreamingStore.activeStreams[threadId]`
   - Cleared when persisted state arrives

2. **Persisted path** (slow, authoritative): `AGENT_STATE_DELTA → listeners.ts → threadStore.threadStates[threadId]`
   - Agent writes `state.json` to disk FIRST, then emits delta event
   - Frontend applies patch or reads from disk
   - After state is in store, calls `clearStream()` to remove ephemeral content

**The handoff between these paths is the primary source of jank.** When persisted state arrives and streaming content is cleared, if heights change or content rerenders, the virtualizer recalculates and the scroll position can jump.

---

## Component Breakdown

### 1. VirtualList Engine (`src/lib/virtual-list.ts`)

Pure-math engine, no DOM access. Manages:
- Per-item heights in `_heights[]` with prefix-sum `_offsets[]` for O(1) lookups
- Binary search for visible items in O(log N)
- Subscriber notification on state changes

**Key design choice:** The engine is framework-agnostic and never touches the DOM. All DOM interaction is in the React adapter (`use-virtual-list.ts`).

### 2. React Adapter (`src/hooks/use-virtual-list.ts`)

Wires VirtualList to React via `useSyncExternalStore`. Manages:

- **ResizeObserver** (shared, single instance): Monitors all virtual items with 80ms trailing-edge throttle. Batches height changes into `list.setItemHeights()`.

- **Sticky scroll** (intent-based):
  - Engaged by default (`sticky: true`)
  - Disengages on wheel-up (deltaY < 0) or scrollbar pointerdown
  - Re-engages when scroll gap ≤ 20px from bottom
  - State tracked via ref + useState for both sync and async access

- **Unified auto-scroll** (rAF-deduplicated):
  - `followOutput`: fires on height changes (streaming content growing)
  - `followCountChange`: fires on item count increase (new blocks appearing)
  - Single `requestAnimationFrame` with pending behavior ref prevents competing scroll targets
  - Only scrolls if gap > 1px from bottom

### 3. MessageList (`src/components/thread/message-list.tsx`)

Integration point. Key behaviors:

- **Virtual count = turns.length + 1**: Always reserves a trailing slot for streaming content. This avoids N→N+1→N count flicker when streaming starts/stops.
- `followOutput` returns `"auto"` (instant) when streaming + at bottom
- `followCountChange` returns `"smooth"` for new blocks
- Streaming slot shows `StreamingContent` or `WorkingIndicator`

### 4. StreamAccumulator (`agents/src/lib/stream-accumulator.ts`)

Agent-side. Accumulates SDK `content_block_start` / `content_block_delta` events:
- Groups by block index and type (text/thinking)
- 50ms throttled flush
- First emit: full blocks with `previousEventId: null`
- Subsequent emits: append-only deltas with chain linking
- `flush()` on `message_stop`, `reset()` between turns

### 5. Streaming Store (`src/stores/streaming-store.ts`)

Zustand store for ephemeral streaming blocks:
- `applyDelta()`: applies append-only deltas with chain gap detection
- On gap: clears stream, waits for next full sync
- `clearStream()`: removes all ephemeral content for a thread
- Separate `lastStreamEventId` tracker per thread (module-level, not in store)

### 6. Trickle Text (`src/hooks/use-trickle-text.ts`)

Character reveal animation:
- Duration = `min(750ms, charsRemaining * 16ms)`
- Linear interpolation via rAF loop
- `findSafeBoundary()`: prevents cutting mid-markdown (code fences, bold, links, etc.)
- Snaps to full content when `isStreaming` goes false

### 7. State Listeners (`src/entities/threads/listeners.ts`)

Central event handler. For `AGENT_STATE_DELTA`:
1. Always refresh metadata (disk read)
2. If active thread:
   - Chain intact → `applyPatch(structuredClone(currentState), patches)`
   - Chain broken → full disk read fallback
   - After either → `clearStream(threadId)`
3. If inactive thread: just track chain position, clear stream

### 8. Agent Output (`agents/src/output.ts`)

Agent-side state emission:
1. `writeStateToDisk()` — **synchronous write** via `writeFileSync` or ThreadWriter
2. Compute JSON Patch diff against `previousEmittedState`
3. Emit via hub socket with chain linking
4. First emit sends full state, subsequent emits send patches only

### 9. State Recovery (`src/lib/state-recovery.ts`)

Fallback for broken pipelines:
- Heartbeat monitoring detects stale threads
- Immediate disk recovery + 3s polling interval
- Stops when heartbeat resumes or agent completes

---

## Known Jank Sources

### A. Ephemeral → Persisted Handoff Flash

**What happens:** When `AGENT_STATE_DELTA` arrives and `clearStream()` fires, the streaming content disappears. The persisted content may render at a different height, causing a layout shift. During the React render gap, the user may see a brief flash of content disappearing and reappearing.

**Why it's hard:** The two content paths have different rendering pipelines (TrickleBlock vs AssistantMessage), different heights, and the swap happens mid-scroll.

### B. Metadata Refresh on Every Delta

Every `AGENT_STATE_DELTA` triggers `threadService.refreshById(threadId)` — a disk read for metadata. During fast streaming (many deltas/second), this creates unnecessary I/O churn. The metadata is needed for token usage display but doesn't need per-delta freshness.

### C. ResizeObserver Throttle vs Scroll Racing

The 80ms ResizeObserver throttle means height updates are batched. During fast streaming, content grows between batches, and the auto-scroll target (`el.scrollHeight`) may not reflect the latest heights. This creates micro-jumps as the scroll catches up.

### D. structuredClone on Every Patch

`applyPatch(structuredClone(currentState), patches)` deep-clones the entire thread state on every delta. For long threads with many messages/tool states, this is expensive and can cause frame drops.

### E. Dual Event Chains

The streaming store and state listener maintain separate event chains (`lastStreamEventId` vs `lastAppliedEventId`). A gap in one doesn't necessarily mean a gap in the other, but both trigger disk reads independently.

### F. clearStream After Async Operations

In `listeners.ts`, `clearStream()` is called after `await threadService.loadThreadState()`. Between the await and the clear, both ephemeral and persisted content may be visible simultaneously, causing doubled content or layout jumps.

---

## Suggestions for Simplification

### 1. Unify the Two Content Paths

Instead of two separate rendering paths (StreamingContent vs AssistantMessage), consider a single message component that can accept either ephemeral streaming data or persisted state. The key insight: both ultimately produce the same content blocks (text + thinking). A unified renderer would eliminate the handoff flash entirely.

### 2. Throttle Metadata Refreshes

Debounce `threadService.refreshById()` calls during streaming. Metadata updates (token usage) don't need per-delta precision — a 1-2s trailing debounce would eliminate most I/O churn while keeping the display reasonably fresh.

### 3. Eliminate structuredClone

Use an immutable data structure pattern or `immer` for thread state so patches can be applied without deep cloning. Or, since `fast-json-patch.applyPatch` has a `mutate` option, apply patches to a single mutable reference and produce a new store reference via shallow spread.

### 4. Test Each Layer Independently

The layered architecture actually supports unit testing well:

- **VirtualList**: Pure functions, no DOM. Test height calculations, binary search, scroll-to targeting with synthetic inputs.
- **StreamAccumulator**: Test delta accumulation, chain linking, throttle behavior with fake HubClient.
- **Streaming Store**: Test `applyDelta()` chain gap detection, `clearStream()` timing with Zustand test utils.
- **Trickle Text**: Test `findSafeBoundary()` exhaustively (it's pure), test `useTrickleText` with `@testing-library/react-hooks` for animation timing.
- **Listeners**: Test event handler logic by mocking `threadService` and `useStreamingStore`, verifying correct branching for chain gaps, active/inactive threads.

### 5. Integration Tests with Recorded Streams

Record real agent stream event sequences (STREAM_DELTA + AGENT_STATE_DELTA + timing) and replay them against the frontend stores in a test harness. Assert:
- No content flashes (streaming content should monotonically grow or transition cleanly)
- Scroll position stability (no jumps > N pixels during stream)
- Final state matches disk state exactly

### 6. Reduce Event Frequency from Agent

The agent currently calls `emitState()` on every tool state change, every message append, and every usage update. Each emission triggers a disk write + socket event + frontend processing. Batching these (e.g., debounce `emitState()` by 100ms) would reduce the number of handoff moments and disk reads.

---

## Phases

- [x] Research and document current architecture
- [ ] Identify specific test strategies for each isolated component
- [ ] Design unified content rendering approach
- [ ] Plan integration test harness with recorded streams

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---
