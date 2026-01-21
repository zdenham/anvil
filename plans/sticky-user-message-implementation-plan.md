# Sticky Pinned User Messages Implementation Plan

## Overview
Implement sticky pinning for the latest user message in the chat panel. When a user message scrolls above the fold, it will remain pinned at the top with overflow ellipses for long messages and proper vertical height accommodation.

## Current Chat Architecture Analysis

### Key Components
- **ChatPane**: Top-level chat container with collapse/expand (400px width, 40px collapsed)
- **ThreadView**: Manages message state and turn grouping
- **MessageList**: Virtualized scrolling with react-virtuoso
- **UserMessage**: Right-aligned bubble with accent-600 background

### Current Layout Structure
```
ChatPane (h-full flex flex-col)
├── Header (border-b border-surface-700, px-3 py-2)
└── ThreadView (flex-1 flex flex-col min-h-0)
    └── MessageList (flex-1 min-h-0 overflow-hidden)
        ├── Virtuoso Container
        └── Scroll-to-bottom Button
```

### Critical Layout Constraints
- Chat panel width: 250px (min) to 800px (max), default 400px
- Uses flex-1 min-h-0 pattern for proper scrolling
- Virtuoso handles message virtualization with 50px bottom threshold
- Auto-scroll during streaming with smooth behavior

## Key Decisions

### Decision 1: Turn-Based vs Message-Based Tracking
**Decision**: Track the **latest user turn** (not individual messages).

Rationale:
- The virtualization unit in Virtuoso is the turn, not the message
- `rangeChanged` reports turn indices, not message indices
- The turn contains the user message content we need to display
- Simpler integration with existing turn-grouping architecture

### Decision 2: State Location
**Decision**: State lives in `ThreadView`, with visibility computed from Virtuoso range data passed up via callback.

Structure:
```typescript
// ThreadView owns this state
const [stickyState, setStickyState] = useState<StickyMessageState | null>(null);

// MessageList reports range changes up
onRangeChanged={(range) => {
  // ThreadView computes sticky visibility from range + turns data
}}
```

### Decision 3: Layout Approach
**Decision**: Use absolute positioning with conditional padding-top on the Virtuoso container.

- Sticky message positioned absolutely at top of ThreadView
- When sticky is visible, add `padding-top` to Virtuoso wrapper to prevent content overlap
- No changes needed to ChatPane height

### Decision 4: Streaming Behavior
**Decision**: Show sticky message during streaming.

Rationale:
- Users may scroll up during long streaming responses to re-read their prompt
- The sticky provides context for what the assistant is responding to
- Hiding it would remove useful context during the most important time

### Decision 5: Visibility Hysteresis
**Decision**: Only show sticky when the user turn is **fully out of view** (not partially visible).

Rationale:
- Prevents flickering when the message is at the edge of the viewport
- If `startIndex > latestUserTurnIndex`, the turn is fully scrolled above
- This provides a clean transition point

---

## Implementation Plan

### Phase 1: Core Sticky Message Infrastructure

#### 1.1 Create Sticky Message State Types
**File**: `src/components/thread/types.ts` (or inline in thread-view.tsx)

```typescript
interface StickyMessageState {
  isVisible: boolean;
  messageContent: string;  // The text content to display
  turnIndex: number;       // For scrolling back to original
}
```

#### 1.2 Create Sticky Message Component
**File**: `src/components/thread/sticky-user-message.tsx`

A compact, styled component that:
- Displays truncated user message (max 2 lines)
- Matches UserMessage styling but compressed
- Includes click-to-scroll functionality
- Animates in/out smoothly

```typescript
interface StickyUserMessageProps {
  content: string;
  onScrollToOriginal: () => void;
}
```

Styling requirements:
- Max 2 lines with `line-clamp-2`
- Same accent-600 background as regular messages
- Smaller padding for compact display (px-3 py-2)
- Drop shadow for elevation (`shadow-lg`)
- Rounded corners consistent with message bubbles (`rounded-lg`)
- Cursor pointer to indicate clickability

#### 1.3 Update MessageList for Range Reporting
**File**: `src/components/thread/message-list.tsx`

Add/extend the following:

1. Accept an `onRangeChanged` callback prop:
```typescript
interface MessageListProps {
  // ... existing props
  onRangeChanged?: (range: { startIndex: number; endIndex: number }) => void;
}
```

2. Wire it to Virtuoso's `rangeChanged`:
```typescript
<Virtuoso
  // ... existing props
  rangeChanged={(range) => {
    onRangeChanged?.(range);
  }}
/>
```

3. Expose `scrollToIndex` via the ref:
```typescript
export interface MessageListRef {
  scrollToBottom: () => void;
  scrollToIndex: (index: number) => void;  // NEW
}

// In imperative handle:
scrollToIndex: (index: number) => {
  virtuosoRef.current?.scrollToIndex({
    index,
    align: 'start',
    behavior: 'smooth'
  });
}
```

### Phase 2: ThreadView Integration

#### 2.1 Add Sticky State Management
**File**: `src/components/thread/thread-view.tsx`

```typescript
// State
const [stickyMessage, setStickyMessage] = useState<StickyMessageState | null>(null);

// Find latest user turn (memoized)
const latestUserTurn = useMemo(() => {
  const index = turns.findLastIndex(turn =>
    turn.type === 'user' && !isToolResultOnlyTurn(turn)
  );
  if (index === -1) return null;
  return { index, turn: turns[index] };
}, [turns]);

// Handle range changes from MessageList
const handleRangeChanged = useCallback((range: { startIndex: number; endIndex: number }) => {
  if (!latestUserTurn) {
    setStickyMessage(null);
    return;
  }

  // Show sticky only when turn is FULLY out of view (scrolled above)
  const isFullyAboveViewport = range.startIndex > latestUserTurn.index;

  if (isFullyAboveViewport) {
    const content = getUserTurnPrompt(latestUserTurn.turn);
    setStickyMessage({
      isVisible: true,
      messageContent: content,
      turnIndex: latestUserTurn.index,
    });
  } else {
    setStickyMessage(null);
  }
}, [latestUserTurn]);

// Scroll to original message
const handleScrollToOriginal = useCallback(() => {
  if (stickyMessage && messageListRef.current) {
    messageListRef.current.scrollToIndex(stickyMessage.turnIndex);
  }
}, [stickyMessage]);
```

#### 2.2 Update ThreadView Layout
**File**: `src/components/thread/thread-view.tsx`

```tsx
<div className="flex-1 flex flex-col min-h-0 relative">
  {/* Sticky message - absolutely positioned */}
  {stickyMessage?.isVisible && (
    <StickyUserMessage
      content={stickyMessage.messageContent}
      onScrollToOriginal={handleScrollToOriginal}
    />
  )}

  {/* Message list with conditional padding */}
  <div className={cn(
    "flex-1 min-h-0",
    stickyMessage?.isVisible && "pt-14" // ~56px for sticky height
  )}>
    <MessageList
      ref={messageListRef}
      turns={turns}
      onRangeChanged={handleRangeChanged}
      // ... other props
    />
  </div>
</div>
```

### Phase 3: Styling and Animation

#### 3.1 Sticky Message Styles
**File**: `src/components/thread/sticky-user-message.tsx`

```tsx
export function StickyUserMessage({ content, onScrollToOriginal }: StickyUserMessageProps) {
  return (
    <button
      onClick={onScrollToOriginal}
      className={cn(
        // Positioning
        "absolute top-0 left-0 right-0 z-10",
        // Sizing & layout
        "mx-3 mt-2 px-3 py-2",
        // Visual styling (match UserMessage)
        "bg-accent-600 text-white rounded-lg",
        "shadow-lg",
        // Text truncation
        "text-sm text-left line-clamp-2",
        // Animation
        "animate-in slide-in-from-top-2 fade-in duration-150",
        // Interactive
        "cursor-pointer hover:bg-accent-500 transition-colors",
        // Accessibility
        "focus:outline-none focus:ring-2 focus:ring-accent-400 focus:ring-offset-2 focus:ring-offset-surface-800"
      )}
      aria-label="Click to scroll to original message"
    >
      {content}
    </button>
  );
}
```

#### 3.2 Animation Details
If the project doesn't have `animate-in` utilities, add equivalent CSS:

```css
@keyframes slideInFromTop {
  from {
    transform: translateY(-100%);
    opacity: 0;
  }
  to {
    transform: translateY(0);
    opacity: 1;
  }
}

.sticky-message-enter {
  animation: slideInFromTop 150ms ease-out;
}
```

### Phase 4: Edge Cases

#### 4.1 Edge Case Handling

| Scenario | Behavior |
|----------|----------|
| Very first user message, no scrolling yet | No sticky (message is visible) |
| User scrolls up 1px, message partially visible | No sticky (hysteresis: must be fully above) |
| User scrolls up, message fully above viewport | Show sticky |
| New user message sent | Reset sticky state, scroll to bottom |
| Thread switch | Reset sticky state |
| Very long first message | Same rules apply - only sticky when fully above |
| Empty/whitespace message | Don't show sticky (filter in `latestUserTurn` logic) |
| User clicks sticky during streaming | Scroll to original, streaming continues |

#### 4.2 Thread Switching
Reset sticky state when thread changes:
```typescript
useEffect(() => {
  setStickyMessage(null);
}, [threadId]);
```

#### 4.3 New Message Reset
When a new user message is added, the scroll-to-bottom behavior will naturally hide the sticky since the new message will be in view.

### Phase 5: Performance Optimization

#### 5.1 Memoization
```typescript
// Memoize latest user turn calculation
const latestUserTurn = useMemo(() => { ... }, [turns]);

// Memoize range handler
const handleRangeChanged = useCallback(() => { ... }, [latestUserTurn]);

// Memoize scroll handler
const handleScrollToOriginal = useCallback(() => { ... }, [stickyMessage]);
```

#### 5.2 Debouncing (Optional)
If range changes fire too frequently, debounce the handler:
```typescript
const handleRangeChanged = useDebouncedCallback((range) => {
  // ... sticky logic
}, 50); // 50ms debounce
```

However, start without debouncing and add only if performance issues arise.

#### 5.3 Component Memoization
```typescript
export const StickyUserMessage = memo(function StickyUserMessage({ ... }) {
  // ...
});
```

---

## Files Summary

### New Files
1. `src/components/thread/sticky-user-message.tsx` - Sticky message UI component

### Modified Files
1. `src/components/thread/message-list.tsx` - Add `onRangeChanged` prop and `scrollToIndex` ref method
2. `src/components/thread/thread-view.tsx` - Add sticky state management, layout changes

### Reference Files (For Patterns)
1. `src/components/thread/user-message.tsx` - Existing user message styling
2. `src/lib/utils/turn-grouping.ts` - Turn utilities like `getUserTurnPrompt`

---

## Success Criteria

1. **Functional**: Latest user message pins at top when fully scrolled out of view
2. **Visual**: Clean 2-line truncation with proper ellipses, matches UserMessage styling
3. **Interactive**: Click scrolls smoothly to original message location
4. **Performance**: No scroll lag, minimal re-renders
5. **Streaming**: Sticky remains functional during assistant streaming
6. **Accessible**: Proper ARIA labels, keyboard accessible (button element)
7. **Responsive**: Works across all chat panel sizes (250px-800px)

---

## Testing Checklist

- [ ] Short message: pins correctly, no truncation
- [ ] Long message: pins with 2-line truncation and ellipsis
- [ ] Click sticky: smoothly scrolls to original message
- [ ] Partial scroll: message partially visible = no sticky
- [ ] Full scroll: message fully above = sticky appears
- [ ] During streaming: sticky shows and functions normally
- [ ] Scroll up during streaming: sticky shows, can click to scroll
- [ ] New message sent: sticky disappears, view scrolls to new message
- [ ] Thread switch: sticky resets
- [ ] Narrow panel (250px): sticky readable and functional
- [ ] Wide panel (800px): sticky doesn't stretch oddly
- [ ] Keyboard: can tab to sticky and activate with Enter/Space
- [ ] Screen reader: announces purpose of sticky message
