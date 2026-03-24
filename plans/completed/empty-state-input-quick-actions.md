# Empty State Input and Quick Actions

## Overview

Add a ThreadInput and QuickActionsPanel to the empty pane state, allowing users to start a new thread directly from the empty state without needing to use the spotlight.

## Current State

The `EmptyPaneContent` component (`src/components/content-pane/empty-pane-content.tsx`) currently displays:
- "Welcome to Anvil" heading
- Instructions to use the spotlight (hotkey, type prompt, press Enter)

The empty state has no interactive elements - users must use the spotlight to create threads.

## Desired State

The empty state should display:
1. The existing welcome message (perhaps condensed)
2. A `QuickActionsPanel` with `contextType="empty"` for quick actions
3. A `ThreadInput` component for submitting prompts
4. Submitting a prompt should create a new thread and spawn an agent

## Key Design Decision: DRY via Composition

**This is the most important architectural decision in this plan.**

`ThreadContent` already has the layout we need:
- Shows `QuickActionsPanel` with `contextType="empty"` when there are no messages
- Has the input pinned to the bottom with proper styling
- Handles all the complex submit logic (queue, resume, spawn)

The only difference between `EmptyPaneContent` and an empty `ThreadContent` is:
- `ThreadContent` requires a `threadId` and updates an existing thread
- `EmptyPaneContent` needs to *create* a thread on first submit

### Approach: Extract ThreadInputSection Component

Rather than creating a leaky abstraction by adding "create mode" to `ThreadContent`, we extract the shared bottom section into a composable component:

```tsx
// src/components/reusable/thread-input-section.tsx

export interface ThreadInputSectionProps {
  onSubmit: (prompt: string) => void | Promise<void>;
  workingDirectory: string | null;
  contextType: "empty" | "thread";
  disabled?: boolean;
  placeholder?: string;
  queuedMessages?: QueuedMessage[];
  canQueue?: boolean;
  inputRef?: React.RefObject<ThreadInputRef>;
  autoFocus?: boolean;
}

export function ThreadInputSection({
  onSubmit,
  workingDirectory,
  contextType,
  disabled = false,
  placeholder,
  queuedMessages = [],
  canQueue = false,
  inputRef,
  autoFocus,
}: ThreadInputSectionProps) {
  return (
    <div className="flex-shrink-0 w-full max-w-[900px] mx-auto mt-4">
      <QuickActionsPanel contextType={contextType} />
      <QueuedMessagesBanner messages={queuedMessages} />
      <div className={cn("relative", canQueue && "ring-1 ring-amber-500/30 ring-inset")}>
        <ThreadInput
          ref={inputRef}
          onSubmit={onSubmit}
          disabled={disabled}
          workingDirectory={workingDirectory}
          placeholder={placeholder}
          autoFocus={autoFocus}
        />
      </div>
    </div>
  );
}
```

This approach:
- **Composable** - Each consumer controls its own submit behavior
- **No leaky abstractions** - `ThreadContent` stays focused on viewing threads
- **Reusable** - Both `ThreadContent` and `EmptyPaneContent` compose with this component
- **Clear responsibilities** - Input section handles layout/styling, consumers handle logic

## Implementation Steps

### Step 1: Create ThreadInputSection component

Create `src/components/reusable/thread-input-section.tsx` with the shared layout for quick actions, queued messages banner, and input. See the component definition above.

### Step 2: Refactor ThreadContent to use ThreadInputSection

Update `ThreadContent` to compose with the new component instead of having the layout inline:

```tsx
// In ThreadContent render:
return (
  <div className="flex flex-col h-full text-surface-50 relative overflow-hidden px-2.5">
    <div className="flex-1 min-h-0 overflow-hidden flex flex-col w-full">
      <ThreadView ... />
    </div>

    <ThreadInputSection
      onSubmit={handleSubmit}
      workingDirectory={workingDirectory}
      contextType={messages.length === 0 ? "empty" : "thread"}
      placeholder={canQueueMessages ? "Queue a follow-up message..." : undefined}
      queuedMessages={queuedMessages}
      canQueue={canQueueMessages}
      inputRef={inputRef}
    />

    {/* Toast */}
  </div>
);
```

### Step 3: Extract shared thread creation logic

Create `src/lib/thread-creation-service.ts`:

```tsx
export interface CreateThreadOptions {
  prompt: string;
  repoId: string;
  worktreeId: string;
  worktreePath: string;
}

export interface CreateThreadResult {
  threadId: string;
  taskId: string;
}

/**
 * Creates a new thread with optimistic UI and spawns an agent.
 * Used by spotlight and empty pane.
 */
export async function createThread(options: CreateThreadOptions): Promise<CreateThreadResult> {
  // Extract logic from SpotlightController.createSimpleThread()
  // - Generate threadId, taskId
  // - Call threadService.createOptimistic()
  // - Emit THREAD_OPTIMISTIC_CREATED
  // - Spawn agent (non-blocking)
  // - Return { threadId, taskId }
}
```

### Step 4: Create useMRUWorktree hook

Extract the MRU worktree loading logic from spotlight into a reusable hook:

```tsx
// src/hooks/use-mru-worktree.ts
export function useMRUWorktree() {
  const [repoWorktrees, setRepoWorktrees] = useState<RepoWorktree[]>([]);

  useEffect(() => {
    // Load and sort worktrees by lastAccessedAt
    // Same logic as spotlight's loadWorktrees()
  }, []);

  return {
    repoWorktrees,
    mruWorktree: repoWorktrees[0] ?? null,
    workingDirectory: repoWorktrees[0]?.worktree.path ?? null,
  };
}
```

### Step 5: Update EmptyPaneContent

Rewrite to use the shared components:

```tsx
export function EmptyPaneContent() {
  const { mruWorktree, workingDirectory } = useMRUWorktree();

  const handleSubmit = useCallback(async (prompt: string) => {
    if (!mruWorktree) {
      // Show error - no repositories configured
      return;
    }

    const { threadId } = await createThread({
      prompt,
      repoId: mruWorktree.repoId,
      worktreeId: mruWorktree.worktree.id,
      worktreePath: mruWorktree.worktree.path,
    });

    // Switch view to the new thread
    contentPanesService.setActivePaneView({ type: "thread", threadId });
  }, [mruWorktree]);

  return (
    <div className="flex flex-col h-full text-surface-50 relative overflow-hidden px-2.5">
      {/* Welcome message in main area */}
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center text-surface-400">
          <h2 className="text-xl font-medium font-mono text-surface-100">
            Welcome to Anvil
          </h2>
          <p className="text-base mt-2">
            Type a message below to get started
          </p>
        </div>
      </div>

      <ThreadInputSection
        onSubmit={handleSubmit}
        workingDirectory={workingDirectory}
        contextType="empty"
        autoFocus
      />
    </div>
  );
}
```

### Step 6: Update spotlight to use shared service

Refactor `SpotlightController.createSimpleThread()` to use the extracted `createThread()` function, keeping only the spotlight-specific logic (window routing, hide spotlight).

## Files to Modify

1. `src/components/reusable/thread-input-section.tsx` - **New file** for shared input section
2. `src/lib/thread-creation-service.ts` - **New file** for shared thread creation logic
3. `src/hooks/use-mru-worktree.ts` - **New file** for MRU worktree hook
4. `src/components/content-pane/thread-content.tsx` - Refactor to use ThreadInputSection
5. `src/components/content-pane/empty-pane-content.tsx` - Rewrite to use shared components
6. `src/components/spotlight/spotlight.tsx` - Refactor to use shared service and hook

## Dependencies

- `repoService` - Get available repositories
- `worktreeService` - Get worktrees for MRU selection
- `threadService` - Create optimistic thread
- `spawnSimpleAgent` - Spawn agent process
- `contentPanesService` - Switch view to new thread
- `eventBus` - Broadcast thread creation events
- `loadSettings` - Load repository settings (for UUIDs)

## Edge Cases

1. **No repositories configured**: Show error or prompt user to add a repository
2. **Multiple repositories**: Use MRU worktree (matches spotlight behavior)
3. **Agent spawn failure**: Thread will remain in "running" state until timeout/refresh
4. **Quick action execution**: Should work same as in thread context

## Testing

1. Open main window with no thread selected (empty state)
2. Verify input and quick actions appear at bottom
3. Type a prompt and press Enter
4. Verify thread is created and view switches to show it
5. Verify agent spawns and responds
6. Test @ file mentions work (if working directory is set)
7. Test quick actions execute correctly from empty state
