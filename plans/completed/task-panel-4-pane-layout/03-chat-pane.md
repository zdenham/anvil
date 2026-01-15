# Stream 3: Chat Pane Extraction

**Dependencies**: None (can execute in parallel with Streams 1 & 2)

## Goal

Extract the thread/chat display into a standalone `ChatPane` component with collapse functionality.

## Implementation Steps

### Step 3.1: Create ChatPane Component

**File**: `src/components/workspace/chat-pane.tsx`

```tsx
import { useState, useCallback } from "react";
import { ChevronRight, ChevronLeft, MessageSquare } from "lucide-react";
import { ThreadView } from "@/components/thread/thread-view";
import type { MessageParam } from "@anthropic-ai/sdk/resources/messages";

interface ChatPaneProps {
  threadId: string | null;
  messages: MessageParam[];
  isStreaming: boolean;
  status: "idle" | "loading" | "running" | "completed" | "error";
  error?: string;
  onRetry?: () => void;
  // Collapse state can be managed by parent or internally
  defaultCollapsed?: boolean;
}

const CHAT_PANE_WIDTH = 400;
const COLLAPSED_WIDTH = 40; // Just enough for the collapse button

export function ChatPane({
  threadId,
  messages,
  isStreaming,
  status,
  error,
  onRetry,
  defaultCollapsed = false,
}: ChatPaneProps) {
  const [isCollapsed, setIsCollapsed] = useState(defaultCollapsed);

  const handleToggleCollapse = useCallback(() => {
    setIsCollapsed((prev) => !prev);
    // Optionally persist to localStorage
    localStorage.setItem("chatPaneCollapsed", String(!isCollapsed));
  }, [isCollapsed]);

  if (isCollapsed) {
    return (
      <div
        className="h-full flex flex-col border-l border-slate-700/50 bg-slate-900/30"
        style={{ width: COLLAPSED_WIDTH }}
      >
        <CollapseButton
          isCollapsed={true}
          onClick={handleToggleCollapse}
        />
      </div>
    );
  }

  return (
    <div
      className="h-full flex flex-col border-l border-slate-700/50 bg-slate-900/30"
      style={{ width: CHAT_PANE_WIDTH }}
    >
      {/* Header with collapse button */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-slate-700/50">
        <div className="flex items-center gap-2 text-slate-400">
          <MessageSquare size={14} />
          <span className="text-xs font-medium uppercase tracking-wide">
            Agent Output
          </span>
        </div>
        <CollapseButton
          isCollapsed={false}
          onClick={handleToggleCollapse}
        />
      </div>

      {/* Thread content */}
      <div className="flex-1 min-h-0">
        {threadId ? (
          <ThreadView
            messages={messages}
            isStreaming={isStreaming}
            status={status}
            error={error}
            onRetry={onRetry}
          />
        ) : (
          <ChatEmptyState />
        )}
      </div>
    </div>
  );
}

interface CollapseButtonProps {
  isCollapsed: boolean;
  onClick: () => void;
}

function CollapseButton({ isCollapsed, onClick }: CollapseButtonProps) {
  return (
    <button
      onClick={onClick}
      className={`
        p-1.5 rounded-md transition-colors
        text-slate-500 hover:text-slate-300 hover:bg-slate-700/50
        ${isCollapsed ? "mx-auto mt-2" : ""}
      `}
      title={isCollapsed ? "Expand chat pane" : "Collapse chat pane"}
    >
      {isCollapsed ? (
        <ChevronLeft size={16} />
      ) : (
        <ChevronRight size={16} />
      )}
    </button>
  );
}

function ChatEmptyState() {
  return (
    <div className="h-full flex items-center justify-center text-slate-500">
      <div className="text-center px-4">
        <MessageSquare className="w-8 h-8 mx-auto mb-2 opacity-50" />
        <p className="text-sm">No thread selected</p>
        <p className="text-xs mt-1 text-slate-600">
          Select a thread from the menu to view agent output
        </p>
      </div>
    </div>
  );
}
```

### Step 3.2: Add Collapse State Persistence (Optional Enhancement)

```tsx
// Read initial state from localStorage
const [isCollapsed, setIsCollapsed] = useState(() => {
  if (typeof window === "undefined") return defaultCollapsed;
  const stored = localStorage.getItem("chatPaneCollapsed");
  return stored === "true";
});
```

### Step 3.3: Consider Parent-Managed Collapse State

If the parent needs to control collapse (e.g., for responsive behavior):

```tsx
interface ChatPaneProps {
  // ... existing props
  isCollapsed?: boolean;
  onToggleCollapse?: () => void;
}

// In component:
const collapsed = isCollapsed ?? internalIsCollapsed;
const toggleCollapse = onToggleCollapse ?? handleInternalToggle;
```

### Step 3.4: Responsive Width Consideration

For future enhancement, make width responsive:

```tsx
// Could be prop-based
interface ChatPaneProps {
  width?: number;
  minWidth?: number;
}

// Or use CSS clamp
style={{ width: "clamp(300px, 33%, 500px)" }}
```

## File Created

1. `src/components/workspace/chat-pane.tsx`

## Verification

After completing this stream:
1. `ChatPane` renders with collapse button
2. Clicking collapse button toggles between expanded/collapsed states
3. When collapsed, shows only a thin bar with expand button
4. When expanded, shows ThreadView or empty state
5. Collapse state persists across renders (localStorage)

## Integration Notes (for Stream 4)

When integrating in `task-workspace.tsx`:

```tsx
<ChatPane
  threadId={activeThreadId}
  messages={messages}
  isStreaming={isStreaming}
  status={viewStatus}
  error={error}
  onRetry={handleRetry}
/>
```

The ChatPane is positioned as the rightmost element in the flex container.

## Design Notes

- Collapse direction: Right pane collapses to the right (button shows `◀` when expanded, `▶` when collapsed)
- Width: Fixed 400px when expanded, 40px when collapsed
- The collapse button mirrors Apple's sidebar pattern but for the right side
- No drag-to-resize for now (keep it simple), could add later
