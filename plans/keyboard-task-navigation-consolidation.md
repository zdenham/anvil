# Keyboard Task Navigation and Task View Consolidation Plan

## Overview

This plan implements quick keyboard navigation for task selection and consolidates the task list implementations by deprecating the kanban view and removing redundant status displays.

## Goals

1. **Keyboard Navigation**: Enable tabbing through tasks while holding the shortcut key
2. **Task Consolidation**: DRY the task list implementations between simple task pane and main window
3. **Kanban Deprecation**: Remove the kanban board view entirely
4. **Status Display Simplification**: Remove text status labels, keep only color dots with accessibility enhancements

## Current State Analysis

### Existing Keyboard Navigation Implementation

**IMPORTANT**: TasksPanel already has a fully functional keyboard navigation system that should be extracted and reused.

**Location**: `src/components/tasks-panel/tasks-panel.tsx` (lines 90-147)

**Current Features**:
- Arrow up/down changes `selectedIndex` with wrapping (first <-> last)
- Enter confirms selection and opens the task
- Auto-scroll keeps selected item visible (`scrollIntoView`)
- Focus management on mount (`containerRef.focus()`)
- Selection index resets when task list changes

This implementation should be extracted into a reusable hook rather than reimplemented.

### Task Pane Shortcut Implementation
- **Hotkey Storage**: `src-tauri/src/lib.rs` contains `save_task_panel_hotkey` and `get_saved_task_panel_hotkey`
- **Hotkey Registration**: Located in hotkey registration functions (not at lines 182-194)
- **Current Behavior**: Single press toggles tasks list panel
- **Backend**: `panels::toggle_tasks_list()` in `src-tauri/src/panels.rs`

### Task Display Components
1. **Tasks Panel**: `src/components/tasks-panel/tasks-panel.tsx` - Lightweight NSPanel with existing keyboard nav
2. **Simple Task Pane**: `src/components/simple-task/simple-task-window.tsx`
3. **Main Window Tasks**: `src/components/main-window/tasks-page.tsx`
4. **Task Board**: `src/components/tasks/task-board-page.tsx` - Orchestrates views, handles event subscriptions
5. **Task List View**: `src/components/tasks/task-list-view.tsx` - Uses dnd-kit for reordering

### Existing Navigation Hooks
- `src/hooks/use-simple-task-navigation.ts` - Provides `getNextTaskId`, `getPrevTaskId`, `getFirstUnreadTaskId`
- `src/hooks/use-navigate-to-next-task.ts` - Wrapper for navigating to next task

### Kanban Implementation (To be deprecated)
- **Files**: `src/components/tasks/kanban-board.tsx`, `src/components/tasks/kanban-column.tsx`
- **Features**: Drag-and-drop, 7 columns, visual validation
- **Dependencies**: dnd-kit library (STILL REQUIRED by TaskListView after kanban removal)

### Task Status Display
- **Config**: `src/components/tasks/task-card.tsx` STATUS_CONFIG
- **Section Headers**: `src/components/tasks/task-list-view.tsx` STATUS_LABELS (lines 15-23)
- **Color System**: `src/utils/task-colors.ts` (priority-based: running > unread > read)
- **Current Display**: Both text labels and color dots

### Sorting Logic Inconsistency
**Current State** (must be unified):
- `TasksPanel` (line 87): `sort((a, b) => b.updatedAt - a.updatedAt)` - Most recent first
- `sortTasksByPriority` (sort-tasks.ts): `sort((a, b) => (a.sortOrder || a.createdAt) - (b.sortOrder || b.createdAt))` - By sortOrder/createdAt ascending
- `useTaskBoard` hook: Groups by status with internal sorting

## Implementation Plan

### Phase 1: Keyboard Navigation Enhancement

#### 1.1 Revised Interaction Model

**Decision**: Abandon "hold shortcut key" approach due to technical constraints.

**Rationale**:
- Tauri's global shortcut system (`@tauri-apps/plugin-global-shortcut`) only fires on key activation, not press/release
- Implementing key hold detection would require:
  - `rdev` crate for low-level keyboard monitoring (additional dependency, cross-platform complexity)
  - CGEvent tap for macOS (platform-specific, accessibility permissions required)
  - Significant backend complexity for questionable UX benefit

**New Interaction Model** (simpler, leverages existing code):
1. Press shortcut to open/toggle tasks panel
2. Navigate through tasks using either:
   - **Arrow Keys**: Up/Down with wrapping (already implemented in TasksPanel)
   - **Tab Navigation**: Tab/Shift+Tab for standard accessibility navigation
3. Press Enter to select and open task
4. Press Escape to close panel without selection

**Navigation Method Details**:
- **Arrow Keys**: Faster navigation with visual selection highlight, wraps from last to first
- **Tab Navigation**: Standard accessibility pattern, follows DOM order, respects focus management
- **Hybrid Support**: Both methods work simultaneously - users can switch between them seamlessly

#### 1.2 Extract Reusable Keyboard Navigation Hook

**File to create**: `src/hooks/use-keyboard-task-navigation.ts`

**Purpose**: Extract the existing TasksPanel keyboard navigation into a reusable hook.

```typescript
interface KeyboardNavigationConfig {
  tasks: TaskMetadata[];
  onSelect: (task: TaskMetadata) => void;
  onClose?: () => void;
  enabled?: boolean;
  supportArrowKeys?: boolean; // Default: true
  supportTabNavigation?: boolean; // Default: true
}

interface KeyboardNavigationResult {
  selectedIndex: number;
  setSelectedIndex: (index: number) => void;
  handleKeyDown: (event: KeyboardEvent) => void;
  handleFocus: (event: FocusEvent) => void; // For tab navigation
  containerRef: React.RefObject<HTMLDivElement>;
  listRef: React.RefObject<HTMLUListElement>;
  getItemProps: (index: number) => { tabIndex: number; onFocus: () => void }; // For tab integration
}

export function useKeyboardTaskNavigation(config: KeyboardNavigationConfig): KeyboardNavigationResult {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const supportArrowKeys = config.supportArrowKeys ?? true;
  const supportTabNavigation = config.supportTabNavigation ?? true;

  // Handle keyboard navigation
  const handleKeyDown = useCallback((event: KeyboardEvent) => {
    if (!config.enabled || config.tasks.length === 0) return;

    switch (event.key) {
      case 'ArrowDown':
        if (!supportArrowKeys) return;
        event.preventDefault();
        setSelectedIndex((prev) => (prev + 1) % config.tasks.length);
        // Focus the newly selected item for accessibility
        if (supportTabNavigation && listRef.current) {
          const newSelectedItem = listRef.current.children[selectedIndex + 1] as HTMLElement;
          newSelectedItem?.focus();
        }
        break;
      case 'ArrowUp':
        if (!supportArrowKeys) return;
        event.preventDefault();
        setSelectedIndex((prev) => prev === 0 ? config.tasks.length - 1 : prev - 1);
        // Focus the newly selected item for accessibility
        if (supportTabNavigation && listRef.current) {
          const newIndex = selectedIndex === 0 ? config.tasks.length - 1 : selectedIndex - 1;
          const newSelectedItem = listRef.current.children[newIndex] as HTMLElement;
          newSelectedItem?.focus();
        }
        break;
      case 'Tab':
        if (!supportTabNavigation) return;
        // Let default tab behavior handle focus, but sync selectedIndex
        // Note: actual focus handling happens in handleFocus
        break;
      case 'Enter':
        event.preventDefault();
        if (config.tasks[selectedIndex]) {
          config.onSelect(config.tasks[selectedIndex]);
        }
        break;
      case 'Escape':
        event.preventDefault();
        config.onClose?.();
        break;
    }
  }, [config.tasks, selectedIndex, config.enabled, config.onSelect, config.onClose, supportArrowKeys, supportTabNavigation]);

  // Handle focus events for tab navigation
  const handleFocus = useCallback((event: FocusEvent) => {
    if (!supportTabNavigation || !config.enabled) return;

    const target = event.target as HTMLElement;
    const listElement = listRef.current;
    if (!listElement) return;

    // Find the index of the focused item
    const focusedIndex = Array.from(listElement.children).indexOf(target);
    if (focusedIndex >= 0 && focusedIndex < config.tasks.length) {
      setSelectedIndex(focusedIndex);
    }
  }, [config.tasks.length, config.enabled, supportTabNavigation]);

  // Get props for each task item to support tab navigation
  const getItemProps = useCallback((index: number) => ({
    tabIndex: supportTabNavigation ? 0 : -1, // Make all items tabbable if tab navigation enabled
    onFocus: () => {
      if (supportTabNavigation && config.enabled) {
        setSelectedIndex(index);
      }
    }
  }), [supportTabNavigation, config.enabled]);

  // Reset index when tasks change
  useEffect(() => {
    if (selectedIndex >= config.tasks.length) {
      setSelectedIndex(Math.max(0, config.tasks.length - 1));
    }
  }, [config.tasks.length, selectedIndex]);

  // Auto-scroll to keep selected item visible
  useEffect(() => {
    if (listRef.current && config.tasks.length > 0) {
      const selectedElement = listRef.current.children[selectedIndex] as HTMLElement;
      selectedElement?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [selectedIndex, config.tasks.length]);

  // Focus container on mount
  useEffect(() => {
    if (config.enabled && containerRef.current) {
      containerRef.current.focus();
    }
  }, [config.enabled]);

  return {
    selectedIndex,
    setSelectedIndex,
    handleKeyDown,
    handleFocus,
    containerRef,
    listRef,
    getItemProps
  };
}
```

#### 1.3 Consolidate Existing Navigation Hooks

**Files to consolidate**:
- `src/hooks/use-simple-task-navigation.ts` - Keep and enhance
- `src/hooks/use-navigate-to-next-task.ts` - Keep as wrapper
- New `src/hooks/use-keyboard-task-navigation.ts` - Extract from TasksPanel

**Relationship**:
- `useKeyboardTaskNavigation` - UI navigation within a task list (arrow keys, selection state)
- `useSimpleTaskNavigation` - Navigation between tasks (next/prev task lookup, unread detection)
- `useNavigateToNextTask` - Action wrapper for navigating to next task

#### 1.4 Update TasksPanel to Use Extracted Hook

**File to modify**: `src/components/tasks-panel/tasks-panel.tsx`

**Changes**:
- Import and use `useKeyboardTaskNavigation` hook with hybrid navigation:
```typescript
const navigation = useKeyboardTaskNavigation({
  tasks: sortedTasks,
  onSelect: handleTaskClick,
  onClose: () => invoke("hide_tasks_panel"),
  enabled: true,
  supportArrowKeys: true,  // Enable arrow key navigation
  supportTabNavigation: true,  // Enable standard tab navigation
});
```
- Remove inline keyboard handling logic (lines 90-147)
- Apply `getItemProps` to each task item for tab integration
- Maintain all existing functionality

### Phase 2: Task List Consolidation

#### 2.1 Create Unified Task List Component

**File to create**: `src/components/shared/unified-task-list.tsx`

**Component Structure**:
```typescript
interface UnifiedTaskListProps {
  tasks: TaskMetadata[];
  onTaskSelect: (task: TaskMetadata) => void;
  onDeleteTask?: (task: TaskMetadata) => void;

  // Display configuration
  selectedIndex?: number;
  compact?: boolean; // For simple task pane vs main window
  showSearch?: boolean;
  showFilters?: boolean;
  showStatusSectionHeaders?: boolean; // Whether to group by status with headers

  // Feature toggles
  enableTaskDeletion?: boolean;
  enableDragReorder?: boolean; // Control drag-and-drop per context
  enableKeyboardNavigation?: boolean;

  // Callbacks for drag reorder
  onReorder?: (taskId: string, newIndex: number, status: TaskStatus) => void;

  // Event bus subscription
  subscribeToEvents?: boolean; // Whether to handle task lifecycle events

  // Sorting configuration
  sortMode?: 'updatedAt' | 'sortOrder' | 'status-grouped';
}
```

**Features**:
- Render tasks in consistent list format
- Support both compact (tasks panel) and full (main window) modes
- Unified selection and navigation logic via `useKeyboardTaskNavigation`
- Consistent task opening behavior with simple/standard task differentiation
- **Preserve task deletion functionality** with DeleteButton component
- Context-aware deletion behavior (close window vs stay on page)
- **Conditional dnd-kit integration** based on `enableDragReorder` prop
- **Configurable event subscriptions** for task lifecycle events

**Simple Task vs Standard Task Handling**:
```typescript
const handleTaskClick = useCallback(async (task: TaskMetadata) => {
  if (task.type === 'simple') {
    // Import openSimpleTask dynamically to avoid circular imports
    const { openSimpleTask } = await import('@/lib/hotkey-service');
    const threadId = await getThreadForTask(task.id);
    await openSimpleTask(threadId ?? task.id, task.id);
  } else {
    // Standard task handling
    onTaskSelect(task);
  }
}, [onTaskSelect, getThreadForTask]);
```

**Task Deletion Integration**:
- Import and use existing `DeleteButton` component (`src/components/tasks/delete-button.tsx`)
- Preserve two-step confirmation UX pattern (first click shows "Confirm", second executes)
- Wire up `onDeleteTask` prop to enable deletion per context
- Support conditional rendering based on `enableTaskDeletion` prop
- Maintain consistent delete button positioning (end of row/card)
- Preserve loading states during deletion

**Event Subscriptions** (when `subscribeToEvents` is true):
```typescript
useEffect(() => {
  if (!subscribeToEvents) return;

  const handleTaskEvent = (data: { taskId: string }) => {
    // Trigger refresh or state update
  };

  eventBus.on(EventName.TASK_CREATED, handleTaskEvent);
  eventBus.on(EventName.TASK_UPDATED, handleTaskEvent);
  eventBus.on(EventName.TASK_DELETED, handleTaskEvent);
  eventBus.on(EventName.TASK_STATUS_CHANGED, handleTaskEvent);
  eventBus.on(EventName.THREAD_CREATED, handleThreadEvent);
  eventBus.on(EventName.THREAD_UPDATED, handleThreadEvent);
  eventBus.on(EventName.THREAD_STATUS_CHANGED, handleThreadEvent);

  return () => {
    eventBus.off(EventName.TASK_CREATED, handleTaskEvent);
    // ... cleanup all listeners
  };
}, [subscribeToEvents]);
```

**Sorting Configuration**:
```typescript
const sortedTasks = useMemo(() => {
  switch (sortMode) {
    case 'updatedAt':
      return [...tasks].sort((a, b) => b.updatedAt - a.updatedAt);
    case 'sortOrder':
      return sortTasksByPriority(tasks);
    case 'status-grouped':
      // Return tasks grouped by status (for main window list view)
      return tasks; // Grouping handled by parent component
    default:
      return tasks;
  }
}, [tasks, sortMode]);
```

**Empty State Handling**:
```typescript
if (tasks.length === 0) {
  return showEmptyState ? <EmptyTaskState /> : (
    <div className="p-4 text-center text-zinc-500 text-sm">
      No tasks yet
    </div>
  );
}
```

#### 2.2 Update Tasks Panel

**File to modify**: `src/components/tasks-panel/tasks-panel.tsx`

**Changes**:
- Replace existing task list with UnifiedTaskList configured for compact panel usage:
```typescript
<UnifiedTaskList
  tasks={sortedTasks}
  onTaskSelect={handleTaskClick}
  onDeleteTask={handleDeleteTask}
  selectedIndex={navigation.selectedIndex}
  compact={true}
  enableKeyboardNavigation={true}
  enableTaskDeletion={true}
  enableDragReorder={false}
  sortMode="updatedAt"
  subscribeToEvents={false}
  // Dual navigation support
  supportArrowKeys={true}
  supportTabNavigation={true}
  navigationProps={{
    handleKeyDown: navigation.handleKeyDown,
    handleFocus: navigation.handleFocus,
    getItemProps: navigation.getItemProps,
    containerRef: navigation.containerRef,
    listRef: navigation.listRef,
  }}
/>
```
- Remove redundant task display logic

#### 2.3 Update Main Window Tasks Page

**File to modify**: `src/components/main-window/tasks-page.tsx`

**Changes**:
- Replace TaskBoardPage with UnifiedTaskList for list view:
```typescript
<UnifiedTaskList
  tasks={sortedTasks}
  onTaskSelect={handleTaskClick}
  onDeleteTask={handleDeleteTask}
  compact={false}
  showSearch={true}
  showFilters={true}
  showStatusSectionHeaders={true}
  enableTaskDeletion={true}
  enableDragReorder={true}
  subscribeToEvents={true}
  // Main window: Prefer tab navigation, optional arrow keys
  supportArrowKeys={false}  // Can be true if desired
  supportTabNavigation={true}
  enableKeyboardNavigation={false}  // Standard focus management
/>
```
- Remove kanban view toggle option
- Maintain existing task management features

### Phase 3: Kanban View Deprecation

#### 3.1 Feature Flag for Gradual Rollout

**File to create**: `src/lib/feature-flags.ts`

```typescript
export const FeatureFlags = {
  // Set to false to hide kanban view toggle
  ENABLE_KANBAN_VIEW: false,

  // Set to true to enable new unified task list
  USE_UNIFIED_TASK_LIST: true,
};
```

**Integration**:
```typescript
// In TaskToolbar
{FeatureFlags.ENABLE_KANBAN_VIEW && (
  <div className="flex bg-surface-800 rounded-lg p-1">
    {/* View toggle buttons */}
  </div>
)}
```

#### 3.2 Remove Kanban Components (After Feature Flag Validation)

**Files to delete** (only after feature flag is disabled in production for 2+ weeks):
- `src/components/tasks/kanban-board.tsx`
- `src/components/tasks/kanban-column.tsx`

**Preserve for revert capability**:
- Keep files in a `deprecated/` branch for 30 days
- Document git commit SHAs for easy cherry-pick if needed

#### 3.3 Clean Up Task Board Page

**File to modify**: `src/components/tasks/task-board-page.tsx`

**Changes**:
- Remove kanban view logic and state (behind feature flag first)
- Remove view toggle functionality
- Simplify to only use list view with UnifiedTaskList
- **KEEP dnd-kit dependencies** - still required by TaskListView

#### 3.4 Update Task Toolbar Props Interface

**File to modify**: `src/components/tasks/task-toolbar.tsx`

**Before**:
```typescript
interface TaskToolbarProps {
  view: "kanban" | "list";
  onViewChange: (view: "kanban" | "list") => void;
  // ...
}
```

**After**:
```typescript
interface TaskToolbarProps {
  // Make view props optional for backwards compatibility
  view?: "kanban" | "list";
  onViewChange?: (view: "kanban" | "list") => void;
  // Keep other props
  availableTags: string[];
  // ...
}
```

#### 3.5 dnd-kit Dependency Decision

**IMPORTANT**: dnd-kit CANNOT be fully removed.

**Files still using dnd-kit after kanban removal**:
- `src/components/tasks/task-list-view.tsx` - Uses `DndContext`, `SortableContext`
- `src/components/tasks/task-row.tsx` - Uses `useSortable`
- `src/components/tasks/task-card.tsx` - Uses `useSortable`

**Decision**: Keep dnd-kit for list view reordering functionality.

**Update to package.json**: No changes needed - dnd-kit remains a dependency.

### Phase 4: Status Display Simplification with Accessibility

#### 4.1 Remove Text Status Labels (Visible) While Preserving Accessibility

**Files to modify**:
- `src/components/tasks/task-card.tsx`
- `src/components/tasks/task-row.tsx`

**Changes**:
- Remove visible STATUS_CONFIG text labels
- Keep only color dot indicators
- **Add screen reader text** for accessibility:

```typescript
function StatusDot({ task, threads }: StatusDotProps) {
  const { color, animation } = getTaskDotColor(task, threads);
  const statusText = getStatusText(task, threads); // "Running", "Unread", etc.

  return (
    <span className="relative">
      <span
        className={`w-2 h-2 rounded-full flex-shrink-0 ${color} ${animation || ""}`}
        aria-hidden="true" // Hide decorative dot from screen readers
      />
      {/* Screen reader only text */}
      <span className="sr-only">{statusText}</span>
    </span>
  );
}
```

**Add to global CSS** (`src/styles/globals.css` or tailwind config):
```css
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border-width: 0;
}
```

#### 4.2 Add Accessible Tooltip Component

**File to create**: `src/components/ui/accessible-tooltip.tsx`

```typescript
interface AccessibleTooltipProps {
  content: string;
  children: React.ReactNode;
}

export function AccessibleTooltip({ content, children }: AccessibleTooltipProps) {
  return (
    <div className="relative group">
      {children}
      <div
        role="tooltip"
        className="absolute z-50 hidden group-hover:block group-focus-within:block
                   px-2 py-1 text-xs bg-zinc-800 text-zinc-100 rounded shadow-lg
                   -top-8 left-1/2 -translate-x-1/2 whitespace-nowrap"
      >
        {content}
      </div>
    </div>
  );
}
```

**Usage in StatusDot**:
```typescript
<AccessibleTooltip content={statusText}>
  <span className={`w-2 h-2 rounded-full ${color} ${animation}`} aria-hidden="true" />
  <span className="sr-only">{statusText}</span>
</AccessibleTooltip>
```

#### 4.3 Status Section Headers Decision

**Question from review**: Should section headers also lose their text labels?

**Decision**: **Keep text labels for section headers** in `task-list-view.tsx`.

**Rationale**:
- Section headers serve a different purpose than individual task status dots
- They help users quickly navigate to task groups
- Removing them would significantly reduce usability
- Color-only section headers would be confusing

**No changes to** `src/components/tasks/task-list-view.tsx` STATUS_LABELS constant.

#### 4.4 Update Task Color System for Accessibility

**File to modify**: `src/utils/task-colors.ts`

**Add distinguishing characteristics beyond color**:

```typescript
interface TaskDotStyle {
  color: string;
  animation?: string;
  icon?: string; // Optional icon identifier for additional visual distinction
}

export function getTaskDotColor(task: TaskMetadata, threads: ThreadMetadata[]): TaskDotStyle {
  const taskThreads = threads.filter(t => t.taskId === task.id);
  const hasRunning = taskThreads.some(t => t.status === 'running');
  const hasUnread = taskThreads.some(t => !t.isRead);

  if (hasRunning) {
    return {
      color: 'bg-green-400',
      animation: 'animate-pulse', // Animation distinguishes running state
      icon: 'running',
    };
  }
  if (hasUnread) {
    return {
      color: 'bg-blue-500',
      animation: undefined,
      icon: 'unread',
    };
  }
  return {
    color: 'bg-zinc-400',
    animation: undefined,
    icon: 'read',
  };
}
```

**Visual Distinctions by State**:
| State | Color | Additional Visual Cue |
|-------|-------|----------------------|
| Running | Green (`bg-green-400`) | Pulse animation |
| Unread | Blue (`bg-blue-500`) | Solid dot |
| Read | Gray (`bg-zinc-400`) | Muted/dimmed appearance |

### Phase 5: Integration and Testing

#### 5.1 Wire Up Navigation Flow

**Files to modify**: Multiple components

**Integration Points**:
- Connect `useKeyboardTaskNavigation` hook to UnifiedTaskList
- Ensure consistent behavior between simple task pane and main window
- Test keyboard navigation with actual task selection and opening

**Cross-Window State Management**:

Each window has its own React state tree (separate Tauri windows with separate React roots). Navigation state should be:
- **Per-window** - Each window tracks its own `selectedIndex`
- **Not synchronized** - No need to sync selection between windows
- **Task list state** - Comes from Zustand store (automatically synced via IPC)

```typescript
// Each window independently uses the hook
const { selectedIndex, handleKeyDown } = useKeyboardTaskNavigation({
  tasks: sortedTasks,
  onSelect: handleTaskClick,
  onClose: () => invoke("hide_tasks_panel"),
  enabled: true,
});
```

#### 5.2 Race Condition Handling

**Scenarios to Handle**:

1. **Task deleted during navigation**:
```typescript
const handleKeyDown = useCallback((event: KeyboardEvent) => {
  if (event.key === 'Enter') {
    const task = tasks[selectedIndex];
    if (!task) {
      // Task was deleted, reset selection
      setSelectedIndex(Math.min(selectedIndex, tasks.length - 1));
      return;
    }
    onSelect(task);
  }
}, [tasks, selectedIndex]);
```

2. **Task list updates during navigation**:
```typescript
useEffect(() => {
  // Clamp selectedIndex to valid range when tasks change
  if (selectedIndex >= tasks.length) {
    setSelectedIndex(Math.max(0, tasks.length - 1));
  }
}, [tasks.length, selectedIndex]);
```

3. **Optimistic selection with rollback**:
```typescript
const handleSelect = async (task: TaskMetadata) => {
  try {
    await onSelect(task);
  } catch (error) {
    // Task may have been deleted, refresh list
    await taskService.refresh();
    // Show error notification if needed
  }
};
```

#### 5.3 Delete Confirmation During Navigation

**Edge Case**: User is navigating and tries to delete a task.

**Solution**: Delete button is a separate interaction from navigation.
- Delete requires explicit click (not keyboard shortcut during navigation)
- Two-step confirmation prevents accidental deletion
- Navigation continues to work while delete confirmation is pending

## Technical Specifications

### Keyboard Navigation Behavior (Revised)

**Trigger**: Press task panel shortcut key to open panel

**Navigation Methods**:
1. **Arrow Key Navigation**:
   - Arrow up/down while panel is open (with wrapping from first ↔ last)
   - Visual selection highlight updates in real-time
   - Automatically syncs with tab focus when both methods are enabled

2. **Tab Navigation** (Standard Accessibility):
   - Tab/Shift+Tab follows DOM order through task items
   - Focus ring indicates currently focused task
   - Selection index automatically syncs with focused item
   - Respects standard browser accessibility patterns

**Hybrid Behavior**:
- Both methods work simultaneously when enabled
- Arrow keys update both selection highlight AND browser focus
- Tab navigation updates selection index to match focused item
- Consistent Enter/Escape behavior regardless of navigation method used

**Actions**:
- **Selection**: Press Enter to open highlighted/focused task
- **Cancel**: Press Escape to close panel without selection
- **Visual**: Clear highlighting shows current selection (ring highlight + focus ring)

**Scope**:
- **Tasks Panel**: Full hybrid navigation (arrow keys + tab)
- **Main Window**: Standard focus management with optional arrow key enhancement

### Task List Unification

**Shared Logic**:
- Task filtering and search
- Task selection and opening
- Keyboard navigation (via `useKeyboardTaskNavigation`)
- Status color indicators with accessibility
- **Task deletion with DeleteButton component**
- Two-step delete confirmation UI pattern
- Simple task vs standard task differentiation

**Context-Specific**:
- Layout density (compact vs full)
- Available actions (search, filters)
- Panel size and positioning
- **Deletion behavior** (close window vs stay on page)
- Delete button visibility and positioning
- Drag-and-drop enablement
- Event bus subscriptions
- Sorting mode

### Window Architecture

**Separate Tauri Windows/Panels**:
- Simple task panel: `simple-task.html` -> `SimpleTaskPanel` NSPanel
- Tasks list panel: `tasks-panel.html` -> `TasksListPanel` NSPanel
- Main window: Regular Tauri window with `tasks-page.tsx`

**State Management**:
- Zustand stores are synchronized across windows via IPC bridge
- Navigation state (selectedIndex) is local to each window
- No cross-window navigation synchronization needed

### Removed Features

**Kanban Board** (behind feature flag, then removed):
- All drag-and-drop between columns
- Column-based task organization
- Visual task flow representation

**Status Text Labels** (visible only, screen reader text preserved):
- "Draft", "Backlog", "To Do", etc. visible text
- STATUS_CONFIG label mappings
- Text-based status identification (replaced by tooltips + sr-only text)

## Testing Strategy

### Unit Tests

**File to create**: `src/hooks/use-keyboard-task-navigation.test.ts`

```typescript
describe('useKeyboardTaskNavigation', () => {
  // Arrow Key Navigation Tests
  it('should navigate down on ArrowDown', () => {
    // Test selectedIndex increments
  });

  it('should navigate up on ArrowUp', () => {
    // Test selectedIndex decrements
  });

  it('should wrap from last to first on ArrowDown', () => {
    // Test wrapping behavior
  });

  it('should wrap from first to last on ArrowUp', () => {
    // Test wrapping behavior
  });

  // Tab Navigation Tests
  it('should update selectedIndex when focus changes via tab', () => {
    // Test focus synchronization with selection
  });

  it('should provide correct tabIndex via getItemProps', () => {
    // Test tab accessibility setup
  });

  // Hybrid Navigation Tests
  it('should sync focus when arrow keys change selection', () => {
    // Test that arrow keys update both selectedIndex AND browser focus
  });

  it('should sync selection when tab navigation changes focus', () => {
    // Test that tab focus updates selectedIndex
  });

  it('should work with both navigation methods disabled', () => {
    // Test fallback behavior
  });

  it('should work with only arrow keys enabled', () => {
    // Test partial navigation support
  });

  it('should work with only tab navigation enabled', () => {
    // Test partial navigation support
  });

  // Common Tests
  it('should call onSelect on Enter', () => {
    // Test selection callback regardless of navigation method
  });

  it('should call onClose on Escape', () => {
    // Test close callback regardless of navigation method
  });

  it('should reset index when tasks change', () => {
    // Test index clamping
  });

  it('should handle empty task list', () => {
    // Test empty state
  });

  it('should handle single task in list', () => {
    // Test single item navigation for both methods
  });
});
```

**File to update**: `src/components/tasks/task-card.ui.test.tsx`

```typescript
describe('TaskCard with status dot changes', () => {
  it('should render status dot without visible text', () => {
    // Verify no visible status text
  });

  it('should include screen reader text for status', () => {
    // Verify sr-only span exists with correct content
  });

  it('should show tooltip on hover', () => {
    // Verify tooltip appears
  });
});
```

### Integration Tests

**File to create**: `src/components/shared/unified-task-list.test.tsx`

```typescript
describe('UnifiedTaskList', () => {
  it('should render tasks in compact mode', () => {});
  it('should render tasks in full mode with filters', () => {});
  it('should handle task selection via keyboard', () => {});
  it('should handle task deletion', () => {});
  it('should differentiate simple vs standard tasks', () => {});
  it('should subscribe to events when configured', () => {});
  it('should support drag reorder when enabled', () => {});
});
```

### Accessibility Tests

**Manual Testing Checklist**:
- [ ] Screen reader announces task status (VoiceOver, NVDA)
- [ ] Keyboard navigation works without mouse
- [ ] Focus is visible at all times
- [ ] Tooltips are accessible via keyboard (focus-within)
- [ ] Color is not the only means of conveying status (animation for running)

**Automated** (via jest-axe or similar):
```typescript
import { axe, toHaveNoViolations } from 'jest-axe';

expect.extend(toHaveNoViolations);

it('should have no accessibility violations', async () => {
  const { container } = render(<UnifiedTaskList tasks={mockTasks} />);
  const results = await axe(container);
  expect(results).toHaveNoViolations();
});
```

### Edge Case Tests

**Scenarios to Test**:
- Empty task list navigation
- Single task in list
- Navigation wrapping (first -> last, last -> first)
- Task deletion during navigation (index clamping)
- Task creation during navigation (list update)
- Panel visibility changes during navigation
- Multiple rapid key presses (debouncing)
- Focus management during navigation mode
- Delete confirmation timeout with navigation

### Performance Tests

**Large Task List Performance**:
```typescript
it('should render 1000 tasks without significant delay', () => {
  const startTime = performance.now();
  render(<UnifiedTaskList tasks={generate1000Tasks()} />);
  const endTime = performance.now();
  expect(endTime - startTime).toBeLessThan(500); // 500ms threshold
});
```

## Migration Strategy

### Backwards Compatibility
- Preserve all existing task opening mechanisms
- Maintain current hotkey behavior (toggle panel)
- Keep existing task status logic intact
- **Preserve all task deletion functionality** including:
  - Two-step delete confirmation (DeleteButton component)
  - Context-aware deletion behavior
  - Optimistic updates and rollback on failure
  - Recursive subtask deletion

### User Experience
- Keyboard navigation leverages existing TasksPanel implementation - no learning curve
- List view becomes the primary task management interface
- Color dots provide sufficient status information with accessibility enhancements
- Tooltips and screen reader text maintain full status information

### Performance
- Remove unused kanban rendering code (after feature flag period)
- Simplify task list rendering with unified component
- **Keep dnd-kit** for list reordering functionality

### Feature Flag Rollout Plan

**Week 1-2**:
- Deploy with `ENABLE_KANBAN_VIEW: true` (current behavior)
- Deploy `USE_UNIFIED_TASK_LIST: true` in parallel paths
- Monitor for issues

**Week 3-4**:
- Set `ENABLE_KANBAN_VIEW: false` for new installs
- Existing users retain kanban access

**Week 5-6**:
- Set `ENABLE_KANBAN_VIEW: false` for all users
- Monitor feedback

**Week 7+**:
- Remove kanban code if no significant issues
- Remove feature flag infrastructure

### Rollback Strategy

**If issues arise with UnifiedTaskList**:
1. Set `USE_UNIFIED_TASK_LIST: false` in feature flags
2. Release patch version
3. Users automatically revert to previous implementation

**If issues arise with kanban removal**:
1. Set `ENABLE_KANBAN_VIEW: true` in feature flags
2. Release patch version
3. Kanban view becomes available again

**If accessibility concerns arise**:
1. Status text can be made visible again via CSS change
2. No code changes required, just toggle `sr-only` to visible class

## Implementation Order

1. **Feature flags infrastructure** - Enable gradual rollout
2. **Extract keyboard navigation hook** - Foundation from existing code
3. **Update TasksPanel** - Use extracted hook, validate behavior
4. **Create UnifiedTaskList component** - Consolidate display logic
5. **Add accessibility enhancements** - sr-only text, tooltips
6. **Update main window** - Wire up UnifiedTaskList
7. **Disable kanban via feature flag** - Begin deprecation
8. **Integration testing** - Ensure seamless user experience
9. **Remove kanban components** - After validation period
10. **Remove feature flags** - Clean up infrastructure

## Success Criteria

1. Users can navigate tasks with arrow keys in tasks panel (existing behavior preserved)
2. Task selection works consistently in both simple pane and main window
3. Kanban view is hidden behind feature flag, then removed
4. Only color dots are used for visual status indication
5. Screen readers can announce task status (WCAG compliance)
6. All existing task management features are preserved
7. No regressions in task opening or hotkey functionality
8. Reduced code duplication between task list implementations
9. **Task deletion functionality is fully preserved** in unified component
10. Feature flag enables safe rollback if needed

## Risk Assessment

**Low Risk**:
- Keyboard navigation extraction is refactoring existing working code
- Task list consolidation improves maintainability
- Feature flags enable safe rollout

**Medium Risk**:
- Kanban removal may affect users who prefer visual task flow
- Status text removal may reduce accessibility (mitigated by sr-only text)
- Cross-window architecture complexity

**Mitigation**:
- Feature flags enable gradual rollout and instant rollback
- Accessibility enhancements (sr-only text, tooltips) preserve information
- Consider tooltip hover for status text if user feedback indicates need
- Per-window navigation state avoids synchronization complexity
- Keep kanban code in separate branch for 30 days post-removal

## Dependencies and Prerequisites

### Backend Changes Required
- None for keyboard navigation (using existing shortcut system)
- No new Tauri commands needed (frontend-only navigation)

### Frontend Dependencies
- `useKeyboardTaskNavigation` hook (new)
- `UnifiedTaskList` component (new)
- `AccessibleTooltip` component (new)
- Feature flags infrastructure (new)

### Existing Code to Preserve
- `DeleteButton` component and two-step confirmation logic
- `taskService.delete()` and recursive subtask deletion
- Event bus subscriptions for task lifecycle
- dnd-kit integration for list reordering
- `sortTasksByPriority` function
- Simple task vs standard task opening logic

### Files Summary

**New Files**:
- `src/hooks/use-keyboard-task-navigation.ts`
- `src/components/shared/unified-task-list.tsx`
- `src/components/ui/accessible-tooltip.tsx`
- `src/lib/feature-flags.ts`
- `src/hooks/use-keyboard-task-navigation.test.ts`
- `src/components/shared/unified-task-list.test.tsx`

**Modified Files**:
- `src/components/tasks-panel/tasks-panel.tsx`
- `src/components/main-window/tasks-page.tsx`
- `src/components/tasks/task-board-page.tsx`
- `src/components/tasks/task-toolbar.tsx`
- `src/components/tasks/task-card.tsx`
- `src/components/tasks/task-row.tsx`
- `src/components/tasks/task-card.ui.test.tsx`
- `src/utils/task-colors.ts`

**Deleted Files** (after feature flag period):
- `src/components/tasks/kanban-board.tsx`
- `src/components/tasks/kanban-column.tsx`

**NOT Deleted**:
- dnd-kit dependencies in `package.json` (still needed)
