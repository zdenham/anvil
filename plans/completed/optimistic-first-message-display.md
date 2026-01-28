# Optimistic First Message Display

## Problem

When a thread is created from Spotlight, the breadcrumbs ("threads / new") appear quickly, but there's a noticeable delay before the user's first message is displayed. This creates a jarring "blank thread" state.

## Root Cause

The `ContentPane` component renders `ThreadContent` but **never passes the `initialPrompt` prop**, even though:

1. The optimistic thread metadata includes the first message in `turns[0].prompt`
2. `ThreadContent` already has logic to display `initialPrompt` as an optimistic message (lines 178-190)
3. The prop exists in the component interface but is always `undefined`

### Current Data Flow

```
Spotlight creates optimistic thread
  → metadata.turns[0].prompt = "user's message"
  → THREAD_CREATED broadcast
  → Window opens

ContentPane receives threadId
  → <ThreadContent threadId={view.threadId} />  ← NO initialPrompt passed!
  → ThreadContent waits for activeState.messages from disk
  → Delay until agent writes state.json
```

### Why This Causes Delay

`ThreadContent` derives messages from two sources (lines 178-190):

```typescript
const messages = useMemo((): MessageParam[] => {
  // Priority 1: Real messages from state.json
  if (activeState?.messages && activeState.messages.length > 0) {
    return activeState.messages;
  }
  // Priority 2: Optimistic message from initialPrompt prop
  if (initialPrompt) {
    return [{ role: "user", content: initialPrompt }];
  }
  return [];  // ← This is what happens - empty array, blank screen
}, [activeState?.messages, initialPrompt]);
```

Since `initialPrompt` is never passed, it falls through to the empty array while waiting for `state.json` to be written by the agent.

## Solution

Pass `initialPrompt` from thread metadata to `ThreadContent`. The metadata is already in the store (from `createOptimistic`), so this is a simple prop threading fix.

### Changes Required

**1. `src/components/content-pane/content-pane.tsx`**

Add a selector to get the first prompt from metadata and pass it to ThreadContent:

```typescript
// Before (line 50-52):
{view.type === "thread" && (
  <ThreadContent threadId={view.threadId} onPopOut={onPopOut} autoFocus={view.autoFocus} />
)}

// After:
{view.type === "thread" && (
  <ThreadContentWithPrompt
    threadId={view.threadId}
    onPopOut={onPopOut}
    autoFocus={view.autoFocus}
  />
)}
```

Create a wrapper component (or inline) that extracts the prompt:

```typescript
function ThreadContentWithPrompt({
  threadId,
  ...props
}: { threadId: string; onPopOut?: () => void; autoFocus?: boolean }) {
  const initialPrompt = useThreadStore(
    useCallback((s) => s.threads[threadId]?.turns[0]?.prompt, [threadId])
  );
  return <ThreadContent threadId={threadId} initialPrompt={initialPrompt} {...props} />;
}
```

### Alternative: Inline Selection

Could also do this without a wrapper:

```typescript
// Inside ContentPane, add a selector:
const threadPrompt = useThreadStore(
  useCallback(
    (s) => view.type === "thread" ? s.threads[view.threadId]?.turns[0]?.prompt : undefined,
    [view]
  )
);

// Then pass it:
<ThreadContent
  threadId={view.threadId}
  onPopOut={onPopOut}
  autoFocus={view.autoFocus}
  initialPrompt={threadPrompt}
/>
```

## Expected Results

- User's first message displays **immediately** when thread view opens
- No blank thread state
- Message is replaced by real data when `AGENT_STATE` event arrives (seamless transition)

## Files to Modify

1. `src/components/content-pane/content-pane.tsx` - Pass initialPrompt from metadata

## Testing

1. Open Spotlight, type a message, press Enter
2. Thread view should show the user message immediately (no blank state)
3. When agent responds, messages should update normally
