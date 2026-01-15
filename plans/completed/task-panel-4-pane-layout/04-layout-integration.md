# Stream 4: Layout Integration

**Dependencies**: Streams 1, 2, 3 must be completed first

## Goal

Wire together all components into the new 4-pane layout in `task-workspace.tsx`.

## Implementation Steps

### Step 4.1: Update Imports

```tsx
// OLD
import { WorkspaceSidebar, type WorkspaceTab } from "./workspace-sidebar";

// NEW
import { LeftMenu, type WorkspaceTab } from "./left-menu";
import { ChatPane } from "./chat-pane";
import { GitCommitsList } from "./git-commits-list";
```

### Step 4.2: Update State

```tsx
// Change default active tab from "threads" to "overview"
const [activeTab, setActiveTab] = useState<WorkspaceTab>("overview");

// Remove sidebar collapsed state (left menu is always visible)
// const [sidebarCollapsed, setSidebarCollapsed] = useState(true); // REMOVE
```

### Step 4.3: Update Layout JSX

Replace the current layout with:

```tsx
return (
  <div className="h-full flex flex-col bg-gradient-to-br from-slate-900 to-slate-800">
    {/* Task header - spans full width */}
    <TaskHeader taskId={taskId} onOpenTask={handleOpenTask} />

    {/* Main layout: menu + content + chat */}
    <div className="flex-1 flex min-h-0">
      {/* Left Menu - always visible, fixed width */}
      <LeftMenu
        taskTitle={task.title}
        activeTab={activeTab}
        onTabChange={setActiveTab}
        fileChangeCount={fileChanges.size}
        commitCount={undefined} // TODO: Wire up from useGitCommits if needed
        threads={threads}
        activeThreadId={activeThreadId}
        onThreadSelect={handleThreadSelect}
      />

      {/* Center: Main Content + Action Panel */}
      <div className="flex-1 flex flex-col min-h-0">
        <MainContentPane
          tab={activeTab}
          taskId={taskId}
          threadId={activeThreadId}
          fileChanges={fileChanges}
          fullFileContents={fullFileContents}
          workingDirectory={workingDirectory}
          // Note: messages/streaming props no longer needed for main content
          // (thread view moved to ChatPane)
        />

        {/* Action panel below main content, not spanning chat */}
        <ActionPanel
          taskId={taskId}
          threadId={activeThreadId}
          onSendMessage={handleSendMessage}
        />
      </div>

      {/* Right: Chat Pane */}
      <ChatPane
        threadId={activeThreadId}
        messages={messages}
        isStreaming={isStreaming}
        status={viewStatus}
        error={error}
        onRetry={handleRetry}
      />
    </div>
  </div>
);
```

### Step 4.4: Update MainContentPane

**File**: `src/components/workspace/main-content-pane.tsx`

Remove thread-related props and add git tab:

```tsx
interface MainContentPaneProps {
  tab: WorkspaceTab;
  taskId: string;
  threadId: string | null; // Still needed for context, but not for display
  fileChanges: Map<string, FileChange>;
  fullFileContents: Record<string, string[] | null>;
  workingDirectory: string;
  filesLoading?: boolean;
  branchName?: string;  // NEW: for git tab
  // REMOVED: messages, isStreaming, status, error, onRetry
}

export function MainContentPane({
  tab,
  taskId,
  threadId,
  fileChanges,
  fullFileContents,
  workingDirectory,
  filesLoading,
  branchName,
}: MainContentPaneProps) {
  // ... existing code ...

  switch (tab) {
    case "overview":
      return (
        <div className={contentClass}>
          <TaskOverview taskId={taskId} />
        </div>
      );

    case "changes":
      return (
        <div className={`${contentClass} p-4 overflow-auto`}>
          {filesLoading ? (
            <DiffViewerSkeleton />
          ) : fileChanges.size === 0 ? (
            <DiffEmptyState />
          ) : (
            <DiffViewer
              fileChanges={fileChanges}
              fullFileContents={validFileContents}
              workingDirectory={workingDirectory}
            />
          )}
        </div>
      );

    case "git":  // NEW
      return (
        <div className={contentClass}>
          <GitCommitsList
            branchName={branchName}
            workingDirectory={workingDirectory}
          />
        </div>
      );

    // REMOVED: case "threads" - no longer a tab

    default:
      return null;
  }
}
```

### Step 4.5: Update handleThreadSelect

Thread selection now just updates the selected thread (which ChatPane displays):

```tsx
const handleThreadSelect = useCallback((threadId: string) => {
  setSelectedThreadId(threadId);
  // REMOVED: setActiveTab("threads"); - threads is no longer a tab
}, []);
```

### Step 4.6: Clean Up Unused Props

Remove props from MainContentPane that are no longer used:
- `messages`
- `isStreaming`
- `status`
- `error`
- `onRetry`

These are now passed directly to ChatPane.

### Step 4.7: Wire Up Git Data

If the task has a branchName:

```tsx
// In TaskWorkspace
const branchName = task.branchName;

// Pass to MainContentPane
<MainContentPane
  // ... other props
  branchName={branchName}
/>
```

If using `useGitCommits` for commit count badge:

```tsx
const { commits } = useGitCommits(task.branchName, workingDirectory);

<LeftMenu
  // ... other props
  commitCount={commits.length}
/>
```

### Step 4.8: Remove Old Sidebar Padding Logic

Remove the conditional padding that was used for the collapsed sidebar:

```tsx
// REMOVE this:
<div className={`flex-1 flex flex-col min-h-0 ${sidebarCollapsed ? "pl-10" : ""}`}>
```

The left menu is always visible now, so no padding adjustment needed.

## Files Modified

1. `src/components/workspace/task-workspace.tsx` - Main layout refactor
2. `src/components/workspace/main-content-pane.tsx` - Add git tab, remove threads tab

## Files to Delete (Optional Cleanup)

1. `src/components/workspace/workspace-sidebar.tsx` - Replaced by left-menu.tsx
2. `src/components/workspace/sidebar-collapse-button.tsx` - May not be needed if ChatPane has its own button

## Full task-workspace.tsx After Refactor

```tsx
import { useState, useEffect, useMemo, useCallback } from "react";
import { TaskHeader } from "./task-header";
import { LeftMenu, type WorkspaceTab } from "./left-menu";
import { MainContentPane } from "./main-content-pane";
import { ActionPanel } from "./action-panel";
import { ChatPane } from "./chat-pane";
import { useTaskStore } from "@/entities/tasks/store";
import { useTaskThreads } from "@/hooks/use-task-threads";
import { useStreamingThread } from "@/hooks/use-streaming-thread";
import { useFileContents } from "@/hooks/use-file-contents";
import { useThreadMessages } from "@/hooks/use-thread-messages";
import { resumeAgent } from "@/lib/agent-service";
import { eventBus } from "@/entities/events";
import { logger } from "@/lib/logger-client";
import type { FileChange } from "@/lib/types/agent-messages";

interface TaskWorkspaceProps {
  taskId: string;
  initialThreadId?: string;
}

export function TaskWorkspace({ taskId, initialThreadId }: TaskWorkspaceProps) {
  const [activeTab, setActiveTab] = useState<WorkspaceTab>("overview");
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(
    initialThreadId ?? null
  );

  const task = useTaskStore((state) => state.tasks[taskId]);
  const threads = useTaskThreads(taskId);

  const activeThreadId = selectedThreadId ?? threads[0]?.id ?? null;
  const { streamingState } = useStreamingThread(activeThreadId);
  const { threadState: diskState, status: diskStatus, error } = useThreadMessages(
    activeThreadId ?? ""
  );

  const threadState = streamingState ?? diskState;
  const messages = threadState?.messages ?? [];
  const isStreaming = threadState?.status === "running";
  const workingDirectory = threadState?.workingDirectory ?? "";

  const fileChanges = useMemo(() => {
    const changes = threadState?.fileChanges ?? [];
    const map = new Map<string, FileChange>();
    for (const change of changes) {
      map.set(change.path, change);
    }
    return map;
  }, [threadState?.fileChanges]);

  const { contents: fullFileContents, loading: filesLoading } = useFileContents(
    fileChanges,
    workingDirectory
  );

  const viewStatus =
    diskStatus === "loading"
      ? "loading"
      : diskStatus === "error"
      ? "error"
      : isStreaming
      ? "running"
      : threadState?.status === "complete"
      ? "completed"
      : "idle";

  useEffect(() => {
    if (!selectedThreadId && threads.length > 0) {
      setSelectedThreadId(threads[0].id);
    }
  }, [threads, selectedThreadId]);

  const handleSendMessage = useCallback(
    async (message: string) => {
      if (!activeThreadId) {
        logger.warn("[TaskWorkspace] No active thread to send message to");
        return;
      }
      try {
        await resumeAgent(activeThreadId, message, {
          onState: (state) => {
            eventBus.emit("agent:state", { threadId: activeThreadId, state });
          },
          onComplete: (exitCode, costUsd) => {
            eventBus.emit("agent:completed", { threadId: activeThreadId, exitCode, costUsd });
          },
          onError: (error) => {
            eventBus.emit("agent:error", { threadId: activeThreadId, error });
          },
        });
      } catch (err) {
        logger.error("[TaskWorkspace] Failed to send message:", err);
      }
    },
    [activeThreadId]
  );

  const handleRetry = useCallback(() => {
    if (activeThreadId) {
      setSelectedThreadId(null);
      setTimeout(() => setSelectedThreadId(activeThreadId), 0);
    }
  }, [activeThreadId]);

  const handleOpenTask = useCallback(() => {
    logger.log("[TaskWorkspace] Open task:", taskId);
  }, [taskId]);

  const handleThreadSelect = useCallback((threadId: string) => {
    setSelectedThreadId(threadId);
  }, []);

  if (!task) {
    return (
      <div className="h-full flex items-center justify-center bg-gradient-to-br from-slate-900 to-slate-800 text-slate-400">
        Task not found
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-gradient-to-br from-slate-900 to-slate-800">
      <TaskHeader taskId={taskId} onOpenTask={handleOpenTask} />

      <div className="flex-1 flex min-h-0">
        <LeftMenu
          taskTitle={task.title}
          activeTab={activeTab}
          onTabChange={setActiveTab}
          fileChangeCount={fileChanges.size}
          threads={threads}
          activeThreadId={activeThreadId}
          onThreadSelect={handleThreadSelect}
        />

        <div className="flex-1 flex flex-col min-h-0">
          <MainContentPane
            tab={activeTab}
            taskId={taskId}
            fileChanges={fileChanges}
            fullFileContents={fullFileContents}
            workingDirectory={workingDirectory}
            filesLoading={filesLoading}
            branchName={task.branchName}
          />
          <ActionPanel
            taskId={taskId}
            threadId={activeThreadId}
            onSendMessage={handleSendMessage}
          />
        </div>

        <ChatPane
          threadId={activeThreadId}
          messages={messages}
          isStreaming={isStreaming}
          status={viewStatus}
          error={error}
          onRetry={handleRetry}
        />
      </div>
    </div>
  );
}
```

## Verification

After completing this stream:
1. App compiles without errors
2. 4-pane layout renders correctly:
   - Left menu (180px) with task title, tabs, thread list
   - Main content (flex) showing overview/changes/git based on tab
   - Action panel below main content (not spanning chat)
   - Chat pane (400px) on right with thread output
3. Tab switching works (overview, changes, git)
4. Thread selection updates chat pane
5. Collapse button on chat pane works
6. Input in action panel sends messages correctly

## Known Limitations / Future Work

1. No drag-to-resize on chat pane
2. Git commits may need backend command implementation
3. Responsive behavior for small screens not addressed
4. Keyboard shortcuts for tab switching not added
