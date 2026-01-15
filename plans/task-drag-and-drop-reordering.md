# Task Drag and Drop Reordering - Comprehensive Implementation Plan

## Executive Summary
Enhance the existing task management system with improved drag-and-drop functionality by migrating from numeric to lexicographical ordering. This plan provides accessibility-first implementation, comprehensive testing strategy, performance optimizations, and robust error handling to deliver a world-class task reordering experience.

## Current State Analysis

### Existing Implementation
- **Drag Library**: Already using `@dnd-kit` v6.3.1 with sortable support
- **Current Ordering**: Numeric `sortOrder` field with 1000-unit spacing
- **Reordering Logic**:
  - `reorderWithinColumn()` reassigns all affected tasks as `index * 1000`
  - `moveToColumn()` calculates midpoint: `Math.floor((prevOrder + nextOrder) / 2)`
- **UI Components**: KanbanBoard and TaskListView have functional drag-and-drop
- **Validation**: Move validation prevents invalid status transitions
- **State Management**: Zustand store with optimistic updates and rollback

### Identified Limitations
- **Precision Issues**: Numeric ordering can hit precision limits with many insertions
- **Bulk Updates**: Reordering requires updating all subsequent tasks (expensive)
- **UX Gaps**: Limited visual feedback, no accessibility alternatives
- **Performance**: No debouncing or batching for rapid operations
- **Testing**: Minimal drag-and-drop test coverage

## Proposed Enhancements

### 1. Lexicographical Ordering System

#### Core Algorithm
Implement fractional string-based ordering that allows infinite precision insertion:

```typescript
interface OrderSystem {
  generateInitial(): string;                    // "m" - middle of alphabet
  generateBefore(next: string): string;         // Insert before existing order
  generateAfter(prev: string): string;          // Insert after existing order
  generateBetween(prev: string, next: string): string; // Insert between orders
}
```

#### Benefits Over Numeric System
- **Infinite Precision**: No floating-point limitations
- **Minimal Updates**: Only the moved task needs order update
- **Collision-Free**: No risk of duplicate sort values
- **Future-Proof**: Works with any list size

#### Implementation Details
- Base-26 lexicographical space using letters a-z
- Midpoint algorithm for insertion between any two positions
- Automatic compaction when order strings grow too long (>8 chars)

### 2. Enhanced Visual Design System

#### Drag State Indicators
- **Idle State**: Subtle grip handle (6 dots) visible on hover
- **Hover State**: Handle becomes prominent, cursor changes to grab
- **Dragging State**: Task card elevated with shadow, 50% opacity
- **Drop Zone State**: Animated insertion line with color indication
- **Success State**: Brief highlight animation on successful drop

#### Responsive Design Considerations
- **Desktop**: Precise pixel positioning with 8px activation distance
- **Mobile**: Larger touch targets (44px minimum), haptic feedback
- **Tablet**: Hybrid approach with adaptive touch/pointer detection

### 3. Accessibility-First Implementation

#### Keyboard Navigation
- **Tab**: Navigate to drag handle
- **Spacebar**: Grab/release item (with audio/visual confirmation)
- **Arrow Keys**: Move item up/down within list
- **Escape**: Cancel drag operation
- **Enter**: Confirm move to current position

#### Screen Reader Support
- **Live Regions**: Announce position changes ("Task moved to position 3 of 12")
- **Instructions**: Contextual help text for operation guidance
- **State Announcements**: "Task grabbed", "Task dropped", "Move cancelled"

#### Alternative Interaction Methods
- **Reorder Buttons**: Up/down arrows for sequential movement
- **Position Menu**: Dropdown to select specific target position
- **Batch Operations**: Multi-select with position assignment

### 4. Performance Optimization Framework

#### Optimistic Updates
- **Immediate UI Response**: Visual changes before API confirmation
- **Rollback Strategy**: Automatic revert on failure with user notification
- **Conflict Resolution**: Handle concurrent edits gracefully

#### Rendering Optimization
- **Virtual Scrolling**: For task lists exceeding 100 items
- **Memoization**: Prevent unnecessary re-renders during drag operations
- **Debouncing**: Batch rapid position changes (300ms window)

#### Memory Management
- **Cleanup**: Remove drag listeners on component unmount
- **Throttling**: Limit drag event frequency to 60fps max
- **Lazy Loading**: Load task content only when needed

## Technical Implementation Specifications

### Lexicographical Order Algorithm

#### Core Implementation
```typescript
class LexicographicalOrder {
  private static readonly ALPHABET = 'abcdefghijklmnopqrstuvwxyz';
  private static readonly MID_CHAR = 'm'; // Middle of alphabet

  /**
   * Generate order for first item
   */
  static generateInitial(): string {
    return this.MID_CHAR;
  }

  /**
   * Generate order before an existing item
   */
  static generateBefore(next: string): string {
    if (next === 'a') return 'Z'; // Wrap to end of previous "tier"
    if (next.length === 1) {
      const prevChar = String.fromCharCode(next.charCodeAt(0) - 1);
      return prevChar === 'a' ? 'Z' : prevChar;
    }
    return this.generateMiddle('', next);
  }

  /**
   * Generate order after an existing item
   */
  static generateAfter(prev: string): string {
    if (prev === 'z') return prev + this.MID_CHAR; // Extend length
    const nextChar = String.fromCharCode(prev.charCodeAt(0) + 1);
    return nextChar;
  }

  /**
   * Generate order between two items (core algorithm)
   */
  static generateBetween(prev: string, next: string): string {
    let i = 0;
    const maxLen = Math.max(prev.length, next.length);

    while (i < maxLen) {
      const prevChar = prev[i] || 'a';
      const nextChar = next[i] || 'z';

      if (prevChar < nextChar) {
        const midCode = Math.floor((prevChar.charCodeAt(0) + nextChar.charCodeAt(0)) / 2);
        if (midCode > prevChar.charCodeAt(0)) {
          return prev.substring(0, i) + String.fromCharCode(midCode);
        }
      }
      i++;
    }

    // No middle found - extend string
    return prev + this.MID_CHAR;
  }
}
```

#### Migration Strategy
```typescript
async function migrateSortOrders(tasks: TaskMetadata[]): Promise<void> {
  const sortedTasks = tasks.sort((a, b) => a.sortOrder - b.sortOrder);

  for (let i = 0; i < sortedTasks.length; i++) {
    const newOrder = i === 0
      ? LexicographicalOrder.generateInitial()
      : LexicographicalOrder.generateAfter(sortedTasks[i - 1].lexOrder);

    await taskService.update(sortedTasks[i].id, {
      lexOrder: newOrder,
      sortOrder: undefined // Remove old field
    });
  }
}
```

### Enhanced Component Architecture

#### Updated TaskMetadata Schema
```typescript
// core/types/tasks.ts
export const TaskMetadataSchema = z.object({
  id: z.string(),
  slug: z.string(),
  title: z.string(),
  description: z.string().optional(),
  branchName: z.string().nullable(),
  type: z.enum(['work', 'investigate', 'simple']),
  status: TaskStatusSchema,

  // NEW: Lexicographical ordering
  lexOrder: z.string().default(() => LexicographicalOrder.generateInitial()),

  // DEPRECATED: Keep for migration period
  sortOrder: z.number().optional(),

  tags: z.array(z.string()).default([]),
  subtasks: z.array(SubtaskSchema).default([]),
  // ... rest of schema
});
```

#### Enhanced TaskCard with Accessibility
```typescript
// src/components/tasks/task-card.tsx
export function TaskCard({ task, index }: TaskCardProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
    isOver,
  } = useSortable({ id: task.id });

  const [isKeyboardGrabbed, setIsKeyboardGrabbed] = useState(false);

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        "task-card",
        isDragging && "task-card--dragging",
        isOver && "task-card--drop-target"
      )}
      role="listitem"
      aria-describedby={`task-instructions-${task.id}`}
    >
      <DragHandle
        {...attributes}
        {...listeners}
        taskId={task.id}
        position={index + 1}
        totalCount={totalTaskCount}
        onKeyboardGrab={setIsKeyboardGrabbed}
        isGrabbed={isKeyboardGrabbed}
      />

      <TaskContent task={task} />

      {/* Hidden instructions for screen readers */}
      <div id={`task-instructions-${task.id}`} className="sr-only">
        Press spacebar to grab this task for reordering. Use arrow keys to move position.
        Press spacebar again to drop. Press escape to cancel.
      </div>
    </div>
  );
}
```

#### Accessible DragHandle Component
```typescript
// src/components/tasks/drag-handle.tsx
interface DragHandleProps {
  taskId: string;
  position: number;
  totalCount: number;
  isGrabbed: boolean;
  onKeyboardGrab: (grabbed: boolean) => void;
  [key: string]: any; // dnd-kit attributes
}

export function DragHandle({
  taskId,
  position,
  totalCount,
  isGrabbed,
  onKeyboardGrab,
  ...dndProps
}: DragHandleProps) {
  const handleKeyDown = (e: KeyboardEvent) => {
    switch (e.key) {
      case ' ':
        e.preventDefault();
        onKeyboardGrab(!isGrabbed);
        announceToScreenReader(
          isGrabbed
            ? `Task dropped at position ${position}`
            : `Task grabbed. Use arrow keys to move. Current position ${position} of ${totalCount}`
        );
        break;
      case 'ArrowUp':
        if (isGrabbed && position > 1) {
          onPositionChange(position - 1);
        }
        break;
      case 'ArrowDown':
        if (isGrabbed && position < totalCount) {
          onPositionChange(position + 1);
        }
        break;
      case 'Escape':
        if (isGrabbed) {
          onKeyboardGrab(false);
          announceToScreenReader('Task reorder cancelled');
        }
        break;
    }
  };

  return (
    <button
      {...dndProps}
      onKeyDown={handleKeyDown}
      className={cn(
        "drag-handle",
        isGrabbed && "drag-handle--grabbed"
      )}
      aria-label={`Drag to reorder task. Position ${position} of ${totalCount}`}
      aria-describedby={`drag-instructions-${taskId}`}
      aria-pressed={isGrabbed}
    >
      <GripVertical className="drag-handle__icon" />
    </button>
  );
}
```

### File System and Data Updates

#### Enhanced TaskService Methods
```typescript
// src/entities/tasks/service.ts
class TaskService {
  /**
   * Reorder task using lexicographical positioning
   */
  async reorderTask(
    taskId: string,
    beforeTaskId: string | null,
    afterTaskId: string | null
  ): Promise<void> {
    const beforeTask = beforeTaskId ? await this.getTask(beforeTaskId) : null;
    const afterTask = afterTaskId ? await this.getTask(afterTaskId) : null;

    const newOrder = LexicographicalOrder.generateBetween(
      beforeTask?.lexOrder || null,
      afterTask?.lexOrder || null
    );

    return this.optimistic(
      () => this.store._applyUpdate(taskId, { lexOrder: newOrder }),
      () => this.updateTaskFile(taskId, { lexOrder: newOrder })
    );
  }

  /**
   * Batch reorder multiple tasks (for bulk operations)
   */
  async batchReorder(operations: Array<{
    taskId: string;
    beforeTaskId?: string;
    afterTaskId?: string;
  }>): Promise<void> {
    const updates = operations.map(op => {
      const newOrder = LexicographicalOrder.generateBetween(
        op.beforeTaskId || null,
        op.afterTaskId || null
      );
      return { taskId: op.taskId, lexOrder: newOrder };
    });

    return this.optimistic(
      () => updates.forEach(u => this.store._applyUpdate(u.taskId, { lexOrder: u.lexOrder })),
      () => Promise.all(updates.map(u => this.updateTaskFile(u.taskId, { lexOrder: u.lexOrder })))
    );
  }
}
```

#### Updated Store Selectors
```typescript
// src/entities/tasks/store.ts
export const useTaskStore = create<TaskStore>((set, get) => ({
  // ... existing store

  getTasksByStatus: (status: TaskStatus) => {
    const tasks = Object.values(get().tasks);
    return tasks
      .filter(task => task.status === status)
      .sort((a, b) => {
        // Use lexOrder if available, fallback to sortOrder for migration
        const aOrder = a.lexOrder || String(a.sortOrder || 0).padStart(10, '0');
        const bOrder = b.lexOrder || String(b.sortOrder || 0).padStart(10, '0');
        return aOrder.localeCompare(bOrder);
      });
  },

  getTaskPosition: (taskId: string, status: TaskStatus) => {
    const tasks = get().getTasksByStatus(status);
    return tasks.findIndex(task => task.id === taskId) + 1;
  },

  getTotalTasksInStatus: (status: TaskStatus) => {
    return get().getTasksByStatus(status).length;
  }
}));
```

## Comprehensive Testing Strategy

### Unit Tests

#### Lexicographical Order Algorithm Testing
```typescript
// src/utils/lexicographical-order.test.ts
describe('LexicographicalOrder', () => {
  describe('generateBetween', () => {
    test('generates order between two strings', () => {
      expect(LexicographicalOrder.generateBetween('a', 'c')).toBe('b');
      expect(LexicographicalOrder.generateBetween('a', 'b')).toBe('am');
    });

    test('handles edge cases', () => {
      expect(LexicographicalOrder.generateBetween('', 'b')).toBe('a');
      expect(LexicographicalOrder.generateBetween('z', '')).toBe('zm');
    });

    test('prevents infinite loops with identical adjacent strings', () => {
      expect(LexicographicalOrder.generateBetween('a', 'a')).toBe('am');
    });
  });

  describe('migration scenarios', () => {
    test('converts numeric orders correctly', () => {
      const numericTasks = [
        { id: '1', sortOrder: 1000 },
        { id: '2', sortOrder: 2000 },
        { id: '3', sortOrder: 3000 }
      ];

      const lexOrders = convertToLexicographical(numericTasks);
      expect(lexOrders.map(t => t.lexOrder)).toEqual(['m', 'n', 'o']);
    });
  });
});
```

#### Component Testing with @testing-library
```typescript
// src/components/tasks/task-card.ui.test.tsx
describe('TaskCard with Drag and Drop', () => {
  test('displays drag handle on hover', async () => {
    const { getByRole } = render(<TaskCard task={mockTask} index={0} />);
    const dragHandle = getByRole('button', { name: /drag to reorder/i });

    expect(dragHandle).toBeInTheDocument();
    expect(dragHandle).toHaveAttribute('aria-pressed', 'false');
  });

  test('keyboard navigation works correctly', async () => {
    const user = userEvent.setup();
    const { getByRole } = render(<TaskCard task={mockTask} index={0} />);
    const dragHandle = getByRole('button', { name: /drag to reorder/i });

    await user.tab(); // Focus drag handle
    await user.keyboard(' '); // Grab task

    expect(dragHandle).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText(/task grabbed/i)).toBeInTheDocument();

    await user.keyboard('{ArrowDown}'); // Move down
    await user.keyboard(' '); // Drop

    expect(dragHandle).toHaveAttribute('aria-pressed', 'false');
  });

  test('announces position changes to screen readers', async () => {
    const announceToScreenReader = jest.fn();
    const user = userEvent.setup();

    render(<TaskCard task={mockTask} index={0} />, {
      wrapper: ({ children }) => (
        <ScreenReaderProvider announce={announceToScreenReader}>
          {children}
        </ScreenReaderProvider>
      )
    });

    const dragHandle = getByRole('button', { name: /drag to reorder/i });
    await user.keyboard(' '); // Grab
    await user.keyboard('{ArrowDown}'); // Move

    expect(announceToScreenReader).toHaveBeenCalledWith(
      'Task moved to position 2 of 5'
    );
  });
});
```

### Integration Tests

#### TaskService Reordering Tests
```typescript
// src/entities/tasks/service.test.ts
describe('TaskService reordering', () => {
  let taskService: TaskService;
  let mockFS: MockFileSystemAdapter;

  beforeEach(() => {
    mockFS = new MockFileSystemAdapter();
    taskService = new TaskService(mockFS);
  });

  test('reorders tasks within same status', async () => {
    const tasks = [
      createTask({ id: 'task1', status: 'todo', lexOrder: 'a' }),
      createTask({ id: 'task2', status: 'todo', lexOrder: 'b' }),
      createTask({ id: 'task3', status: 'todo', lexOrder: 'c' })
    ];

    await taskService.hydrate();

    // Move task3 between task1 and task2
    await taskService.reorderTask('task3', 'task1', 'task2');

    const reorderedTasks = taskService.getTasksByStatus('todo');
    expect(reorderedTasks.map(t => t.id)).toEqual(['task1', 'task3', 'task2']);
  });

  test('handles optimistic update rollback on failure', async () => {
    mockFS.writeFile = jest.fn().mockRejectedValue(new Error('Write failed'));

    const originalOrder = taskService.getTasksByStatus('todo');

    await expect(
      taskService.reorderTask('task1', null, 'task2')
    ).rejects.toThrow('Write failed');

    // Verify rollback occurred
    expect(taskService.getTasksByStatus('todo')).toEqual(originalOrder);
  });

  test('batch reorder operations work atomically', async () => {
    const operations = [
      { taskId: 'task1', afterTaskId: 'task3' },
      { taskId: 'task2', beforeTaskId: 'task1' }
    ];

    await taskService.batchReorder(operations);

    const finalOrder = taskService.getTasksByStatus('todo');
    expect(finalOrder.map(t => t.id)).toEqual(['task2', 'task1', 'task3']);
  });
});
```

### End-to-End Tests (Playwright)

#### Complete Drag and Drop Workflow
```typescript
// e2e/task-reordering.spec.ts
test.describe('Task Reordering', () => {
  test('drag and drop reordering works end-to-end', async ({ page }) => {
    await page.goto('/tasks');
    await page.waitForLoadState('networkidle');

    // Verify initial order
    const initialTasks = await page.locator('[data-testid^="task-item-"]').allTextContents();
    expect(initialTasks).toEqual(['Task A', 'Task B', 'Task C']);

    // Drag Task C above Task A
    await page.dragAndDrop(
      '[data-testid="task-item-task-c"] [data-testid="drag-handle"]',
      '[data-testid="task-item-task-a"]'
    );

    // Wait for animation and verify new order
    await page.waitForTimeout(500);
    const reorderedTasks = await page.locator('[data-testid^="task-item-"]').allTextContents();
    expect(reorderedTasks).toEqual(['Task C', 'Task A', 'Task B']);

    // Verify order persists after page refresh
    await page.reload();
    await page.waitForLoadState('networkidle');

    const persistedTasks = await page.locator('[data-testid^="task-item-"]').allTextContents();
    expect(persistedTasks).toEqual(['Task C', 'Task A', 'Task B']);
  });

  test('keyboard reordering works for accessibility', async ({ page }) => {
    await page.goto('/tasks');

    // Focus first task's drag handle
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab'); // Navigate to drag handle

    // Grab task
    await page.keyboard.press(' ');
    await expect(page.locator('[aria-live="polite"]')).toContainText('Task grabbed');

    // Move down
    await page.keyboard.press('ArrowDown');
    await expect(page.locator('[aria-live="polite"]')).toContainText('position 2 of 3');

    // Drop task
    await page.keyboard.press(' ');
    await expect(page.locator('[aria-live="polite"]')).toContainText('Task dropped at position 2');

    // Verify new order
    const finalOrder = await page.locator('[data-testid^="task-item-"]').allTextContents();
    expect(finalOrder).toEqual(['Task B', 'Task A', 'Task C']);
  });

  test('cross-column drag validates status transitions', async ({ page }) => {
    await page.goto('/tasks/kanban');

    // Try to drag from 'in-progress' to 'done' (should be blocked)
    await page.dragAndDrop(
      '[data-testid="task-item-in-progress-task"] [data-testid="drag-handle"]',
      '[data-testid="kanban-column-done"]'
    );

    // Should show validation error
    await expect(page.locator('[data-testid="error-toast"]')).toContainText(
      'Tasks in progress require agent completion before moving to done'
    );

    // Verify task stayed in original column
    await expect(page.locator('[data-testid="kanban-column-in-progress"]')).toContainText('In Progress Task');
  });
});
```

### Performance Testing

#### Load Testing with Large Task Lists
```typescript
// src/components/tasks/performance.test.ts
describe('Performance with large datasets', () => {
  test('renders 1000 tasks without significant lag', async () => {
    const largeTasks = Array.from({ length: 1000 }, (_, i) =>
      createTask({ id: `task-${i}`, title: `Task ${i}` })
    );

    const startTime = performance.now();

    render(<KanbanBoard tasks={largeTasks} />);

    // Wait for all tasks to render
    await waitFor(() => {
      expect(screen.getAllByRole('listitem')).toHaveLength(1000);
    });

    const renderTime = performance.now() - startTime;
    expect(renderTime).toBeLessThan(2000); // Should render in under 2 seconds
  });

  test('drag operations remain smooth with 500 tasks', async () => {
    const manyTasks = Array.from({ length: 500 }, (_, i) =>
      createTask({ id: `task-${i}`, status: 'todo' })
    );

    const { container } = render(<TaskListView tasks={manyTasks} />);

    // Simulate drag start
    const firstTask = container.querySelector('[data-testid="task-item-task-0"]');
    const startTime = performance.now();

    fireEvent.dragStart(firstTask!);
    fireEvent.dragEnd(firstTask!);

    const dragTime = performance.now() - startTime;
    expect(dragTime).toBeLessThan(100); // Drag should respond in under 100ms
  });
});
```

### Accessibility Compliance Testing

#### WCAG 2.1 AA Compliance
```typescript
// e2e/accessibility.spec.ts
test.describe('Accessibility Compliance', () => {
  test('drag and drop meets WCAG 2.1 AA standards', async ({ page }) => {
    await page.goto('/tasks');

    // Run axe accessibility scanner
    const accessibilityScanResults = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
      .analyze();

    expect(accessibilityScanResults.violations).toEqual([]);
  });

  test('keyboard navigation covers all interactive elements', async ({ page }) => {
    await page.goto('/tasks');

    // Start from first focusable element
    await page.keyboard.press('Tab');

    let focusedElement = await page.locator(':focus').textContent();
    const focusedElements: string[] = [focusedElement || ''];

    // Tab through all elements
    for (let i = 0; i < 20; i++) {
      await page.keyboard.press('Tab');
      focusedElement = await page.locator(':focus').textContent();
      if (focusedElement && !focusedElements.includes(focusedElement)) {
        focusedElements.push(focusedElement);
      }
    }

    // Verify all drag handles are reachable
    expect(focusedElements).toContain('Drag to reorder task. Position 1 of 5');
    expect(focusedElements).toContain('Drag to reorder task. Position 2 of 5');
  });

  test('screen reader announcements are accurate', async ({ page }) => {
    await page.goto('/tasks');

    // Mock screen reader
    const announcements: string[] = [];
    await page.addInitScript(() => {
      const announcements: string[] = [];
      window.announcements = announcements;

      // Intercept aria-live announcements
      const observer = new MutationObserver((mutations) => {
        mutations.forEach((mutation) => {
          if (mutation.type === 'childList' && mutation.target.nodeType === Node.ELEMENT_NODE) {
            const element = mutation.target as Element;
            if (element.getAttribute('aria-live')) {
              announcements.push(element.textContent || '');
            }
          }
        });
      });

      observer.observe(document.body, { childList: true, subtree: true });
    });

    // Perform keyboard drag operation
    await page.keyboard.press('Tab Tab');
    await page.keyboard.press(' '); // Grab
    await page.keyboard.press('ArrowDown'); // Move
    await page.keyboard.press(' '); // Drop

    // Verify announcements
    const pageAnnouncements = await page.evaluate(() => window.announcements);
    expect(pageAnnouncements).toContain('Task grabbed. Use arrow keys to move. Current position 1 of 5');
    expect(pageAnnouncements).toContain('Task moved to position 2 of 5');
    expect(pageAnnouncements).toContain('Task dropped at position 2');
  });
});
```

## Error Handling and Edge Cases

### Lexicographical Order Edge Cases

#### Order String Length Management
```typescript
// src/utils/lexicographical-order.ts
class LexicographicalOrder {
  private static readonly MAX_ORDER_LENGTH = 8;

  /**
   * Compact order strings when they grow too long
   * Triggered when any order exceeds MAX_ORDER_LENGTH
   */
  static async compactOrders(taskService: TaskService, status: TaskStatus): Promise<void> {
    const tasks = taskService.getTasksByStatus(status);

    if (tasks.some(t => t.lexOrder.length > this.MAX_ORDER_LENGTH)) {
      console.log(`Compacting ${tasks.length} tasks in ${status} status`);

      const updates = tasks.map((task, index) => ({
        taskId: task.id,
        lexOrder: String.fromCharCode(97 + Math.floor(index / 26)) + // a, b, c...
                  String.fromCharCode(97 + (index % 26))              // a-z cycling
      }));

      await taskService.batchReorder(updates);
    }
  }

  /**
   * Handle collision resolution for identical orders
   */
  static resolveCollision(existingOrder: string): string {
    // Append incrementing suffix: 'a' -> 'aa', 'aa' -> 'ab', etc.
    return existingOrder + String.fromCharCode(97 + Math.floor(Math.random() * 26));
  }
}
```

#### File System Error Recovery
```typescript
// src/entities/tasks/error-recovery.ts
export class TaskReorderingErrorHandler {

  /**
   * Handle disk write failures during reordering
   */
  static async handleReorderFailure(
    taskId: string,
    originalOrder: string,
    newOrder: string,
    error: Error,
    taskService: TaskService
  ): Promise<void> {
    console.error(`Failed to reorder task ${taskId}:`, error);

    // Attempt rollback to original position
    try {
      await taskService.update(taskId, { lexOrder: originalOrder });

      // Show user notification
      NotificationService.show({
        type: 'error',
        title: 'Reorder Failed',
        message: 'Task could not be moved. Order has been restored.',
        action: {
          label: 'Retry',
          onClick: () => taskService.reorderTask(taskId, null, null)
        }
      });

    } catch (rollbackError) {
      // Complete failure - force refresh from disk
      console.error('Rollback failed, forcing refresh:', rollbackError);
      await taskService.refresh();

      NotificationService.show({
        type: 'error',
        title: 'System Error',
        message: 'Tasks have been refreshed from disk due to a synchronization error.',
      });
    }
  }

  /**
   * Handle concurrent modification conflicts
   */
  static async handleConcurrentModification(
    taskId: string,
    expectedVersion: number,
    actualVersion: number,
    taskService: TaskService
  ): Promise<void> {
    console.warn(`Concurrent modification detected for task ${taskId}`);

    // Refresh task from disk to get latest version
    await taskService.refreshTask(taskId);

    NotificationService.show({
      type: 'warning',
      title: 'Task Updated',
      message: 'This task was modified elsewhere. The latest version has been loaded.',
    });
  }
}
```

### Network and Synchronization Issues

#### Offline Support
```typescript
// src/entities/tasks/offline-queue.ts
interface QueuedReorderOperation {
  id: string;
  taskId: string;
  beforeTaskId: string | null;
  afterTaskId: string | null;
  timestamp: number;
  retryCount: number;
}

export class OfflineReorderQueue {
  private queue: QueuedReorderOperation[] = [];
  private isOnline = navigator.onLine;

  constructor(private taskService: TaskService) {
    this.setupNetworkListeners();
    this.loadPersistedQueue();
  }

  /**
   * Queue reorder operation when offline
   */
  async queueReorder(
    taskId: string,
    beforeTaskId: string | null,
    afterTaskId: string | null
  ): Promise<void> {
    const operation: QueuedReorderOperation = {
      id: crypto.randomUUID(),
      taskId,
      beforeTaskId,
      afterTaskId,
      timestamp: Date.now(),
      retryCount: 0
    };

    this.queue.push(operation);
    await this.persistQueue();

    // Apply optimistically to local state
    const newOrder = LexicographicalOrder.generateBetween(
      beforeTaskId ? await this.taskService.getTask(beforeTaskId) : null,
      afterTaskId ? await this.taskService.getTask(afterTaskId) : null
    );

    this.taskService.store._applyUpdate(taskId, { lexOrder: newOrder });
  }

  /**
   * Process queued operations when back online
   */
  private async processQueue(): Promise<void> {
    if (!this.isOnline || this.queue.length === 0) return;

    const operations = [...this.queue];
    this.queue = [];

    for (const operation of operations) {
      try {
        await this.taskService.reorderTask(
          operation.taskId,
          operation.beforeTaskId,
          operation.afterTaskId
        );
      } catch (error) {
        console.error('Failed to process queued reorder:', error);

        if (operation.retryCount < 3) {
          operation.retryCount++;
          this.queue.push(operation);
        } else {
          console.error('Dropping failed operation after 3 retries:', operation);
        }
      }
    }

    await this.persistQueue();
  }

  private setupNetworkListeners(): void {
    window.addEventListener('online', () => {
      this.isOnline = true;
      this.processQueue();
    });

    window.addEventListener('offline', () => {
      this.isOnline = false;
    });
  }

  private async persistQueue(): Promise<void> {
    localStorage.setItem('task-reorder-queue', JSON.stringify(this.queue));
  }

  private loadPersistedQueue(): void {
    const stored = localStorage.getItem('task-reorder-queue');
    if (stored) {
      try {
        this.queue = JSON.parse(stored);
      } catch (error) {
        console.error('Failed to load persisted queue:', error);
        localStorage.removeItem('task-reorder-queue');
      }
    }
  }
}
```

## Implementation Phases and Dependencies

### Phase 1: Foundation (Week 1-2)
**Goal**: Establish lexicographical ordering system

#### Dependencies
- None (can start immediately)

#### Deliverables
1. **LexicographicalOrder utility class**
   - Core algorithm implementation
   - Comprehensive unit tests
   - Performance benchmarking

2. **Schema migration planning**
   - Update TaskMetadata schema with `lexOrder` field
   - Plan backward compatibility strategy
   - Create migration validation scripts

3. **Enhanced TaskService methods**
   - `reorderTask()` implementation
   - `batchReorder()` for bulk operations
   - Error handling and rollback logic

#### Success Criteria
- All existing numeric ordering tests pass with lexicographical implementation
- Migration script successfully converts sample datasets
- Performance meets or exceeds current system (< 100ms reorder operations)

### Phase 2: Enhanced UI Components (Week 3-4)
**Goal**: Upgrade drag-and-drop user experience

#### Dependencies
- Phase 1 completion (lexicographical ordering)
- @dnd-kit upgrade to latest version (if needed)

#### Deliverables
1. **Accessible DragHandle component**
   - Keyboard navigation support
   - Screen reader announcements
   - WCAG 2.1 AA compliance

2. **Enhanced visual feedback**
   - Smooth drag animations
   - Clear drop zone indicators
   - Loading states during API calls

3. **Alternative interaction methods**
   - Up/down reorder buttons
   - Position selection dropdown
   - Bulk reordering interface

#### Success Criteria
- All accessibility tests pass automated scanning
- Keyboard-only users can reorder tasks efficiently
- Visual feedback matches design specifications

### Phase 3: Performance and Resilience (Week 5-6)
**Goal**: Optimize for scale and handle edge cases

#### Dependencies
- Phase 2 completion (enhanced UI)
- Performance baseline establishment

#### Deliverables
1. **Performance optimizations**
   - Virtual scrolling for large lists (>100 tasks)
   - Debounced drag operations
   - Memory leak prevention

2. **Error handling framework**
   - Offline operation queuing
   - Conflict resolution
   - Automatic recovery strategies

3. **Monitoring and observability**
   - Performance metrics collection
   - Error rate monitoring
   - User behavior analytics

#### Success Criteria
- Smooth drag experience with 1000+ tasks
- Zero data loss during network interruptions
- < 1% error rate in production usage

### Phase 4: Migration and Rollout (Week 7-8)
**Goal**: Safe production deployment

#### Dependencies
- Phase 3 completion (performance/resilience)
- Feature flag infrastructure
- Staging environment validation

#### Deliverables
1. **Production migration**
   - Gradual rollout with feature flags
   - Real-time monitoring dashboards
   - Rollback procedures

2. **Documentation and training**
   - User interaction guidelines
   - Developer maintenance docs
   - Accessibility compliance report

3. **Quality assurance**
   - End-to-end test automation
   - Load testing validation
   - Security review completion

#### Success Criteria
- 100% successful data migration without user impact
- Zero critical bugs in production
- User satisfaction metrics maintain current levels

## Migration and Rollback Strategies

### Progressive Migration Approach

#### Feature Flag Configuration
```typescript
// src/config/feature-flags.ts
export const FEATURE_FLAGS = {
  LEXICOGRAPHICAL_ORDERING: {
    enabled: process.env.NODE_ENV === 'development', // Start with dev
    rollout: {
      development: 100,
      staging: 50,     // 50% of staging users
      production: 0    // Gradual rollout: 0% -> 10% -> 50% -> 100%
    }
  }
} as const;

// Usage in components
function TaskCard() {
  const useLexOrdering = useFeatureFlag('LEXICOGRAPHICAL_ORDERING');

  return useLexOrdering
    ? <EnhancedTaskCard />
    : <LegacyTaskCard />;
}
```

#### Dual-System Operation
```typescript
// src/entities/tasks/hybrid-service.ts
export class HybridTaskService extends TaskService {

  /**
   * Support both ordering systems during migration
   */
  async reorderTask(taskId: string, position: ReorderPosition): Promise<void> {
    if (this.useLexicographicalOrdering) {
      return super.reorderTaskLex(taskId, position.beforeTaskId, position.afterTaskId);
    } else {
      return super.reorderTaskNumeric(taskId, position.index);
    }
  }

  /**
   * Gradually migrate tasks to lexicographical ordering
   */
  async migrateBatch(batchSize = 50): Promise<void> {
    const numericTasks = Object.values(this.store.tasks)
      .filter(task => !task.lexOrder && task.sortOrder)
      .slice(0, batchSize);

    if (numericTasks.length === 0) {
      console.log('Migration complete - all tasks using lexicographical ordering');
      return;
    }

    console.log(`Migrating ${numericTasks.length} tasks to lexicographical ordering`);

    for (const task of numericTasks) {
      const siblingTasks = this.getTasksByStatus(task.status)
        .filter(t => t.id !== task.id)
        .sort((a, b) => a.sortOrder - b.sortOrder);

      const index = siblingTasks.findIndex(t => t.sortOrder > task.sortOrder);
      const beforeTask = index > 0 ? siblingTasks[index - 1] : null;
      const afterTask = index >= 0 ? siblingTasks[index] : null;

      const lexOrder = LexicographicalOrder.generateBetween(
        beforeTask?.lexOrder || null,
        afterTask?.lexOrder || null
      );

      await this.update(task.id, {
        lexOrder,
        sortOrder: undefined // Remove old field
      });
    }
  }
}
```

#### Emergency Rollback Procedure
```typescript
// src/entities/tasks/rollback-service.ts
export class RollbackService {

  /**
   * Emergency rollback to numeric ordering
   */
  async emergencyRollback(reason: string): Promise<void> {
    console.error(`EMERGENCY ROLLBACK INITIATED: ${reason}`);

    // 1. Disable feature flag immediately
    await this.disableFeatureFlag('LEXICOGRAPHICAL_ORDERING');

    // 2. Restore numeric ordering from backup
    const backup = await this.loadNumericOrderBackup();

    // 3. Apply numeric orders to all tasks
    for (const [taskId, sortOrder] of Object.entries(backup)) {
      await this.taskService.update(taskId, {
        sortOrder,
        lexOrder: undefined
      });
    }

    // 4. Notify monitoring systems
    await this.alertMonitoring('ROLLBACK_COMPLETED', { reason });

    // 5. Show user notification
    NotificationService.show({
      type: 'info',
      title: 'System Restored',
      message: 'Task ordering has been restored to the previous version.',
    });
  }

  /**
   * Create backup of current numeric orders before migration
   */
  async createNumericOrderBackup(): Promise<void> {
    const backup: Record<string, number> = {};

    Object.values(this.taskService.store.tasks).forEach(task => {
      if (task.sortOrder) {
        backup[task.id] = task.sortOrder;
      }
    });

    await this.persistBackup(backup);
  }

  private async persistBackup(backup: Record<string, number>): Promise<void> {
    const backupData = {
      timestamp: Date.now(),
      backup,
      version: process.env.APP_VERSION
    };

    await this.fileSystem.writeFile(
      '~/.mort/backups/numeric-ordering-backup.json',
      JSON.stringify(backupData, null, 2)
    );
  }
}
```

### Monitoring and Success Metrics

#### Key Performance Indicators
```typescript
// src/monitoring/task-reordering-metrics.ts
export class TaskReorderingMetrics {

  /**
   * Track reordering performance and success rates
   */
  trackReorderOperation(operation: {
    type: 'within-column' | 'cross-column' | 'keyboard' | 'bulk';
    duration: number;
    success: boolean;
    errorType?: string;
    taskCount: number;
    orderingSystem: 'numeric' | 'lexicographical';
  }): void {

    // Performance metrics
    this.histogram('task_reorder_duration_ms', operation.duration, {
      type: operation.type,
      ordering_system: operation.orderingSystem
    });

    // Success rate metrics
    this.counter('task_reorder_total', 1, {
      type: operation.type,
      success: operation.success.toString(),
      ordering_system: operation.orderingSystem
    });

    // Error tracking
    if (!operation.success && operation.errorType) {
      this.counter('task_reorder_errors', 1, {
        error_type: operation.errorType,
        type: operation.type
      });
    }

    // Scale metrics
    this.histogram('task_reorder_list_size', operation.taskCount, {
      type: operation.type
    });
  }

  /**
   * Track user experience metrics
   */
  trackUserExperience(event: {
    action: 'drag_start' | 'drag_end' | 'keyboard_grab' | 'position_change';
    timestamp: number;
    taskId: string;
    fromPosition?: number;
    toPosition?: number;
  }): void {

    this.event('task_reorder_user_action', {
      action: event.action,
      task_id: event.taskId,
      from_position: event.fromPosition?.toString(),
      to_position: event.toPosition?.toString()
    });
  }
}
```

#### Success Criteria
- **Performance**: 95th percentile reorder operations complete in < 100ms
- **Reliability**: 99.9% success rate for reorder operations
- **Accessibility**: 100% keyboard accessibility with screen reader support
- **Scale**: Smooth performance with task lists up to 1,000 items
- **Migration**: Zero data loss during transition period
- **User Satisfaction**: Maintain current user experience ratings

## Risk Assessment and Mitigation

### High-Risk Areas

1. **Data Migration Complexity**
   - **Risk**: Corrupt or lost task ordering during migration
   - **Mitigation**: Comprehensive backup strategy, rollback procedures, gradual rollout

2. **Performance Regression**
   - **Risk**: Slower reordering with lexicographical system
   - **Mitigation**: Performance benchmarking, optimization focused development

3. **Accessibility Compliance**
   - **Risk**: Breaking existing keyboard navigation workflows
   - **Mitigation**: Accessibility-first development, extensive testing with assistive technologies

### Medium-Risk Areas

1. **Browser Compatibility**
   - **Risk**: Drag and drop behavior differences across browsers
   - **Mitigation**: Cross-browser testing matrix, progressive enhancement

2. **Large Dataset Performance**
   - **Risk**: UI slowdowns with hundreds of tasks
   - **Mitigation**: Virtual scrolling, pagination, performance monitoring

### Low-Risk Areas

1. **Feature Flag Management**
   - **Risk**: Configuration errors in rollout
   - **Mitigation**: Automated testing of flag configurations, staged rollout

## Conclusion

This comprehensive plan transforms the existing task reordering system into a world-class, accessible, and scalable solution. By implementing lexicographical ordering, enhancing accessibility, and providing robust error handling, we ensure a superior user experience while maintaining system reliability and performance at scale.