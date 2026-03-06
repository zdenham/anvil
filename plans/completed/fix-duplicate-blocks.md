# Fix Duplicate Thinking/Tool Blocks in Thread UI

## Problem

During streaming, thinking and tool blocks are rendered twice in the thread UI. The root cause is a **missing dedup guard in `applyAppendAssistantMessage`** in the shared thread reducer.

## Root Cause Analysis

### The Race Condition: HYDRATE + Socket Replay

When the frontend opens a running thread (or recovery polling kicks in), this sequence occurs:

1. **HYDRATE from disk**: `loadThreadState` reads `state.json` → replaces entire state via `HYDRATE`, including all committed messages. The disk state has `wipMap: {}` (all entries consumed).
2. **Socket events continue**: `THREAD_ACTION` events from the agent's socket connection are still being delivered. These include `APPEND_ASSISTANT_MESSAGE` actions for messages that are **already** in the hydrated state.
3. **Duplicate append**: `applyAppendAssistantMessage` checks `wipMap` for a match — but wipMap is empty after HYDRATE. It falls through to the **append path**, which blindly appends the message without checking if it already exists.

### Why User Messages Don't Duplicate

`APPEND_USER_MESSAGE` already has a dedup guard at `thread-reducer.ts:52`:
```ts
if (state.messages.some((m) => m.id === action.payload.id)) return state;
```

`APPEND_ASSISTANT_MESSAGE` has **no such guard**. It only checks `wipMap` (for WIP replacement), then blindly appends.

### Secondary Issue: STREAM_START After HYDRATE

`applyStreamStart` only checks `wipMap` to prevent duplicate WIP creation. After HYDRATE (wipMap is empty), a late `STREAM_START` for an already-committed message would create a phantom empty WIP assistant message. The `STREAM_DELTA` handler catches this via `alreadyCommitted` check, but the empty WIP still lingers.

### Trigger Scenarios

- **Panel open during agent run**: `ThreadContent` mounts → `setActiveThread` → `loadThreadState` (HYDRATE) → socket events for already-committed messages arrive
- **Recovery polling**: Heartbeat goes stale → `recoverStateFromDisk` → HYDRATE → delayed socket events replay
- **Multi-window**: Two windows watching the same thread, one triggers HYDRATE while socket events flow

## Fix

### File: `core/lib/thread-reducer.ts`

Two changes:

#### 1. Add dedup guard to `applyAppendAssistantMessage` (primary fix)

Before the append path, check if a message with the same `id` already exists:

```ts
function applyAppendAssistantMessage(state: ThreadState, message: StoredMessage): ThreadState {
  const wipMap = { ...(state.wipMap ?? {}) };
  const blockIdMap = { ...(state.blockIdMap ?? {}) };
  const anthropicId = message.anthropicId;

  // ... existing block ID resolution ...

  if (anthropicId && wipMap[anthropicId]) {
    // ... existing WIP replacement logic ...
  }

+ // Deduplicate by ID — no-op if a message with this ID already exists
+ // This guards against HYDRATE + socket replay races: disk state already
+ // contains the message, then the same action arrives via socket.
+ if (state.messages.some((m) => m.id === message.id)) return state;

  // No WIP to replace — append
  return { ... };
}
```

#### 2. Add committed-message guard to `applyStreamStart` (secondary fix)

Prevent phantom WIP creation when a committed message with the same anthropicId already exists:

```ts
function applyStreamStart(state: ThreadState, payload: { anthropicMessageId: string }): ThreadState {
  const wipMap = { ...(state.wipMap ?? {}) };

  // If we already have a WIP for this anthropicId, no-op
  if (wipMap[payload.anthropicMessageId]) return state;

+ // If a committed message with this anthropicId already exists (post-HYDRATE),
+ // don't create a phantom WIP.
+ if (state.messages.some((m) => m.anthropicId === payload.anthropicMessageId)) return state;

  // ... rest of function ...
}
```

## Phases

- [x] Add dedup guard to `applyAppendAssistantMessage` in `core/lib/thread-reducer.ts`
- [x] Add committed-message guard to `applyStreamStart` in `core/lib/thread-reducer.ts`
- [x] Add unit tests for the dedup behavior (HYDRATE then duplicate APPEND)
- [x] Verify existing tests pass

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Why Dedup-by-ID (Not Merge, Not Map)

The agent generates one `nanoid()` per message in `message-handler.ts:187`. That ID flows to both:
- The socket action (`dispatch` → `emitAction`)
- The disk state (`dispatch` → `writeToDisk`)

So HYDRATE'd state and late socket actions carry the **exact same ID for the exact same content**. This makes the fix a simple ID check — the same pattern already used for `APPEND_USER_MESSAGE` at line 52.

**Why not merge?** The socket version is identical to the disk version (same id, same anthropicId, same content blocks). There's nothing to merge — skip is the correct behavior.

**Why not a Map?** Changing `messages` from `StoredMessage[]` to an indexed structure would be a larger refactor touching the entire rendering pipeline. The ID check is minimal and matches the existing user-message pattern.

**Why not dedup by `anthropicId`?** The SDK splits one API response into multiple `APPEND_ASSISTANT_MESSAGE` actions with the **same** `anthropicId` but **different** `id` (nanoid):
- First APPEND: `{ id: "abc", anthropicId: "msg_01Six...", content: [thinking] }` — replaces WIP
- Second APPEND: `{ id: "def", anthropicId: "msg_01Six...", content: [tool_use] }` — appends

Both are valid. Deduping by `anthropicId` would break this.
