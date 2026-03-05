# Stable UUID Block Keying

## Problem

Content blocks (text, thinking) are keyed by array index throughout the system, causing:

1. **Two thinking blocks bug**: `StreamAccumulator` emits `stream_delta` without `messageId`, so the WIP message is tracked as `wip-{threadId}` while the committed message has `anthropicId: "msg_01..."`. The reducer can't correlate them → committed message is *appended* instead of replacing the WIP → both render.

2. **Index-based React keys**: `thinking-${index}`, `text-${index}`, `streaming-${type}-${index}` — fragile if blocks reorder, causes expand/collapse state to bind to wrong block.

3. **`full` field silently dropped**: First `stream_delta` sends accumulated content in `full` with `deltas: []`, but the frontend only processes `deltas`. Initial text is lost.

4. **Constructed message IDs**: `stream-${anthropicId}`, `wip-${threadId}` — string-building instead of stable UUIDs.

## Design

Every content block and message gets a real UUID. The agent side generates UUIDs and passes them through stream deltas. The frontend uses them for React keys and state persistence. No more index-based or constructed IDs.

**Block IDs are stable across the streaming → committed transition.** When a committed message replaces a WIP message, the reducer carries forward block IDs from the WIP content into the committed content (matched by index — block ordering is stable from the SDK). This means React keys, expand/collapse state, and any other block-keyed UI state survive the transition without a flash or re-mount.

**Existing tests already describe the target behavior** — `agents/src/lib/stream-accumulator.test.ts` expects `messageId` from `message_start` and no chain IDs, but the implementation doesn't match yet.

## Phases

- [x] Phase 1: Fix StreamAccumulator — messageId + block UUIDs + remove chain IDs
- [x] Phase 2: Update core types and reducer — block IDs and proper WIP correlation
- [x] Phase 3: Update frontend components — UUID-based React keys
- [x] Phase 4: Tests

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Phase 1: Fix StreamAccumulator

**File**: `agents/src/lib/stream-accumulator.ts`

The accumulator currently doesn't handle `message_start` events and uses chain IDs (`id`, `previousEventId`, `full`) that the frontend doesn't consume properly.

### Changes

1. **Add `messageId` field** — capture from `message_start` event:
   ```typescript
   private messageId: string | null = null;

   handleDelta(event: BetaRawMessageStreamEvent): void {
     if (event.type === "message_start") {
       this.messageId = event.message.id;
       return;
     }
     // ... existing content_block_start / content_block_delta handling
   }
   ```

2. **Add block UUID generation** — generate a `nanoid()` for each text/thinking block at `content_block_start`:
   ```typescript
   interface StreamBlock {
     type: "text" | "thinking";
     content: string;
     id: string;  // NEW: stable UUID
   }

   // In handleDelta, content_block_start:
   this.blocks[event.index] = { type: blockType, content: "", id: nanoid() };
   ```

3. **Include `messageId` and block `id` in emissions** — replace chain IDs:
   ```typescript
   // Instead of: { type, threadId, id, previousEventId, deltas/full }
   // Emit:       { type, threadId, messageId, deltas }
   // Where each delta includes: { index, type, append, blockId }
   ```

4. **Remove `full` field and chain IDs** — first emission also uses `deltas` format (with full content as initial append). Remove `id`, `previousEventId`, `full`.

5. **Reset clears `messageId`**:
   ```typescript
   reset(): void {
     this.messageId = null;
     // ... existing cleanup
   }
   ```

### Wire format change

Before:
```json
{
  "type": "stream_delta",
  "threadId": "...",
  "id": "event-chain-id",
  "previousEventId": "prev-chain-id",
  "deltas": [{ "index": 0, "type": "thinking", "append": "..." }],
  "full": [{ "type": "thinking", "content": "..." }]
}
```

After:
```json
{
  "type": "stream_delta",
  "threadId": "...",
  "messageId": "msg_01...",
  "deltas": [{ "index": 0, "type": "thinking", "append": "...", "blockId": "abc123" }]
}
```

The `full` field is eliminated. The first emission is no longer special — it sends normal deltas. This also fixes the "initial content silently dropped" bug because the first flush now emits proper deltas.

---

## Phase 2: Update Core Types and Reducer

### Type changes

**File**: `core/types/events.ts`

1. Add `blockId` to `BlockDelta`:
   ```typescript
   export interface BlockDelta {
     index: number;
     type: "text" | "thinking";
     append: string;
     blockId: string;  // NEW
   }
   ```

2. Add `id` to `RenderContentBlock`:
   ```typescript
   export interface RenderContentBlock {
     type: "text" | "thinking";
     id?: string;  // NEW: stable UUID, present on streaming and committed blocks
     text?: string;
     thinking?: string;
     isStreaming?: boolean;
   }
   ```

### Reducer changes

**File**: `core/lib/thread-reducer.ts`

1. **`applyStreamDelta`** — use `blockId` from delta to set block `id`:
   ```typescript
   // When creating new block:
   blocks[delta.index] = {
     type: delta.type === "text" ? "text" : "thinking",
     [field]: delta.append,
     isStreaming: true,
     id: delta.blockId,  // NEW: stable UUID from agent
   };

   // When updating existing block, preserve id:
   blocks[delta.index] = {
     ...existing,
     [field]: (existing[field] ?? "") + delta.append,
     isStreaming: true,
     // id already set from creation
   };
   ```

2. **`applyStreamStart` / implicit start** — stop using constructed `stream-${id}` UUIDs. Use `nanoid()` for the WIP message `id` but still map `anthropicMessageId → uuid` in `idMap` for commit-time replacement:
   ```typescript
   const uuid = nanoid();  // Real UUID, not stream-${...}
   idMap[payload.anthropicMessageId] = uuid;
   ```

3. **`applyAppendAssistantMessage`** — carry forward block IDs from the WIP message into the committed message's content blocks. The reducer already finds the WIP via `idMap[anthropicId]`, so we have access to both the WIP content (with streaming block IDs) and the committed content (from the SDK, no block IDs on text/thinking). Merge them by index:
   ```typescript
   function applyAppendAssistantMessage(state: ThreadState, message: StoredMessage): ThreadState {
     const idMap = state.idMap ?? {};
     const anthropicId = message.anthropicId;

     if (anthropicId && idMap[anthropicId]) {
       const streamingUuid = idMap[anthropicId];
       const wipMsg = state.messages.find((m) => m.id === streamingUuid);
       const wipBlocks = (wipMsg?.content as RenderContentBlock[]) ?? [];

       // Carry forward block IDs from streaming into committed content
       const content = (message.content as RenderContentBlock[]).map((block, i) => {
         const wipBlock = wipBlocks[i];
         if (wipBlock?.id && (block.type === "text" || block.type === "thinking")) {
           return { ...block, id: wipBlock.id };
         }
         return block;
       });

       const messages = state.messages.map((m) =>
         m.id === streamingUuid ? { ...message, id: streamingUuid, content } : m,
       );
       return { ...state, messages };
     }

     return { ...state, messages: [...state.messages, message] };
   }
   ```
   This ensures block IDs assigned during streaming survive into the committed message. React keys stay stable, expand/collapse state on thinking blocks is preserved, and there's no flash/re-mount at the streaming→committed boundary.

### Listener changes

**File**: `src/entities/threads/listeners.ts`

Remove the `wip-${threadId}` fallback. If `messageId` is missing, log a warning instead of silently creating an untrackable WIP:
```typescript
eventBus.on(EventName.STREAM_DELTA, (payload) => {
  if (!payload.messageId) {
    logger.warn("[ThreadListener] stream_delta missing messageId, skipping");
    return;
  }
  // dispatch with payload.messageId as anthropicMessageId
});
```

---

## Phase 3: Update Frontend Components — UUID-Based React Keys

### AssistantMessage block keys

**File**: `src/components/thread/assistant-message.tsx`

Replace all index-based keys with block `id`:

```tsx
// Streaming blocks:
<div key={renderBlock.id ?? `streaming-fallback-${index}`}>

// Committed text:
<TextBlock key={block.id ?? `text-fallback-${index}`} ... />

// Committed thinking:
<ThinkingBlock
  key={block.id ?? `thinking-fallback-${index}`}
  blockKey={block.id ?? `thinking-fallback-${index}`}
  ...
/>
```

Fallback to index only as safety net — once the pipeline is wired, `id` should always be present on text/thinking blocks.

### Tool use blocks — no change needed

Tool use blocks already use the API-assigned `block.id` (e.g., `toolu_01...`) as their React key. This is correct.

### ThinkingBlock blockKey

**File**: `src/components/thread/thinking-block.tsx`

No structural change needed — it already accepts `blockKey` as a prop. The caller change in assistant-message.tsx handles this.

### Committed message content — block IDs carried forward by reducer

When the SDK's committed message arrives via `APPEND_ASSISTANT_MESSAGE`, text/thinking blocks from the API don't have `id` fields. But the reducer's `applyAppendAssistantMessage` (updated in Phase 2) carries forward block IDs from the WIP message into the committed content by index. **No changes needed in `message-handler.ts`** — the agent side sends SDK blocks as-is, and the reducer merges in the streaming IDs.

For messages that were never streamed (e.g., cache hits, or if streaming was skipped), committed text/thinking blocks will have no `id`. The frontend falls back to index-based keys in that case (the `?? \`fallback-${index}\`` pattern).

---

## Phase 4: Tests

1. **Fix existing failing tests** in `agents/src/lib/stream-accumulator.test.ts` — they already describe the desired behavior (messageId from message_start, no chain IDs). After Phase 1, they should pass.

2. **Add block UUID tests** — verify:
   - Each `content_block_start` generates a unique `blockId`
   - `blockId` is included in all subsequent deltas for that block
   - `reset()` clears block IDs

3. **Reducer tests** — verify:
   - Stream delta with `messageId` creates WIP that can be replaced by `APPEND_ASSISTANT_MESSAGE`
   - Block `id` is preserved through delta accumulation
   - **Block IDs carry forward from WIP to committed**: after `APPEND_ASSISTANT_MESSAGE` replaces a WIP, the committed text/thinking blocks retain the `id` values from the streaming blocks
   - Non-streamed messages (no WIP to replace) work correctly with no block IDs
   - No more `stream-${id}` or `wip-${threadId}` patterns

---

## Files Changed

| File | Change |
|------|--------|
| `agents/src/lib/stream-accumulator.ts` | messageId capture, block UUIDs, remove chain IDs/full |
| `agents/src/lib/stream-accumulator.test.ts` | Add block UUID tests, existing tests should pass |
| `core/types/events.ts` | Add `blockId` to BlockDelta, `id` to RenderContentBlock |
| `core/lib/thread-reducer.ts` | Use real UUIDs, track block IDs, carry forward IDs on commit |
| `src/entities/threads/listeners.ts` | Remove `wip-${threadId}` fallback |
| `src/components/thread/assistant-message.tsx` | Use `block.id` for React keys and blockKey |

## Out of Scope

- Tool result sub-component keys (grep context lines, glob file lists, diff lines) — these are within a single tool result and index-based keys are acceptable since the data is immutable once rendered.
- Message-level virtual list keys — already handled by the virtualizer.
- Markdown code block index counter — within a single text block render, index is fine.
