# Fix: Streaming Content Appears Before User Message

## Problem

When a user sends a message, the streaming assistant response appears BEFORE the user message in the UI. Once streaming completes, the messages reorder to the correct position.

## Root Cause

User messages live in a separate `optimisticMessages` React state, appended *after* real messages:
```typescript
return [...realMessages, ...pending];
```

When streaming starts, `STREAM_DELTA` creates a WIP assistant message in `realMessages` — but the user message is still in the optimistic bucket, so it renders after the assistant.

## Approach

Eliminate the optimistic messages layer entirely. Dispatch `APPEND_USER_MESSAGE` directly into the thread reducer the moment the user hits send. The user message becomes a first-class citizen in the same `messages` array as everything else, so streaming deltas naturally appear after it.

No agent-side changes needed. The agent's `appendUserMessage` in `output.ts` only writes to disk (`state.json`) and sends `{ type: "state" }` over the socket — which the frontend **drops** (not handled in `routeAgentMessage`). The agent never sends a `thread_action` for user messages. The only way the agent's user message reaches the frontend is via HYDRATE (full state replacement on cold load/reconnect), which naturally overwrites the entire state including the locally-dispatched message. So there's no duplication path today.

## Changes

### 1. Reducer: deduplicate APPEND_USER_MESSAGE by ID
**File:** `core/lib/thread-reducer.ts` ~line 50

Add an early return if a message with the same `id` already exists. This is future-proofing for when the agent eventually sends `thread_action` over the socket (the tests in `output.test.ts` already expect this), but costs nothing to add now.

### 2. Frontend: dispatch to reducer instead of optimistic state
**File:** `src/components/content-pane/thread-content.tsx`

In `handleSubmit`:
- Generate the message UUID upfront
- Dispatch `APPEND_USER_MESSAGE` to the thread store directly via `useThreadStore.getState().dispatch()`
- Pass the same UUID to `sendQueuedMessage`

Remove:
- `optimisticMessages` useState
- `realMessageCountWhenOptimisticAdded` ref
- The `useMemo` that merges optimistic + real messages
- The cleanup effect that deduplicates optimistic messages against real state
- The `flushSync` import (no longer needed)

### 3. sendQueuedMessage: accept an external ID
**File:** `src/lib/agent-service.ts` ~line 360

Change `sendQueuedMessageSocket` to accept an optional `messageId` parameter instead of always generating one internally. This lets the caller provide the same ID it dispatched to the reducer, keeping the `QueuedMessagesStore` tracking consistent.

## Phases

- [x] Add ID-based dedup to APPEND_USER_MESSAGE in thread-reducer
- [x] Refactor handleSubmit to dispatch directly to thread store, remove optimistic layer
- [x] Update sendQueuedMessage to accept an external message ID

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Notes

- `StoredMessage` already has an `id: string` field
- `sendQueuedMessage` already generates a UUID and sends `{ id, content, timestamp }` to the agent
- HYDRATE (full state replacement) only fires on cold load / reconnect — it replaces the full messages array, so the locally-dispatched user message is naturally superseded
- The `QueuedMessagesStore` (delivery tracking / ack) is separate from the optimistic rendering layer and can remain as-is
- Agent-side `appendUserMessage` does NOT need changes — it only writes to disk and the frontend never sees it in real-time
