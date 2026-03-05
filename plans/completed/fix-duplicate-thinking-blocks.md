# Fix: Duplicate Identical Thinking Blocks During Streaming

## Problem

During streaming, users see several identical thinking blocks rendered in the thread. The same thinking content appears multiple times.

## Diagnosis

### Root Cause: Full state snapshots during streaming cause WIP/committed overlap

This bug is a downstream consequence of the same `thread_action` dropping issue described in `plans/fix-thinking-before-user-message.md`. Because `thread_action` messages don't update committed state in real-time, the frontend relies on periodic full state snapshots (via `AGENT_STATE_DELTA` with `full` payload) to catch up. When a snapshot arrives DURING streaming, it creates an overlap:

**The race condition:**

1. Agent is streaming assistant turn N. Frontend has:
   - Committed messages: `[user₁, assistant₁, user₂]` (stale — missing recent turns)
   - wipMessage: `{id: "msg_abc", content: [{thinking: "Let me analyze...", isStreaming: true}]}`

2. Full state snapshot arrives (from AGENT_STATE_DELTA with `full` — triggered by chain reset or periodic sync). The snapshot includes everything through the agent's CURRENT state, including turn N's assistant message that was committed via `APPEND_ASSISTANT_MESSAGE` on the agent side:
   - HYDRATE fires → committed state = `[user₁, assistant₁, user₂, assistant₂(thinking + text)]`
   - wipMessage = null (HYDRATE clears it)

3. But stream deltas for turn N+1 were already in the event queue (or arrive immediately after). A new STREAM_DELTA fires:
   - wipMessage = `{id: "msg_def", content: [{thinking: "Now I need to...", isStreaming: true}]}`

4. `getState()` returns:
   ```
   messages: [...committed, wipMessage]
   = [user₁, assistant₁, user₂, assistant₂(thinking+text), wipAssistant(thinking)]
   ```

5. User sees thinking from `assistant₂` AND thinking from `wipAssistant`. If the thinking content is similar or the turn boundary isn't visually distinct, these appear as **duplicate identical thinking blocks**.

### Contributing Factor: Stream accumulator `filter(Boolean)` index misalignment

`agents/src/lib/stream-accumulator.ts:88-118` has a secondary bug that can contribute to incorrect block indices:

```typescript
private emitSnapshot(): void {
  this.dirty = false;
  const blocks = this.blocks.filter(Boolean);  // ← Removes sparse entries, shifts indices
  // ...
  for (let i = 0; i < blocks.length; i++) {
    const prevLen = this.lastEmittedLengths[i] ?? 0;  // ← Uses filtered indices
    // ...
    deltas.push({ index: i, ... });  // ← Sends filtered index, not original SDK index
  }
  this.lastEmittedLengths = blocks.map((b) => b.content.length);  // ← Stored with filtered indices
}
```

When the SDK sends non-tracked block types (e.g., `tool_use` at index 2), `this.blocks` becomes sparse: `[thinking, text, undefined, text]`. After `filter(Boolean)`, indices shift from `[0, 1, 3]` to `[0, 1, 2]`. The `lastEmittedLengths` array is then keyed by filtered indices, causing misalignment on subsequent flushes if new blocks appear between existing ones.

This doesn't directly cause identical duplicates but can cause content to be sent at wrong indices, which the `ThreadStateMachine` then places at wrong positions in the wipMessage content array.

### Why Fixing Bug 1 Fixes Bug 2

If `thread_action` messages are properly wired to the machine (see `fix-thinking-before-user-message.md`):

1. `APPEND_ASSISTANT_MESSAGE` arrives in real-time through the machine → clears wipMessage
2. No more reliance on periodic full snapshots during streaming
3. Committed state and wipMessage stay in sync — no overlap window
4. The machine's `applyAction` for `APPEND_ASSISTANT_MESSAGE` (line 122-128) immediately clears wipMessage, so the next STREAM_DELTA starts fresh for the new message

## Phases

- [ ] Fix primary cause by landing `fix-thinking-before-user-message.md` (thread_action → THREAD_ACTION)
- [ ] Fix stream-accumulator `filter(Boolean)` index misalignment
- [ ] Add guard in ThreadStateMachine to deduplicate WIP vs committed messageId

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Fix

### Phase 1: Land the thread_action → THREAD_ACTION fix

See `plans/fix-thinking-before-user-message.md`. This is the primary fix — it eliminates the race condition where full state snapshots arrive during streaming and create WIP/committed overlap.

### Phase 2: Fix stream-accumulator index alignment

In `agents/src/lib/stream-accumulator.ts`, replace the `filter(Boolean)` approach with direct iteration that preserves original SDK indices:

```typescript
private emitSnapshot(): void {
  this.dirty = false;

  if (!this.hubClient.isConnected) {
    logger.debug("[StreamAccumulator] Hub not connected, skipping delta");
    return;
  }

  const deltas: Array<{ index: number; type: "text" | "thinking"; append: string }> = [];

  for (let i = 0; i < this.blocks.length; i++) {
    const block = this.blocks[i];
    if (!block) continue;  // Skip sparse positions without shifting indices

    const prevLen = this.lastEmittedLengths[i] ?? 0;
    const currentLen = block.content.length;
    if (currentLen > prevLen) {
      deltas.push({
        index: i,  // Original SDK index preserved
        type: block.type,
        append: block.content.slice(prevLen),
      });
      this.lastEmittedLengths[i] = currentLen;
    }
  }

  if (deltas.length > 0) {
    this.hubClient.send({
      type: "stream_delta",
      threadId: this.threadId,
      messageId: this.messageId,
      deltas,
    });
  }
}
```

### Phase 3: Add messageId dedup guard in ThreadStateMachine

As a safety net, prevent wipMessage from duplicating a committed message:

```typescript
private applyStreamDelta(payload: MachineStreamDelta): ThreadRenderState {
  // Guard: if this messageId is already committed, ignore stream deltas for it
  const alreadyCommitted = this.threadState.messages.some(
    (m) => m.id === payload.messageId
  );
  if (alreadyCommitted) return this.getState();

  // ... rest of existing logic
}
```

## Files to Change

| File | Change |
|------|--------|
| `src/lib/agent-service.ts` | Wire thread_action → THREAD_ACTION (phase 1, shared fix) |
| `agents/src/lib/stream-accumulator.ts` | Fix `filter(Boolean)` → iterate with original indices |
| `src/lib/thread-state-machine.ts` | Add messageId dedup guard in `applyStreamDelta` |
