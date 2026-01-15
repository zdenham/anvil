# Task List Consolidation (Sequential Track B)

## Overview
Creates unified task list component to eliminate code duplication. **Depends on Track A completion** for keyboard navigation hook.

## Goals
1. Create UnifiedTaskList component with all existing features
2. Update TasksPanel to use UnifiedTaskList
3. Update main window to use UnifiedTaskList
4. Maintain all task deletion and management functionality

## Implementation Steps

### 2.1 Create Unified Task List Component
**File to create**: `src/components/shared/unified-task-list.tsx`

**Consolidates**:
- TasksPanel task display logic
- Main window task list display
- TaskListView features (drag reorder, filtering)
- Task deletion with DeleteButton integration

**Key Features**:
```typescript
interface UnifiedTaskListProps {
  tasks: TaskMetadata[];
  onTaskSelect: (task: TaskMetadata) => void;
  onDeleteTask?: (task: TaskMetadata) => void;

  // Display modes
  compact?: boolean;
  selectedIndex?: number;
  showSearch?: boolean;
  showFilters?: boolean;
  showStatusSectionHeaders?: boolean;

  // Feature toggles
  enableTaskDeletion?: boolean;
  enableDragReorder?: boolean;
  enableKeyboardNavigation?: boolean;
  supportArrowKeys?: boolean;
  supportTabNavigation?: boolean;

  // Configuration
  sortMode?: 'updatedAt' | 'sortOrder' | 'status-grouped';
  subscribeToEvents?: boolean;
}
```

**Task Deletion Integration**:
- Import existing DeleteButton component
- Preserve two-step confirmation UX
- Context-aware deletion behavior (close window vs stay on page)
- Maintain loading states and error handling

**Simple vs Standard Task Handling**:
```typescript
const handleTaskClick = async (task: TaskMetadata) => {
  if (task.type === 'simple') {
    const { openSimpleTask } = await import('@/lib/hotkey-service');
    const threadId = await getThreadForTask(task.id);
    await openSimpleTask(threadId ?? task.id, task.id);
  } else {
    onTaskSelect(task);
  }
};
```

### 2.2 Update TasksPanel Integration
**File to modify**: `src/components/tasks-panel/tasks-panel.tsx`

Replace existing task list rendering with:
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
  supportArrowKeys={true}
  supportTabNavigation={true}
  sortMode="updatedAt"
  subscribeToEvents={false}
  navigationProps={navigation}
/>
```

### 2.3 Update Main Window Tasks Page
**File to modify**: `src/components/main-window/tasks-page.tsx`

Replace TaskBoardPage with:
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
  supportTabNavigation={true}
  enableKeyboardNavigation={false}  // Standard focus management
/>
```

### 2.4 Event Bus Integration
Handle task lifecycle events when `subscribeToEvents` is enabled:
```typescript
useEffect(() => {
  if (!subscribeToEvents) return;

  const handleTaskEvent = (data: { taskId: string }) => {
    // Trigger refresh or state update
  };

  eventBus.on(EventName.TASK_CREATED, handleTaskEvent);
  eventBus.on(EventName.TASK_UPDATED, handleTaskEvent);
  eventBus.on(EventName.TASK_DELETED, handleTaskEvent);
  // ... cleanup
}, [subscribeToEvents]);
```

## Dependencies
- **Requires**: Track A completion (`useKeyboardTaskNavigation` hook)
- **Blocks**: Track C (Kanban Deprecation needs unified list in place)

## Race Condition Handling
```typescript
// Task deleted during navigation
const handleKeyDown = useCallback((event: KeyboardEvent) => {
  if (event.key === 'Enter') {
    const task = tasks[selectedIndex];
    if (!task) {
      setSelectedIndex(Math.min(selectedIndex, tasks.length - 1));
      return;
    }
    onSelect(task);
  }
}, [tasks, selectedIndex]);
```

## Preserved Features
- **Complete task deletion workflow** (DeleteButton + confirmation)
- **Drag-and-drop reordering** (dnd-kit integration)
- **Event subscriptions** for real-time updates
- **Simple task differentiation** and opening logic
- **Sorting consistency** across all contexts

## Testing
- Integration tests for UnifiedTaskList
- Task deletion workflow testing
- Keyboard navigation with unified component
- Event subscription validation

## Estimated Scope
- **Files**: 1 new, 2 modified
- **Risk**: Medium (significant refactoring)
- **Dependencies**: Must wait for Track A