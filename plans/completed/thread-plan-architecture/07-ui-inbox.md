# 07: Inbox UI Updates

**Dependencies:** 04-thread-refactor.md, 05-plan-entity.md, 06-relations.md
**Can run parallel with:** None (needs all entity work complete)

## Goal

Update the inbox UI to show threads and plans in a **single unified list** (not separated by type), following the same patterns as the existing `UnifiedTaskList` component.

## Key Design Decisions

1. **No separate sections** - Threads and plans are interleaved in a single chronological list sorted by `updatedAt`
2. **No filter tabs** - Simple unified view without filtering
3. **Icon differentiation** - Small icon in each row to distinguish threads from plans (no type pills/badges)
4. **Display content:**
   - **Threads:** Show the last user message (truncated)
   - **Plans:** Show the plan filename (from `relativePath`)

## Design Principles

Match the existing task list UI patterns from `src/components/shared/unified-task-list.tsx`:
- Simple `<ul>/<li>` structure with `space-y-2` gap
- Consistent styling: `bg-surface-800 rounded-lg border border-surface-700 hover:border-surface-600`
- Status dot with color/animation (green pulse for running, blue for unread, grey otherwise)
- Monospace title: `text-sm text-surface-100 font-mono truncate`
- Callback-based architecture: `onSelect`, `onDelete`
- Sort by `updatedAt` descending (most recent first)
- Empty state component when list is empty

## Tasks

### 1. Create inbox types

Create `src/components/inbox/types.ts`:

```typescript
import type { ThreadMetadata } from "@/entities/threads/types";
import type { PlanMetadata } from "@/entities/plans/types";

// Union type for unified list items
export type InboxItem =
  | { type: 'thread'; data: ThreadMetadata; sortKey: number; displayText: string }
  | { type: 'plan'; data: PlanMetadata; sortKey: number; displayText: string };

export interface UnifiedInboxProps {
  /** Array of threads to display */
  threads: ThreadMetadata[];
  /** Array of plans to display */
  plans: PlanMetadata[];
  /** Last user message for each thread (for display) */
  threadLastMessages: Record<string, string>;
  /** Callback when a thread is selected */
  onThreadSelect: (thread: ThreadMetadata) => void;
  /** Callback when a plan is selected */
  onPlanSelect: (plan: PlanMetadata) => void;
  /** Custom CSS classes for the container */
  className?: string;
  /** Optional callback when a thread should be deleted */
  onThreadDelete?: (thread: ThreadMetadata) => void;
  /** Optional callback when a plan should be deleted */
  onPlanDelete?: (plan: PlanMetadata) => void;
}
```

### 2. Create inbox utilities

Create `src/components/inbox/utils.ts`:

```typescript
import type { ThreadMetadata } from "@/entities/threads/types";
import type { PlanMetadata } from "@/entities/plans/types";
import type { InboxItem } from "./types";
import path from "path";

/**
 * Get the display name for a plan (filename without extension).
 */
export function getPlanDisplayName(plan: PlanMetadata): string {
  const filename = path.basename(plan.relativePath);
  return filename.replace(/\.md$/, '');
}

/**
 * Combine threads and plans into a single sorted list.
 */
export function createUnifiedList(
  threads: ThreadMetadata[],
  plans: PlanMetadata[],
  threadLastMessages: Record<string, string>
): InboxItem[] {
  const items: InboxItem[] = [
    ...threads.map((t) => ({
      type: 'thread' as const,
      data: t,
      sortKey: t.updatedAt,
      displayText: threadLastMessages[t.id] || t.id.slice(0, 8),
    })),
    ...plans.map((p) => ({
      type: 'plan' as const,
      data: p,
      sortKey: p.updatedAt,
      displayText: getPlanDisplayName(p),
    })),
  ];

  // Sort by updatedAt descending (most recent first)
  return items.sort((a, b) => b.sortKey - a.sortKey);
}
```

### 3. Create inbox item component

Create `src/components/inbox/inbox-item.tsx`:

```typescript
import { MessageSquare, FileText } from "lucide-react";
import type { ThreadMetadata } from "@/entities/threads/types";
import type { PlanMetadata } from "@/entities/plans/types";
import type { InboxItem } from "./types";
import { getThreadDotColor, getPlanDotColor } from "@/utils/thread-colors";
import { useRelationStore } from "@/entities/relations/store";
import { useThreadStore } from "@/entities/threads/store";
import { DeleteButton } from "@/components/tasks/delete-button";

interface InboxItemRowProps {
  item: InboxItem;
  onSelect: () => void;
  onDelete?: () => void;
}

export function InboxItemRow({ item, onSelect, onDelete }: InboxItemRowProps) {
  const { color, animation } = useItemDotColor(item);
  const isUnread = !item.data.isRead;

  return (
    <li
      onClick={onSelect}
      className="group flex items-center gap-3 px-3 py-2 bg-surface-800 rounded-lg border border-surface-700 hover:border-surface-600 cursor-pointer transition-colors"
    >
      {/* Type icon - distinguish thread from plan */}
      <span className="w-4 h-4 flex items-center justify-center text-surface-400 flex-shrink-0">
        {item.type === 'thread' ? (
          <MessageSquare size={14} />
        ) : (
          <FileText size={14} />
        )}
      </span>

      {/* Status dot */}
      <span
        className={`w-2 h-2 rounded-full flex-shrink-0 ${color} ${animation || ""}`}
      />

      {/* Display text - last message for threads, filename for plans */}
      <span className="flex-1 text-sm text-surface-100 truncate font-mono">
        {item.displayText}
      </span>

      {/* Unread indicator */}
      {isUnread && (
        <span className="w-2 h-2 rounded-full bg-accent-500" title="Unread" />
      )}

      {/* Delete button */}
      {onDelete && (
        <DeleteButton onDelete={onDelete} />
      )}
    </li>
  );
}

function useItemDotColor(item: InboxItem): { color: string; animation?: string } {
  // For threads, use thread status directly
  if (item.type === 'thread') {
    return getThreadDotColor(item.data as ThreadMetadata);
  }

  // For plans, derive running status from associated threads
  const plan = item.data as PlanMetadata;
  const relations = useRelationStore((s) => s.getByPlan(plan.id));
  const threads = useThreadStore((s) => s.getAll());

  const hasRunningThread = relations.some((rel) => {
    const thread = threads.find((t) => t.id === rel.threadId);
    return thread?.status === 'running';
  });

  return getPlanDotColor(plan.isRead, hasRunningThread);
}
```

### 4. Create hook for last user messages

Create `src/hooks/use-thread-last-messages.ts`:

```typescript
import { useMemo } from "react";
import type { ThreadMetadata, ThreadTurn } from "@/entities/threads/types";

/**
 * Get the last user message from a thread's turns array.
 * The turns array on ThreadMetadata already contains user prompts.
 */
function getLastUserMessage(thread: ThreadMetadata): string {
  if (!thread.turns || thread.turns.length === 0) {
    return thread.id.slice(0, 8); // Fallback to truncated ID
  }

  // Get the last turn with a prompt (user message)
  const lastTurn = thread.turns[thread.turns.length - 1];
  if (!lastTurn?.prompt) {
    return thread.id.slice(0, 8);
  }

  // Truncate long messages for display
  const maxLength = 100;
  if (lastTurn.prompt.length > maxLength) {
    return lastTurn.prompt.slice(0, maxLength) + '...';
  }

  return lastTurn.prompt;
}

/**
 * Hook to get the last user message for each thread.
 * Uses the turns array on ThreadMetadata which already contains user prompts.
 */
export function useThreadLastMessages(threads: ThreadMetadata[]): Record<string, string> {
  return useMemo(() => {
    const messages: Record<string, string> = {};

    for (const thread of threads) {
      messages[thread.id] = getLastUserMessage(thread);
    }

    return messages;
  }, [threads]);
}
```

**Note:** The `turns` array on `ThreadMetadata` already contains user prompts from each conversation turn, so we don't need to load the full conversation file. The last turn's `prompt` field gives us the last user message.

### 5. Create unified inbox component

Create `src/components/inbox/unified-inbox.tsx`:

```typescript
import { useMemo } from "react";
import type { ThreadMetadata } from "@/entities/threads/types";
import type { PlanMetadata } from "@/entities/plans/types";
import type { UnifiedInboxProps } from "./types";
import { InboxItemRow } from "./inbox-item";
import { createUnifiedList } from "./utils";
import { EmptyInboxState } from "./empty-inbox-state";

export function UnifiedInbox({
  threads,
  plans,
  threadLastMessages,
  onThreadSelect,
  onPlanSelect,
  className = "",
  onThreadDelete,
  onPlanDelete,
}: UnifiedInboxProps) {
  // Create unified list sorted by updatedAt
  const items = useMemo(
    () => createUnifiedList(threads, plans, threadLastMessages),
    [threads, plans, threadLastMessages]
  );

  if (items.length === 0) {
    return <EmptyInboxState />;
  }

  return (
    <div className={className}>
      <ul className="space-y-2 px-3 pt-3">
        {items.map((item) => (
          <InboxItemRow
            key={`${item.type}-${item.data.id}`}
            item={item}
            onSelect={() => {
              if (item.type === 'thread') {
                onThreadSelect(item.data as ThreadMetadata);
              } else {
                onPlanSelect(item.data as PlanMetadata);
              }
            }}
            onDelete={
              item.type === 'thread' && onThreadDelete
                ? () => onThreadDelete(item.data as ThreadMetadata)
                : item.type === 'plan' && onPlanDelete
                ? () => onPlanDelete(item.data as PlanMetadata)
                : undefined
            }
          />
        ))}
      </ul>
    </div>
  );
}
```

**Key changes from original design:**
- No filter tabs - single unified list
- No section headers - threads and plans interleaved
- Items sorted by `updatedAt` descending
- Icon (MessageSquare/FileText) distinguishes type instead of section headers

### 6. Create empty state component

Create `src/components/inbox/empty-inbox-state.tsx`:

```typescript
export function EmptyInboxState() {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-surface-400">
      <p className="text-sm">No threads or plans yet</p>
    </div>
  );
}
```

### 7. Create thread/plan color utilities

Create `src/utils/thread-colors.ts`:

```typescript
import type { ThreadMetadata } from "@/entities/threads/types";

export function getThreadDotColor(thread: ThreadMetadata): { color: string; animation?: string } {
  if (thread.status === 'running') {
    return { color: 'bg-emerald-500', animation: 'animate-pulse' };
  }
  if (!thread.isRead) {
    return { color: 'bg-accent-500' };
  }
  return { color: 'bg-zinc-400' };
}

export function getPlanDotColor(isRead: boolean, hasRunningThread: boolean): { color: string; animation?: string } {
  // Plan status is derived from associated threads (decision #10)
  if (hasRunningThread) {
    return { color: 'bg-emerald-500', animation: 'animate-pulse' };
  }
  if (!isRead) {
    return { color: 'bg-accent-500' };
  }
  return { color: 'bg-zinc-400' };
}
```

### 8. Import relation hooks from 06-relations

**Important:** Do NOT create duplicate hooks here. The relation hooks are defined in 06-relations.md and should be imported from `@/entities/relations/hooks`.

Import the following hooks from `@/entities/relations/hooks`:
- `useRelatedPlans(threadId)` - Get plans related to a thread
- `useRelatedThreads(planId)` - Get threads related to a plan
- `useRelatedThreadsIncludingArchived(planId)` - Get threads including archived relations

For plan content loading, create a simple hook:

Create `src/hooks/use-plan-content.ts`:

```typescript
import { useState, useEffect } from "react";
import { planService } from "@/entities/plans/service";

export function usePlanContent(planId: string): string | null {
  const [content, setContent] = useState<string | null>(null);

  useEffect(() => {
    planService.getPlanContent(planId).then(setContent);
  }, [planId]);

  return content;
}
```

### 9. Update thread detail view

Update existing thread detail to show related plans:

```typescript
function ThreadDetail({ threadId }: { threadId: string }) {
  const thread = useThread(threadId);
  const relatedPlans = useRelatedPlans(threadId);

  return (
    <div>
      <ThreadHeader thread={thread} />
      <ThreadConversation thread={thread} />

      {relatedPlans.length > 0 && (
        <section className="border-t border-surface-700 mt-4 pt-4">
          <h4 className="text-xs font-medium text-surface-400 uppercase tracking-wide px-3 pb-2">
            Related Plans
          </h4>
          <ul className="space-y-2 px-3">
            {relatedPlans.map(({ plan, relationType }) => (
              <li
                key={plan.id}
                className="flex items-center gap-3 px-3 py-2 bg-surface-800 rounded-lg border border-surface-700 hover:border-surface-600 cursor-pointer transition-colors"
              >
                <span className="w-2 h-2 rounded-full flex-shrink-0 bg-zinc-400" />
                <span className="flex-1 text-sm text-surface-100 truncate font-mono">
                  {plan.relativePath}
                </span>
                <span className="px-1.5 py-0.5 text-[10px] uppercase tracking-wide bg-surface-700 text-surface-400 rounded">
                  {relationType}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
```

### 10. Create plan detail view

Create `src/components/inbox/plan-detail.tsx`:

```typescript
function PlanDetail({ planId }: { planId: string }) {
  const plan = usePlan(planId);
  const content = usePlanContent(planId);
  const relatedThreads = useRelatedThreadsIncludingArchived(planId);

  return (
    <div>
      <PlanHeader plan={plan} />
      <PlanContent content={content} />

      {relatedThreads.length > 0 && (
        <section className="border-t border-surface-700 mt-4 pt-4">
          <h4 className="text-xs font-medium text-surface-400 uppercase tracking-wide px-3 pb-2">
            Related Threads
          </h4>
          <ul className="space-y-2 px-3">
            {relatedThreads.map(({ thread, relationType, isArchived }) => (
              <li
                key={thread.id}
                className={`flex items-center gap-3 px-3 py-2 bg-surface-800 rounded-lg border border-surface-700 hover:border-surface-600 cursor-pointer transition-colors ${
                  isArchived ? 'opacity-60' : ''
                }`}
              >
                <span className="w-2 h-2 rounded-full flex-shrink-0 bg-zinc-400" />
                <span className="flex-1 text-sm text-surface-100 truncate font-mono">
                  {getThreadTitle(thread)}
                </span>
                <span className="px-1.5 py-0.5 text-[10px] uppercase tracking-wide bg-surface-700 text-surface-400 rounded">
                  {relationType}
                </span>
                {isArchived && (
                  <span className="px-1.5 py-0.5 text-[10px] uppercase tracking-wide bg-surface-600 text-surface-500 rounded">
                    archived
                  </span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
```

### 11. Update navigation

Update routing to handle:
- `/inbox` - Main inbox view (UnifiedInbox)
- `/inbox/threads/:threadId` - Thread detail
- `/inbox/plans/:planId` - Plan detail

### 12. Bulk actions

Add bulk actions following the same button styling:

```typescript
function InboxActions() {
  return (
    <div className="flex gap-2 px-3 py-2">
      <button
        onClick={markAllRead}
        className="px-2 py-1 text-sm text-surface-400 hover:text-surface-200 transition-colors"
      >
        Mark All Read
      </button>
      <button
        onClick={archiveCompleted}
        className="px-2 py-1 text-sm text-surface-400 hover:text-surface-200 transition-colors"
      >
        Archive Completed
      </button>
    </div>
  );
}

function PlanActions({ planId }: { planId: string }) {
  return (
    <div className="flex gap-2">
      <button
        onClick={() => archivePlanAndThreads(planId)}
        className="px-2 py-1 text-sm text-surface-400 hover:text-surface-200 transition-colors"
      >
        Archive Plan & Threads
      </button>
      <button
        onClick={() => markChildrenRead(planId)}
        className="px-2 py-1 text-sm text-surface-400 hover:text-surface-200 transition-colors"
      >
        Mark Children Read
      </button>
    </div>
  );
}
```

## File Summary

New files to create:
- `src/components/inbox/types.ts`
- `src/components/inbox/utils.ts`
- `src/components/inbox/inbox-item.tsx`
- `src/components/inbox/unified-inbox.tsx`
- `src/components/inbox/empty-inbox-state.tsx`
- `src/utils/thread-colors.ts`
- `src/hooks/use-thread-last-messages.ts`
- `src/hooks/use-plan-content.ts`

Hooks imported from 06-relations (do NOT recreate):
- `useRelatedPlans` - from `@/entities/relations/hooks`
- `useRelatedThreads` - from `@/entities/relations/hooks`
- `useRelatedThreadsIncludingArchived` - from `@/entities/relations/hooks`

Existing files to modify:
- Thread detail component (add related plans section)
- Plan detail component (add related threads section)

## Acceptance Criteria

- [ ] Unified list displays threads and plans interleaved (sorted by `updatedAt`)
- [ ] **No filter tabs** - single unified view
- [ ] **No section headers** - items are not grouped by type
- [ ] **Icon differentiation** - MessageSquare icon for threads, FileText icon for plans
- [ ] **Thread display** - Shows last user message (truncated)
- [ ] **Plan display** - Shows plan filename (from `relativePath`)
- [ ] Status dots use same color logic (green pulse for running, accent for unread, grey otherwise)
- [ ] Plan status is derived from associated threads (decision #10)
- [ ] Delete button reuses existing DeleteButton component
- [ ] Empty state shows when no items exist
- [ ] Related plans shown on thread detail (via relations table)
- [ ] Related threads shown on plan detail (via relations table)
- [ ] `getThreadDotColor` utility created
- [ ] `getPlanDotColor` utility created
- [ ] `useThreadLastMessages(threads)` hook created (uses `turns` array from thread metadata)
- [ ] Relation hooks imported from `@/entities/relations/hooks` (NOT recreated here)
- [ ] TypeScript compiles
- [ ] UI tests pass

## Programmatic Testing Plan

The implementation agent must write and ensure all of the following tests pass before considering this plan complete.

### 1. Inbox Utils Tests (`src/components/inbox/__tests__/utils.test.ts`)

```typescript
describe('getPlanDisplayName', () => {
  it('should return filename without .md extension', () => {});
  it('should handle nested paths and return only filename', () => {});
  it('should preserve filename if no .md extension', () => {});
});

describe('createUnifiedList', () => {
  it('should combine threads and plans into single array', () => {});
  it('should sort items by updatedAt descending (most recent first)', () => {});
  it('should set displayText to last message for threads', () => {});
  it('should set displayText to filename for plans', () => {});
  it('should return empty array when both inputs are empty', () => {});
  it('should interleave threads and plans based on updatedAt', () => {});
});
```

### 2. InboxItemRow Component Tests (`src/components/inbox/__tests__/inbox-item.test.tsx`)

```typescript
describe('InboxItemRow', () => {
  it('should render MessageSquare icon for thread items', () => {});
  it('should render FileText icon for plan items', () => {});
  it('should display item.displayText as the title', () => {});
  it('should call onSelect when item is clicked', () => {});
  it('should display status dot with green pulse animation for running threads', () => {});
  it('should display status dot with accent color for unread items', () => {});
  it('should display grey status dot for read, non-running items', () => {});
  it('should display green pulse for plan with running associated thread', () => {});
  it('should display unread indicator dot when item.data.isRead is false', () => {});
  it('should render DeleteButton when onDelete prop is provided', () => {});
  it('should not render DeleteButton when onDelete prop is not provided', () => {});
  it('should call onDelete when delete button is clicked', () => {});
  it('should apply correct CSS classes matching UnifiedTaskList styling', () => {});
});
```

### 3. UnifiedInbox Component Tests (`src/components/inbox/__tests__/unified-inbox.test.tsx`)

```typescript
describe('UnifiedInbox', () => {
  it('should render EmptyInboxState when no items exist', () => {});
  it('should render all items in a single unified list', () => {});
  it('should NOT render filter tabs', () => {});
  it('should NOT render section headers', () => {});
  it('should sort items by updatedAt descending', () => {});
  it('should call onThreadSelect when thread item is clicked', () => {});
  it('should call onPlanSelect when plan item is clicked', () => {});
  it('should pass onThreadDelete to InboxItemRow for threads', () => {});
  it('should pass onPlanDelete to InboxItemRow for plans', () => {});
  it('should interleave threads and plans based on updatedAt', () => {});
});
```

### 4. Thread Color Utility Tests (`src/utils/__tests__/thread-colors.test.ts`)

```typescript
describe('getThreadDotColor', () => {
  it('should return green with pulse animation for running threads', () => {});
  it('should return accent color without animation for unread non-running threads', () => {});
  it('should return grey without animation for read non-running threads', () => {});
});

describe('getPlanDotColor', () => {
  it('should return green with pulse animation when hasRunningThread is true', () => {});
  it('should return accent color without animation when unread and no running thread', () => {});
  it('should return grey without animation when read and no running thread', () => {});
});
```

### 5. Thread Last Messages Hook Tests (`src/hooks/__tests__/use-thread-last-messages.test.ts`)

```typescript
describe('useThreadLastMessages', () => {
  it('should return a record keyed by thread ID', () => {});
  it('should return last user message for each thread', () => {});
  it('should return empty object when threads array is empty', () => {});
  it('should update when threads array changes', () => {});
});
```

### 6. Relation Hooks Tests (`src/hooks/__tests__/use-related-plans.test.ts`)

```typescript
describe('useRelatedPlans', () => {
  it('should return empty array when thread has no relations', () => {});
  it('should return related plans with their relation types', () => {});
  it('should filter out relations where plan no longer exists', () => {});
  it('should include all relation types: created, modified, mentioned', () => {});
});
```

### 7. Relation Hooks Tests (`src/hooks/__tests__/use-related-threads.test.ts`)

```typescript
describe('useRelatedThreadsIncludingArchived', () => {
  it('should return empty array when plan has no relations', () => {});
  it('should return active related threads with isArchived=false', () => {});
  it('should return archived related threads with isArchived=true', () => {});
  it('should combine both active and archived threads in result', () => {});
  it('should filter out relations where thread no longer exists', () => {});
  it('should include relation type for each related thread', () => {});
});
```

### 8. Empty State Component Tests

```typescript
describe('EmptyInboxState', () => {
  it('should render "No threads or plans yet" message', () => {});
  it('should apply correct styling classes', () => {});
});
```

### 9. Integration Tests (`src/components/inbox/__tests__/integration.test.tsx`)

```typescript
describe('Inbox Integration', () => {
  it('should update plan status dot when associated thread status changes to running', () => {});
  it('should show related plans section in thread detail when thread has relations', () => {});
  it('should show related threads section in plan detail when plan has relations', () => {});
  it('should display archived badge on archived threads in plan detail', () => {});
  it('should call correct callback when thread item is clicked', () => {});
  it('should call correct callback when plan item is clicked', () => {});
});
```

### Test Requirements

1. All tests must use the project's existing testing framework (likely Vitest or Jest with React Testing Library)
2. Mock the Zustand stores appropriately for isolated unit tests
3. Use proper test data factories/fixtures for ThreadMetadata and PlanMetadata
4. Integration tests should test actual store interactions without mocking
5. All tests must pass before the implementation is considered complete
6. Tests should verify the exact CSS classes specified in the plan to ensure styling matches UnifiedTaskList
