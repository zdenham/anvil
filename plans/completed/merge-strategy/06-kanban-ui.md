# Phase 6: Kanban & UI

**Dependencies:** 01-unified-status-system
**Parallel Group:** B

## Goal

Update the kanban board and UI components to use the new unified status system.

---

## 6.1 Update Kanban Board

**Files to update:**
- `src/components/kanban/kanban-board.tsx`
- `src/components/kanban/kanban-column.tsx`

```typescript
const columns: TaskStatus[] = ["backlog", "todo", "in_progress", "in_review", "complete"];

const columnLabels: Record<TaskStatus, string> = {
  backlog: "Backlog",
  todo: "To Do",
  in_progress: "In Progress",
  in_review: "In Review",
  complete: "Complete",
  cancelled: "Cancelled",  // May be hidden or separate
};
```

---

## 6.2 Drag and Drop Rules

| From | To | Allowed | Notes |
|------|-----|---------|-------|
| `backlog` | `todo` | Yes | Prioritize task |
| `todo` | `backlog` | Yes | Deprioritize task |
| `todo` | `in_progress` | Yes | Starts execution |
| `in_progress` | `todo` | Yes | Pause/restart |
| `in_progress` | `in_review` | No | Requires agent completion |
| `in_review` | `in_progress` | Yes | Request more work |
| `in_review` | `complete` | No | Requires merge |
| Any | `cancelled` | Yes | Cancel task |

---

## 6.3 Column Styling

Each column should have distinct visual treatment:

- **Backlog**: Muted/gray styling
- **To Do**: Default styling
- **In Progress**: Active/highlighted styling
- **In Review**: Review indicator (could show review/merge phase)
- **Complete**: Success/green indicator

---

## 6.4 Status Indicators

Update task cards to show:
- Current status badge
- For `in_review`: indicate if in review or merge phase
- For `complete` with PR: show PR link

---

## 6.5 Other UI Updates

Files that may need status updates:
- Task list views
- Task detail panels
- Workspace sidebar
- Status filters/dropdowns
- Any status-based conditional rendering

---

## Checklist

- [ ] Update `kanban-board.tsx` column configuration
- [ ] Update `kanban-column.tsx` labels and styling
- [ ] Implement drag-and-drop validation rules
- [ ] Update task card status badges
- [ ] Add review/merge phase indicator for in_review
- [ ] Add PR link display for completed tasks
- [ ] Update any status filters/selectors
- [ ] Update workspace sidebar status display
- [ ] Test drag-and-drop behavior
- [ ] Test keyboard navigation with new columns
