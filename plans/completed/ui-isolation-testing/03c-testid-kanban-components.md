# Sub-Plan: Test IDs for Kanban Components

**Dependencies:** None
**Blocks:** Kanban-related UI tests
**Parallel With:** 03a, 03b, 03d
**Estimated Effort:** 30-60 minutes

## Objective

Add `data-testid` attributes to kanban board components for stable test selectors. This enables:
- Querying specific columns by status
- Querying cards by task ID
- Testing card counts per column
- Testing drag-and-drop source/target identification (if applicable)

## Target Components

Locate and modify these files (paths may vary based on actual project structure):

| Component | Expected Location | Purpose |
|-----------|-------------------|---------|
| KanbanBoard | `src/components/kanban-board.tsx` | Full board view container |
| KanbanColumn | `src/components/kanban-column.tsx` | Single status column |
| KanbanCard | `src/components/kanban-card.tsx` | Task card in column |
| ColumnHeader | Possibly inline or separate | Column title/count display |

## Required Test IDs

Based on `src/test/helpers/queries.ts`:

### Container IDs
```tsx
// KanbanBoard container
<div data-testid="kanban-board">
```

### Parameterized IDs (use status or task.id)
```tsx
// Column wrapper (keyed by status)
<div data-testid={`kanban-column-${status}`}>
// e.g., "kanban-column-in-progress", "kanban-column-done"

// Card wrapper (keyed by task ID)
<div data-testid={`kanban-card-${task.id}`}>
// e.g., "kanban-card-task-123"
```

### Optional: Additional IDs for Enhanced Testing
```tsx
// Column header (if separate element)
<h3 data-testid={`kanban-column-header-${status}`}>

// Card count badge (if displayed)
<span data-testid={`kanban-column-count-${status}`}>

// Empty state within column
<div data-testid={`kanban-column-empty-${status}`}>
```

## Implementation Pattern

### KanbanBoard
```tsx
function KanbanBoard({ tasks }: { tasks: TaskMetadata[] }) {
  const columns = groupByStatus(tasks);

  return (
    <div data-testid="kanban-board" className="kanban-board">
      {STATUSES.map(status => (
        <KanbanColumn
          key={status}
          status={status}
          tasks={columns[status] || []}
        />
      ))}
    </div>
  );
}
```

### KanbanColumn
```tsx
function KanbanColumn({
  status,
  tasks
}: {
  status: TaskStatus;
  tasks: TaskMetadata[];
}) {
  return (
    <div data-testid={`kanban-column-${status}`} className="kanban-column">
      <h3>{statusLabel(status)}</h3>
      {tasks.map(task => (
        <KanbanCard key={task.id} task={task} />
      ))}
    </div>
  );
}
```

### KanbanCard
```tsx
function KanbanCard({ task }: { task: TaskMetadata }) {
  return (
    <div data-testid={`kanban-card-${task.id}`} className="kanban-card">
      <span>{task.title}</span>
    </div>
  );
}
```

## Steps

1. **Find kanban components**
   ```bash
   # Search for kanban-related components
   find src -name "*kanban*.tsx" -type f
   grep -r "KanbanBoard\|KanbanColumn\|KanbanCard" src --include="*.tsx"
   ```

2. **Review existing component structure**
   - Identify the root element of each component
   - Note any existing attributes that might conflict
   - Check if components use props spreading

3. **Add test IDs** following the patterns above
   - Start with the board container
   - Add column IDs (ensure status value is kebab-case)
   - Add card IDs (use task.id, not slug)

4. **Verify IDs match queries.ts**
   - `testIds.kanbanBoard` -> `"kanban-board"`
   - `testIds.kanbanColumn(status)` -> `"kanban-column-${status}"`
   - `testIds.kanbanCard(id)` -> `"kanban-card-${id}"`

5. **Check query helpers exist in `src/test/helpers/queries.ts`**
   If missing, add these helpers:
   - `getKanbanCard(taskId)` - get single card by task ID
   - `getKanbanColumn(status)` - get column by status
   - `getCardsInColumn(status)` - get all cards within a column
   - `queryKanbanCard(taskId)` - returns null if not found

6. **No logic changes** - only add data-testid attributes

## Verification

```bash
# Ensure no TypeScript errors
pnpm typecheck

# Ensure app still builds
pnpm build

# Run existing tests to catch regressions
pnpm test
```

**Manual verification:**
- Open the app and navigate to the kanban view
- Inspect elements to confirm test IDs are present
- Verify no visual or behavioral changes

## Test Query Examples

Once test IDs are in place, tests can use queries like:

```typescript
import { screen, within } from "@testing-library/react";
import { getKanbanCard, getKanbanColumn, getCardsInColumn } from "@/test/helpers/queries";

// Get the entire board
const board = screen.getByTestId("kanban-board");

// Get all cards in "in-progress" column
const inProgressCards = getCardsInColumn("in-progress");
expect(inProgressCards).toHaveLength(3);

// Get specific card by task ID
const card = getKanbanCard("task-123");
expect(card).toHaveTextContent("Fix the bug");

// Get column by status
const doneColumn = getKanbanColumn("done");
expect(doneColumn).toBeInTheDocument();

// Query cards within a specific column
expect(within(doneColumn).getAllByTestId(/^kanban-card-/)).toHaveLength(5);

// Verify card is in correct column
const todoColumn = getKanbanColumn("todo");
expect(within(todoColumn).queryByTestId("kanban-card-task-456")).toBeInTheDocument();

// Check for empty column state (if implemented)
const emptyColumn = getKanbanColumn("blocked");
expect(within(emptyColumn).queryAllByTestId(/^kanban-card-/)).toHaveLength(0);
```

## Notes

- Do not change component behavior, only add data-testid attributes
- If a component does not accept a `data-testid` prop, spread props or add the attribute to the root element
- Use `task.id` for card IDs, not `task.slug` (slugs can change, IDs are stable)
- Status values in column IDs should match the exact status strings used in the codebase (e.g., `"in-progress"` not `"inProgress"`)
- For compound components, ensure parent passes testid through to the appropriate child element

## Edge Cases

- **Empty board:** Ensure board container still has testid even with no columns/cards
- **Empty column:** Consider adding an empty state testid for columns with no cards
- **Card click handlers:** Test IDs should be on the clickable element or its container
- **Drag handles:** If cards have separate drag handles, consider adding a `kanban-card-drag-${id}` testid
