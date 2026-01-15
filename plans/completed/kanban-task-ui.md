# Kanban Task UI

## Overview

Build a task management interface with dual view modes (Kanban board and List view), tag-based filtering, and drag-and-drop reordering within status columns.

## Current State

The entity layer is fully implemented:

- **Task types** (`src/entities/tasks/types.ts`): `KanbanStatus`, `TaskMetadata` with `tags` and `sortOrder` fields
- **Task store** (`src/entities/tasks/store.ts`): Zustand store with `getTasksByStatus()` selector
- **Task service** (`src/entities/tasks/service.ts`): Full CRUD with optimistic updates
- **Event bus** (`src/entities/events.ts`): Task lifecycle events

## Goals

1. Create a Kanban board view with columns for each status (Backlog, Todo, In Progress, Done)
2. Create a List view as an alternative display mode
3. Add tag-based filtering
4. Enable drag-and-drop to reorder tasks within a status column
5. Persist sort order per status column
6. Toggle between Kanban and List views

## Non-Goals (Deferred)

- Drag-and-drop between columns (status change via drag) — keep status changes explicit
- Inline task editing — tasks open in a detail view
- Bulk operations
- Keyboard-only drag-and-drop

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           Task Board Panel                              │
│  ┌─────────────────────────────────────────────────────────────────────┐ │
│  │  Toolbar: [View Toggle] [Tag Filters] [Search]                      │ │
│  └─────────────────────────────────────────────────────────────────────┘ │
│  ┌─────────────────────────────────────────────────────────────────────┐ │
│  │                                                                     │ │
│  │   KANBAN VIEW                    or        LIST VIEW                │ │
│  │   ┌─────┬─────┬─────┬─────┐              ┌───────────────────┐      │ │
│  │   │Back │Todo │In   │Done │              │ Task Row          │      │ │
│  │   │log  │     │Prog │     │              │ Task Row          │      │ │
│  │   │     │     │     │     │              │ Task Row          │      │ │
│  │   │     │     │     │     │              │ ...               │      │ │
│  │   └─────┴─────┴─────┴─────┘              └───────────────────┘      │ │
│  │                                                                     │ │
│  └─────────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────┘
```

### Data Flow

```
useTaskStore (Zustand)
       │
       ▼
useTaskBoard hook (React hook)
       │  - groups tasks by status
       │  - sorts by sortOrder
       │  - filters by tags/search
       │  - exposes reorder handler
       ▼
TaskBoardPage (React component)
       │
       ├── KanbanBoard ─── KanbanColumn ─── TaskCard (draggable)
       │
       └── TaskListView ─── TaskRow (draggable within status groups)
```

---

## Implementation Tasks

### Phase 1: Drag-and-Drop Infrastructure

#### 1.1 Install @dnd-kit

```bash
pnpm add @dnd-kit/core @dnd-kit/sortable @dnd-kit/utilities
```

Why @dnd-kit:

- Modern, accessible, lightweight
- First-class React support
- Excellent TypeScript types
- Built-in sortable preset
- No native HTML5 drag-drop quirks

#### 1.2 Create useTaskBoard hook

**`src/hooks/use-task-board.ts`**:

```typescript
import { useMemo, useCallback } from "react";
import { useTaskStore } from "@/entities/tasks/store";
import { taskService } from "@/entities/tasks/service";
import type { TaskMetadata, KanbanStatus } from "@/entities/tasks/types";

export interface GroupedTasks {
  backlog: TaskMetadata[];
  todo: TaskMetadata[];
  "in-progress": TaskMetadata[];
  done: TaskMetadata[];
}

export interface TaskBoardFilters {
  tags: string[];
  search: string;
}

export function useTaskBoard(filters: TaskBoardFilters) {
  const tasks = useTaskStore((s) => s.tasks);

  const groupedTasks = useMemo(() => {
    const groups: GroupedTasks = {
      backlog: [],
      todo: [],
      "in-progress": [],
      done: [],
    };

    for (const task of Object.values(tasks)) {
      // Filter by tags
      if (filters.tags.length > 0) {
        if (!filters.tags.some((tag) => task.tags.includes(tag))) continue;
      }
      // Filter by search
      if (filters.search) {
        if (!task.title.toLowerCase().includes(filters.search.toLowerCase())) continue;
      }
      // Group by kanban status only
      if (task.status in groups) {
        groups[task.status as KanbanStatus].push(task);
      }
    }

    // Sort each group by sortOrder
    for (const status of Object.keys(groups) as KanbanStatus[]) {
      groups[status].sort((a, b) => a.sortOrder - b.sortOrder);
    }

    return groups;
  }, [tasks, filters.tags, filters.search]);

  const allTags = useMemo(() => {
    const tagSet = new Set<string>();
    for (const task of Object.values(tasks)) {
      for (const tag of task.tags) tagSet.add(tag);
    }
    return Array.from(tagSet).sort();
  }, [tasks]);

  const reorderWithinColumn = useCallback(
    async (taskId: string, targetIndex: number, status: KanbanStatus) => {
      const column = groupedTasks[status];
      const taskIndex = column.findIndex((t) => t.id === taskId);
      if (taskIndex === -1) return;

      // Calculate new sort order
      const newOrder = [...column];
      const [moved] = newOrder.splice(taskIndex, 1);
      newOrder.splice(targetIndex, 0, moved);

      // Assign new sort orders (use index * 1000 for spacing)
      const updates = newOrder.map((t, i) => ({
        id: t.id,
        sortOrder: i * 1000,
      }));

      // Update all affected tasks
      for (const { id, sortOrder } of updates) {
        await taskService.update(id, { sortOrder });
      }
    },
    [groupedTasks]
  );

  return { groupedTasks, allTags, reorderWithinColumn };
}
```

---

### Phase 2: Kanban View Components

#### 2.1 Create TaskCard component

**`src/components/tasks/task-card.tsx`**:

```typescript
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical } from "lucide-react";
import type { TaskMetadata } from "@/entities/tasks/types";

interface TaskCardProps {
  task: TaskMetadata;
  onClick: () => void;
}

export function TaskCard({ task, onClick }: TaskCardProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: task.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const completedSubtasks = task.subtasks.filter((s) => s.completed).length;

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="group bg-slate-800 rounded-lg border border-slate-700 p-3 cursor-pointer hover:border-slate-600 transition-colors"
      onClick={onClick}
    >
      <div className="flex items-start gap-2">
        <button
          className="mt-1 opacity-0 group-hover:opacity-100 cursor-grab active:cursor-grabbing text-slate-500 hover:text-slate-400 transition-opacity"
          {...attributes}
          {...listeners}
        >
          <GripVertical size={14} />
        </button>
        <div className="flex-1 min-w-0">
          <p className="text-sm text-slate-100 truncate">{task.title}</p>
          {task.tags.length > 0 && (
            <div className="flex gap-1 mt-2 flex-wrap">
              {task.tags.slice(0, 3).map((tag) => (
                <span
                  key={tag}
                  className="px-1.5 py-0.5 text-[10px] uppercase tracking-wide bg-slate-700 text-slate-400 rounded"
                >
                  {tag}
                </span>
              ))}
              {task.tags.length > 3 && (
                <span className="text-[10px] text-slate-500">+{task.tags.length - 3}</span>
              )}
            </div>
          )}
          {task.subtasks.length > 0 && (
            <p className="text-xs text-slate-500 mt-2">
              {completedSubtasks}/{task.subtasks.length} subtasks
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
```

#### 2.2 Create KanbanColumn component

**`src/components/tasks/kanban-column.tsx`**:

```typescript
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { useDroppable } from "@dnd-kit/core";
import type { TaskMetadata, KanbanStatus } from "@/entities/tasks/types";
import { TaskCard } from "./task-card";

const STATUS_COLORS: Record<KanbanStatus, string> = {
  backlog: "border-slate-500",
  todo: "border-amber-500",
  "in-progress": "border-blue-500",
  done: "border-emerald-500",
};

const STATUS_LABELS: Record<KanbanStatus, string> = {
  backlog: "Backlog",
  todo: "Todo",
  "in-progress": "In Progress",
  done: "Done",
};

interface KanbanColumnProps {
  status: KanbanStatus;
  tasks: TaskMetadata[];
  onTaskClick: (task: TaskMetadata) => void;
}

export function KanbanColumn({ status, tasks, onTaskClick }: KanbanColumnProps) {
  const { setNodeRef } = useDroppable({ id: status });

  return (
    <div className="flex flex-col w-72 flex-shrink-0">
      <div className={`flex items-center gap-2 px-3 py-2 border-l-2 ${STATUS_COLORS[status]}`}>
        <h3 className="text-sm font-medium text-slate-200">{STATUS_LABELS[status]}</h3>
        <span className="text-xs text-slate-500 bg-slate-800 px-1.5 py-0.5 rounded">
          {tasks.length}
        </span>
      </div>
      <div
        ref={setNodeRef}
        className="flex-1 p-2 space-y-2 overflow-y-auto bg-slate-900/50 rounded-b-lg min-h-[200px]"
      >
        <SortableContext items={tasks.map((t) => t.id)} strategy={verticalListSortingStrategy}>
          {tasks.map((task) => (
            <TaskCard key={task.id} task={task} onClick={() => onTaskClick(task)} />
          ))}
        </SortableContext>
      </div>
    </div>
  );
}
```

#### 2.3 Create KanbanBoard component

**`src/components/tasks/kanban-board.tsx`**:

```typescript
import {
  DndContext,
  DragEndEvent,
  PointerSensor,
  useSensor,
  useSensors,
  closestCenter,
} from "@dnd-kit/core";
import type { TaskMetadata, KanbanStatus } from "@/entities/tasks/types";
import type { GroupedTasks } from "@/hooks/use-task-board";
import { KanbanColumn } from "./kanban-column";

const STATUSES: KanbanStatus[] = ["backlog", "todo", "in-progress", "done"];

interface KanbanBoardProps {
  groupedTasks: GroupedTasks;
  onReorder: (taskId: string, newIndex: number, status: KanbanStatus) => void;
  onTaskClick: (task: TaskMetadata) => void;
}

export function KanbanBoard({ groupedTasks, onReorder, onTaskClick }: KanbanBoardProps) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
  );

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    // Find which column the task is in
    for (const status of STATUSES) {
      const column = groupedTasks[status];
      const activeIndex = column.findIndex((t) => t.id === active.id);
      if (activeIndex !== -1) {
        const overIndex = column.findIndex((t) => t.id === over.id);
        if (overIndex !== -1) {
          onReorder(active.id as string, overIndex, status);
        }
        break;
      }
    }
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <div className="flex gap-4 p-4 overflow-x-auto h-full">
        {STATUSES.map((status) => (
          <KanbanColumn
            key={status}
            status={status}
            tasks={groupedTasks[status]}
            onTaskClick={onTaskClick}
          />
        ))}
      </div>
    </DndContext>
  );
}
```

---

### Phase 3: List View Components

#### 3.1 Create TaskRow component

**`src/components/tasks/task-row.tsx`**:

```typescript
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, Circle } from "lucide-react";
import type { TaskMetadata, KanbanStatus } from "@/entities/tasks/types";

const STATUS_DOT_COLORS: Record<KanbanStatus, string> = {
  backlog: "text-slate-500",
  todo: "text-amber-500",
  "in-progress": "text-blue-500",
  done: "text-emerald-500",
};

interface TaskRowProps {
  task: TaskMetadata;
  onClick: () => void;
}

export function TaskRow({ task, onClick }: TaskRowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: task.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const statusColor = STATUS_DOT_COLORS[task.status as KanbanStatus] ?? "text-slate-500";

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="group flex items-center gap-3 px-3 py-2 bg-slate-800 rounded-lg border border-slate-700 hover:border-slate-600 cursor-pointer transition-colors"
      onClick={onClick}
    >
      <button
        className="opacity-0 group-hover:opacity-100 cursor-grab active:cursor-grabbing text-slate-500 hover:text-slate-400 transition-opacity"
        {...attributes}
        {...listeners}
      >
        <GripVertical size={14} />
      </button>
      <Circle size={8} className={`${statusColor} fill-current`} />
      <span className="flex-1 text-sm text-slate-100 truncate">{task.title}</span>
      {task.tags.length > 0 && (
        <div className="flex gap-1">
          {task.tags.slice(0, 2).map((tag) => (
            <span
              key={tag}
              className="px-1.5 py-0.5 text-[10px] uppercase tracking-wide bg-slate-700 text-slate-400 rounded"
            >
              {tag}
            </span>
          ))}
        </div>
      )}
      {task.subtasks.length > 0 && (
        <span className="text-xs text-slate-500">
          {task.subtasks.filter((s) => s.completed).length}/{task.subtasks.length}
        </span>
      )}
    </div>
  );
}
```

#### 3.2 Create TaskListView component

**`src/components/tasks/task-list-view.tsx`**:

```typescript
import {
  DndContext,
  DragEndEvent,
  PointerSensor,
  useSensor,
  useSensors,
  closestCenter,
} from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import type { TaskMetadata, KanbanStatus } from "@/entities/tasks/types";
import type { GroupedTasks } from "@/hooks/use-task-board";
import { TaskRow } from "./task-row";

const STATUS_LABELS: Record<KanbanStatus, string> = {
  backlog: "Backlog",
  todo: "Todo",
  "in-progress": "In Progress",
  done: "Done",
};

const STATUSES: KanbanStatus[] = ["backlog", "todo", "in-progress", "done"];

interface TaskListViewProps {
  groupedTasks: GroupedTasks;
  onReorder: (taskId: string, newIndex: number, status: KanbanStatus) => void;
  onTaskClick: (task: TaskMetadata) => void;
}

export function TaskListView({ groupedTasks, onReorder, onTaskClick }: TaskListViewProps) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
  );

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    for (const status of STATUSES) {
      const column = groupedTasks[status];
      const activeIndex = column.findIndex((t) => t.id === active.id);
      if (activeIndex !== -1) {
        const overIndex = column.findIndex((t) => t.id === over.id);
        if (overIndex !== -1) {
          onReorder(active.id as string, overIndex, status);
        }
        break;
      }
    }
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <div className="p-4 space-y-6 overflow-y-auto h-full">
        {STATUSES.map((status) => {
          const tasks = groupedTasks[status];
          if (tasks.length === 0) return null;
          return (
            <div key={status}>
              <h3 className="text-sm font-medium text-slate-400 mb-2 flex items-center gap-2">
                {STATUS_LABELS[status]}
                <span className="text-xs text-slate-500">({tasks.length})</span>
              </h3>
              <div className="space-y-1">
                <SortableContext
                  items={tasks.map((t) => t.id)}
                  strategy={verticalListSortingStrategy}
                >
                  {tasks.map((task) => (
                    <TaskRow key={task.id} task={task} onClick={() => onTaskClick(task)} />
                  ))}
                </SortableContext>
              </div>
            </div>
          );
        })}
      </div>
    </DndContext>
  );
}
```

---

### Phase 4: Toolbar & Filtering

#### 4.1 Create TaskToolbar component

**`src/components/tasks/task-toolbar.tsx`**:

```typescript
import { LayoutGrid, List, Search, X } from "lucide-react";

interface TaskToolbarProps {
  view: "kanban" | "list";
  onViewChange: (view: "kanban" | "list") => void;
  availableTags: string[];
  selectedTags: string[];
  onTagsChange: (tags: string[]) => void;
  searchQuery: string;
  onSearchChange: (query: string) => void;
}

export function TaskToolbar({
  view,
  onViewChange,
  availableTags,
  selectedTags,
  onTagsChange,
  searchQuery,
  onSearchChange,
}: TaskToolbarProps) {
  const toggleTag = (tag: string) => {
    if (selectedTags.includes(tag)) {
      onTagsChange(selectedTags.filter((t) => t !== tag));
    } else {
      onTagsChange([...selectedTags, tag]);
    }
  };

  return (
    <div className="flex items-center gap-4 p-4 border-b border-slate-800">
      {/* View toggle */}
      <div className="flex bg-slate-800 rounded-lg p-1">
        <button
          onClick={() => onViewChange("kanban")}
          className={`p-1.5 rounded ${
            view === "kanban" ? "bg-slate-700 text-slate-100" : "text-slate-400 hover:text-slate-300"
          }`}
        >
          <LayoutGrid size={16} />
        </button>
        <button
          onClick={() => onViewChange("list")}
          className={`p-1.5 rounded ${
            view === "list" ? "bg-slate-700 text-slate-100" : "text-slate-400 hover:text-slate-300"
          }`}
        >
          <List size={16} />
        </button>
      </div>

      {/* Search */}
      <div className="relative flex-1 max-w-xs">
        <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500" />
        <input
          type="text"
          placeholder="Search tasks..."
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          className="w-full pl-8 pr-3 py-1.5 text-sm bg-slate-800 border border-slate-700 rounded-lg text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-slate-600"
        />
      </div>

      {/* Tag filters */}
      {availableTags.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap">
          {availableTags.map((tag) => (
            <button
              key={tag}
              onClick={() => toggleTag(tag)}
              className={`px-2 py-1 text-xs rounded-lg border transition-colors ${
                selectedTags.includes(tag)
                  ? "bg-blue-500/20 border-blue-500/50 text-blue-400"
                  : "bg-slate-800 border-slate-700 text-slate-400 hover:border-slate-600"
              }`}
            >
              {tag}
            </button>
          ))}
          {selectedTags.length > 0 && (
            <button
              onClick={() => onTagsChange([])}
              className="p-1 text-slate-500 hover:text-slate-400"
            >
              <X size={14} />
            </button>
          )}
        </div>
      )}
    </div>
  );
}
```

---

### Phase 5: Main Task Board Page

#### 5.1 Create TaskBoardPage component

**`src/components/tasks/task-board-page.tsx`**:

```typescript
import { useState, useCallback } from "react";
import { useTaskBoard, type TaskBoardFilters } from "@/hooks/use-task-board";
import type { TaskMetadata, KanbanStatus } from "@/entities/tasks/types";
import { TaskToolbar } from "./task-toolbar";
import { KanbanBoard } from "./kanban-board";
import { TaskListView } from "./task-list-view";

interface TaskBoardPageProps {
  onTaskClick?: (task: TaskMetadata) => void;
}

export function TaskBoardPage({ onTaskClick }: TaskBoardPageProps) {
  const [view, setView] = useState<"kanban" | "list">("kanban");
  const [filters, setFilters] = useState<TaskBoardFilters>({ tags: [], search: "" });

  const { groupedTasks, allTags, reorderWithinColumn } = useTaskBoard(filters);

  const handleReorder = useCallback(
    (taskId: string, newIndex: number, status: KanbanStatus) => {
      reorderWithinColumn(taskId, newIndex, status);
    },
    [reorderWithinColumn]
  );

  const handleTaskClick = useCallback(
    (task: TaskMetadata) => {
      onTaskClick?.(task);
    },
    [onTaskClick]
  );

  return (
    <div className="flex flex-col h-full bg-slate-900">
      <TaskToolbar
        view={view}
        onViewChange={setView}
        availableTags={allTags}
        selectedTags={filters.tags}
        onTagsChange={(tags) => setFilters((f) => ({ ...f, tags }))}
        searchQuery={filters.search}
        onSearchChange={(search) => setFilters((f) => ({ ...f, search }))}
      />
      <div className="flex-1 overflow-hidden">
        {view === "kanban" ? (
          <KanbanBoard
            groupedTasks={groupedTasks}
            onReorder={handleReorder}
            onTaskClick={handleTaskClick}
          />
        ) : (
          <TaskListView
            groupedTasks={groupedTasks}
            onReorder={handleReorder}
            onTaskClick={handleTaskClick}
          />
        )}
      </div>
    </div>
  );
}
```

---

### Phase 6: Window/Panel Configuration

#### 6.1 Create entry point files

**`tasks.html`** (project root):

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Tasks</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/tasks-main.tsx"></script>
  </body>
</html>
```

**`src/tasks-main.tsx`**:

```typescript
import { StrictMode, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { taskService } from "@/entities/tasks/service";
import { TaskBoardPage } from "@/components/tasks/task-board-page";
import "./index.css";

function TasksApp() {
  useEffect(() => {
    taskService.hydrate();
  }, []);

  return <TaskBoardPage />;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <TasksApp />
  </StrictMode>
);
```

#### 6.2 Update Vite config

**`vite.config.ts`** — add tasks entry:

```typescript
build: {
  rollupOptions: {
    input: {
      main: resolve(__dirname, "index.html"),
      spotlight: resolve(__dirname, "spotlight.html"),
      clipboard: resolve(__dirname, "clipboard.html"),
      conversation: resolve(__dirname, "conversation.html"),
      tasks: resolve(__dirname, "tasks.html"), // NEW
    },
  },
},
```

#### 6.3 Add tasks panel to Rust backend

**Option A: Add as a new panel** (similar to conversation panel)

Add to `src-tauri/src/panels.rs`:
- Create `TasksPanel` with label "tasks"
- Size: 900x700
- Panel behavior: stays above other windows, hides on blur

**Option B: Use as a regular window** (simpler)

Add to `src-tauri/tauri.conf.json`:

```json
{
  "label": "tasks",
  "title": "Tasks",
  "width": 1000,
  "height": 700,
  "visible": false,
  "url": "tasks.html"
}
```

Add Tauri command to show/hide the window.

---

## File Changes Summary

### New Files

| Path                                       | Description               |
| ------------------------------------------ | ------------------------- |
| `src/hooks/use-task-board.ts`              | Task board state hook     |
| `src/components/tasks/task-card.tsx`       | Draggable task card       |
| `src/components/tasks/kanban-column.tsx`   | Single Kanban column      |
| `src/components/tasks/kanban-board.tsx`    | Kanban board container    |
| `src/components/tasks/task-row.tsx`        | Draggable task row        |
| `src/components/tasks/task-list-view.tsx`  | List view container       |
| `src/components/tasks/task-toolbar.tsx`    | View toggle & filters     |
| `src/components/tasks/task-board-page.tsx` | Main page component       |
| `src/tasks-main.tsx`                       | React entry point         |
| `tasks.html`                               | HTML entry                |

### Modified Files

| Path                        | Change                    |
| --------------------------- | ------------------------- |
| `vite.config.ts`            | Add tasks.html entry      |
| `src-tauri/tauri.conf.json` | Add tasks window          |
| `src-tauri/src/panels.rs`   | Add tasks panel (if used) |
| `package.json`              | Add @dnd-kit dependencies |

---

## UI Design Notes

### Color Palette (Dark Theme)

Uses existing Tailwind slate palette:

```css
--bg-primary: #0f172a; /* slate-900 */
--bg-secondary: #1e293b; /* slate-800 */
--bg-card: #334155; /* slate-700 */
--border: #475569; /* slate-600 */
--text-primary: #f1f5f9; /* slate-100 */
--text-secondary: #94a3b8; /* slate-400 */

/* Status accents */
--backlog: #64748b; /* slate-500 */
--todo: #f59e0b; /* amber-500 */
--in-progress: #3b82f6; /* blue-500 */
--done: #10b981; /* emerald-500 */
```

### Card Design

- Subtle slate-800 background
- Rounded corners (8px)
- Hover reveals drag handle
- Drag preview at 50% opacity

### Typography

- Card title: 14px (text-sm)
- Tags: 10px uppercase with tracking
- Counts: 12px (text-xs) muted

---

## Implementation Order

1. [ ] Phase 1: Install @dnd-kit, create useTaskBoard hook
2. [ ] Phase 2: Kanban components (card, column, board)
3. [ ] Phase 3: List view components (row, list)
4. [ ] Phase 4: Toolbar & filtering
5. [ ] Phase 5: Main page assembly
6. [ ] Phase 6: Window configuration & entry points

---

## Open Questions

1. **Panel vs Window?**
   - Panel: Floating, hides on blur (like conversation panel)
   - Window: Standard window, stays visible
   - Recommendation: Start with regular window for simplicity

2. **View preference persistence?**
   - Could store in localStorage
   - Simple: `localStorage.getItem("taskBoardView")`

3. **Tag colors?**
   - Auto-assign based on string hash
   - Future: Let users pick colors

4. **Quick-add from board?**
   - Add "+ New" button in column headers
   - Opens spotlight or inline input
   - Good UX for v2
