# TodoWrite Tool Block Implementation Plan

## Overview

This document outlines the implementation of the `TodoWriteToolBlock` component, which specializes in rendering the results of the TodoWrite tool. This tool updates a todo list with status changes to pending, in_progress, or completed items.

The implementation follows the conventions established by `BashToolBlock` and uses the reusable UI components from `src/components/ui/`.

---

## Anthropic API Types

The component receives data through the `ToolBlockProps` interface, which wraps Anthropic SDK types:

```typescript
// From src/components/thread/tool-blocks/index.ts
interface ToolBlockProps {
  id: string;           // Maps to ToolUseBlock.id from @anthropic-ai/sdk
  name: string;         // Maps to ToolUseBlock.name (will be "TodoWrite")
  input: Record<string, unknown>;  // Maps to ToolUseBlock.input
  result?: string;      // Stringified tool result from ToolResultBlockParam.content
  isError?: boolean;    // Maps to ToolResultBlockParam.is_error
  status: ToolStatus;   // "running" | "complete" | "error"
  durationMs?: number;
  isFocused?: boolean;
  threadId: string;
}
```

The `input` comes from the Anthropic `ToolUseBlock.input` field. The `result` is the stringified content from `ToolResultBlockParam.content` (the tool execution response sent back to Claude).

---

## Data Structures

### TodoWrite Input (from ToolUseBlock.input)

The input follows Claude Code's TodoWrite tool schema:

```typescript
interface TodoWriteInput {
  todos: Array<{
    content: string;      // The todo item text (imperative form)
    status: "pending" | "in_progress" | "completed";
    activeForm: string;   // Present continuous form shown during execution
  }>;
}
```

### TodoWrite Result

The result is typically a simple success confirmation string (not JSON). The TodoWrite tool returns text like "Todo list updated successfully." - no complex parsing is needed. If the result string exists and `isError` is false, the operation succeeded.

---

## UI Specification

### Two-Line Header Layout (Always Visible)

Use `CollapsibleBlock` as the container with a two-line header structure:

**Line 1 (Description):**
- **Chevron:** `ExpandChevron` component with `size="md"` - controls collapse/expand
- **Text:** "Updating todos" (activeForm) wrapped in `ShimmerText` with `isShimmering={status === "running"}`
- **Duration:** Right-aligned `formatDuration(durationMs)` when complete
- **Note:** No icon on this line - the chevron occupies the leading position

**Line 2 (Command/Details):**
- **Icon:** `ListTodo` from lucide-react (`w-3.5 h-3.5 text-zinc-500`) - icon ONLY appears on this line
- **Text:** Summary of todo changes (e.g., "5 items · 2 completed · 1 in progress")
- Indented to align with the text on line 1 (past the chevron)

```tsx
<CollapsibleBlock
  isExpanded={isExpanded}
  onToggle={() => setIsExpanded(!isExpanded)}
  ariaLabel={`TodoWrite: Update todos, status: ${status}`}
  testId={`todowrite-tool-${id}`}
  header={
    <div className="flex flex-col gap-0.5">
      {/* Line 1: Description with chevron and shimmer animation */}
      <div className="flex items-center gap-2">
        <ExpandChevron isExpanded={isExpanded} size="md" />
        <ShimmerText isShimmering={isRunning} className="text-sm text-zinc-200 truncate">
          Updating todos
        </ShimmerText>
        {durationMs !== undefined && !isRunning && (
          <span className="text-xs text-muted-foreground ml-auto">
            {formatDuration(durationMs)}
          </span>
        )}
      </div>
      {/* Line 2: Command/details with icon */}
      <div className="flex items-center gap-1.5 ml-5">
        <ListTodo className="w-3.5 h-3.5 text-zinc-500 shrink-0" />
        <span className="text-xs text-zinc-400">
          {summary.total} items
          {summary.completed > 0 && ` · ${summary.completed} completed`}
          {summary.inProgress > 0 && ` · ${summary.inProgress} in progress`}
        </span>
      </div>
    </div>
  }
>
  {/* Expanded content */}
</CollapsibleBlock>
```

### Todo List Display (Expanded Content)

Render a formatted todo list - never raw JSON. Use `CollapsibleOutputBlock` for consistent styling with BashToolBlock:

```tsx
<CollapsibleOutputBlock
  isExpanded={isOutputExpanded}
  onToggle={() => setIsOutputExpanded(!isOutputExpanded)}
  isLongContent={todos.length > LINE_COLLAPSE_THRESHOLD}
  maxCollapsedHeight={MAX_COLLAPSED_HEIGHT}
  variant="default"
>
  <div className="p-2 space-y-1">
    {todos.map((todo, idx) => (
      <TodoItemRow key={idx} todo={todo} />
    ))}
  </div>
</CollapsibleOutputBlock>
```

Each todo item is rendered as a human-readable row (no JSON):

```tsx
function TodoItemRow({ todo }: { todo: TodoItem }) {
  return (
    <div className="flex items-start gap-2 text-xs py-0.5">
      {/* Status icon */}
      {todo.status === "completed" && (
        <Check className="w-3.5 h-3.5 text-green-400 shrink-0 mt-0.5" />
      )}
      {todo.status === "in_progress" && (
        <Loader2 className="w-3.5 h-3.5 text-blue-400 animate-spin shrink-0 mt-0.5" />
      )}
      {todo.status === "pending" && (
        <Circle className="w-3.5 h-3.5 text-zinc-500 shrink-0 mt-0.5" />
      )}

      {/* Todo content */}
      <span className="text-zinc-300 flex-1 min-w-0">{todo.content}</span>

      {/* Status badge */}
      <span className={cn(
        "px-1.5 py-0.5 rounded text-[10px] font-medium shrink-0 border",
        todo.status === "completed" && "bg-green-500/15 text-green-300 border-green-500/30",
        todo.status === "in_progress" && "bg-blue-500/15 text-blue-300 border-blue-500/30",
        todo.status === "pending" && "bg-zinc-700/30 text-zinc-400 border-zinc-600/50"
      )}>
        {todo.status === "in_progress" ? "in progress" : todo.status}
      </span>
    </div>
  );
}
```

---

## Reusable UI Components

Import from `@/components/ui/`:

| Component | Usage |
|-----------|-------|
| `CollapsibleBlock` | Main container with click-to-expand header, handles keyboard (Enter/Space) and ARIA attributes |
| `CollapsibleOutputBlock` | Wrapper for the todo list with gradient fade overlay when collapsed, "Expand/Collapse" button for long lists |
| `ExpandChevron` | Animated chevron icon in header (rotates on expand) |
| `ShimmerText` | Header text animation while `status === "running"` |
| `StatusIcon` | Not used directly - we use specific icons (Check, Loader2, Circle) for each todo status |

Note: `CopyButton` is intentionally not used since the todo list is a structured data visualization, not copyable text output.

---

## Implementation Details

### File Location

```
src/components/thread/tool-blocks/todowrite-tool-block.tsx
```

### Constants

```typescript
const LINE_COLLAPSE_THRESHOLD = 10;  // Collapse list if > 10 items
const MAX_COLLAPSED_HEIGHT = 200;    // Max height in pixels when collapsed
```

### Parse Input

Extract todos array from the `ToolUseBlock.input` object:

```typescript
interface TodoItem {
  content: string;
  status: "pending" | "in_progress" | "completed";
  activeForm: string;
}

function parseTodosInput(input: Record<string, unknown>): TodoItem[] {
  const todosRaw = input?.todos;
  if (!Array.isArray(todosRaw)) return [];

  return todosRaw.map((item) => ({
    content: typeof item?.content === "string" ? item.content : "",
    status: isValidStatus(item?.status) ? item.status : "pending",
    activeForm: typeof item?.activeForm === "string" ? item.activeForm : "",
  }));
}

function isValidStatus(status: unknown): status is TodoItem["status"] {
  return status === "pending" || status === "in_progress" || status === "completed";
}
```

### Calculate Summary

```typescript
interface TodoSummary {
  total: number;
  completed: number;
  inProgress: number;
  pending: number;
}

function calculateSummary(todos: TodoItem[]): TodoSummary {
  return {
    total: todos.length,
    completed: todos.filter(t => t.status === "completed").length,
    inProgress: todos.filter(t => t.status === "in_progress").length,
    pending: todos.filter(t => t.status === "pending").length,
  };
}
```

### State Management

Use `useToolExpandStore` for persisting expand state across virtualization remounts (same pattern as BashToolBlock):

```typescript
// Block expand state (whether to show the todo list)
const isExpanded = useToolExpandStore((state) => state.isToolExpanded(threadId, id));
const setToolExpanded = useToolExpandStore((state) => state.setToolExpanded);

// Output expand state (whether to show full list when > threshold)
const defaultOutputExpanded = todos.length <= LINE_COLLAPSE_THRESHOLD;
const isOutputExpanded = useToolExpandStore((state) =>
  state.isOutputExpanded(threadId, id, defaultOutputExpanded)
);
const setOutputExpanded = useToolExpandStore((state) => state.setOutputExpanded);
```

---

## Complete Component Structure

```tsx
import { cn } from "@/lib/utils";
import { formatDuration } from "@/lib/utils/time-format";
import { useToolExpandStore } from "@/stores/tool-expand-store";
import { CollapsibleBlock } from "@/components/ui/collapsible-block";
import { CollapsibleOutputBlock } from "@/components/ui/collapsible-output-block";
import { ShimmerText } from "@/components/ui/shimmer-text";
import { ExpandChevron } from "@/components/ui/expand-chevron";
import { ListTodo, Check, Circle, Loader2 } from "lucide-react";
import type { ToolBlockProps } from "./index";

const LINE_COLLAPSE_THRESHOLD = 10;
const MAX_COLLAPSED_HEIGHT = 200;

export function TodoWriteToolBlock({
  id,
  input,
  status,
  durationMs,
  threadId,
}: ToolBlockProps) {
  const isExpanded = useToolExpandStore((state) => state.isToolExpanded(threadId, id));
  const setToolExpanded = useToolExpandStore((state) => state.setToolExpanded);
  const setIsExpanded = (expanded: boolean) => setToolExpanded(threadId, id, expanded);

  const todos = parseTodosInput(input);
  const summary = calculateSummary(todos);
  const isRunning = status === "running";
  const isLongList = todos.length > LINE_COLLAPSE_THRESHOLD;

  const defaultOutputExpanded = !isLongList;
  const isOutputExpanded = useToolExpandStore((state) =>
    state.isOutputExpanded(threadId, id, defaultOutputExpanded)
  );
  const setOutputExpanded = useToolExpandStore((state) => state.setOutputExpanded);
  const setIsOutputExpanded = (expanded: boolean) => setOutputExpanded(threadId, id, expanded);

  return (
    <CollapsibleBlock
      isExpanded={isExpanded}
      onToggle={() => setIsExpanded(!isExpanded)}
      ariaLabel={`TodoWrite: Update todos, status: ${status}`}
      testId={`todowrite-tool-${id}`}
      className="py-0.5"
      header={
        <div className="flex flex-col gap-0.5">
          {/* Line 1: Description with chevron and shimmer animation */}
          <div className="flex items-center gap-2">
            <ExpandChevron isExpanded={isExpanded} size="md" />
            <ShimmerText
              isShimmering={isRunning}
              className="text-sm text-zinc-200 truncate min-w-0"
            >
              Updating todos
            </ShimmerText>
            {durationMs !== undefined && !isRunning && (
              <span className="text-xs text-muted-foreground ml-auto shrink-0">
                {formatDuration(durationMs)}
              </span>
            )}
          </div>
          {/* Line 2: Command/details with icon (icon ONLY on this line) */}
          <div className="flex items-center gap-1.5 ml-5">
            <ListTodo className="w-3.5 h-3.5 text-zinc-500 shrink-0" />
            <span className="text-xs text-zinc-400">
              {summary.total} items
              {summary.completed > 0 && ` · ${summary.completed} completed`}
              {summary.inProgress > 0 && ` · ${summary.inProgress} in progress`}
            </span>
          </div>
        </div>
      }
    >
      {/* Todo list */}
      {todos.length > 0 && (
        <div className="mt-2 ml-6">
          <CollapsibleOutputBlock
            isExpanded={isOutputExpanded}
            onToggle={() => setIsOutputExpanded(!isOutputExpanded)}
            isLongContent={isLongList}
            maxCollapsedHeight={MAX_COLLAPSED_HEIGHT}
            variant="default"
          >
            <div className="p-2 space-y-1">
              {todos.map((todo, idx) => (
                <TodoItemRow key={idx} todo={todo} />
              ))}
            </div>
          </CollapsibleOutputBlock>
        </div>
      )}

      {/* Empty state */}
      {todos.length === 0 && !isRunning && (
        <div className="mt-2 ml-6 text-xs text-zinc-500">No todo items</div>
      )}

      {/* Screen reader status */}
      <span className="sr-only">
        {isRunning ? "Updating todo list" : `Todo list updated: ${summary.total} items`}
      </span>
    </CollapsibleBlock>
  );
}

function TodoItemRow({ todo }: { todo: TodoItem }) {
  return (
    <div className="flex items-start gap-2 text-xs py-0.5">
      {todo.status === "completed" && (
        <Check className="w-3.5 h-3.5 text-green-400 shrink-0 mt-0.5" />
      )}
      {todo.status === "in_progress" && (
        <Loader2 className="w-3.5 h-3.5 text-blue-400 animate-spin shrink-0 mt-0.5" />
      )}
      {todo.status === "pending" && (
        <Circle className="w-3.5 h-3.5 text-zinc-500 shrink-0 mt-0.5" />
      )}
      <span className="text-zinc-300 flex-1 min-w-0">{todo.content}</span>
      <span
        className={cn(
          "px-1.5 py-0.5 rounded text-[10px] font-medium shrink-0 border",
          todo.status === "completed" &&
            "bg-green-500/15 text-green-300 border-green-500/30",
          todo.status === "in_progress" &&
            "bg-blue-500/15 text-blue-300 border-blue-500/30",
          todo.status === "pending" &&
            "bg-zinc-700/30 text-zinc-400 border-zinc-600/50"
        )}
      >
        {todo.status === "in_progress" ? "in progress" : todo.status}
      </span>
    </div>
  );
}
```

---

## Integration

### Register in Tool Block Registry

Update `src/components/thread/tool-blocks/index.ts`:

```typescript
import { TodoWriteToolBlock } from "./todowrite-tool-block";

const TOOL_BLOCK_REGISTRY: Record<string, ToolBlockComponent> = {
  bash: BashToolBlock,
  todowrite: TodoWriteToolBlock,
};

export { BashToolBlock, TodoWriteToolBlock };
```

---

## Edge Cases

1. **Empty Todo List** - Show "No todo items" placeholder text
2. **Long List (>10 items)** - Use `CollapsibleOutputBlock` with gradient fade and expand button
3. **Long Todo Content** - Allow text to wrap naturally (no truncation)
4. **Running State** - Show shimmer animation on header, todo items still visible if input is parsed
5. **Error State** - Component renders normally; isError is available if needed for styling
6. **Invalid Input** - Return empty array from parser, show "No todo items"
7. **Missing Status** - Default to "pending" in parser
8. **Missing Content** - Use empty string in parser

---

## Testing Checklist

- [ ] Renders correctly with 0, 1, 5, and 20+ todo items
- [ ] Expand/collapse works via click and keyboard (Enter/Space)
- [ ] Shimmer animation shows while `status === "running"`
- [ ] Summary line shows correct counts for each status
- [ ] Status icons are visually distinct (green check, blue spinner, gray circle)
- [ ] Status badges have correct colors per status
- [ ] Long lists show gradient fade and expand/collapse button
- [ ] Expand state persists across re-renders (useToolExpandStore)
- [ ] ARIA attributes are present (`aria-expanded`, `aria-label`)
- [ ] Screen reader announcement is accurate

---

## Success Criteria

- Component uses `CollapsibleBlock` and `CollapsibleOutputBlock` for consistent expand/collapse behavior with BashToolBlock
- Uses `ExpandChevron` and `ShimmerText` from shared UI components
- Persists expand state via `useToolExpandStore` (survives virtualization)
- Never displays raw JSON - all data is rendered as formatted todo items
- Handles all edge cases gracefully (empty, invalid, long lists)
- Follows accessibility patterns (keyboard nav, ARIA, screen reader text)
