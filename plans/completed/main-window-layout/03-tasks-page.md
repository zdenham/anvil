# Tasks Page Component

## File

`src/components/main-window/tasks-page.tsx`

## Purpose

Stub placeholder for the kanban task board. Will be replaced with full implementation from `plans/kanban-task-ui.md`.

## Implementation

```typescript
import { CheckSquare } from "lucide-react";

export function TasksPage() {
  return (
    <div className="h-full flex flex-col items-center justify-center text-slate-400">
      <CheckSquare size={48} className="mb-4 opacity-50" />
      <p className="text-lg font-medium">Tasks</p>
      <p className="text-sm text-slate-500">Kanban board coming soon</p>
    </div>
  );
}
```

## Props

None.

## Styling

- Full height container
- Centered content (flex column)
- Muted colors (`slate-400`, `slate-500`)
- Large icon with reduced opacity

## Future

This component will be replaced entirely when implementing `plans/kanban-task-ui.md`. The kanban implementation will include:
- Column-based layout (backlog, in progress, done)
- Drag-and-drop task cards
- Task creation and editing
- Filtering and sorting

## Dependencies

- `lucide-react`
