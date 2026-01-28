# Plan: Top-Aligned Chat UI (ChatGPT-style)

## Problem

Currently, our chat UI starts messages at the bottom of the container and fills upward. This is achieved through react-virtuoso's `alignToBottom` property. Most popular chat applications (ChatGPT, Claude.ai, Slack, etc.) start messages at the top and fill downward, which feels more natural for reading and is what users expect.

## Current Behavior

- Messages render top-to-bottom chronologically (correct)
- But the container is bottom-aligned via `alignToBottom` on Virtuoso
- When there are few messages, they appear at the bottom of the viewport
- New messages push content up

## Desired Behavior

- Messages start at the top of the container
- When there are few messages, they appear at the top with empty space below
- New messages appear below existing ones
- Auto-scroll to bottom only during active streaming when user is already at bottom
- User can scroll freely; scroll-to-bottom button appears when scrolled away

## Files to Modify

### 1. `src/components/thread/message-list.tsx`

**Changes:**
- Remove `alignToBottom` prop from Virtuoso
- Keep `followOutput` behavior for streaming
- Keep scroll-to-bottom button logic (still useful when there are many messages)
- Adjust initial scroll behavior - no longer need to scroll to bottom on mount for short conversations

```tsx
// Before
<Virtuoso
  ref={virtuosoRef}
  data={turns}
  itemContent={itemContent}
  components={{ Footer }}
  followOutput={isStreaming && isAtBottom ? "smooth" : false}
  alignToBottom  // REMOVE THIS
  atBottomStateChange={setIsAtBottom}
  atBottomThreshold={50}
  style={{ height: "100%" }}
  overscan={200}
/>

// After
<Virtuoso
  ref={virtuosoRef}
  data={turns}
  itemContent={itemContent}
  components={{ Footer }}
  followOutput={isStreaming && isAtBottom ? "smooth" : false}
  atBottomStateChange={setIsAtBottom}
  atBottomThreshold={50}
  style={{ height: "100%" }}
  overscan={200}
  initialTopMostItemIndex={0}  // Start at top
/>
```

### 2. `src/components/content-pane/thread-content.tsx`

**Changes:**
- Review auto-scroll on mount behavior (lines 270-283)
- For new conversations, don't auto-scroll to bottom
- For conversations with many messages, consider whether to scroll to bottom on open or stay at top

**Decision needed:** When opening an existing conversation with many messages:
- Option A: Start at top (user scrolls to see latest)
- Option B: Scroll to bottom to show latest (current behavior, still useful)
- Option C: Remember scroll position per thread

Recommendation: **Option B** - Keep scrolling to bottom on mount for existing conversations. This matches ChatGPT behavior where you see the latest messages when opening a conversation.

### 3. Empty State Positioning

The empty state component (`src/components/thread/empty-state.tsx`) may need adjustment if it's currently centered vertically assuming bottom alignment.

**Review:** Check if empty state uses flex centering that depends on the bottom-aligned layout.

## Implementation Steps

1. **Remove `alignToBottom` from Virtuoso** in `message-list.tsx`
2. **Add `initialTopMostItemIndex={0}`** to ensure we start at top
3. **Keep scroll-to-bottom-on-mount** in `thread-content.tsx` for existing conversations
4. **Test scenarios:**
   - New empty thread (messages should appear at top)
   - Thread with 1-2 messages (should be at top, not bottom)
   - Thread with many messages (should scroll to bottom on open)
   - Streaming new messages (should auto-scroll if at bottom)
   - User scrolls up during streaming (should NOT auto-scroll, button appears)
5. **Verify empty state** still looks correct

## Visual Comparison

### Before (Bottom-aligned)
```
┌─────────────────────┐
│                     │
│                     │
│                     │
│   [User message]    │
│   [Assistant msg]   │
│   [Input box]       │
└─────────────────────┘
```

### After (Top-aligned)
```
┌─────────────────────┐
│   [User message]    │
│   [Assistant msg]   │
│                     │
│                     │
│                     │
│   [Input box]       │
└─────────────────────┘
```

## Risk Assessment

- **Low risk**: This is a UI layout change with no data implications
- **Testing focus**: Scroll behavior during streaming, scroll position restoration
- **Rollback**: Simple - just re-add `alignToBottom` prop

## Questions for User

1. When opening an existing conversation with history, should we:
   - Show latest messages (scroll to bottom) - **recommended**
   - Show oldest messages (start at top)
   - Remember last scroll position

2. Should the scroll-to-bottom button behavior change? Currently it appears when scrolled away from bottom.
