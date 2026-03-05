# Fix Duplicate Streaming Content Rendering

## Problem

During streaming, thinking blocks and text content render **twice** — once in-place as a committed turn, and again in the streaming slot at the bottom.

## Root Cause

Two rendering paths read from the same WIP data, causing duplication:

### Data flow

1. `ThreadStateMachine.getState()` appends the WIP message (with `isStreaming: true` blocks) to the committed messages array (`thread-state-machine.ts:79-85`)
2. `ThreadContent` reads `threadStates[threadId]` — the **render state including WIP** — and passes `messages` to `ThreadView` (`thread-content.tsx:108-109, 226-253`)
3. `groupMessagesIntoTurns(messages)` creates a turn for the WIP message (`thread-view.tsx:47-49`)

### Where duplication happens

- **Path 1 (turns):** `MessageList` → `TurnRenderer` → `AssistantMessage` renders **all** content blocks from the WIP message, including `isStreaming: true` blocks. It does not filter them — see `assistant-message.tsx:39-87` where blocks are rendered without checking `isStreaming`.

- **Path 2 (streaming slot):** `MessageList` reserves a streaming slot (virtual index past all turns) that renders `StreamingContent`, which reads the **same last message** from the store and filters for `isStreaming: true` blocks (`streaming-content.tsx:10-37`).

Result: the same text/thinking blocks appear twice on screen.

## Fix

Eliminate the streaming slot entirely. Instead, have `AssistantMessage` handle `isStreaming` blocks inline using `TrickleBlock` + `StreamingCursor`. This is the correct architecture because:

- The WIP message is already in the turns array (via `getState()`)
- It already has a virtual list item — a second slot is redundant
- Single rendering path = no duplication possible
- Content stays keyed to its position in the actual message

### Changes

**`assistant-message.tsx`** — For each content block, check `isStreaming`. Render `TrickleBlock` for streaming text/thinking, committed components for everything else. Show `StreamingCursor` after the last streaming block.

**`message-list.tsx`** — Remove the streaming slot (extra virtual item), `hasStreamingContent` selector, and `StreamingContent` import. `WorkingIndicator` stays as-is (it's independent — shown when last turn is `user` type).

**Delete `streaming-content.tsx`** — No longer needed; its logic moves into `AssistantMessage`.

### Why not filter `isStreaming` blocks in `AssistantMessage`?

The previous plan proposed filtering out `isStreaming` blocks and letting the streaming slot handle them. This is worse because:

- It preserves the two-path architecture that caused the bug in the first place
- The streaming slot re-reads the same store data, adds a virtual list item, and duplicates block iteration
- More code to maintain for no benefit

## Phases

- [x] Update `AssistantMessage` to render `isStreaming` blocks with `TrickleBlock` + `StreamingCursor`
- [x] Remove streaming slot from `MessageList` and delete `streaming-content.tsx`
- [x] Verify no regressions in existing thread rendering tests

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---
