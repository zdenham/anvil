# Kanban Deprecation (Parallel Track C)

## Overview
Removes kanban view components while preserving dnd-kit for list reordering. Can run in parallel with Track D (Accessibility) once Track B provides UnifiedTaskList.

## Goals
1. Hide kanban view behind feature flags
2. Update task toolbar to handle missing kanban
3. Remove kanban components after validation period
4. Preserve dnd-kit dependencies for list view reordering

## Implementation Steps

### 3.1 Feature Flag Kanban View
**File to modify**: `src/components/tasks/task-toolbar.tsx`

Conditionally render view toggle:
```typescript
{FeatureFlags.ENABLE_KANBAN_VIEW && (
  <div className="flex bg-surface-800 rounded-lg p-1">
    {/* View toggle buttons */}
  </div>
)}
```

**Interface updates**:
```typescript
interface TaskToolbarProps {
  // Make view props optional for backwards compatibility
  view?: "kanban" | "list";
  onViewChange?: (view: "kanban" | "list") => void;
  availableTags: string[];
  // ... other props
}
```

### 3.2 Update Task Board Page
**File to modify**: `src/components/tasks/task-board-page.tsx`

- Remove kanban view logic and state (behind feature flag)
- Remove view toggle functionality
- Simplify to only use list view with UnifiedTaskList
- **PRESERVE dnd-kit dependencies** - still required by TaskListView

### 3.3 Remove Kanban Components (After Validation)
**Files to delete** (only after feature flag disabled for 2+ weeks):
- `src/components/tasks/kanban-board.tsx`
- `src/components/tasks/kanban-column.tsx`

**Preservation Strategy**:
- Keep files in `deprecated/kanban-removal` branch
- Document git commit SHAs for easy revert
- 30-day preservation period

### 3.4 dnd-kit Dependency Decision
**IMPORTANT**: dnd-kit CANNOT be fully removed.

**Files still using dnd-kit after kanban removal**:
- `src/components/tasks/task-list-view.tsx` - Uses `DndContext`, `SortableContext`
- `src/components/tasks/task-row.tsx` - Uses `useSortable`
- `src/components/tasks/task-card.tsx` - Uses `useSortable`

**Decision**: Keep dnd-kit for list view reordering functionality.

## Dependencies
- **Requires**: Track B completion (UnifiedTaskList must replace kanban functionality)
- **No blocking**: Can run parallel with Track D (Accessibility)

## Feature Flag Rollout Strategy

### Week 1-2: Parallel Development Phase
- Deploy with `ENABLE_KANBAN_VIEW: true` (current behavior)
- Deploy `USE_UNIFIED_TASK_LIST: true` alongside
- Monitor for issues in unified list

### Week 3-4: Gradual Rollout
- Set `ENABLE_KANBAN_VIEW: false` for new installs
- Existing users retain kanban access
- Collect feedback on unified list

### Week 5-6: Full Deprecation
- Set `ENABLE_KANBAN_VIEW: false` for all users
- Monitor user feedback and support requests

### Week 7+: Cleanup
- Remove kanban code if no significant issues
- Remove feature flag infrastructure

## Rollback Strategy
**If issues arise with kanban removal**:
1. Set `ENABLE_KANBAN_VIEW: true` in feature flags
2. Release patch version
3. Kanban view becomes available again
4. No code changes required (preserved in deprecated branch)

## Removed Features
- **Kanban Board**: All drag-and-drop between columns
- **Column-based organization**: 7-column task flow visualization
- **Visual task flow**: Graphical representation of task progression

## Preserved Features
- **List view drag reordering**: Still uses dnd-kit
- **Task status functionality**: Status logic remains intact
- **All task management**: CRUD operations unchanged

## Testing Strategy
- Verify unified list handles all kanban use cases
- Test feature flag toggle functionality
- Validate dnd-kit still works in list view
- Monitor performance after kanban removal

## Estimated Scope
- **Files**: 2 deleted, 2 modified
- **Risk**: Medium (user-facing feature removal)
- **Parallel Friendly**: Yes with Track D, depends on Track B