# Threads List Page Components

## Files

- `src/components/main-window/threads-list-page.tsx`
- `src/components/main-window/thread-list-item.tsx`

## Purpose

Display a list of all conversation threads, sorted by most recently updated. Clicking a thread opens the thread panel.

---

## ThreadsListPage

### Implementation

```typescript
import { MessageSquare } from "lucide-react";
import { useThreadStore } from "@/entities/threads";
import { ThreadListItem } from "./thread-list-item";

export function ThreadsListPage() {
  const threads = useThreadStore((s) => Object.values(s.threads));

  // Sort by updatedAt descending
  const sortedThreads = [...threads].sort(
    (a, b) => b.updatedAt - a.updatedAt
  );

  if (sortedThreads.length === 0) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-slate-400">
        <MessageSquare size={48} className="mb-4 opacity-50" />
        <p className="text-lg font-medium">No threads yet</p>
        <p className="text-sm text-slate-500">
          Start a conversation using the spotlight
        </p>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      <header className="px-6 py-4 border-b border-slate-800">
        <h2 className="text-lg font-semibold text-slate-100">Threads</h2>
        <p className="text-sm text-slate-500">{sortedThreads.length} threads</p>
      </header>
      <div className="flex-1 overflow-y-auto">
        {sortedThreads.map((thread) => (
          <ThreadListItem key={thread.id} thread={thread} />
        ))}
      </div>
    </div>
  );
}
```

### Features

- Sorted by most recently updated
- Empty state when no threads
- Header with thread count
- Scrollable list

---

## ThreadListItem

### Implementation

```typescript
import { GitBranch } from "lucide-react";
import type { ThreadMetadata } from "@/entities/threads";
import { openThread } from "@/lib/hotkey-service";
import { formatRelativeTime } from "@/lib/utils/time-format";

interface ThreadListItemProps {
  thread: ThreadMetadata;
}

export function ThreadListItem({ thread }: ThreadListItemProps) {
  const handleClick = () => {
    openThread(thread.id);
  };

  // Get last prompt from turns array
  const lastTurn = thread.turns[thread.turns.length - 1];
  const lastPrompt = lastTurn?.prompt || "No messages";

  // Generate display title from first prompt or fallback
  const firstPrompt = thread.turns[0]?.prompt;
  const title = firstPrompt
    ? firstPrompt.slice(0, 50) + (firstPrompt.length > 50 ? "..." : "")
    : "New Thread";

  return (
    <button
      onClick={handleClick}
      className="w-full px-6 py-4 border-b border-slate-800/50 hover:bg-slate-800/30
                 transition-colors text-left flex items-start gap-4"
    >
      <div className="flex-shrink-0 mt-1">
        <StatusIndicator status={thread.status} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium text-slate-100 truncate">{title}</span>
          {thread.git?.branch && (
            <span className="flex items-center gap-1 text-xs text-slate-500">
              <GitBranch size={12} />
              {thread.git.branch}
            </span>
          )}
        </div>
        <p className="text-sm text-slate-400 truncate mt-1">
          {lastPrompt}
        </p>
        <div className="flex items-center gap-3 mt-2 text-xs text-slate-500">
          <span>{formatRelativeTime(thread.updatedAt)}</span>
          <span>{thread.turns.length} turns</span>
        </div>
      </div>
    </button>
  );
}

function StatusIndicator({ status }: { status: ThreadMetadata["status"] }) {
  const colors = {
    idle: "bg-slate-500",
    running: "bg-blue-500 animate-pulse",
    completed: "bg-green-500",
    error: "bg-red-500",
    paused: "bg-yellow-500",
  };

  return (
    <div className={`w-2 h-2 rounded-full ${colors[status]}`} />
  );
}
```

### Props

| Prop | Type | Description |
|------|------|-------------|
| `thread` | `ThreadMetadata` | The thread entity to display |

### Displays

- Status indicator (colored dot)
- Title derived from first prompt
- Git branch if available
- Last prompt preview
- Relative timestamp
- Turn count

### Interaction

- Clicking opens thread panel via `openThread()`

---

## Dependencies

- `@/entities/threads` (useThreadStore, ThreadMetadata)
- `@/lib/hotkey-service` (openThread)
- `@/lib/utils/time-format` (formatRelativeTime)
- `lucide-react`

## Notes

- `ThreadMetadata` uses camelCase timestamps (`updatedAt`, `createdAt`) as Unix milliseconds
- Status types: `"idle" | "running" | "completed" | "error" | "paused"`
- `turns` array contains all conversation turns with `prompt`, `startedAt`, `completedAt`
- Git info is optional nested object with `branch` and optional `commitHash`
