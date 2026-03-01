# Fix: Send Message Double-Render Flash

## Problem

When sending a message, there's a single-frame flash where the message appears in two places. This happens because the optimistic message and the real message coexist in the rendered list for one frame.

### Root Cause

`thread-content.tsx:232-247` computes the messages array as:

```ts
return [...realMessages, ...optimisticMessages];
```

When `activeState.messages` updates (real state from disk now includes the user message), the `messages` memo immediately recomputes with the duplicate. But the cleanup that removes the optimistic copy lives in a `useEffect` (lines 412-457), which runs **after** React renders — guaranteeing a one-frame gap where both copies exist.

The virtual list then renders the message at two positions (both with absolute positioning via `translateY`), causing the visible flash.

## Fix

**Move the deduplication from a post-render effect into the memo itself.** The `messages` memo already has access to both `activeState.messages` and `optimisticMessages`. It can filter out optimistic messages that already appear in real state before returning, eliminating the one-frame duplicate entirely.

### Change: `src/components/content-pane/thread-content.tsx`

**In the `messages` memo (lines 232-247):** Before appending optimistic messages, filter out any that already exist in the real messages by content matching. This is the same content-matching logic currently in the cleanup effect, just moved earlier.

```ts
const messages = useMemo((): MessageParam[] => {
  const realMessages = activeState?.messages ?? [];

  if (realMessages.length === 0 && initialPrompt && optimisticMessages.length === 0) {
    return [{ role: "user", content: initialPrompt }];
  }

  if (optimisticMessages.length > 0) {
    // Filter out optimistic messages already present in real state
    const realContent = new Set(
      realMessages
        .filter((m) => m.role === "user")
        .map((m) => typeof m.content === "string" ? m.content : JSON.stringify(m.content))
    );
    const pending = optimisticMessages.filter((m) => {
      const content = typeof m.content === "string" ? m.content : JSON.stringify(m.content);
      return !realContent.has(content);
    });
    if (pending.length > 0) {
      return [...realMessages, ...pending];
    }
  }

  return realMessages;
}, [activeState?.messages, initialPrompt, optimisticMessages]);
```

**Keep the existing cleanup effect** (lines 412-457) — it still serves to actually clear the `optimisticMessages` state so it doesn't accumulate. The memo now just prevents the duplicate from ever reaching the render. The effect does the proper cleanup on the next tick.

## Phases

- [x] Move deduplication logic into the `messages` memo in `thread-content.tsx`
- [x] Verify the cleanup effect still works correctly (no behavioral changes needed, just keeps state tidy)

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---
