# Task Workspace UI Enhancement Plan

## Overview

Enhance the existing thread window (`thread-window.tsx`) into a unified "Task Workspace" view. This is shown after spotlight submission and serves as the primary interface for working on tasks.

**Key changes:**
- Tabbed sidebar navigation instead of side-by-side panes
- Main content pane shows selected tab content
- Fixed bottom action panel with draggable expansion
- Task header with full context (already partially implemented)

## Architecture

### Layout Structure

```
┌─────────────────────────────────────────────────────────────────────────┐
│ [Work] Task Title                                    task/my-task-slug  │
├───┬─────────────────────────────────────────────────────────────────────┤
│[>]│                                                                     │
│   │              MAIN CONTENT PANE                                      │
│   │                                                                     │
│   │  Shows content based on selected tab:                               │
│   │  - Overview: Task markdown                                          │
│   │  - Changes: DiffViewer                                              │
│   │  - Thread: ThreadView chat                                          │
│   │                                                                     │
│   │  On spotlight submission: sidebar COLLAPSED, thread view shown      │
│   │                                                                     │
├───┴─────────────────────────────────────────────────────────────────────┤
│ ACTION PANEL (fixed bottom, draggable height)                    [drag] │
│ ┌─────────────────────────────────────────────────────────────────────┐ │
│ │ [Review request / Agent input / Continue button - context aware]    │ │
│ └─────────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────┘

SIDEBAR (when expanded via Apple-style collapse button):
┌──────────────┐
│  [<]         │  ← Apple-style collapse button
│  ┌────────┐  │
│  │Overview│  │
│  └────────┘  │
│  ┌────────┐  │
│  │Changes │  │
│  │   [3]  │  │
│  └────────┘  │
│  ┌────────┐  │
│  │Threads │  │
│  │  ├─ T1 │  │
│  │  └─ T2 │  │
│  └────────┘  │
└──────────────┘
```

### Tab Behavior

| Tab | Content | When Active |
|-----|---------|-------------|
| **Overview** | Task markdown content (readonly) | When user expands sidebar and clicks |
| **Changes** | DiffViewer with file changes | When user expands sidebar and clicks |
| **Threads** | Expandable list, selecting shows ThreadView in main pane | When user expands sidebar and clicks |

**Default View:** Upon spotlight submission, the sidebar starts **collapsed** with the main pane showing the running agent/thread. This maximizes screen real estate for the active work. Users can expand the sidebar via the Apple-style collapse button to switch tabs.

**No Separate Chat Input:** The old "send follow up message" input is removed from the thread view. All user input goes through the action panel at the bottom, which provides context-aware input (starting agent, continuing, responding to reviews).

### Component Hierarchy

```
TaskWorkspace (renamed from ThreadWindow)
├── TaskHeader (existing, enhanced)
├── WorkspaceLayout (fills middle space)
│   ├── SidebarCollapseButton (Apple-style, always visible)
│   ├── WorkspaceSidebar (collapsible, starts collapsed)
│   │   ├── TabButton (Overview)
│   │   ├── TabButton (Changes)
│   │   └── ThreadsList (expandable under Threads tab)
│   └── MainContentPane
│       ├── DiffViewer (when tab = changes)
│       ├── TaskOverview (when tab = overview)
│       └── ThreadView (when tab = threads && thread selected)
└── ActionPanel (fixed bottom)
    ├── DragHandle (top edge for resizing)
    └── ActionContent (context-aware)
```

---

## Implementation Steps

### Step 1: Create Sidebar Components

**File: `src/components/workspace/workspace-sidebar.tsx`**

Collapsible tabbed sidebar with Apple-style collapse button:
- Overview tab
- Changes tab (with count badge)
- Threads tab (with expandable thread list)

Starts collapsed on spotlight submission to maximize main content area.

```tsx
type WorkspaceTab = "overview" | "changes" | "threads";

interface WorkspaceSidebarProps {
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  activeTab: WorkspaceTab;
  onTabChange: (tab: WorkspaceTab) => void;
  fileChangeCount: number;
  threads: ThreadMetadata[];
  activeThreadId: string | null;
  onThreadSelect: (threadId: string) => void;
}

export function WorkspaceSidebar({ isCollapsed, onToggleCollapse, ... }: WorkspaceSidebarProps) {
  return (
    <>
      {/* Apple-style collapse button - always visible */}
      <SidebarCollapseButton
        isCollapsed={isCollapsed}
        onClick={onToggleCollapse}
      />

      {!isCollapsed && (
        <div className="w-48 h-full flex flex-col border-r border-slate-700/50 bg-slate-900/30">
          <TabButton
            active={activeTab === "overview"}
            onClick={() => onTabChange("overview")}
          >
            Overview
          </TabButton>
          <TabButton
            active={activeTab === "changes"}
            onClick={() => onTabChange("changes")}
            badge={fileChangeCount > 0 ? fileChangeCount : undefined}
          >
            Changes
          </TabButton>
          <TabButton
            active={activeTab === "threads"}
            onClick={() => onTabChange("threads")}
            expandable
          >
            Threads
          </TabButton>
          {activeTab === "threads" && (
            <ThreadsList
              threads={threads}
              activeThreadId={activeThreadId}
              onSelect={onThreadSelect}
            />
          )}
        </div>
      )}
    </>
  );
}
```

**File: `src/components/workspace/sidebar-collapse-button.tsx`**

Apple-style collapse/expand button positioned at the sidebar edge:

```tsx
interface SidebarCollapseButtonProps {
  isCollapsed: boolean;
  onClick: () => void;
}

export function SidebarCollapseButton({ isCollapsed, onClick }: SidebarCollapseButtonProps) {
  return (
    <button
      onClick={onClick}
      className="absolute top-3 left-2 z-10 w-6 h-6 flex items-center justify-center
                 rounded bg-slate-800/80 hover:bg-slate-700/80 border border-slate-600/50
                 text-slate-400 hover:text-slate-200 transition-colors"
      aria-label={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
    >
      {isCollapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
    </button>
  );
}
```

**File: `src/components/workspace/tab-button.tsx`**

Reusable tab button with optional badge and expansion indicator.

**File: `src/components/workspace/threads-list.tsx`**

List of threads under the Threads tab. Shows thread status, allows selection.

### Step 2: Create Task Overview Component

**File: `src/components/workspace/task-overview.tsx`**

Renders task markdown content. Uses existing `taskService.getContent()`.

```tsx
interface TaskOverviewProps {
  taskId: string;
}

export function TaskOverview({ taskId }: TaskOverviewProps) {
  const [content, setContent] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const task = useTaskStore(state => state.tasks[taskId]);

  useEffect(() => {
    setLoading(true);
    taskService.getContent(taskId)
      .then(setContent)
      .finally(() => setLoading(false));
  }, [taskId]);

  if (loading) return <OverviewSkeleton />;
  if (!content && !task?.description) return <OverviewEmptyState />;

  return (
    <div className="p-6 prose prose-invert max-w-none">
      {task?.description && (
        <p className="text-slate-400 mb-6">{task.description}</p>
      )}
      <ReactMarkdown>{content}</ReactMarkdown>
    </div>
  );
}
```

### Step 3: Create Action Panel Component

**File: `src/components/workspace/action-panel.tsx`**

Fixed-position bottom panel with draggable height (drag handle at top edge).

```tsx
interface ActionPanelProps {
  taskId: string | null;
  threadId: string | null;
  isStreaming: boolean;
  onSendMessage: (message: string) => void;
}

export function ActionPanel({ taskId, threadId, isStreaming, onSendMessage }: ActionPanelProps) {
  const [height, setHeight] = useState(120);

  // Determine action state
  const actionState = useActionState(taskId, threadId, isStreaming);

  return (
    <div
      className="relative border-t border-slate-700/50 bg-slate-900/80 backdrop-blur flex-shrink-0"
      style={{ height }}
    >
      <DragHandle position="top" onDrag={setHeight} />
      <ActionContent state={actionState} onSendMessage={onSendMessage} />
    </div>
  );
}
```

**Action States:**
1. `streaming` - Agent is working → Show status + cancel button
2. `awaiting-input` - Agent waiting for response → Show input field
3. `review-pending` - Has review request → Show review UI
4. `idle` - No active thread → Show "Start working" input
5. `completed` - Thread complete → Show "Continue" / "Start new" options

**File: `src/components/workspace/drag-handle.tsx`**

Draggable handle for resizing action panel height.

### Step 4: Refactor Thread Window → Task Workspace

**File: `src/components/workspace/task-workspace.tsx`** (new, replaces thread-window.tsx)

Main workspace component combining all pieces:

```tsx
interface TaskWorkspaceProps {
  taskId: string;
  initialThreadId?: string;
}

export function TaskWorkspace({ taskId, initialThreadId }: TaskWorkspaceProps) {
  // Sidebar starts collapsed on spotlight submission
  const [sidebarCollapsed, setSidebarCollapsed] = useState(true);
  const [activeTab, setActiveTab] = useState<WorkspaceTab>("threads");
  const [selectedThreadId, setSelectedThreadId] = useState(initialThreadId);

  const task = useTaskStore(state => state.tasks[taskId]);
  const threads = useTaskThreads(taskId);
  const activeThread = selectedThreadId
    ? threads.find(t => t.id === selectedThreadId)
    : threads[0]; // Default to first/active thread

  // Get file changes from active thread
  const { streamingState } = useStreamingThread(activeThread?.id ?? "");
  const fileChanges = streamingState?.fileChanges ?? [];

  // Auto-select first thread when available
  useEffect(() => {
    if (!selectedThreadId && threads.length > 0) {
      setSelectedThreadId(threads[0].id);
    }
  }, [threads.length]);

  return (
    <div className="h-full flex flex-col bg-gradient-to-br from-slate-900 to-slate-800">
      <TaskHeader taskId={taskId} />

      <div className="flex-1 flex min-h-0">
        <WorkspaceSidebar
          isCollapsed={sidebarCollapsed}
          onToggleCollapse={() => setSidebarCollapsed(!sidebarCollapsed)}
          activeTab={activeTab}
          onTabChange={setActiveTab}
          fileChangeCount={fileChanges.length}
          threads={threads}
          activeThreadId={selectedThreadId}
          onThreadSelect={(id) => {
            setSelectedThreadId(id);
            setActiveTab("threads");
          }}
        />

        <MainContentPane
          tab={activeTab}
          taskId={taskId}
          threadId={selectedThreadId}
          fileChanges={fileChanges}
        />
      </div>

      <ActionPanel
        taskId={taskId}
        threadId={selectedThreadId}
        isStreaming={streamingState?.status === "running"}
        onSendMessage={handleSendMessage}
      />
    </div>
  );
}
```

**File: `src/components/workspace/main-content-pane.tsx`**

Renders content based on active tab:

```tsx
interface MainContentPaneProps {
  tab: WorkspaceTab;
  taskId: string;
  threadId: string | null;
  fileChanges: FileChange[];
}

export function MainContentPane({ tab, taskId, threadId, fileChanges }: MainContentPaneProps) {
  switch (tab) {
    case "overview":
      return <TaskOverview taskId={taskId} />;
    case "changes":
      return <DiffViewer fileChanges={fileChanges} />;
    case "threads":
      return threadId
        ? <ThreadView threadId={threadId} />
        : <ThreadEmptyState />;
  }
}
```

### Step 5: Update Entry Points

**File: `thread.html` → `workspace.html`** (rename)

Update entry point HTML file.

**File: `vite.config.ts`**

Update build input from `thread.html` to `workspace.html`.

**File: `src-tauri/src/panels.rs`**

Update panel constants:
```rust
pub const WORKSPACE_PANEL_LABEL: &str = "workspace-panel"; // was THREAD_PANEL_LABEL
```

**File: `src-tauri/src/lib.rs`**

Update command names if needed.

### Step 6: Create Supporting Hooks

**File: `src/hooks/use-task-threads.ts`**

```tsx
export function useTaskThreads(taskId: string): ThreadMetadata[] {
  const task = useTaskStore(state => state.tasks[taskId]);
  const threads = useThreadStore(state =>
    (task?.threadIds ?? [])
      .map(id => state.threads[id])
      .filter(Boolean)
  );
  return threads;
}
```

**File: `src/hooks/use-action-state.ts`**

```tsx
type ActionState =
  | { type: "streaming" }
  | { type: "awaiting-input"; placeholder: string }
  | { type: "review-pending"; reviewId: string }
  | { type: "idle" }
  | { type: "completed" };

export function useActionState(
  taskId: string | null,
  threadId: string | null,
  isStreaming: boolean
): ActionState {
  // Determine current action state based on task/thread status
  if (isStreaming) return { type: "streaming" };
  // ... other logic
}
```

---

## Files to Create

| File | Purpose |
|------|---------|
| `src/components/workspace/task-workspace.tsx` | Main workspace component |
| `src/components/workspace/workspace-sidebar.tsx` | Collapsible tabbed sidebar navigation |
| `src/components/workspace/sidebar-collapse-button.tsx` | Apple-style collapse/expand button |
| `src/components/workspace/tab-button.tsx` | Reusable tab button |
| `src/components/workspace/threads-list.tsx` | Thread list under Threads tab |
| `src/components/workspace/task-overview.tsx` | Task markdown viewer |
| `src/components/workspace/action-panel.tsx` | Fixed bottom action panel |
| `src/components/workspace/drag-handle.tsx` | Draggable resize handle |
| `src/components/workspace/main-content-pane.tsx` | Content area router |
| `src/components/workspace/index.ts` | Barrel exports |
| `src/hooks/use-task-threads.ts` | Get threads for task |
| `src/hooks/use-action-state.ts` | Determine action panel state |

## Files to Modify

| File | Changes |
|------|---------|
| `thread.html` | Rename to `workspace.html` |
| `vite.config.ts` | Update build input |
| `src-tauri/src/panels.rs` | Update panel label/constants |
| `src/components/thread/thread-window.tsx` | Deprecate, migrate logic to workspace |

## Files to Keep/Reuse

| File | Usage |
|------|-------|
| `src/components/thread/thread-view.tsx` | Reused for chat in threads tab |
| `src/components/diff-viewer/*` | Reused for changes tab |
| `src/hooks/use-thread-messages.ts` | Reused |
| `src/hooks/use-streaming-thread.ts` | Reused |
| `src/hooks/use-file-contents.ts` | Reused |

---

## Action Panel States Detail

| State | Trigger | UI |
|-------|---------|-----|
| **Streaming** | `threadState.status === "running"` | Progress indicator, cancel button |
| **Awaiting Input** | Agent sent `human_review_request` | Review request card with response input |
| **Idle** | No active thread, task selected | Text input: "What would you like to work on?" |
| **Completed** | Thread complete, no pending reviews | "Thread complete" message + "Continue" button |

---

## Migration Path

1. Create new `workspace/` component directory alongside existing `thread/`
2. Build new components incrementally
3. Test workspace view with existing thread data
4. Update panel infrastructure to use workspace
5. Remove deprecated thread-window.tsx
6. Update entry point HTML

---

## Future Considerations

- Edit mode for task overview markdown
- Subtask display in sidebar
- Multi-thread diff aggregation
- Review request scheduling UI
- Keyboard shortcuts for tab navigation (1/2/3)
- Keyboard shortcut for sidebar toggle (Cmd+B)
- Thread preview on hover in sidebar
