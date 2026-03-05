# Fix Thread Accumulator Client/Server Discrepancy

## Problem

When replaying events in the UI, we see **fewer tool calls and no thinking blocks** compared to loading the thread fresh from disk. The agent-side reducer and client-side reducer produce different states from the same logical sequence because the client receives `stream_delta` events that populate `idMap`, causing a different code path in `applyAppendAssistantMessage`.

## Root Cause

The Claude Agent SDK splits a single API response into **multiple `assistant` messages that share the same `anthropicId`**:

```
API call → msg_0142AZ:
  #21  APPEND_ASSISTANT_MESSAGE  ['thinking']     anthropicId=msg_0142AZ
  #25  APPEND_ASSISTANT_MESSAGE  ['tool_use']     anthropicId=msg_0142AZ

API call → msg_014aR8:
  #35  APPEND_ASSISTANT_MESSAGE  ['thinking']     anthropicId=msg_014aR8
  #39  APPEND_ASSISTANT_MESSAGE  ['text']         anthropicId=msg_014aR8
  #44  APPEND_ASSISTANT_MESSAGE  ['tool_use']     anthropicId=msg_014aR8
  #50  APPEND_ASSISTANT_MESSAGE  ['tool_use']     anthropicId=msg_014aR8
```

### Bug 1: idMap entry not consumed after WIP replacement

`idMap` maps `anthropicId → WIP message UUID` at the **message level**. When the SDK splits a response into multiple messages sharing the same `anthropicId`, the second message replaces the first (via the same idMap entry), losing content.

### Bug 2: Late stream deltas corrupt committed messages

The `StreamAccumulator` throttles at 50ms, so some `stream_delta` events arrive after their corresponding `APPEND_ASSISTANT_MESSAGE`, corrupting already-committed content.

## ID Strategy

The Anthropic API provides stable IDs for **some** block types but not others:

| Block Type | API-provided ID | Our approach |
|-----------|----------------|--------------|
| `tool_use` | `block.id` (stable, globally unique) | Use as lookup key |
| `text` | None — only positional `index` | Composite key: `${anthropicMessageId}:${index}` |
| `thinking` | None — only positional `index` | Composite key: `${anthropicMessageId}:${index}` |

**Principle:** Every block gets **our own stable ID** (nanoid), assigned once and used everywhere for keying (React keys, state lookups, etc.). The API-provided ID or composite key is just a **correlation key** used to map streaming blocks to their committed counterparts. The mapping is:

```
correlation key → our nanoid (used everywhere)
```

- `StreamAccumulator` already generates a nanoid per block at `content_block_start` and includes it in `stream_delta` events as `blockId`.
- The reducer's `blockIdMap` stores `correlationKey → ourNanoid` during streaming, then looks up the nanoid during commit to carry it forward onto the committed block.
- Entries are **consumed on commit** — once a committed block gets its nanoid, the mapping is deleted. This prevents stale entries from causing collisions when the SDK reuses the same `anthropicMessageId` across split messages.

### Why block-level, not message-level

The current `idMap` operates at message granularity (`anthropicId → WIP message UUID`). This breaks because the SDK can emit multiple committed messages with the same `anthropicId`. A block-level map avoids this entirely — each block is independently correlated regardless of how the SDK splits messages.

## Impact

For the example trace (thread `8099ceba`):
- **3 thinking blocks lost** (one per API call with thinking)
- **4 tool calls lost** (all but the last tool_use per API call)
- Only 4 of 12 assistant messages survive (last message per anthropicId)

## Phases

- [x] Replace message-level idMap with wipMap + blockIdMap
- [x] Guard applyStreamDelta against late deltas on committed messages
- [x] Add regression test with event replay

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Phase 1: Replace message-level idMap with block-level blockIdMap

### Changes to `ThreadState` (core/types/events.ts)

Replace `idMap` with `blockIdMap`:

```typescript
// Before:
idMap: z.record(z.string(), z.string()).optional()  // anthropicId → WIP message UUID

// After:
blockIdMap: z.record(z.string(), z.string()).optional()  // correlationKey → our nanoid
```

### Changes to `StreamAccumulator` (agents/src/lib/stream-accumulator.ts)

No structural changes needed — it already emits `blockId` (nanoid) per block. Just ensure the `messageId` (anthropic message ID) and `index` are both available in the delta payload so the reducer can compute the correlation key. Currently `index` and `blockId` are already emitted; `messageId` is emitted at the `stream_delta` envelope level.

### Changes to `thread-reducer.ts`

**`applyStreamStart`** — Simplified. No longer creates a WIP message. Instead, just marks that a stream is active for this `anthropicMessageId` so we know to create a WIP message on first delta.

**`applyStreamDelta`** — On first delta for a given `anthropicMessageId`:
1. Create WIP message (as before)
2. For each block delta, compute correlation key (`${anthropicMessageId}:${delta.index}`)
3. Store `blockIdMap[correlationKey] = delta.blockId` (the nanoid from StreamAccumulator)
4. Assign `delta.blockId` as the block's `id`

**`applyAppendAssistantMessage`** — For each block in the committed message:
1. Compute its correlation key:
   - `tool_use`: use `block.id` (the Anthropic-provided tool use ID)
   - `text`/`thinking`: use `${message.anthropicId}:${blockIndex}`
2. Look up `blockIdMap[correlationKey]` → our nanoid
3. If found, assign our nanoid as the block's `id` and **delete** the entry (consume on use)
4. If not found (no streaming happened for this block), leave as-is

The WIP message replacement also changes: instead of finding a WIP message by anthropicId, we **always append** committed messages. The block IDs carry forward via `blockIdMap` lookups, and WIP messages should be cleaned up (removed) when their corresponding committed message arrives.

Actually, simpler: keep the WIP-replacement behavior but **consume the message tracking** after first replacement. The WIP message exists purely for live UI display during streaming. When the first committed message arrives for that anthropicId, replace the WIP and delete the message-level tracking. Subsequent committed messages with the same anthropicId just append.

So we need **both** maps:
- `wipMap: Record<string, string>` — `anthropicMessageId → WIP message UUID` (consumed on first commit)
- `blockIdMap: Record<string, string>` — `correlationKey → our nanoid` (consumed per-block on commit)

## Phase 2: Guard against late stream deltas

After `applyAppendAssistantMessage` consumes the `wipMap` entry, any late `STREAM_DELTA` for that `anthropicMessageId` will find no entry in `wipMap` → no-op. This falls out naturally from the consume-on-use behavior.

Explicit guard in `applyStreamDelta`:
```typescript
if (!wipMap[payload.anthropicMessageId]) {
  // Message already committed and wipMap consumed — this is a late delta, ignore.
  return state;
}
```

## Phase 3: Regression test

Replay the `thread_action` and `stream_delta` events from the example trace through `threadReducer` and verify:

1. All 12 assistant messages survive (not just 4)
2. Thinking blocks are preserved (3 messages with thinking)
3. Tool use blocks are preserved (6 messages with tool_use)
4. Block IDs from streaming are carried forward onto committed blocks
5. Late stream deltas don't corrupt committed messages
6. `blockIdMap` and `wipMap` are empty after all messages are committed
