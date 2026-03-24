# NotebookEdit Tool Block Implementation Plan

## Overview

The `NotebookEdit` tool block renders Jupyter notebook edits in a clear, readable format following the `BashToolBlock` UI conventions established in the tool result rendering overhaul. This component uses the shared reusable UI components to ensure consistent design across all tool blocks.

---

## Anthropic API Types

The component receives data shaped according to Anthropic's API types from `@anthropic-ai/sdk`:

### Tool Use Block (from `Anthropic.ToolUseBlock`)

```typescript
// From @anthropic-ai/sdk/resources/messages
interface ToolUseBlock {
  id: string;        // Unique tool use ID (e.g., "toolu_01ABC123")
  input: unknown;    // Tool-specific input parameters
  name: string;      // Tool name: "NotebookEdit"
  type: 'tool_use';
}
```

### Tool Result Block (from `Anthropic.ToolResultBlockParam`)

```typescript
// From @anthropic-ai/sdk/resources/messages
interface ToolResultBlockParam {
  tool_use_id: string;  // References the tool_use block's id
  type: 'tool_result';
  content?: string | Array<TextBlockParam | ImageBlockParam>;
  is_error?: boolean;   // True if execution failed
}
```

### NotebookEdit Input Shape

The `input` field from `ToolUseBlock` has this structure for NotebookEdit:

```typescript
interface NotebookEditInput {
  notebook_path: string;                        // Absolute path to .ipynb file
  new_source: string;                           // New cell source content
  cell_number?: number;                         // 0-indexed cell position (for insert/replace)
  cell_id?: string;                             // Unique cell ID (alternative to cell_number)
  cell_type?: "code" | "markdown";              // Cell type (required for insert)
  edit_mode?: "replace" | "insert" | "delete";  // Operation type (default: "replace")
}
```

### NotebookEdit Result Shape

The `content` field from `ToolResultBlockParam` is a string. For NotebookEdit, this is typically a plain text success/error message:

```typescript
// Success examples:
"Successfully replaced cell 3 in /path/to/notebook.ipynb"
"Successfully inserted new code cell at position 5"
"Successfully deleted cell at index 2"

// Error examples:
"Error: Cell index 10 out of range (notebook has 5 cells)"
"Error: Could not parse notebook file"
"Error: notebook_path is required"
```

**Note:** The result is always a plain string, not JSON. Parse it to extract relevant info for display.

---

## Design Specification

### First Line (Description Row)

The first line contains the description text with expand/collapse control:

- **Chevron:** `ExpandChevron` component (size="md") on the left for expand/collapse toggle
- **Text:** Operation description with `ShimmerText` (shimmers while `status === "running"`)
  - Format: `"Edit notebook"` or more specific like `"Replace cell 3"`
- **Duration:** Right-aligned, shown when complete (using `formatDuration`)
- **Status Icon:** `StatusIcon` component (isSuccess={false}) shown only on error

**Note:** The icon does NOT appear on the first line because the chevron occupies that position.

### Second Line (Command/Details Row)

The second line shows the command details with the tool icon:

- **Icon:** `NotebookPen` from lucide-react (w-3.5 h-3.5, text-zinc-500) - appears on this line only
- **Notebook path:** Filename only (e.g., `analysis.ipynb`)
- **Cell info:** Cell identifier and operation (e.g., `cell 3 (replaced)`)
- **Copy button:** `CopyButton` component to copy the full notebook path

**Layout:**
```
▼ Edit notebook                                           [45ms]
  📝 analysis.ipynb • cell 3 (replaced)                   [copy]
```

**Key Layout Rules:**
1. First line: Chevron + description text (with shimmer animation when running) + duration/status
2. Second line: Icon + command details (notebook path, cell info) + copy button
3. The chevron controls expand/collapse and only appears on the first line
4. The NotebookPen icon only appears on the second line where the command details are

### Expanded Content

When expanded, show the new source content that was written to the cell. Use `CollapsibleOutputBlock` for long content with gradient fade and expand/collapse button.

**Content Display (Not Raw JSON):**
- Show the cell type badge (Code/Markdown)
- Show cell index/ID
- Show the `new_source` content with proper formatting:
  - For code cells: monospace font, preserve whitespace
  - For markdown cells: monospace font, preserve whitespace
- Use syntax highlighting if content is long (via `CollapsibleOutputBlock`)

**Layout:**
```
▼ Edit notebook                                           [45ms]
  📝 analysis.ipynb • cell 3 (replaced)                   [copy]

  ┌─────────────────────────────────────────────────────────────┐
  │ Code Cell • Index 3                                  [copy] │
  │                                                             │
  │ import numpy as np                                          │
  │ import pandas as pd                                         │
  │                                                             │
  │ def calculate_mean(data):                                   │
  │     return np.mean(data)                                    │
  │                                                    [Expand] │
  └─────────────────────────────────────────────────────────────┘
```

**Note:** Unlike `BashToolBlock`, there's no need for a "Waiting for output" state since NotebookEdit is synchronous and typically fast.

---

## Reusable UI Components

Import all shared components from `@/components/ui/`:

### Component Usage Table

| Component | Import | Purpose | Usage in NotebookEdit |
|-----------|--------|---------|----------------------|
| `ExpandChevron` | `@/components/ui/expand-chevron` | Animated expand/collapse indicator | First line, left side (size="md") |
| `ShimmerText` | `@/components/ui/shimmer-text` | Loading animation for text | First line description text while `status === "running"` |
| `CopyButton` | `@/components/ui/copy-button` | Copy to clipboard with tooltip | Second line (notebook path), expanded content (cell source) |
| `StatusIcon` | `@/components/ui/status-icon` | Success/failure indicator | First line, shown when `isError === true` |
| `CollapsibleOutputBlock` | `@/components/ui/collapsible-output-block` | Long content with gradient fade | Expanded cell content section |
| `CollapsibleBlock` | `@/components/ui/collapsible-block` | Clickable header with expandable content | Optional: nested collapsible sections |

### Import Statement

```typescript
import { CopyButton } from "@/components/ui/copy-button";
import { ShimmerText } from "@/components/ui/shimmer-text";
import { ExpandChevron } from "@/components/ui/expand-chevron";
import { StatusIcon } from "@/components/ui/status-icon";
import { CollapsibleOutputBlock } from "@/components/ui/collapsible-output-block";
import { NotebookPen } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDuration } from "@/lib/utils/time-format";
import { useToolExpandStore } from "@/stores/tool-expand-store";
import type { ToolBlockProps } from "./index";
```

### Store Integration

Use Zustand store for expand state persistence (matches `BashToolBlock` pattern):

```typescript
// Main block expand state
const isExpanded = useToolExpandStore((state) =>
  state.isToolExpanded(threadId, id)
);
const setToolExpanded = useToolExpandStore((state) => state.setToolExpanded);
const setIsExpanded = (expanded: boolean) => setToolExpanded(threadId, id, expanded);

// Output expand state (for long cell content)
const isOutputExpanded = useToolExpandStore((state) =>
  state.isOutputExpanded(threadId, id, !isLongContent)
);
const setOutputExpanded = useToolExpandStore((state) => state.setOutputExpanded);
const setIsOutputExpanded = (expanded: boolean) => setOutputExpanded(threadId, id, expanded);
```

---

## Component Interface

The component receives `ToolBlockProps` from the registry (defined in `index.ts`):

```typescript
// From src/components/thread/tool-blocks/index.ts
interface ToolBlockProps {
  id: string;                        // From ToolUseBlock.id
  name: string;                      // "NotebookEdit"
  input: Record<string, unknown>;    // NotebookEditInput shape
  result?: string;                   // Plain text success/error message
  isError?: boolean;                 // From ToolResultBlockParam.is_error
  status: ToolStatus;                // "running" | "complete" | "error"
  durationMs?: number;               // Execution duration
  isFocused?: boolean;               // Keyboard navigation focus
  threadId: string;                  // For expand state persistence
}
```

---

## Implementation Structure

### File Location
```
src/components/thread/tool-blocks/notebook-edit-tool-block.tsx
```

### Registry Update

Add to `src/components/thread/tool-blocks/index.ts`:

```typescript
import { NotebookEditToolBlock } from "./notebook-edit-tool-block";

const TOOL_BLOCK_REGISTRY: Record<string, ToolBlockComponent> = {
  bash: BashToolBlock,
  notebookedit: NotebookEditToolBlock,  // Add this (lowercase for normalization)
};

export { BashToolBlock, NotebookEditToolBlock };
```

---

## Helper Functions

```typescript
/**
 * Parse and validate NotebookEdit input from the API.
 */
function parseNotebookInput(input: Record<string, unknown>): {
  notebookPath: string;
  newSource: string;
  cellNumber?: number;
  cellId?: string;
  cellType?: "code" | "markdown";
  editMode: "replace" | "insert" | "delete";
} {
  const notebookPath = typeof input.notebook_path === "string" ? input.notebook_path : "";
  const newSource = typeof input.new_source === "string" ? input.new_source : "";
  const cellNumber = typeof input.cell_number === "number" ? input.cell_number : undefined;
  const cellId = typeof input.cell_id === "string" ? input.cell_id : undefined;
  const cellType = input.cell_type === "code" || input.cell_type === "markdown"
    ? input.cell_type
    : undefined;
  const editMode = input.edit_mode === "insert" || input.edit_mode === "delete"
    ? input.edit_mode
    : "replace";

  return { notebookPath, newSource, cellNumber, cellId, cellType, editMode };
}

/**
 * Parse the result string to extract success/failure info.
 * Result is always a plain string, not JSON.
 */
function parseNotebookResult(result: string | undefined): {
  isSuccess: boolean;
  message: string;
} {
  if (!result) {
    return { isSuccess: true, message: "" };
  }

  const isError = result.toLowerCase().startsWith("error");
  return {
    isSuccess: !isError,
    message: result,
  };
}

/**
 * Format edit mode for display.
 */
function formatEditMode(mode: "replace" | "insert" | "delete"): string {
  const labels: Record<string, string> = {
    replace: "replaced",
    insert: "inserted",
    delete: "deleted",
  };
  return labels[mode] ?? mode;
}

/**
 * Format cell identifier for display.
 */
function formatCellIdentifier(cellNumber?: number, cellId?: string): string {
  if (cellNumber !== undefined) {
    return `cell ${cellNumber}`;
  }
  if (cellId) {
    return `cell ${cellId}`;
  }
  return "cell";
}

/**
 * Extract filename from path.
 */
function getFilename(path: string): string {
  return path.split("/").pop() ?? path;
}

/**
 * Check if content is long enough to warrant collapse.
 */
const LINE_COLLAPSE_THRESHOLD = 15;
const MAX_COLLAPSED_HEIGHT = 300;

function isContentLong(content: string): boolean {
  return content.split("\n").length > LINE_COLLAPSE_THRESHOLD;
}
```

---

## Component Implementation

```typescript
export function NotebookEditToolBlock({
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
  // Parse input and result
  const { notebookPath, newSource, cellNumber, cellId, cellType, editMode } =
    parseNotebookInput(input);
  const { message: resultMessage } = parseNotebookResult(result);

  // Expand state from store
  const isExpanded = useToolExpandStore((state) => state.isToolExpanded(threadId, id));
  const setToolExpanded = useToolExpandStore((state) => state.setToolExpanded);
  const setIsExpanded = (expanded: boolean) => setToolExpanded(threadId, id, expanded);

  // Output expand state for long content
  const isLongContent = isContentLong(newSource);
  const defaultOutputExpanded = !isLongContent;
  const isOutputExpanded = useToolExpandStore((state) =>
    state.isOutputExpanded(threadId, id, defaultOutputExpanded)
  );
  const setOutputExpanded = useToolExpandStore((state) => state.setOutputExpanded);
  const setIsOutputExpanded = (expanded: boolean) => setOutputExpanded(threadId, id, expanded);

  const isRunning = status === "running";
  const filename = getFilename(notebookPath);
  const cellIdentifier = formatCellIdentifier(cellNumber, cellId);
  const editModeLabel = formatEditMode(editMode);

  return (
    <div
      className="group py-0.5"
      aria-label={`Edit notebook: ${notebookPath}, status: ${status}`}
      data-testid={`notebook-edit-tool-${id}`}
      data-tool-status={status}
    >
      {/* First Line: Description Row (with chevron for expand/collapse) */}
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
        <div className="flex items-center gap-2">
          <ExpandChevron isExpanded={isExpanded} size="md" />
          <ShimmerText
            isShimmering={isRunning}
            className="text-sm text-zinc-200 truncate min-w-0"
          >
            Edit notebook
          </ShimmerText>

          {/* Error indicator */}
          {!isRunning && isError && <StatusIcon isSuccess={false} />}

          {/* Duration - right justified */}
          <span className="flex items-center gap-2 shrink-0 ml-auto">
            {durationMs !== undefined && !isRunning && (
              <span className="text-xs text-muted-foreground">
                {formatDuration(durationMs)}
              </span>
            )}
          </span>
        </div>

        {/* Second Line: Command/Details Row (with icon) */}
        <div className="flex items-center gap-1 mt-0.5 pl-5">
          <NotebookPen className="w-3.5 h-3.5 text-zinc-500 shrink-0" />
          <code className="text-xs font-mono text-zinc-500 flex items-center gap-1 min-w-0 flex-1">
            <span className="truncate">{filename}</span>
            <span className="text-zinc-600">•</span>
            <span className="truncate">
              {cellIdentifier} ({editModeLabel})
            </span>
          </code>
          <CopyButton text={notebookPath} label="Copy notebook path" alwaysVisible />
        </div>
      </div>

      {/* Expanded Content */}
      {isExpanded && newSource && (
        <div className="relative mt-2">
          {/* Cell type badge and copy button */}
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs text-zinc-500">
              {cellType === "markdown" ? "Markdown" : "Code"} Cell
              {cellNumber !== undefined && ` • Index ${cellNumber}`}
            </span>
            <CopyButton text={newSource} label="Copy cell content" />
          </div>

          <CollapsibleOutputBlock
            isExpanded={isOutputExpanded}
            onToggle={() => setIsOutputExpanded(!isOutputExpanded)}
            isLongContent={isLongContent}
            maxCollapsedHeight={MAX_COLLAPSED_HEIGHT}
            variant={isError ? "error" : "default"}
          >
            <pre
              className={cn(
                "text-xs font-mono p-2",
                "whitespace-pre-wrap break-words",
                isError ? "text-red-200" : "text-zinc-300"
              )}
            >
              <code>{newSource}</code>
            </pre>
          </CollapsibleOutputBlock>

          {/* Result message (if error or notable) */}
          {isError && resultMessage && (
            <span className="text-xs text-red-400 mt-1 block">
              {resultMessage}
            </span>
          )}
        </div>
      )}

      {/* Expanded but delete operation (no content to show) */}
      {isExpanded && editMode === "delete" && (
        <div className="mt-2 ml-6">
          <div className="text-xs font-mono p-2 rounded border border-zinc-700/50 text-zinc-500">
            Cell deleted
          </div>
        </div>
      )}

      {/* Screen reader status */}
      <span className="sr-only">
        {isRunning
          ? "Editing notebook"
          : isError
            ? "Notebook edit failed"
            : "Notebook edit completed successfully"}
      </span>
    </div>
  );
}
```

---

## Styling Conventions

Follow `BashToolBlock` patterns exactly:

**Container:**
```tsx
<div className="group py-0.5" aria-label="..." data-testid="..." data-tool-status={status}>
```

**First line (description with chevron):**
```tsx
<div className="cursor-pointer select-none">
  <div className="flex items-center gap-2">
    {/* ExpandChevron, ShimmerText, StatusIcon, Duration */}
    {/* NOTE: Icon does NOT appear here - chevron is the left element */}
  </div>
</div>
```

**Second line (command details with icon):**
```tsx
<div className="flex items-center gap-1 mt-0.5 pl-5">
  {/* Icon appears HERE on the second line */}
  <NotebookPen className="w-3.5 h-3.5 text-zinc-500 shrink-0" />
  <code className="text-xs font-mono text-zinc-500 flex items-center gap-1 min-w-0 flex-1">
    {/* Filename • Cell info */}
  </code>
  <CopyButton text={...} label="..." alwaysVisible />
</div>
```

**Expanded content:**
```tsx
<div className="relative mt-2">
  <CollapsibleOutputBlock ...>
    <pre className={cn("text-xs font-mono p-2", "whitespace-pre-wrap break-words", ...)}>
      <code>{content}</code>
    </pre>
  </CollapsibleOutputBlock>
</div>
```

---

## Example Renderings

### Collapsed (Success - Replace)
```
▼ Edit notebook                                           [45ms]
  📝 analysis.ipynb • cell 3 (replaced)                   [copy]
```

### Collapsed (Success - Insert)
```
▼ Edit notebook                                           [32ms]
  📝 data_processing.ipynb • cell 5 (inserted)            [copy]
```

### Expanded (Success)
```
▼ Edit notebook                                           [45ms]
  📝 analysis.ipynb • cell 3 (replaced)                   [copy]

  Code Cell • Index 3                                     [copy]
  ┌─────────────────────────────────────────────────────────────┐
  │ import numpy as np                                          │
  │ import pandas as pd                                         │
  │                                                             │
  │ def calculate_mean(data):                                   │
  │     """Calculate the mean of a dataset."""                  │
  │     return np.mean(data)                                    │
  │                                                             │
  │ def calculate_std(data):                                    │
  │     """Calculate standard deviation."""                     │
  │     return np.std(data)                                     │
  │                                                    [Expand] │
  └─────────────────────────────────────────────────────────────┘
```

### Collapsed (Error)
```
▶ Edit notebook                                      ✕    [12ms]
  📝 analysis.ipynb • cell 10 (replaced)                  [copy]
```

### Expanded (Error)
```
▼ Edit notebook                                      ✕    [12ms]
  📝 analysis.ipynb • cell 10 (replaced)                  [copy]

  Code Cell • Index 10                                    [copy]
  ┌─────────────────────────────────────────────────────────────┐
  │ print("test")                                               │
  └─────────────────────────────────────────────────────────────┘

  Error: Cell index 10 out of range (notebook has 5 cells)
```

### Running State
```
▶ Edit notebook ~~~
  📝 analysis.ipynb • cell 3 (replaced)                   [copy]
```

**Note on layout:** The chevron (▼/▶) appears on the first line with the description text. The icon (📝) appears on the second line with the command details. This ensures the first line has the expand/collapse control while the second line displays the contextual information with its associated icon.

---

## Implementation Checklist

### Phase 1: Basic Structure
- [ ] Create `notebook-edit-tool-block.tsx` file
- [ ] Add imports for all reusable UI components
- [ ] Define helper functions (parseNotebookInput, parseNotebookResult, etc.)
- [ ] Implement basic component structure matching BashToolBlock pattern
- [ ] Add to tool registry in `index.ts` (key: "notebookedit")

### Phase 2: First Line (Description Row)
- [ ] ExpandChevron (size="md") on left - controls expand/collapse
- [ ] ShimmerText with "Edit notebook" (isShimmering={status === "running"})
- [ ] StatusIcon for errors (isSuccess={false}, only when isError)
- [ ] Duration display (right-aligned, formatDuration)
- [ ] NOTE: Icon does NOT appear on first line (chevron is the left element)

### Phase 3: Second Line (Command/Details Row)
- [ ] NotebookPen icon (w-3.5 h-3.5 text-zinc-500) - appears on this line only
- [ ] Display filename (extracted from notebookPath)
- [ ] Display cell identifier and edit mode
- [ ] CopyButton for full notebook path (alwaysVisible)
- [ ] Proper styling matching BashToolBlock
- [ ] Left padding (pl-5) to align with first line content

### Phase 4: Expanded Content
- [ ] Cell type badge ("Code Cell" / "Markdown Cell")
- [ ] Cell index display
- [ ] CopyButton for cell content
- [ ] CollapsibleOutputBlock for cell source
- [ ] Pre/code tags with proper styling
- [ ] Error message display (if applicable)
- [ ] Special handling for delete operations

### Phase 5: State Management
- [ ] Integrate with useToolExpandStore for main expand state
- [ ] Integrate with useToolExpandStore for output expand state
- [ ] Proper default values based on content length

### Phase 6: Accessibility & Polish
- [ ] aria-label on container
- [ ] role="button" and aria-expanded on header
- [ ] Keyboard navigation (Enter/Space to toggle)
- [ ] Screen reader status text
- [ ] data-testid for testing
- [ ] data-tool-status for styling hooks

---

## Testing Strategy

### Unit Tests

```typescript
describe("NotebookEditToolBlock", () => {
  it("renders header with NotebookPen icon and 'Edit notebook' text", () => {
    // Verify icon, text, and layout
  });

  it("displays filename and cell info on second line", () => {
    // Verify: analysis.ipynb • cell 3 (replaced)
  });

  it("shows CopyButton that copies full notebook path", () => {
    // Verify copy functionality
  });

  it("toggles expand state on header click", () => {
    // Verify expanded content appears
  });

  it("persists expand state via Zustand store", () => {
    // Verify state survives remount (virtualization)
  });

  it("shows cell content in expanded view (not raw JSON)", () => {
    // Verify newSource is displayed, not JSON
  });

  it("uses CollapsibleOutputBlock for long content", () => {
    // Verify gradient fade and expand button
  });

  it("displays error state with StatusIcon and message", () => {
    // Verify red X icon and error text
  });

  it("handles delete operations (no content to display)", () => {
    // Verify "Cell deleted" message
  });

  it("supports keyboard navigation (Enter/Space)", () => {
    // Verify toggle on keyboard events
  });

  it("shows ShimmerText animation while running", () => {
    // Verify shimmer class applied
  });
});
```

---

## Edge Cases

1. **Missing notebook_path:** Display "Unknown notebook" fallback
2. **Missing cell_number and cell_id:** Display "cell" without identifier
3. **Empty new_source:** Show "Empty cell content" message
4. **Very long cell content:** Use CollapsibleOutputBlock with 300px max height
5. **Special characters in path:** Display as-is, ensure proper escaping in copy
6. **Delete operation:** Show "Cell deleted" instead of content preview
7. **Result is error:** Parse "Error:" prefix and display message

---

## Related Files

- **Main plan:** `/Users/zac/Documents/juice/anvil/anvil/plans/tool-result-rendering-overhaul.md`
- **BashToolBlock reference:** `/Users/zac/Documents/juice/anvil/anvil/src/components/thread/tool-blocks/bash-tool-block.tsx`
- **Reusable UI components:** `/Users/zac/Documents/juice/anvil/anvil/src/components/ui/`
- **Tool block registry:** `/Users/zac/Documents/juice/anvil/anvil/src/components/thread/tool-blocks/index.ts`
- **Expand state store:** `/Users/zac/Documents/juice/anvil/anvil/src/stores/tool-expand-store.ts`

---

## Success Criteria

1. First line displays chevron, "Edit notebook" description text (with shimmer when running), and duration
2. Second line shows NotebookPen icon, notebook filename, and cell info with copy button
3. Icon appears ONLY on the second line (first line has chevron for expand/collapse)
4. Expanded content shows cell source (not raw JSON) with proper formatting
5. Uses `CollapsibleOutputBlock` for long content with gradient fade
6. Error states displayed with `StatusIcon` and error message
7. Expand/collapse state persists via Zustand store
8. Full keyboard navigation support (Enter/Space, Tab)
9. All accessibility ARIA labels and roles present
10. Consistent styling with BashToolBlock conventions
11. All reusable UI components used correctly (ExpandChevron, ShimmerText, CopyButton, StatusIcon, CollapsibleOutputBlock)
12. No raw JSON displayed to users
13. Proper handling of all edit modes (replace, insert, delete)
