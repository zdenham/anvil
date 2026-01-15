# Sub-Plan: Test IDs for Task Components

**Dependencies:** None
**Blocks:** Task-related UI tests (05-first-tests.md)
**Parallel With:** 03b, 03c, 03d
**Estimated Effort:** Small (30-60 minutes)

## Objective

Add `data-testid` attributes to task-related components for stable test selectors. These IDs must match the patterns defined in `src/test/helpers/queries.ts`.

## Target Components

These are the actual file paths in the codebase:

| Component | File Path | Purpose |
|-----------|-----------|---------|
| TaskListView | `src/components/tasks/task-list-view.tsx` | Container for task rows, grouped by status |
| TaskRow | `src/components/tasks/task-row.tsx` | Individual task in list view |
| TaskCard | `src/components/tasks/task-card.tsx` | Individual task in kanban view |

**Note:** TaskRow and TaskCard serve similar purposes but for different view modes (list vs. kanban). Both need test IDs.

## Required Test IDs

These IDs are defined in `src/test/helpers/queries.ts` and must be added to the components:

### Container IDs
```tsx
// TaskListView outer container
<div data-testid="task-list">
```

### Per-Task IDs (use task.id)
```tsx
// TaskRow/TaskCard wrapper element
<div data-testid={`task-item-${task.id}`}>

// Status badge span (the one showing "Draft", "In Progress", etc.)
<span data-testid={`task-status-${task.id}`}>

// Title text element
<span data-testid={`task-title-${task.id}`}>

// Actions container (delete button, etc.) - optional
<div data-testid={`task-actions-${task.id}`}>
```

## Implementation Details

### TaskListView (task-list-view.tsx)

**Current structure (line 55-83):**
```tsx
<DndContext ...>
  <div className="p-4 space-y-6 overflow-y-auto h-full">
    {TASK_STATUSES.map((status) => ...)}
  </div>
</DndContext>
```

**Required change:** Add `data-testid="task-list"` to the outer container div.

### TaskRow (task-row.tsx)

**Current structure (line 39-106):**
```tsx
<div
  ref={setNodeRef}
  style={style}
  className="group flex items-center gap-3 ..."
  onClick={onClick}
>
  ...
  <span className="flex-1 text-sm text-surface-100 truncate font-mono">{task.title}</span>
  ...
</div>
```

**Required changes:**
1. Add `data-testid={`task-item-${task.id}`}` to outer div (line 39)
2. Add `data-testid={`task-title-${task.id}`}` to title span (line 55)
3. Add `data-testid={`task-status-${task.id}`}` to the status dot Circle component - wrap in a span if needed

### TaskCard (task-card.tsx)

**Current structure (line 43-126):**
```tsx
<div
  ref={setNodeRef}
  style={style}
  className="group bg-surface-800 rounded-lg ..."
  onClick={onClick}
>
  ...
  <p className="text-sm text-surface-100 truncate flex-1">{task.title}</p>
  ...
  <span className={`px-1.5 py-0.5 text-[10px] font-medium rounded ${statusConfig.className}`}>
    {statusConfig.label}
  </span>
  ...
</div>
```

**Required changes:**
1. Add `data-testid={`task-item-${task.id}`}` to outer div (line 43)
2. Wrap title in span with `data-testid={`task-title-${task.id}`}` or add to existing p tag (line 61)
3. Add `data-testid={`task-status-${task.id}`}` to status badge span (line 69)

## Implementation Steps

1. **Open the three component files** listed above

2. **Add test IDs to TaskListView**
   ```tsx
   // Line 57: Add testid to container
   <div className="p-4 space-y-6 overflow-y-auto h-full" data-testid="task-list">
   ```

3. **Add test IDs to TaskRow**
   ```tsx
   // Line 39: Add testid to outer div
   <div
     ref={setNodeRef}
     style={style}
     className="group flex items-center gap-3 ..."
     onClick={onClick}
     data-testid={`task-item-${task.id}`}
   >

   // Line 55: Add testid to title
   <span
     className="flex-1 text-sm text-surface-100 truncate font-mono"
     data-testid={`task-title-${task.id}`}
   >
     {task.title}
   </span>

   // Line 54: Wrap Circle in span with testid for status
   <span data-testid={`task-status-${task.id}`}>
     <Circle size={8} className={`${statusColor} fill-current`} />
   </span>
   ```

4. **Add test IDs to TaskCard**
   ```tsx
   // Line 43: Add testid to outer div
   <div
     ref={setNodeRef}
     style={style}
     className="group bg-surface-800 rounded-lg ..."
     onClick={onClick}
     data-testid={`task-item-${task.id}`}
   >

   // Line 61: Add testid to title
   <p
     className="text-sm text-surface-100 truncate flex-1"
     data-testid={`task-title-${task.id}`}
   >
     {task.title}
   </p>

   // Line 69: Add testid to status badge
   <span
     className={`px-1.5 py-0.5 text-[10px] font-medium rounded ${statusConfig.className}`}
     data-testid={`task-status-${task.id}`}
   >
     {statusConfig.label}
   </span>
   ```

5. **Verify no TypeScript errors**
   ```bash
   pnpm typecheck
   ```

6. **Verify app builds**
   ```bash
   pnpm build
   ```

7. **Verify test IDs match queries.ts**
   - `testIds.taskList` should match `"task-list"`
   - `testIds.taskItem(id)` should return `"task-item-${id}"`
   - `testIds.taskStatus(id)` should return `"task-status-${id}"`
   - `testIds.taskTitle(id)` should return `"task-title-${id}"`

## Acceptance Criteria

- [ ] TaskListView has `data-testid="task-list"` on container
- [ ] TaskRow has all three per-task test IDs
- [ ] TaskCard has all three per-task test IDs
- [ ] `pnpm typecheck` passes
- [ ] `pnpm build` passes
- [ ] No behavioral changes to components

## Notes

- Only add `data-testid` attributes - do not modify component logic or styling
- Test IDs go on DOM elements, not React components (unless the component forwards the prop)
- For the Circle icon in TaskRow, wrapping in a span is the cleanest approach
- The outer div already has `ref`, `style`, `className`, and `onClick` - just add `data-testid` to the same element
