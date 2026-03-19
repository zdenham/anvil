# Fix: Duplicate Initial User Message in Sub-Agent Threads

## Problem

When opening an Anthropic sub-agent thread, two initial user messages are displayed. They have the same content (the task prompt) but different IDs, so deduplication doesn't catch them.

## Root Cause

There's a race between two independent code paths that both create the initial user message:

### Path 1: PreToolUse hook (shared.ts:822-854)
When the Agent/Task tool fires, the PreToolUse hook eagerly creates the child thread with an initial user message baked into `state.json`:

```typescript
const initialUserMessage = {
  role: "user",
  content: [{ type: "text", text: taskPrompt }],
  id: crypto.randomUUID(),   // ← ID #1
};
// Written to state.json AND sent via INIT hub action
```

This is done so the UI can immediately show the sub-agent thread with the user's prompt before the SDK even starts streaming.

### Path 2: SDK message streaming (message-handler.ts:658-701)
When the SDK starts processing the sub-agent, it emits the initial user prompt as a `user` type message with `parent_tool_use_id` set. The message handler routes this to `handleForChildThread()`, which **unconditionally** appends it:

```typescript
const userMsg = {
  role: "user" as const,
  content: msg.message.content,
  id: nanoid(),              // ← ID #2 (different!)
};
state.messages.push(userMsg);
hub?.sendActionForThread(childThreadId, {
  type: "APPEND_USER_MESSAGE",
  payload: { id: userMsg.id, content: userMsg.content },
});
```

At this point `getChildThreadState()` has already loaded the disk state (which contains the message from Path 1), so pushing another one creates the duplicate.

### Why dedup doesn't help
- The APPEND_USER_MESSAGE reducer deduplicates by ID (thread-reducer.ts:52)
- Both messages have different IDs (`crypto.randomUUID()` vs `nanoid()`)
- Same content, different IDs → both survive

## Phases

- [x] Fix: Skip appending the initial user message in handleForChildThread
- [x] Verify: Confirm tool-result user messages still flow correctly

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Fix Options

### Option A: Skip the first user message in handleForChildThread (Recommended)

In `handleForChildThread`'s `user` case, detect when the incoming user message is the initial prompt (not a tool result) and skip appending it since it's already in the state from PreToolUse.

**Detection heuristic**: The initial prompt is the only user message that does NOT contain `tool_result` content blocks. All subsequent user messages from the SDK are tool results.

```typescript
// message-handler.ts, handleForChildThread, "user" case
case "user": {
  const msg = message as SDKUserMessage;
  const toolUseId = this.extractToolUseIdFromResult(msg);

  // If this is a tool result, process it normally
  if (toolUseId) {
    // ... existing tool result handling ...

    // Append tool-result user message
    const userMsg = { role: "user", content: msg.message.content, id: nanoid() };
    state.messages.push(userMsg);
    hub?.sendActionForThread(childThreadId, { ... });
  }
  // else: initial prompt — already in state from PreToolUse, skip append

  await this.emitChildThreadState(childThreadId, state);
  return true;
}
```

**Pros**: Simple, minimal change, correct by construction (tool results always have tool_result blocks).
**Cons**: Relies on the invariant that non-tool-result user messages = initial prompt.

### Option B: Thread the message ID from PreToolUse to the SDK

Pass the initial message ID from PreToolUse through to the message handler, and use the same ID when appending. The reducer's ID-based dedup would then catch it.

**Pros**: Dedup happens naturally.
**Cons**: Requires plumbing the ID through more layers; the SDK assigns its own IDs.

### Option C: Content-based dedup in the reducer

Add secondary dedup in `APPEND_USER_MESSAGE` that compares content as well as ID.

**Pros**: Catches all duplicates regardless of source.
**Cons**: Content comparison is expensive for large messages; could mask real bugs.

## Recommendation

**Option A** — it's a surgical 5-line change in `message-handler.ts`. The invariant (initial prompt has no `tool_result` blocks, all subsequent user messages do) is fundamental to how the SDK works.
