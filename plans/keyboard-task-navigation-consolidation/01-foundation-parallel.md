# Foundation & Setup (Parallel Track A)

## Overview
This sub-plan creates the foundational infrastructure that other tracks depend on. Can be executed in parallel with testing setup and accessibility foundation work.

## Goals
1. Extract keyboard navigation hook from existing TasksPanel
2. Set up feature flags infrastructure
3. Create reusable navigation foundation

## Implementation Steps

### 1.1 Extract Keyboard Navigation Hook
**File to create**: `src/hooks/use-keyboard-task-navigation.ts`

Extract the existing TasksPanel keyboard navigation (lines 90-147) into a reusable hook with hybrid arrow key + tab navigation support.

**Key Features**:
- Arrow up/down navigation with wrapping
- Tab navigation integration
- Focus management and auto-scroll
- Configurable navigation methods
- Accessibility support

**Interface**:
```typescript
interface KeyboardNavigationConfig {
  tasks: TaskMetadata[];
  onSelect: (task: TaskMetadata) => void;
  onClose?: () => void;
  enabled?: boolean;
  supportArrowKeys?: boolean;
  supportTabNavigation?: boolean;
}
```

### 1.2 Feature Flags Infrastructure
**File to create**: `src/lib/feature-flags.ts`

```typescript
export const FeatureFlags = {
  ENABLE_KANBAN_VIEW: false,
  USE_UNIFIED_TASK_LIST: true,
};
```

**Integration points**: Task toolbar, main window

### 1.3 Update TasksPanel to Use Hook
**File to modify**: `src/components/tasks-panel/tasks-panel.tsx`

- Replace inline keyboard handling (lines 90-147) with hook
- Maintain all existing functionality
- Enable hybrid navigation (both arrow keys and tab)

## Dependencies
- None (foundation layer)

## Outputs for Other Tracks
- `useKeyboardTaskNavigation` hook → Track B (Consolidation)
- Feature flags → Track C (Kanban Deprecation)

## Testing
- Unit tests for keyboard navigation hook
- Integration tests for TasksPanel with hook
- Accessibility testing for dual navigation methods

## Estimated Scope
- **Files**: 2 new, 1 modified
- **Risk**: Low (refactoring existing working code)
- **Parallel Friendly**: Yes - no external dependencies