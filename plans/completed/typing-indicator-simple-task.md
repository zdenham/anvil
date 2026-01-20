# Typing Indicator for Simple Task Chat

## Problem

When a user sends a message in the simple task view chat, there is minimal visual feedback while waiting for the agent to start responding. The current implementation:

1. User message appears immediately (optimistic update)
2. Status transitions to "running"
3. **Gap**: Nothing visible until first text/tool content arrives
4. StreamingCursor appears once text starts streaming

This creates an awkward period where the user doesn't know if their message was received or if the agent is working.

## Current Visual Feedback

### What exists today

| State | Visual Indicator | Location |
|-------|------------------|----------|
| Status = "running" before content | None (gap) | - |
| Streaming text | `StreamingCursor` - blinking block cursor | `text-block.tsx` |
| Tool execution | `ToolStatusIcon` - spinning loader | `tool-use-block.tsx` |

### Relevant files

- `src/components/thread/thread-view.tsx` - Main container, handles state rendering
- `src/components/thread/assistant-message.tsx` - Renders assistant content blocks
- `src/components/thread/text-block.tsx` - Text with streaming cursor
- `src/components/thread/streaming-cursor.tsx` - Simple pulsing cursor
- `src/components/simple-task/simple-task-window.tsx` - Container with `isStreaming` state

## Research: AI Chatbot Conventions

### Common Patterns

1. **Bouncing Dots ("Typing Indicator")**
   - Three dots that bounce/fade in sequence
   - Used by: iMessage, Slack, WhatsApp, many chat apps
   - Familiar, lightweight, indicates "thinking"

2. **Pulsing/Shimmer Skeleton**
   - Content placeholder with animated gradient
   - Used by: Facebook, LinkedIn loading states
   - Good for longer waits, suggests content structure
   - AI-specific: Colored gradients used for AI-generated content

3. **Text Labels**
   - "Claude is thinking...", "Generating response..."
   - Used by: ChatGPT, Claude.ai, Perplexity
   - Informative, can include status updates

4. **Hybrid Approaches**
   - ChatGPT: Pulsing effect + streaming text cursor
   - Claude.ai: "Thinking" label + streaming content
   - Perplexity: Source citations loading + streaming

### Best Practices (2025 Conventions)

- **Immediate feedback**: Show indicator within 100ms of user action
- **Appropriate duration**: Dots for short waits (<5s), progress/skeleton for longer
- **Subtle animation**: Avoid distracting/jarring motion
- **Accessibility**: Include screen reader announcements
- **Contextual**: Match the interface style (chat bubble vs inline)

Sources:
- [Chatbot UX Design Guide 2025](https://www.parallelhq.com/blog/chatbot-ux-design)
- [Skeleton Loading Design](https://blog.logrocket.com/ux-design/skeleton-loading-screen-design/)
- [Design Patterns for AI Interfaces](https://www.smashingmagazine.com/2025/07/design-patterns-ai-interfaces/)

## Proposed Solution: Working Indicator

### Design Choice: Pulsing Green Dot + "Working" Text

Inspired by Claude Code's terminal UI, this approach uses a single pulsing green dot with "Working" text:

1. **On-brand**: Matches Claude Code's aesthetic and establishes visual consistency
2. **Informative**: Text clearly communicates what's happening
3. **Minimal**: Single dot is less busy than bouncing dots
4. **Distinctive**: Green color signals "active/processing" (like a status LED)

### Visual Design

```
┌─────────────────────────────────────────┐
│                              User msg   │ ← Right-aligned user bubble
├─────────────────────────────────────────┤
│  ● Working                              │ ← Left-aligned working indicator
│  ↑                                      │    (pulsing green dot + text)
│  Gentle pulse animation                 │
└─────────────────────────────────────────┘
```

**Styling:**
- Single dot, 8px diameter
- Color: `#22c55e` (green-500) - matches existing success/active colors
- Text: "Working" in `text-surface-400` (muted)
- Animation: Gentle opacity pulse, 1.5s cycle
- Spacing: Small gap between dot and text

### Component Implementation

#### New File: `src/components/thread/working-indicator.tsx`

```tsx
import { cn } from "@/lib/utils";

interface WorkingIndicatorProps {
  className?: string;
}

/**
 * Pulsing green dot with "Working" text, shown while
 * the assistant is processing but hasn't started streaming content.
 *
 * Inspired by Claude Code's terminal status indicator.
 */
export function WorkingIndicator({ className }: WorkingIndicatorProps) {
  return (
    <div
      className={cn(
        "flex items-center gap-2 px-4 py-3",
        className
      )}
      role="status"
      aria-label="Assistant is working"
    >
      <span
        className="working-dot"
        aria-hidden="true"
      />
      <span className="text-sm text-surface-400">Working</span>
      <span className="sr-only">Assistant is working on your request</span>
    </div>
  );
}
```

#### CSS Animation: `src/index.css`

Add to existing CSS:

```css
/* Working indicator - Claude Code style pulsing dot */
.working-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background-color: #22c55e; /* green-500 */
  animation: workingPulse 1.5s ease-in-out infinite;
}

@keyframes workingPulse {
  0%, 100% {
    opacity: 1;
    transform: scale(1);
  }
  50% {
    opacity: 0.5;
    transform: scale(0.9);
  }
}
```

### Alternative: Subtle Glow Effect

For a more polished look, add a subtle glow to the dot:

```css
.working-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background-color: #22c55e;
  box-shadow: 0 0 8px rgba(34, 197, 94, 0.5);
  animation: workingPulse 1.5s ease-in-out infinite;
}

@keyframes workingPulse {
  0%, 100% {
    opacity: 1;
    box-shadow: 0 0 8px rgba(34, 197, 94, 0.5);
  }
  50% {
    opacity: 0.6;
    box-shadow: 0 0 4px rgba(34, 197, 94, 0.3);
  }
}
```

### Integration Points

#### Option A: Inside MessageList (Recommended)

Add the working indicator as a pseudo-turn at the end of the message list when streaming but no assistant content yet.

**File:** `src/components/thread/message-list.tsx`

```tsx
// After the Virtuoso component, conditionally render:
{isStreaming && !hasAssistantContent && (
  <WorkingIndicator />
)}
```

**Pros:**
- Appears in the natural flow of messages
- Auto-scrolls with `followOutput`
- Clean separation of concerns

**Cons:**
- Requires passing additional state to MessageList

#### Option B: Inside ThreadView

Add after the MessageList when streaming with no assistant content.

**File:** `src/components/thread/thread-view.tsx`

```tsx
<MessageList ... />

{/* Working indicator when streaming but no assistant response yet */}
{isStreaming && !hasAssistantStarted && (
  <div className="px-4">
    <WorkingIndicator />
  </div>
)}
```

**Pros:**
- Simpler, no changes to MessageList
- Easy to style consistently

**Cons:**
- Doesn't participate in virtualized scrolling
- May need manual scroll handling

#### Option C: Inside AssistantMessage (Minimal Change)

Show working indicator as the first content block when assistant message is empty but streaming.

**File:** `src/components/thread/assistant-message.tsx`

```tsx
// At the start of the content rendering:
{content.length === 0 && isStreaming && (
  <WorkingIndicator />
)}
```

**Pros:**
- Contained within assistant turn
- Naturally replaced when content arrives

**Cons:**
- Requires an empty assistant turn to exist in messages

### Recommended Approach: Option A

The cleanest approach is to add the indicator at the MessageList level, appearing after the last user message when:
- `isStreaming === true`
- The last turn is a user turn (no assistant response yet)

This ensures:
1. Indicator appears in the correct visual position
2. Participates in scroll behavior
3. Smoothly transitions to real content

### State Detection Logic

```tsx
// In message-list.tsx or thread-view.tsx
const lastTurn = turns[turns.length - 1];
const showWorkingIndicator = isStreaming && lastTurn?.role === "user";
```

Alternatively, detect presence of assistant content:

```tsx
const hasAssistantResponse = turns.some(
  (turn, idx) => idx > 0 && turn.role === "assistant" && turn.messages.length > 0
);
const showWorkingIndicator = isStreaming && !hasAssistantResponse;
```

For the simple case where we want to show it after initial message send:

```tsx
// Last message is user, and we're streaming
const showWorkingIndicator =
  isStreaming &&
  messages.length > 0 &&
  messages[messages.length - 1].role === "user";
```

## Implementation Plan

### Step 1: Create WorkingIndicator Component

**File:** `src/components/thread/working-indicator.tsx`

Create the component with:
- Pulsing green dot visual
- "Working" text label
- ARIA accessibility attributes
- Tailwind-compatible className prop

### Step 2: Add CSS Animation

**File:** `src/index.css`

Add the keyframe animation for the pulsing green dot effect.

### Step 3: Integrate into MessageList

**File:** `src/components/thread/message-list.tsx`

Add conditional rendering:
1. Import WorkingIndicator
2. Compute `showWorkingIndicator` based on `isStreaming` and last message role
3. Render after Virtuoso when conditions met

### Step 4: Handle Scroll Behavior

Ensure the working indicator triggers scroll-to-bottom when it appears:
- Virtuoso's `followOutput` may need adjustment
- Or manually scroll when indicator renders

### Step 5: Test and Refine

1. Send a message, verify indicator appears immediately
2. Verify indicator disappears when content starts streaming
3. Test scroll behavior
4. Test accessibility (screen reader announces "working")
5. Verify animation is smooth, not jarring

## Alternative Enhancements (Future)

### Dynamic Status Text

The text could change based on agent state:
- "Working" - initial processing
- "Thinking" - extended reasoning
- "Reading files" - when tool use starts (would require deeper integration)

### Skeleton Loading for Long Waits

If the agent takes >5 seconds before first content, consider showing a skeleton placeholder:

```tsx
const [showSkeleton, setShowSkeleton] = useState(false);

useEffect(() => {
  if (showWorkingIndicator) {
    const timer = setTimeout(() => setShowSkeleton(true), 5000);
    return () => clearTimeout(timer);
  }
  setShowSkeleton(false);
}, [showWorkingIndicator]);
```

### Gradient/AI Shimmer

For AI-generated content, consider a subtle gradient shimmer effect behind the dot. This is a 2025 convention for AI interfaces to distinguish AI processing from regular loading states.

## Summary

| Task | File | Priority |
|------|------|----------|
| Create WorkingIndicator component | `src/components/thread/working-indicator.tsx` | High |
| Add CSS animation | `src/index.css` | High |
| Integrate in MessageList | `src/components/thread/message-list.tsx` | High |
| Test scroll behavior | - | High |
| Dynamic status text | Future enhancement | Low |
| Skeleton fallback | Future enhancement | Low |

**Estimated complexity:** Low (new component, CSS, minor integration)
