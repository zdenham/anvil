# TaskOutput Tool Block Implementation Plan

## Overview

Implement a specialized `TaskOutputToolBlock` component following the conventions established by `BashToolBlock`. This tool displays the output and status of background task executions (background Bash commands or background Agent tasks) in a readable, user-friendly format.

---

## Anthropic API Data Structures

### Tool Input (from Claude Agent SDK)

The `TaskOutput` tool input follows this structure from `@anthropic-ai/claude-agent-sdk`:

```typescript
/**
 * Input parameters for the TaskOutput tool.
 * This is what Claude sends when invoking the tool.
 */
interface TaskOutputInput {
  /** The task ID to get output from (matches a background Bash or Agent task) */
  task_id: string;
  /** Whether to wait for completion (default: false) */
  block?: boolean;
  /** Max wait time in ms */
  timeout?: number;
}
```

### Tool Result Format

The result string from the Anthropic API (`ToolResultBlockParam.content`) is a JSON-stringified object. The TaskOutput tool result has this internal structure:

```typescript
/**
 * Claude Code's TaskOutput tool result format.
 * Not exported from @anthropic-ai/sdk - this is Claude Code's internal representation.
 * The result string from tool_result blocks is JSON-stringified with this shape.
 */
interface TaskOutputResult {
  /** Output from the background task (stdout for Bash, response for Agent) */
  output?: string;
  /** Whether the task is still running */
  is_running?: boolean;
  /** Error message if the task failed */
  error?: string;
  /** Exit code for Bash tasks */
  exit_code?: number;
}
```

### How It Arrives in the Component

Tool calls arrive via the Anthropic Messages API as `Anthropic.ToolUseBlock`:

```typescript
// From @anthropic-ai/sdk
interface ToolUseBlock {
  type: "tool_use";
  id: string;           // Unique tool use ID (e.g., "toolu_01ABC...")
  name: string;         // "TaskOutput"
  input: object;        // TaskOutputInput (task_id, block, timeout)
}
```

Tool results arrive as `Anthropic.ToolResultBlockParam`:

```typescript
// From @anthropic-ai/sdk
interface ToolResultBlockParam {
  type: "tool_result";
  tool_use_id: string;  // Matches ToolUseBlock.id
  content: string;      // JSON-stringified TaskOutputResult
  is_error?: boolean;   // True if tool execution failed
}
```

The component receives these via `ToolBlockProps` which normalizes the data:
- `input`: The raw `TaskOutputInput` object
- `result`: The JSON string to parse into `TaskOutputResult`
- `isError`: Whether the tool execution failed

---

## Design Specification

### Visual Structure

The TaskOutput tool block follows the BashToolBlock UI pattern with three layers:

1. **First Line (Header Row)**
   - `ExpandChevron` component for expand/collapse indicator (left side)
   - `ShimmerText` component with description text ("Task output") - shimmer animates while running, static when complete
   - Duration display (right-aligned) using `formatDuration`
   - **Note**: No icon on this line - the chevron serves as the visual anchor

2. **Second Line (Details Row)**
   - `ArrowDownToLine` icon from lucide-react (left side, where the icon belongs)
   - Task ID (truncated) displayed in monospace font
   - `StatusIcon` component for success/failure indicator (only shown after completion)
   - Shows even when collapsed for quick scanning
   - **Note**: The icon appears on this line because the first line uses the chevron for collapse/expand control

3. **Expandable Section**
   - Task output content rendered as plain text (not raw JSON)
   - `CollapsibleOutputBlock` component for long output with gradient overlay
   - `CopyButton` component for copying output content

### Detailed Layout

```
[Chevron]  Task output (shimmer while running)                    [Duration]
           [ArrowDownToLine]  task-abc123  [StatusIcon]
           +-------------------------------------------------------------+
           | Task output content                                          |
           | (may be long, uses CollapsibleOutputBlock)                  |
           +-------------------------------------------------------------+
```

**Layout Notes:**
- First line: Chevron + description text + duration. The chevron controls expand/collapse.
- Second line: Icon + task ID + status. The icon appears here (not on the first line) because the chevron occupies the left position on the first line.

---

## Reusable UI Components

All components are imported from `@/components/ui/`:

### ExpandChevron

Displays expand/collapse state in the header. Automatically switches between `ChevronRight` and `ChevronDown` icons.

```typescript
import { ExpandChevron } from "@/components/ui/expand-chevron";

<ExpandChevron isExpanded={isExpanded} size="md" />
```

### ShimmerText

Animates header text while task is running (status === "running"). Transitions to static text on completion.

```typescript
import { ShimmerText } from "@/components/ui/shimmer-text";

<ShimmerText isShimmering={isRunning} className="text-sm text-zinc-200 truncate">
  Task output
</ShimmerText>
```

### StatusIcon

Shows success/failure indicator after task completion. Only render when not running.

```typescript
import { StatusIcon } from "@/components/ui/status-icon";

{!isRunning && <StatusIcon isSuccess={!isError} />}
```

### CopyButton

Copies output content to clipboard with checkmark feedback and tooltip.

```typescript
import { CopyButton } from "@/components/ui/copy-button";

<CopyButton text={output} label="Copy output" />
```

### CollapsibleOutputBlock

Wraps expanded output content. Handles long content with gradient overlay and expand/collapse button.

```typescript
import { CollapsibleOutputBlock } from "@/components/ui/collapsible-output-block";

<CollapsibleOutputBlock
  isExpanded={isOutputExpanded}
  onToggle={() => setIsOutputExpanded(!isOutputExpanded)}
  isLongContent={isLongOutput}
  maxCollapsedHeight={MAX_COLLAPSED_HEIGHT}
  variant={isError ? "error" : "default"}
>
  <pre className="text-xs font-mono p-2 whitespace-pre-wrap break-words">
    <code>{output}</code>
  </pre>
</CollapsibleOutputBlock>
```

### ArrowDownToLine Icon

Import from lucide-react. Use **only on the second line** (not the first line) with consistent styling matching other tool blocks. The first line uses the `ExpandChevron` component instead.

```typescript
import { ArrowDownToLine } from "lucide-react";

// Used on second line only - first line has the chevron
<ArrowDownToLine className="w-3 h-3 text-zinc-500 shrink-0" />
```

---

## Implementation Details

### File Location

```
src/components/thread/tool-blocks/taskoutput-tool-block.tsx
```

### Imports

```typescript
import { cn } from "@/lib/utils";
import { formatDuration } from "@/lib/utils/time-format";
import { useToolExpandStore } from "@/stores/tool-expand-store";
import { CopyButton } from "@/components/ui/copy-button";
import { ShimmerText } from "@/components/ui/shimmer-text";
import { ExpandChevron } from "@/components/ui/expand-chevron";
import { StatusIcon } from "@/components/ui/status-icon";
import { CollapsibleOutputBlock } from "@/components/ui/collapsible-output-block";
import { ArrowDownToLine } from "lucide-react";
import type { ToolBlockProps } from "./index";
```

### TypeScript Interfaces

```typescript
/**
 * TaskOutput tool input from Claude Agent SDK.
 * This matches the shape of input.* fields passed to the component.
 */
interface TaskOutputInput {
  /** The task ID to get output from */
  task_id: string;
  /** Whether to wait for completion */
  block?: boolean;
  /** Max wait time in ms */
  timeout?: number;
}

/**
 * Claude Code's TaskOutput tool result format.
 * The result string from tool_result blocks is JSON-stringified with this shape.
 */
interface TaskOutputResult {
  /** Output from the background task */
  output?: string;
  /** Whether the task is still running */
  is_running?: boolean;
  /** Error message if the task failed */
  error?: string;
  /** Exit code for Bash tasks */
  exit_code?: number;
}
```

### Constants

```typescript
const LINE_COLLAPSE_THRESHOLD = 20; // Lines of output
const MAX_COLLAPSED_HEIGHT = 300;   // Pixels
```

### Result Parsing Function

Parse the JSON result string into a typed object, handling both structured and plain text results:

```typescript
/**
 * Parse the TaskOutput result which is JSON with output/status fields.
 * Falls back to treating result as plain text if JSON parsing fails.
 */
function parseTaskOutputResult(result: string | undefined): TaskOutputResult {
  if (!result) {
    return { output: "" };
  }

  try {
    const parsed = JSON.parse(result) as TaskOutputResult;
    // Validate it looks like a TaskOutput result
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      ("output" in parsed || "is_running" in parsed || "error" in parsed)
    ) {
      return {
        output: parsed.output ?? "",
        is_running: parsed.is_running ?? false,
        error: parsed.error,
        exit_code: parsed.exit_code,
      };
    }
  } catch {
    // Not JSON, treat as plain text output
  }

  // Fallback: treat entire result as output string
  return { output: result };
}
```

### Component Props

Inherits standard `ToolBlockProps` from the tool block registry:

```typescript
export function TaskOutputToolBlock({
  id,
  name: _name,
  input,
  result,
  isError = false,
  status,
  durationMs,
  isFocused: _isFocused,
  threadId,
}: ToolBlockProps) {
  // Implementation
}
```

### State Management

Use `useToolExpandStore` to persist expand/collapse state across virtualization remounts:

```typescript
// Block expand state
const isExpanded = useToolExpandStore((state) =>
  state.isToolExpanded(threadId, id)
);
const setToolExpanded = useToolExpandStore((state) => state.setToolExpanded);
const setIsExpanded = (expanded: boolean) => setToolExpanded(threadId, id, expanded);

// Output expand state (for long content)
const isLongOutput = outputLines.length > LINE_COLLAPSE_THRESHOLD;
const defaultOutputExpanded = !isLongOutput;
const isOutputExpanded = useToolExpandStore((state) =>
  state.isOutputExpanded(threadId, id, defaultOutputExpanded)
);
const setOutputExpanded = useToolExpandStore((state) => state.setOutputExpanded);
const setIsOutputExpanded = (expanded: boolean) => setOutputExpanded(threadId, id, expanded);
```

---

## Render Logic

### Extract and Parse Data

```typescript
const taskInput = input as unknown as TaskOutputInput;
const taskId = taskInput.task_id || "";
const isBlocking = taskInput.block ?? false;

const { output, is_running, error, exit_code } = parseTaskOutputResult(result);
const isRunning = status === "running" || is_running;
const hasOutput = output.length > 0;
const hasError = isError || !!error;

// Process output for line counting
const outputLines = output ? output.split("\n") : [];
const isLongOutput = outputLines.length > LINE_COLLAPSE_THRESHOLD;
```

### Display Format for Output

The output is rendered as plain text in a monospace font. Never display raw JSON to users:

- **For plain text output**: Display as-is in a `<pre><code>` block
- **For error messages**: Display in red text using the "error" variant of `CollapsibleOutputBlock`
- **For running tasks**: Show "Waiting for output..." with a pulsing cursor animation

### First Line (Header Row with Chevron + Description)

The first line contains the expand/collapse chevron and the description text with shimmer animation. No icon appears on this line - the chevron serves as the visual anchor on the left.

```tsx
<div className="flex items-center gap-2">
  {/* Chevron on the left - controls expand/collapse */}
  <ExpandChevron isExpanded={isExpanded} size="md" />

  {/* Description text - shimmer animates while running */}
  <ShimmerText
    isShimmering={isRunning}
    className="text-sm text-zinc-200 truncate min-w-0"
  >
    Task output
  </ShimmerText>

  {/* Duration - right aligned */}
  <span className="flex items-center gap-2 shrink-0 ml-auto">
    {durationMs !== undefined && !isRunning && (
      <span className="text-xs text-muted-foreground">
        {formatDuration(durationMs)}
      </span>
    )}
  </span>
</div>
```

### Second Line (Icon + Task ID + Status)

The second line contains the tool-specific icon, task details, and status. The icon appears on this line (not the first line) because the first line uses the chevron for collapse/expand control.

```tsx
<div className="flex items-center gap-1 mt-0.5 pl-5">
  {/* Icon appears on the second line, not the first */}
  <ArrowDownToLine className="w-3 h-3 text-zinc-500 shrink-0" />
  <code className="text-xs font-mono text-zinc-500 truncate">
    {taskId.length > 20 ? `${taskId.slice(0, 20)}...` : taskId}
  </code>
  {isBlocking && (
    <span className="text-xs text-zinc-600">(blocking)</span>
  )}
  {/* Status icon only shows after completion */}
  {!isRunning && <StatusIcon isSuccess={!hasError} size="sm" />}
</div>
```

### Expanded Content

```tsx
{isExpanded && hasOutput && (
  <div className="relative mt-2">
    <div className="absolute top-1 right-1 z-10">
      <CopyButton text={output} label="Copy output" />
    </div>
    <CollapsibleOutputBlock
      isExpanded={isOutputExpanded}
      onToggle={() => setIsOutputExpanded(!isOutputExpanded)}
      isLongContent={isLongOutput}
      maxCollapsedHeight={MAX_COLLAPSED_HEIGHT}
      variant={hasError ? "error" : "default"}
    >
      <pre
        className={cn(
          "text-xs font-mono p-2",
          "whitespace-pre-wrap break-words",
          hasError ? "text-red-200" : "text-zinc-300"
        )}
      >
        <code>{output}</code>
        {isRunning && (
          <span className="inline-block w-2 h-4 bg-zinc-400 animate-pulse ml-0.5" />
        )}
      </pre>
    </CollapsibleOutputBlock>

    {/* Show error message if present */}
    {error && (
      <span className="text-xs text-red-400 mt-1 block">
        Error: {error}
      </span>
    )}

    {/* Show exit code for Bash tasks */}
    {exit_code !== undefined && exit_code !== 0 && (
      <span className="text-xs text-yellow-500 mt-1 block">
        Exit code: {exit_code}
      </span>
    )}
  </div>
)}

{/* Expanded but no output yet (running) */}
{isExpanded && !hasOutput && isRunning && (
  <div className="mt-2">
    <div className="text-xs font-mono p-2 rounded border border-zinc-700/50 text-zinc-500">
      Waiting for output...
      <span className="inline-block w-2 h-4 bg-zinc-400 animate-pulse ml-1" />
    </div>
  </div>
)}
```

### Keyboard Navigation and ARIA

The header is clickable and supports keyboard interaction:

```tsx
<div
  className="cursor-pointer select-none"
  onClick={() => setIsExpanded(!isExpanded)}
  role="button"
  aria-expanded={isExpanded}
  tabIndex={0}
  onKeyDown={(e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      setIsExpanded(!isExpanded);
    }
  }}
>
  {/* Header content */}
</div>

{/* Screen reader status */}
<span className="sr-only">
  {isRunning
    ? "Task running"
    : hasError
      ? "Task failed"
      : "Task completed"}
</span>
```

---

## Registry Integration

Add to `src/components/thread/tool-blocks/index.ts`:

```typescript
import { TaskOutputToolBlock } from "./taskoutput-tool-block";

// Update registry
const TOOL_BLOCK_REGISTRY: Record<string, ToolBlockComponent> = {
  bash: BashToolBlock,
  taskoutput: TaskOutputToolBlock,
};

// Update exports
export { BashToolBlock, TaskOutputToolBlock };
```

---

## Complete Component Structure

```typescript
export function TaskOutputToolBlock({
  id,
  name: _name,
  input,
  result,
  isError = false,
  status,
  durationMs,
  isFocused: _isFocused,
  threadId,
}: ToolBlockProps) {
  // State management with useToolExpandStore
  const isExpanded = useToolExpandStore((state) => state.isToolExpanded(threadId, id));
  const setToolExpanded = useToolExpandStore((state) => state.setToolExpanded);
  const setIsExpanded = (expanded: boolean) => setToolExpanded(threadId, id, expanded);

  // Parse input and result
  const taskInput = input as unknown as TaskOutputInput;
  const taskId = taskInput.task_id || "";
  const isBlocking = taskInput.block ?? false;
  const { output, is_running, error, exit_code } = parseTaskOutputResult(result);

  // Derive display state
  const isRunning = status === "running" || is_running;
  const hasOutput = output.length > 0;
  const hasError = isError || !!error;
  const outputLines = output ? output.split("\n") : [];
  const isLongOutput = outputLines.length > LINE_COLLAPSE_THRESHOLD;

  // Output expand state
  const defaultOutputExpanded = !isLongOutput;
  const isOutputExpanded = useToolExpandStore((state) =>
    state.isOutputExpanded(threadId, id, defaultOutputExpanded)
  );
  const setOutputExpanded = useToolExpandStore((state) => state.setOutputExpanded);
  const setIsOutputExpanded = (expanded: boolean) => setOutputExpanded(threadId, id, expanded);

  return (
    <div
      className="group py-0.5"
      aria-label={`Task output: ${taskId}, status: ${status}`}
      data-testid={`taskoutput-tool-${id}`}
      data-tool-status={status}
    >
      {/* Collapsed/Summary Row - clickable header */}
      {/* Primary line + Second line */}
      {/* Expanded Content with CollapsibleOutputBlock */}
      {/* Screen reader status */}
    </div>
  );
}
```

---

## Testing Checklist

- [ ] Component renders with minimal input (just task_id)
- [ ] `ShimmerText` animates while task is running
- [ ] Click/keyboard (Enter/Space) toggles expand/collapse
- [ ] `CopyButton` copies output content
- [ ] Long output uses `CollapsibleOutputBlock` with gradient overlay
- [ ] Status displays correctly (Running/Complete/Error)
- [ ] Duration displays when available and not running
- [ ] Error state shows red styling via `CollapsibleOutputBlock` variant="error"
- [ ] Expand state persists across virtualization via `useToolExpandStore`
- [ ] Screen reader announcements work correctly
- [ ] Task ID truncates gracefully for long IDs
- [ ] Blocking indicator shows when `block: true`
- [ ] Exit code displays for non-zero Bash task results
- [ ] No raw JSON is ever displayed to users

---

## Success Criteria

1. Component follows `BashToolBlock` UI patterns exactly
2. **Two-line layout structure:**
   - First line: Chevron (for expand/collapse) + description text (with shimmer animation when running) + duration
   - Second line: Icon (`ArrowDownToLine`) + task ID + status icon
   - Icon appears ONLY on the second line because the first line has the chevron
3. All reusable UI components from `@/components/ui/` are used correctly:
   - `ExpandChevron` for expand/collapse indicator (first line only)
   - `ShimmerText` for running state animation (first line description)
   - `StatusIcon` for success/failure indicator (second line)
   - `CopyButton` for clipboard functionality
   - `CollapsibleOutputBlock` for long output handling
4. Expand/collapse state persists via `useToolExpandStore`
5. Running state shows shimmer animation on the description text (first line)
6. Output is displayed as readable plain text (never raw JSON)
7. Task ID and status visible in second line when collapsed
8. Copy button available for output content
9. Keyboard navigation supported (Enter/Space to toggle)
10. Proper ARIA labels for accessibility
11. Correct TypeScript types matching Claude Agent SDK structures
