# Fix Stream Completion Flicker

## Problem

When a stream completes, messages visibly disappear and re-appear for a single frame. This is a classic "state gap" bug.

## Root Cause

At stream completion, two things happen in the wrong order:

1. **Streaming content is cleared synchronously** — `streaming-store.ts:44-46` calls `clearStream(threadId)` immediately when `AGENT_STATE` fires
2. **Replacement data requires an async disk read** — `listeners.ts:101` calls `threadService.loadThreadState(threadId)` which reads `state.json` from disk via Tauri IPC

During the gap between step 1 and step 2 completing, there is **no content to display**. The streaming blocks are gone, but the final messages haven't loaded into the store yet. `thread-view.tsx:102` hits `messages.length === 0` and briefly renders `EmptyState`.

### Amplifiers

- **Double disk reads**: Both `AGENT_STATE` (line 88) and `AGENT_COMPLETED` (line 117) in `listeners.ts` independently call `loadThreadState()`, causing redundant work

## Fix Strategy

**Don't clear streaming content until the replacement data is in the store.** This fix respects our event-bridge pattern ("Events Are Signals, Not Data") and disk-as-truth pattern — listeners continue to refresh from disk, never trusting event payloads for state.

### Change 1: Defer `clearStream` until after `loadThreadState` resolves

In `streaming-store.ts`, remove the `AGENT_STATE` listener that eagerly clears the stream. Instead, clear it from `listeners.ts` *after* `loadThreadState` completes.

**`src/stores/streaming-store.ts`** — Remove line 44-46:
```diff
- eventBus.on(EventName.AGENT_STATE, ({ threadId }) => {
-   useStreamingStore.getState().clearStream(threadId);
- });
```

**`src/entities/threads/listeners.ts`** — Clear stream after state is loaded (AGENT_STATE handler):
```diff
  eventBus.on(EventName.AGENT_STATE, async ({ threadId }) => {
    try {
      await threadService.refreshById(threadId);
      const store = useThreadStore.getState();
      if (store.activeThreadId === threadId) {
        await threadService.loadThreadState(threadId);
      }
+     // Clear streaming content AFTER replacement data is in the store
+     useStreamingStore.getState().clearStream(threadId);
      // ... cascade refresh
    } catch (e) { ... }
  });
```

Do the same for `AGENT_COMPLETED` — move `clearStream` into the listener after `loadThreadState`, removing the eager clear from `streaming-store.ts:48-49`.

### Change 2: Guard against empty-message flash in ThreadView

As a defensive measure, don't show `EmptyState` when transitioning from a streaming state:

```diff
- if (status === "idle" || messages.length === 0) {
+ if (status === "idle" || (messages.length === 0 && !isStreaming)) {
```

This ensures that if streaming content exists (even as the stream completes), we don't flash `EmptyState`.

## Files to Modify

| File | Change |
|------|--------|
| `src/stores/streaming-store.ts` | Remove eager `clearStream` on `AGENT_STATE` and `AGENT_COMPLETED` |
| `src/entities/threads/listeners.ts` | Move `clearStream` calls after `loadThreadState` resolves |
| `src/components/thread/thread-view.tsx` | Guard `EmptyState` against streaming→complete transition |

## Phases

- [x] Move `clearStream` calls from streaming-store into listeners (after async disk load completes)
- [x] Guard ThreadView against empty-message flash during transition
- [ ] Verify no regressions in streaming display (manual smoke test)

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---
