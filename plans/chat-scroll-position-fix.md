# Fix: Chat View Auto-Scroll Interrupting Manual Scroll

## Problem

When scrolling up through chat history to read previous messages, new content arriving causes the view to automatically scroll back down to the bottom. This is jarring and prevents users from reading through the chat history while the agent is running.

**Expected behavior:** Auto-scroll should only occur when the user is already at the bottom of the chat. If the user has manually scrolled up, their scroll position should be maintained even when new messages arrive.

## Audit: All Scroll Position Manipulators

### 1. Primary: `src/components/thread/message-list.tsx` (lines 93-104)

This is the core virtualized message list using react-virtuoso:

```tsx
<Virtuoso
  ref={virtuosoRef}
  data={turns}
  itemContent={itemContent}
  components={{ Footer }}
  followOutput={isStreaming ? "smooth" : false}  // PROBLEM: Always follows during streaming
  alignToBottom                                   // Aligns to bottom
  atBottomStateChange={setIsAtBottom}             // Tracks bottom state (unused for follow logic)
  atBottomThreshold={50}                          // 50px threshold
  style={{ height: "100%" }}
  overscan={200}
/>
```

**Issue:** `followOutput={isStreaming ? "smooth" : false}` unconditionally follows new output when streaming, regardless of whether the user manually scrolled up.

**Note:** The `isAtBottom` state IS being tracked via `atBottomStateChange`, but it's only used to show/hide the "scroll to bottom" button, not to control `followOutput`.

### 2. Secondary: `src/components/simple-task/simple-task-window.tsx` (lines 289-300)

```tsx
// Auto-scroll to bottom when simple task panel opens with messages
useEffect(() => {
  if (messages.length > 0 && messageListRef.current) {
    const timer = setTimeout(() => {
      messageListRef.current?.scrollToBottom();
    }, 100);
    return () => clearTimeout(timer);
  }
}, [messages.length > 0 && activeState?.messages ? activeState.messages.length : 0]);
```

**Issues:**
1. The dependency array expression `messages.length > 0 && activeState?.messages ? activeState.messages.length : 0` evaluates to a number, not a boolean guard. This causes the effect to re-run whenever the message count changes, triggering `scrollToBottom()` on every new message.
2. This fights with manual scroll - if user scrolled up, this effect will pull them back down.

### 3. Manual scroll-to-bottom button: `src/components/thread/message-list.tsx` (lines 107-127)

```tsx
{!isAtBottom && (
  <button onClick={scrollToBottom} ...>
    <svg>...</svg>
  </button>
)}
```

This is fine - it's user-initiated.

### 4. Focus-related scroll (potential side effects)

- `src/components/thread/ask-user-question-block.tsx` (line 44): `containerRef.current?.focus()` - could trigger browser's default scroll-into-view
- `src/components/thread/error-state.tsx` (line 17): `retryRef.current?.focus()` - same issue

### 5. Reference Implementation (correct pattern): `src/components/main-window/logs-page.tsx`

```tsx
const [autoScroll, setAutoScroll] = useState(true);

// Auto-scroll only when autoScroll is enabled
useEffect(() => {
  if (autoScroll && scrollRef.current) {
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }
}, [filteredLogs.length, autoScroll]);

// Detect manual scroll to disable auto-scroll
const handleScroll = () => {
  const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
  const isAtBottom = scrollHeight - scrollTop - clientHeight < 50;
  setAutoScroll(isAtBottom);  // Re-enable when user scrolls back to bottom
};
```

## Root Cause Summary

Two competing scroll behaviors override user's manual scroll position:

1. **Virtuoso's `followOutput` prop** - Always set to `"smooth"` during streaming, ignoring user's scroll position
2. **`simple-task-window.tsx` useEffect** - Calls `scrollToBottom()` on message count changes due to malformed dependency array

## Solution

### Step 1: Fix MessageList to respect user scroll position

Modify `followOutput` to only follow when user is at the bottom:

```tsx
// In message-list.tsx
// Change:
followOutput={isStreaming ? "smooth" : false}

// To:
followOutput={isStreaming && isAtBottom ? "smooth" : false}
```

The `isAtBottom` state is already being tracked via `atBottomStateChange={setIsAtBottom}`, we just need to use it to control `followOutput`.

### Step 2: Fix simple-task-window.tsx auto-scroll useEffect

**Required behavior to preserve:** When opening a task panel, it should scroll to the last message (bottom) on mount. This is the desired UX - users want to see the most recent activity when opening a task.

The current useEffect has a malformed dependency array that causes it to fire on every message change, not just on mount. Fix it to only run once when the panel opens:

```tsx
// Replace the existing useEffect (lines 289-300) with:

// Track whether we've done the initial scroll for this task
const hasScrolledOnMount = useRef(false);

// Reset the ref when taskId changes (navigating to a different task)
useEffect(() => {
  hasScrolledOnMount.current = false;
}, [taskId]);

// Auto-scroll to bottom ONLY on initial mount when opening panel with messages
useEffect(() => {
  if (!hasScrolledOnMount.current && messages.length > 0 && messageListRef.current) {
    hasScrolledOnMount.current = true;
    const timer = setTimeout(() => {
      messageListRef.current?.scrollToBottom();
    }, 100);
    return () => clearTimeout(timer);
  }
}, [messages.length > 0]);
```

**Why not rely on Virtuoso's `alignToBottom`?** The `alignToBottom` prop positions content at the bottom of the viewport but doesn't guarantee scroll position when the component mounts with existing data. The explicit `scrollToBottom()` on mount ensures consistent behavior.

**Key change:** The effect now runs once per task open, not on every message arrival. The `hasScrolledOnMount` ref prevents subsequent calls, and resetting it on `taskId` change ensures it works correctly when navigating between tasks.

### Step 3: Handle focus-related scroll (optional, low priority)

If focus calls are causing scroll issues, add `preventScroll: true`:

```tsx
// In ask-user-question-block.tsx
containerRef.current?.focus({ preventScroll: true });

// In error-state.tsx
retryRef.current?.focus({ preventScroll: true });
```

## Files to Modify

1. `src/components/thread/message-list.tsx` - Use `isAtBottom` state to control `followOutput`
2. `src/components/simple-task/simple-task-window.tsx` - Remove or fix the auto-scroll useEffect

## Testing

### Initial mount behavior (must preserve)
1. Open a task panel that already has messages - verify it scrolls to the bottom (most recent message)
2. Navigate between different tasks - verify each opens scrolled to its last message
3. Close and reopen the same task - verify it opens scrolled to bottom

### Scroll position during streaming (the fix)
4. Start a long-running task that produces multiple messages
5. While streaming, scroll up to read earlier messages
6. Verify scroll position is maintained as new messages arrive
7. Scroll back to bottom and verify auto-scroll resumes
8. Verify the "scroll to bottom" button appears when scrolled up
9. Verify clicking the button scrolls to bottom and re-enables auto-scroll
