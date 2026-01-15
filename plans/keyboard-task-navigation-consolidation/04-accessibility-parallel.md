# Accessibility & Status Display (Parallel Track D)

## Overview
Implements accessibility enhancements and simplifies status display to color dots only. Can run in parallel with Track C (Kanban Deprecation) and doesn't depend on other tracks.

## Goals
1. Remove visible status text labels while preserving accessibility
2. Add screen reader support with sr-only text
3. Create accessible tooltip system
4. Enhance color system with distinguishing characteristics
5. Maintain WCAG compliance

## Implementation Steps

### 4.1 Create Accessible Tooltip Component
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

### 4.2 Create Screen Reader Only CSS Class
**File to modify**: `src/styles/globals.css` (or Tailwind config)

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

### 4.3 Update Task Color System for Accessibility
**File to modify**: `src/utils/task-colors.ts`

Add distinguishing characteristics beyond color:
```typescript
interface TaskDotStyle {
  color: string;
  animation?: string;
  icon?: string; // For future icon distinction
}

export function getTaskDotColor(task: TaskMetadata, threads: ThreadMetadata[]): TaskDotStyle {
  const taskThreads = threads.filter(t => t.taskId === task.id);
  const hasRunning = taskThreads.some(t => t.status === 'running');
  const hasUnread = taskThreads.some(t => !t.isRead);

  if (hasRunning) {
    return {
      color: 'bg-green-400',
      animation: 'animate-pulse', // Animation distinguishes running
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

// New function for screen reader text
export function getStatusText(task: TaskMetadata, threads: ThreadMetadata[]): string {
  const taskThreads = threads.filter(t => t.taskId === task.id);
  const hasRunning = taskThreads.some(t => t.status === 'running');
  const hasUnread = taskThreads.some(t => !t.isRead);

  if (hasRunning) return 'Running';
  if (hasUnread) return 'Unread';
  return 'Read';
}
```

**Visual Distinctions by State**:
| State | Color | Additional Visual Cue | Screen Reader Text |
|-------|-------|----------------------|-------------------|
| Running | Green | Pulse animation | "Running" |
| Unread | Blue | Solid dot | "Unread" |
| Read | Gray | Muted appearance | "Read" |

### 4.4 Create StatusDot Component
**File to create**: `src/components/ui/status-dot.tsx`

```typescript
interface StatusDotProps {
  task: TaskMetadata;
  threads: ThreadMetadata[];
}

function StatusDot({ task, threads }: StatusDotProps) {
  const { color, animation } = getTaskDotColor(task, threads);
  const statusText = getStatusText(task, threads);

  return (
    <AccessibleTooltip content={statusText}>
      <span className="relative">
        <span
          className={`w-2 h-2 rounded-full flex-shrink-0 ${color} ${animation || ""}`}
          aria-hidden="true" // Hide decorative dot from screen readers
        />
        {/* Screen reader only text */}
        <span className="sr-only">{statusText}</span>
      </span>
    </AccessibleTooltip>
  );
}
```

### 4.5 Update Task Card Components
**Files to modify**:
- `src/components/tasks/task-card.tsx`
- `src/components/tasks/task-row.tsx`

**Changes**:
- Remove visible STATUS_CONFIG text labels
- Replace with StatusDot component
- Preserve all other functionality

**Before**:
```typescript
<span className="text-xs font-medium px-2 py-1 rounded">
  {STATUS_CONFIG[task.status].label}
</span>
```

**After**:
```typescript
<StatusDot task={task} threads={threads} />
```

### 4.6 Section Headers Decision
**File**: `src/components/tasks/task-list-view.tsx`

**Decision**: **KEEP** text labels for section headers.

**Rationale**:
- Section headers serve navigation purposes
- Color-only headers would be confusing
- Headers help users quickly find task groups
- Different use case than individual task status

**No changes required** to STATUS_LABELS constant.

## Dependencies
- **None** - Pure accessibility enhancement work
- **Can run parallel** with any other track

## Accessibility Features

### Screen Reader Support
- `sr-only` spans provide status information to screen readers
- `aria-hidden` prevents duplicate announcements of decorative dots
- Semantic `role="tooltip"` for tooltips

### Keyboard Navigation
- Tooltips appear on `:focus-within` for keyboard users
- No mouse-only interactions
- Standard tab navigation preserved

### Visual Accessibility
- Animation provides non-color distinction for running tasks
- High contrast maintained across all status states
- Tooltips provide text information on hover/focus

### WCAG Compliance
- **1.4.1 Use of Color**: Animation and tooltips supplement color
- **2.1.1 Keyboard**: All functionality accessible via keyboard
- **3.2.4 Consistent Identification**: Same status representation everywhere
- **4.1.3 Status Messages**: Screen reader announcements preserved

## Testing Strategy

### Automated Accessibility Testing
```typescript
import { axe, toHaveNoViolations } from 'jest-axe';

it('should have no accessibility violations', async () => {
  const { container } = render(<StatusDot task={mockTask} threads={mockThreads} />);
  const results = await axe(container);
  expect(results).toHaveNoViolations();
});
```

### Manual Testing Checklist
- [ ] Screen reader announces task status (VoiceOver, NVDA)
- [ ] Tooltips accessible via keyboard focus
- [ ] Color is not the only means of conveying status
- [ ] Animation distinguishes running state
- [ ] Focus indicators visible at all times

### Test Cases
```typescript
describe('StatusDot accessibility', () => {
  it('should include screen reader text for each status', () => {
    // Test sr-only spans exist with correct content
  });

  it('should show tooltip on hover and focus', () => {
    // Test tooltip visibility
  });

  it('should hide decorative dot from screen readers', () => {
    // Test aria-hidden attribute
  });

  it('should use animation to distinguish running tasks', () => {
    // Test pulse animation class
  });
});
```

## Rollback Strategy
**If accessibility concerns arise**:
1. Status text can be made visible again via CSS change
2. Remove `sr-only` class, add visible styling
3. No code changes required - just CSS toggle
4. Feature flag can control visibility if needed

## Estimated Scope
- **Files**: 3 new, 3 modified
- **Risk**: Low-Medium (accessibility compliance)
- **Parallel Friendly**: Yes - completely independent work