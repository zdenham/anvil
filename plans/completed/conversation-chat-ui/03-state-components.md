# State Components

Simple components for displaying loading, empty, and error states in the conversation UI.

**Prerequisites:** `01-types-and-utilities.md`

## Files Owned

```
src/components/conversation/
├── loading-state.tsx     # Loading spinner/skeleton
├── empty-state.tsx       # No messages yet
└── error-state.tsx       # Error display with retry
```

## Implementation

### 1. Create loading-state.tsx

Displayed when `status === "loading"`:

```typescript
// src/components/conversation/loading-state.tsx
import { Loader2 } from "lucide-react";

export function LoadingState() {
  return (
    <div
      className="flex flex-col items-center justify-center h-full gap-3 text-muted-foreground"
      role="status"
      aria-label="Loading conversation"
    >
      <Loader2 className="h-8 w-8 animate-spin" aria-hidden="true" />
      <p className="text-sm">Loading conversation...</p>
    </div>
  );
}
```

### 2. Create empty-state.tsx

Displayed when `status === "running"` and `messages.length === 0`:

```typescript
// src/components/conversation/empty-state.tsx
import { MessageSquare } from "lucide-react";

interface EmptyStateProps {
  /** Whether the agent is currently running */
  isRunning?: boolean;
}

export function EmptyState({ isRunning = false }: EmptyStateProps) {
  return (
    <div
      className="flex flex-col items-center justify-center h-full gap-3 text-muted-foreground"
      role="status"
      aria-live="polite"
    >
      <MessageSquare className="h-12 w-12 opacity-50" aria-hidden="true" />
      {isRunning ? (
        <>
          <p className="text-sm">Waiting for response...</p>
          <AnimatedDots />
        </>
      ) : (
        <p className="text-sm">No messages yet</p>
      )}
    </div>
  );
}

function AnimatedDots() {
  return (
    <span className="inline-flex gap-1" aria-hidden="true">
      <span className="h-2 w-2 rounded-full bg-current animate-bounce [animation-delay:-0.3s]" />
      <span className="h-2 w-2 rounded-full bg-current animate-bounce [animation-delay:-0.15s]" />
      <span className="h-2 w-2 rounded-full bg-current animate-bounce" />
    </span>
  );
}
```

### 3. Create error-state.tsx

Displayed when `status === "error"`:

```typescript
// src/components/conversation/error-state.tsx
import { useRef, useEffect } from "react";
import { AlertCircle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

interface ErrorStateProps {
  /** Error message to display */
  error?: string;
  /** Callback to retry loading */
  onRetry?: () => void;
}

export function ErrorState({ error, onRetry }: ErrorStateProps) {
  const retryRef = useRef<HTMLButtonElement>(null);

  // Focus retry button on mount for accessibility
  useEffect(() => {
    retryRef.current?.focus();
  }, []);

  return (
    <div
      className="flex flex-col items-center justify-center h-full gap-4 p-6"
      role="alert"
      aria-live="assertive"
    >
      <div className="flex items-center gap-2 text-destructive">
        <AlertCircle className="h-6 w-6" aria-hidden="true" />
        <h2 className="text-lg font-medium">Something went wrong</h2>
      </div>

      {error && (
        <p className="text-sm text-muted-foreground max-w-md text-center">
          {error}
        </p>
      )}

      {onRetry && (
        <Button
          ref={retryRef}
          variant="outline"
          size="sm"
          onClick={onRetry}
          className="gap-2"
        >
          <RefreshCw className="h-4 w-4" aria-hidden="true" />
          Retry
        </Button>
      )}
    </div>
  );
}
```

### 4. Create status-announcement.tsx

Screen reader announcements for status changes:

```typescript
// src/components/conversation/status-announcement.tsx
import type { ConversationState } from "@/stores/conversation-store";

interface StatusAnnouncementProps {
  status: ConversationState["status"];
  error?: string;
}

/**
 * Screen reader-only live region for status announcements.
 */
export function StatusAnnouncement({ status, error }: StatusAnnouncementProps) {
  let announcement = "";

  switch (status) {
    case "idle":
      announcement = ""; // No announcement needed
      break;
    case "loading":
      announcement = "Loading conversation";
      break;
    case "running":
      announcement = "Assistant is responding";
      break;
    case "completed":
      announcement = "Response complete";
      break;
    case "error":
      announcement = error ? `Error: ${error}` : "An error occurred";
      break;
  }

  if (!announcement) return null;

  return (
    <div role="status" aria-live="polite" className="sr-only">
      {announcement}
    </div>
  );
}
```

## Styling

### CSS Classes

Add these utility classes to your global styles or Tailwind config:

```css
/* Screen reader only - visually hidden but accessible */
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}
```

### Reduced Motion

These components use Tailwind's `animate-*` utilities which automatically respect `prefers-reduced-motion`:

```css
@media (prefers-reduced-motion: reduce) {
  .animate-spin,
  .animate-bounce {
    animation: none;
  }
}
```

## Usage

```typescript
// In ConversationView
function ConversationView({ conversationId, workingDirectory }: Props) {
  const { messages, status, error, isStreaming, reload } = useConversation(
    conversationId,
    workingDirectory
  );

  if (status === "loading") {
    return <LoadingState />;
  }

  if (status === "error" && messages.length === 0) {
    return <ErrorState error={error} onRetry={reload} />;
  }

  if (status === "idle" || messages.length === 0) {
    return <EmptyState isRunning={isStreaming} />;
  }

  return (
    <>
      <StatusAnnouncement status={status} error={error} />
      <MessageList messages={messages} isStreaming={isStreaming} />
    </>
  );
}
```

## Accessibility

- **LoadingState**: Uses `role="status"` with `aria-label` for screen readers
- **EmptyState**: Uses `aria-live="polite"` to announce changes
- **ErrorState**: Uses `role="alert"` and `aria-live="assertive"` for immediate announcement
- **StatusAnnouncement**: Provides ongoing status updates to screen readers

All components:
- Have visible focus indicators via Tailwind's `focus-visible:` utilities
- Support keyboard navigation
- Work with reduced motion preferences

## Checklist

- [ ] Create `src/components/conversation/loading-state.tsx`
- [ ] Create `src/components/conversation/empty-state.tsx`
- [ ] Create `src/components/conversation/error-state.tsx`
- [ ] Create `src/components/conversation/status-announcement.tsx`
- [ ] Add sr-only utility class if not already present
- [ ] Test with screen readers
