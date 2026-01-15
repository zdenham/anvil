# Integration & Testing (Parallel Track E)

## Overview
Comprehensive testing strategy that can begin early and run in parallel with development tracks. Covers unit tests, integration tests, accessibility validation, and edge case handling.

## Goals
1. Create comprehensive test suite for all new components
2. Test keyboard navigation thoroughly
3. Validate accessibility compliance
4. Cover edge cases and race conditions
5. Ensure no regressions in existing functionality

## Implementation Steps

### 5.1 Keyboard Navigation Hook Tests
**File to create**: `src/hooks/use-keyboard-task-navigation.test.ts`

```typescript
describe('useKeyboardTaskNavigation', () => {
  // Arrow Key Navigation Tests
  it('should navigate down on ArrowDown', () => {
    // Test selectedIndex increments with wrapping
  });

  it('should navigate up on ArrowUp', () => {
    // Test selectedIndex decrements with wrapping
  });

  it('should wrap from last to first on ArrowDown', () => {
    // Test edge case navigation
  });

  it('should wrap from first to last on ArrowUp', () => {
    // Test edge case navigation
  });

  // Tab Navigation Tests
  it('should update selectedIndex when focus changes', () => {
    // Test focus synchronization
  });

  it('should provide correct tabIndex via getItemProps', () => {
    // Test tab accessibility
  });

  // Hybrid Navigation Tests
  it('should sync focus when arrow keys change selection', () => {
    // Test arrow keys updating browser focus
  });

  it('should sync selection when tab changes focus', () => {
    // Test tab focus updating selectedIndex
  });

  // Configuration Tests
  it('should respect supportArrowKeys=false', () => {
    // Test partial navigation disabling
  });

  it('should respect supportTabNavigation=false', () => {
    // Test partial navigation disabling
  });

  // Common Functionality
  it('should call onSelect on Enter', () => {
    // Test selection across both navigation methods
  });

  it('should call onClose on Escape', () => {
    // Test close functionality
  });

  it('should reset index when tasks change', () => {
    // Test index clamping on task list updates
  });

  // Edge Cases
  it('should handle empty task list', () => {
    // Test graceful degradation
  });

  it('should handle single task navigation', () => {
    // Test minimal case for both methods
  });
});
```

### 5.2 Unified Task List Component Tests
**File to create**: `src/components/shared/unified-task-list.test.tsx`

```typescript
describe('UnifiedTaskList', () => {
  // Rendering Tests
  it('should render in compact mode', () => {
    // Test tasks panel configuration
  });

  it('should render in full mode with all features', () => {
    // Test main window configuration
  });

  // Feature Toggle Tests
  it('should enable/disable task deletion', () => {
    // Test enableTaskDeletion prop
  });

  it('should enable/disable drag reordering', () => {
    // Test enableDragReorder prop
  });

  it('should enable/disable keyboard navigation', () => {
    // Test enableKeyboardNavigation prop
  });

  // Task Management Tests
  it('should handle task selection via click', () => {
    // Test onTaskSelect callback
  });

  it('should handle task deletion workflow', () => {
    // Test full deletion with confirmation
  });

  it('should differentiate simple vs standard tasks', () => {
    // Test task.type handling
  });

  // Event Subscription Tests
  it('should subscribe to events when enabled', () => {
    // Test subscribeToEvents prop
  });

  it('should not subscribe when disabled', () => {
    // Test performance optimization
  });

  // Sorting Tests
  it('should sort by updatedAt when configured', () => {
    // Test TasksPanel sorting mode
  });

  it('should sort by sortOrder when configured', () => {
    // Test main window sorting mode
  });

  // Empty State Tests
  it('should show empty state when no tasks', () => {
    // Test graceful empty handling
  });
});
```

### 5.3 Accessibility Tests
**File to create**: `src/components/ui/status-dot.test.tsx`

```typescript
import { axe, toHaveNoViolations } from 'jest-axe';
import { render } from '@testing-library/react';

expect.extend(toHaveNoViolations);

describe('StatusDot accessibility', () => {
  it('should have no accessibility violations', async () => {
    const { container } = render(
      <StatusDot task={mockRunningTask} threads={mockThreads} />
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it('should include screen reader text for each status', () => {
    // Test sr-only spans for running, unread, read
  });

  it('should hide decorative dot from screen readers', () => {
    // Test aria-hidden="true" on dot
  });

  it('should show tooltip on hover and focus', () => {
    // Test tooltip visibility states
  });

  it('should use animation to distinguish running state', () => {
    // Test animate-pulse class application
  });

  it('should provide consistent status text', () => {
    // Test getStatusText function outputs
  });
});
```

### 5.4 Integration Tests
**File to create**: `src/components/tasks-panel/tasks-panel.integration.test.tsx`

```typescript
describe('TasksPanel integration with keyboard navigation', () => {
  it('should navigate through tasks with arrow keys', () => {
    // Test full navigation workflow
  });

  it('should open task on Enter press', () => {
    // Test task selection integration
  });

  it('should close panel on Escape', () => {
    // Test panel closure
  });

  it('should handle task deletion during navigation', () => {
    // Test race condition handling
  });

  it('should sync with tab navigation', () => {
    // Test hybrid navigation behavior
  });

  it('should preserve existing hotkey functionality', () => {
    // Test no regressions in shortcuts
  });
});
```

### 5.5 Edge Case Testing
**File to create**: `src/components/shared/edge-cases.test.tsx`

```typescript
describe('Edge cases and race conditions', () => {
  // Race Conditions
  it('should handle task deleted during navigation', () => {
    // Test index clamping when task disappears
  });

  it('should handle task list updates during navigation', () => {
    // Test selectedIndex adjustment
  });

  it('should handle rapid key presses', () => {
    // Test navigation state consistency
  });

  // Empty and Minimal States
  it('should handle empty task list navigation', () => {
    // Test graceful degradation
  });

  it('should handle single task list', () => {
    // Test minimal case behavior
  });

  // Focus Management
  it('should maintain focus during panel visibility changes', () => {
    // Test focus restoration
  });

  it('should handle focus loss during navigation', () => {
    // Test focus recovery
  });

  // Delete Confirmation
  it('should continue navigation during delete confirmation', () => {
    // Test delete UI doesn't break navigation
  });

  it('should handle delete timeout with navigation', () => {
    // Test confirm button timeout behavior
  });
});
```

### 5.6 Performance Tests
**File to create**: `src/components/shared/performance.test.tsx`

```typescript
describe('Performance with large task lists', () => {
  it('should render 1000 tasks without significant delay', () => {
    const largeTasks = generateMockTasks(1000);
    const startTime = performance.now();

    render(<UnifiedTaskList tasks={largeTasks} onTaskSelect={jest.fn()} />);

    const renderTime = performance.now() - startTime;
    expect(renderTime).toBeLessThan(500); // 500ms threshold
  });

  it('should navigate smoothly through large lists', () => {
    // Test keyboard navigation performance
  });

  it('should handle scroll performance with auto-scroll', () => {
    // Test scrollIntoView performance
  });
});
```

### 5.7 Regression Tests
**File to update**: `src/components/tasks/task-card.ui.test.tsx`

```typescript
describe('TaskCard status display changes', () => {
  it('should render status dot without visible text', () => {
    const { container } = render(
      <TaskCard task={mockTask} threads={mockThreads} />
    );

    // Should have color dot
    expect(container.querySelector('.w-2.h-2.rounded-full')).toBeInTheDocument();

    // Should NOT have visible status text
    expect(container.querySelector('.text-xs.font-medium.px-2')).not.toBeInTheDocument();
  });

  it('should include sr-only text for accessibility', () => {
    // Test screen reader text preservation
  });

  it('should show tooltip on hover', () => {
    // Test tooltip functionality
  });

  it('should preserve all other task card functionality', () => {
    // Test no regressions in other features
  });
});
```

## Dependencies
- **Can start immediately** - Test infrastructure is independent
- **Parallels all tracks** - Tests can be written alongside development
- **Mock dependencies** - Can test with mocked hooks while real ones are in development

## Testing Infrastructure Setup

### Test Utilities
```typescript
// src/test-utils/keyboard-navigation.ts
export const simulateKeyPress = (element: HTMLElement, key: string) => {
  fireEvent.keyDown(element, { key });
};

export const expectNavigationState = (
  selectedIndex: number,
  expectedIndex: number,
  tasks: TaskMetadata[]
) => {
  expect(selectedIndex).toBe(expectedIndex);
  expect(selectedIndex).toBeGreaterThanOrEqual(0);
  expect(selectedIndex).toBeLessThan(tasks.length);
};
```

### Mock Data
```typescript
// src/test-utils/mock-data.ts
export const mockTasksWithStatus = (count: number): TaskMetadata[] => {
  // Generate tasks with various statuses for testing
};

export const mockThreadsWithReadStatus = (taskIds: string[]): ThreadMetadata[] => {
  // Generate threads with read/unread status
};
```

## Accessibility Testing Strategy

### Automated Tools
- **jest-axe**: Accessibility violations detection
- **@testing-library/jest-dom**: Semantic testing utilities
- **Testing Library User Event**: Real user interaction simulation

### Manual Testing Checklist
- [ ] Screen reader compatibility (VoiceOver, NVDA, JAWS)
- [ ] Keyboard-only navigation workflow
- [ ] High contrast mode compatibility
- [ ] Focus indicator visibility
- [ ] Tooltip accessibility via keyboard

### Browser Testing Matrix
- Chrome/Edge (Windows, macOS)
- Firefox (Windows, macOS)
- Safari (macOS)
- Screen reader combinations

## Continuous Integration

### Test Execution Strategy
```yaml
# Example CI configuration
test-matrix:
  - unit-tests: Run in parallel across all tracks
  - integration-tests: Run after Track A+B completion
  - accessibility-tests: Run in parallel with development
  - performance-tests: Run on large dataset scenarios
  - regression-tests: Run against existing functionality
```

### Coverage Requirements
- **Unit tests**: 90%+ coverage for new hook and components
- **Integration tests**: Cover all user workflows
- **Accessibility tests**: 100% coverage for interactive elements
- **Edge cases**: Cover all identified race conditions

## Estimated Scope
- **Files**: 8 new test files, 2 updated test files
- **Test cases**: ~150 individual test scenarios
- **Coverage targets**: 90%+ on new code, 100% on accessibility
- **Parallel Friendly**: Yes - completely independent execution
- **Can start**: Immediately with mocked dependencies