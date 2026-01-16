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

## Implementation Plan

### Phase 0: Architecture Alignment (CRITICAL)

#### 0.1 Turn-Based Tracking Analysis
**Research**: Understand turn vs message tracking implications
- Your system uses turn grouping (`getUserTurnPrompt(turn)`)
- Need to decide: track individual user messages OR complete user turns
- **Recommendation**: Track individual user messages for simplicity

#### 0.2 Virtuoso Integration Strategy
**Research**: Leverage existing react-virtuoso patterns
- Current implementation uses `rangeChanged` callbacks effectively
- **Recommendation**: Use Virtuoso's built-in range tracking instead of IntersectionObserver
- Better performance and integration with existing scroll behavior

### Phase 1: Core Sticky Message Infrastructure

#### 1.1 Create Sticky Message Detection Hook
**File**: `src/hooks/use-sticky-user-message.ts`

Create a custom hook using **Virtuoso-native approach**:
- Track latest user message content and turn index
- Use Virtuoso's `rangeChanged` callback for visibility detection
- Coordinate with existing streaming and auto-scroll states
- Handle streaming hide/show behavior

Key features:
- Integrate with existing MessageList ref pattern
- Track turn-level visibility using `rangeChanged`
- Debounce state updates (100ms, following existing pattern)
- Reset state when new user message arrives
- Hide during active streaming to avoid conflicts

#### 1.2 Create Sticky Message Component
**File**: `src/components/thread/sticky-user-message.tsx`

Sticky message component with:
- Fixed positioning at top of chat area
- 2-line text truncation with ellipses
- Same styling as regular user messages but compressed
- Smooth show/hide animations (slide down from top)
- Click handler to scroll to original message location

Styling requirements:
- Max 2 lines with `line-clamp-2`
- Same accent-600 background as regular messages
- Smaller padding for compact display (px-3 py-2 vs px-4 py-3)
- Drop shadow for elevation effect
- Rounded corners consistent with message bubbles

#### 1.3 Enhanced MessageList Integration
**File**: `src/components/thread/message-list.tsx`

Extend existing MessageList to support sticky functionality:
- Add `rangeChanged` callback to existing Virtuoso configuration
- Extend MessageListRef interface with sticky message controls
- Integrate with existing scroll-to-bottom functionality
- Track latest user turn index for visibility detection
- Coordinate with streaming states to hide sticky during assistant responses

```typescript
// Extend existing interface
export interface MessageListRef {
  scrollToBottom: () => void;
  // Add sticky controls
  getStickyMessageState: () => StickyMessageState;
  scrollToTurn: (turnIndex: number) => void;
}
```

### Phase 2: Layout Adjustments

#### 2.1 Update ThreadView Layout
**File**: `src/components/thread/thread-view.tsx`

Modify container to accommodate sticky message:
- Add sticky message container above MessageList
- Implement state management for sticky message visibility
- Coordinate between scroll detection and message rendering
- Pass user message data to sticky component

New layout structure:
```
ThreadView (flex-1 flex flex-col min-h-0)
├── StickyUserMessage (absolute top positioning)
└── MessageList (flex-1 min-h-0 with top padding when sticky active)
```

#### 2.2 Adjust Chat Panel Height
**File**: `src/components/workspace/chat-pane.tsx`

Increase effective chat area height:
- Add 60-80px to accommodate sticky message space
- Ensure sticky message doesn't overlap header
- Maintain existing collapse/expand behavior
- Preserve resize functionality

#### 2.3 Update Chat Panel Constraints
**File**: `src/components/workspace/task-workspace.tsx`

Adjust minimum chat panel width if needed:
- Test sticky message at 250px width (current minimum)
- Ensure readability of truncated text
- Consider increasing minimum width to 280px if needed
- Update localStorage persistence for new constraints

### Phase 3: User Experience Enhancements

#### 3.1 Smooth Animations
Add CSS transitions for:
- Sticky message slide-in/slide-out (from top)
- Opacity fade for smooth appearance
- MessageList padding adjustment when sticky appears
- Coordinated animations to avoid jarring layout shifts

#### 3.2 Interactive Behaviors
- Click sticky message to scroll to original location
- Hover effects for visual feedback
- Maintain accessibility with proper ARIA labels
- Keyboard navigation support

#### 3.3 Edge Case Handling
- Multiple rapid user messages (only pin latest)
- Very short messages (maintain minimum height)
- Empty or whitespace-only messages (don't pin)
- Message editing/deletion scenarios
- Thread switching behavior

### Phase 4: Performance Optimization (Updated)

#### 4.1 Virtuoso Range Optimization
- Leverage Virtuoso's built-in range tracking instead of observers
- Efficient turn index calculation and caching
- Throttled range change callbacks (100ms)
- Memory-efficient turn lookup patterns

#### 4.2 Re-render Minimization
- Use React.memo for sticky message component
- Minimize state updates with useCallback optimization
- Lazy evaluation of message truncation
- Debounced range change tracking (following existing patterns)

#### 4.3 Streaming Coordination
- Hide sticky messages during active assistant streaming
- Coordinate with existing `followOutput="smooth"` behavior
- Maintain smooth scrolling during pin/unpin transitions
- Integrate with existing `isStreaming` state management

## Technical Implementation Details

### State Management Pattern (Updated)
```typescript
interface StickyMessageState {
  isVisible: boolean;
  messageContent: string;
  turnId: string;
  turnIndex: number;
  isStreaming: boolean; // Hide sticky during streaming
}

// Integration with existing turn utilities
const latestUserTurnIndex = turns.findLastIndex(turn =>
  turn.type === 'user' && !isToolResultOnlyTurn(turn)
);
```

### Virtuoso Range Tracking Implementation
```typescript
// Add to existing Virtuoso configuration in MessageList
<Virtuoso
  ref={virtuosoRef}
  data={turns}
  itemContent={itemContent}
  followOutput={isStreaming ? "smooth" : false}
  alignToBottom
  atBottomStateChange={setIsAtBottom}
  atBottomThreshold={50}
  // NEW: Add range tracking for sticky messages
  rangeChanged={(range) => {
    const latestUserTurnIndex = findLatestUserTurnIndex(turns);
    const isLatestUserVisible = range.startIndex <= latestUserTurnIndex &&
                               latestUserTurnIndex <= range.endIndex;
    updateStickyVisibility(!isLatestUserVisible && !isStreaming);
  }}
  style={{ height: "100%" }}
  overscan={200}
/>
```

### CSS Classes for Truncation
```css
.sticky-message {
  @apply line-clamp-2 max-h-12 overflow-hidden text-ellipsis;
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  z-index: 10;
  background: rgba(22, 163, 74, 0.95); /* accent-600 with opacity */
  backdrop-filter: blur(4px);
}
```

### Performance Considerations (Updated)
- Use Virtuoso's `rangeChanged` instead of intersection observers
- Implement `useMemo` for turn content processing following existing patterns
- Debounce range change callbacks (100ms, consistent with codebase)
- Integrate with existing ref cleanup and state management patterns
- Hide sticky during streaming to avoid conflicts with auto-scroll

### Accessibility Requirements
- `aria-label` describing sticky message purpose
- Screen reader announcements for pin/unpin state
- Keyboard navigation to scroll to original message
- Sufficient color contrast for truncated text

## Files to Modify

### New Files
1. `src/hooks/use-sticky-user-message.ts` - Core sticky message logic with Virtuoso integration
2. `src/components/thread/sticky-user-message.tsx` - Sticky message UI component

### Modified Files (Priority Order)
1. `src/components/thread/message-list.tsx` - **CRITICAL**: Add rangeChanged callback and extend MessageListRef interface
2. `src/components/thread/thread-view.tsx` - **CRITICAL**: Layout integration and sticky message positioning
3. `src/lib/utils/turn-grouping.ts` - **OPTIONAL**: Add utility for finding latest user turn index
4. `src/components/workspace/chat-pane.tsx` - **MINOR**: Height adjustments (may not be needed with absolute positioning)

### Reference Files (For Implementation Patterns)
1. `src/components/diff-viewer/use-diff-navigation.ts` - Debouncing and cleanup patterns
2. `src/components/thread/turn-renderer.tsx` - Turn structure understanding
3. `src/components/thread/user-message.tsx` - Existing user message styling

### CSS Updates
- Add line-clamp utilities to global CSS
- Sticky message specific animations
- Z-index management for proper layering

## Success Criteria

1. **Functional**: Latest user message pins at top when scrolled out of view
2. **Visual**: Clean 2-line truncation with proper ellipses
3. **Performance**: No scroll lag or memory leaks
4. **Accessible**: Screen reader compatible with keyboard navigation
5. **Responsive**: Works across all chat panel sizes (250px-800px)
6. **Compatible**: Integrates seamlessly with existing virtualization and auto-scroll

## Risk Mitigation

### Potential Issues
- Layout shifting when sticky appears/disappears
- Performance impact on scroll-heavy conversations
- Intersection observer browser compatibility
- Z-index conflicts with other UI elements

### Mitigation Strategies
- Thorough testing across different message lengths
- Performance monitoring during scroll events
- Fallback behavior for unsupported browsers
- CSS isolation to prevent style conflicts

## Testing Strategy

1. **Unit Tests**: Hook logic and component rendering
2. **Integration Tests**: Scroll behavior and state management
3. **Manual Testing**: Various message lengths and chat panel sizes
4. **Performance Tests**: Memory usage and scroll smoothness
5. **Accessibility Tests**: Screen reader and keyboard navigation