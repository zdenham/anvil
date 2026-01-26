# WriteToolBlock Implementation Plan

## Overview

This plan details the implementation of the `WriteToolBlock` component, following the BashToolBlock UI conventions and patterns established during the tool result rendering overhaul.

The Write tool creates or overwrites files. The block should display the file path being written and allow expansion to view the diff showing all new content as additions.

---

## Anthropic API Types

The Write tool receives and returns data conforming to Anthropic SDK types.

### Tool Use Block (Input)

From `@anthropic-ai/sdk/resources/messages`:

```typescript
// Anthropic.ToolUseBlock - the tool_use content block from assistant messages
interface ToolUseBlock {
  id: string;        // Unique tool use ID (e.g., "toolu_01ABC123...")
  input: unknown;    // Tool-specific input (we cast to WriteInput)
  name: string;      // "Write"
  type: 'tool_use';
}
```

### Tool Result Block (Output)

From `@anthropic-ai/sdk/resources/messages`:

```typescript
// Anthropic.ToolResultBlockParam - the tool_result we send back in user messages
interface ToolResultBlockParam {
  tool_use_id: string;                                    // Matches ToolUseBlock.id
  type: 'tool_result';
  content?: string | Array<TextBlockParam | ImageBlockParam>;  // Result content
  is_error?: boolean;                                     // Whether execution failed
  cache_control?: CacheControlEphemeral | null;
}
```

### Write Tool Input Shape

The `input` field from `ToolUseBlock` for the Write tool:

```typescript
interface WriteInput {
  file_path: string;  // Absolute or relative path to the file being written
  content: string;    // The full file content being written
}
```

### Write Tool Result Shape

The `content` field from `ToolResultBlockParam` is a JSON string with this shape (defined by our agent, not Anthropic):

```typescript
interface WriteToolResult {
  filePath: string;                   // Path to the written file
  diff: string;                       // Unified diff showing changes
  operation: "create" | "modify";     // Whether this was a new file or overwrite
}
```

**Note:** The result is JSON-stringified. When `is_error` is true, the `content` field contains a plain error message string instead of JSON.

---

## Reusable UI Components

All components are imported from `@/components/ui/`. Use them exactly as BashToolBlock does for visual consistency.

### 1. ExpandChevron

**Import:** `import { ExpandChevron } from "@/components/ui/expand-chevron"`

**Props:**
- `isExpanded: boolean` - Current expand state
- `size?: "sm" | "md"` - Icon size variant (default: "md")
- `className?: string` - Additional styling

**Usage in WriteToolBlock:**
```tsx
// Header row - use "md" size when description present
<ExpandChevron isExpanded={isExpanded} size="md" />

// Nested file diffs - use "sm" size
<ExpandChevron isExpanded={isFileDiffExpanded} size="sm" />
```

### 2. ShimmerText

**Import:** `import { ShimmerText } from "@/components/ui/shimmer-text"`

**Props:**
- `isShimmering: boolean` - Whether to animate (typically `status === "running"`)
- `className?: string` - Text styling
- `as?: "span" | "div" | "p"` - HTML element (default: "span")
- `children: ReactNode` - Text content

**Usage in WriteToolBlock:**
```tsx
<ShimmerText
  isShimmering={status === "running"}
  className="text-sm text-zinc-200 truncate"
>
  Writing file
</ShimmerText>
```

### 3. CopyButton

**Import:** `import { CopyButton } from "@/components/ui/copy-button"`

**Props:**
- `text: string` - Text to copy to clipboard
- `label?: string` - Tooltip label (default: "Copy")
- `alwaysVisible?: boolean` - Show always vs only on hover (default: false)
- `className?: string` - Additional styling

**Usage in WriteToolBlock:**
```tsx
// Copy file path (always visible like BashToolBlock)
<CopyButton text={filePath} label="Copy file path" alwaysVisible />

// Copy diff content (in expanded section)
<CopyButton text={diffContent} label="Copy diff" />
```

### 4. StatusIcon

**Import:** `import { StatusIcon } from "@/components/ui/status-icon"`

**Props:**
- `isSuccess: boolean` - Show checkmark (true) or X (false)
- `size?: "sm" | "md" | "lg"` - Icon size (default: "md")
- `className?: string` - Additional styling

**Usage in WriteToolBlock:**
```tsx
// Only show on error, matching BashToolBlock pattern
{!isRunning && isError && <StatusIcon isSuccess={false} />}
```

### 5. CollapsibleOutputBlock

**Import:** `import { CollapsibleOutputBlock } from "@/components/ui/collapsible-output-block"`

**Props:**
- `isExpanded: boolean` - Current expand state
- `onToggle: () => void` - Toggle callback
- `isLongContent: boolean` - Whether to show gradient overlay when collapsed
- `maxCollapsedHeight?: number` - Max height in px when collapsed (default: 300)
- `variant?: "default" | "error"` - Border color variant
- `className?: string` - Additional styling
- `children: ReactNode` - Content to display

**Usage in WriteToolBlock:**
```tsx
// Wrap diff display for long diffs
<CollapsibleOutputBlock
  isExpanded={isDiffExpanded}
  onToggle={() => setIsDiffExpanded(!isDiffExpanded)}
  isLongContent={diffLines.length > LINE_COLLAPSE_THRESHOLD}
  maxCollapsedHeight={MAX_COLLAPSED_HEIGHT}
  variant={isError ? "error" : "default"}
>
  <InlineDiffBlock ... />
</CollapsibleOutputBlock>
```

### 6. CollapsibleBlock

**Import:** `import { CollapsibleBlock } from "@/components/ui/collapsible-block"`

**Props:**
- `isExpanded: boolean` - Current expand state
- `onToggle: () => void` - Toggle callback
- `header: ReactNode` - Always-visible header content
- `children: ReactNode` - Expandable content
- `testId?: string` - Test ID for container
- `ariaLabel?: string` - Accessibility label
- `className?: string` - Container styling
- `headerClassName?: string` - Header styling

**Usage in WriteToolBlock:** Not used directly since we implement custom click handling like BashToolBlock. However, if implementing nested collapsible sections (e.g., per-file diffs when multiple files are supported), use this component.

---

## Props Interface

Extends `ToolBlockProps` from `@/components/thread/tool-blocks/index`:

```typescript
interface ToolBlockProps {
  id: string;                      // From ToolUseBlock.id
  name: string;                    // "Write" from ToolUseBlock.name
  input: Record<string, unknown>;  // WriteInput (file_path, content)
  result?: string;                 // JSON-stringified WriteToolResult
  isError?: boolean;               // From ToolResultBlockParam.is_error
  status: ToolStatus;              // "pending" | "running" | "complete" | "error"
  durationMs?: number;             // Execution duration in milliseconds
  isFocused?: boolean;             // For keyboard navigation
  threadId: string;                // For persisting expand state
}
```

---

## UI Layout

The block uses a two-line layout:
- **First line**: Chevron + description text (with shimmer animation when running). The chevron controls expand/collapse. No icon on this line.
- **Second line**: Icon + file path + copy button. The icon appears here since the first line has the chevron.

### First Line - Description (Always Visible)

```
[ExpandChevron] "Write file" / "Writing file" (shimmer)  [StatusIcon if error] [duration]
```

The chevron is the leftmost element and controls expand/collapse. The description text shows "Writing file" with shimmer animation during running state, or "Write file" when complete.

**Implementation:**
```tsx
<div className="flex items-center gap-2">
  <ExpandChevron isExpanded={isExpanded} size="md" />
  <ShimmerText
    isShimmering={status === "running"}
    className="text-sm text-zinc-200 truncate min-w-0"
  >
    {status === "running" ? "Writing file" : "Write file"}
  </ShimmerText>

  {/* Error indicator */}
  {!isRunning && isError && <StatusIcon isSuccess={false} />}

  {/* Duration - right justified */}
  <span className="ml-auto shrink-0">
    {durationMs !== undefined && !isRunning && (
      <span className="text-xs text-muted-foreground">
        {formatDuration(durationMs)}
      </span>
    )}
  </span>
</div>
```

### Second Line - File Path (Always Visible)

Displays the file path with the FilePlus icon. The icon appears on this line (not the first line) because the first line has the chevron:

```
[FilePlus icon] src/components/NewComponent.tsx  [CopyButton]
```

**Implementation:**
```tsx
<div className="flex items-center gap-1 mt-0.5 ml-6">
  <code className="text-xs font-mono text-zinc-500 flex items-center gap-1 min-w-0 flex-1">
    <FilePlus className="w-3 h-3 text-zinc-500/60 shrink-0" />
    <span className="truncate">{filePath}</span>
  </code>
  <CopyButton text={filePath} label="Copy file path" alwaysVisible />
</div>
```

Note: The `ml-6` aligns the second line content with the first line text (accounting for chevron width).

### Expanded Content Section

When `isExpanded === true`, display the diff with proper formatting:

**For successful writes - show inline diff:**
```tsx
{isExpanded && diffData && (
  <div className="relative mt-2">
    <div className="absolute top-1 right-1 z-10">
      <CopyButton text={diffContent} label="Copy diff" />
    </div>
    <CollapsibleOutputBlock
      isExpanded={isDiffOutputExpanded}
      onToggle={() => setDiffOutputExpanded(!isDiffOutputExpanded)}
      isLongContent={isLongDiff}
      maxCollapsedHeight={MAX_COLLAPSED_HEIGHT}
    >
      <InlineDiffBlock
        filePath={diffData.filePath}
        diff={diffData.diff}
        lines={diffData.lines}
        stats={diffData.stats}
      />
    </CollapsibleOutputBlock>
  </div>
)}
```

**For errors - show formatted error message:**
```tsx
{isExpanded && isError && (
  <div className="mt-2">
    <CollapsibleOutputBlock
      isExpanded={true}
      onToggle={() => {}}
      isLongContent={false}
      variant="error"
    >
      <pre className="text-xs font-mono p-2 text-red-200 whitespace-pre-wrap break-words">
        <code>{errorMessage}</code>
      </pre>
    </CollapsibleOutputBlock>
  </div>
)}
```

**For running state without output:**
```tsx
{isExpanded && !diffData && isRunning && (
  <div className="mt-2 ml-6">
    <div className="text-xs font-mono p-2 rounded border border-zinc-700/50 text-zinc-500">
      Writing file...
      <span className="inline-block w-2 h-4 bg-zinc-400 animate-pulse ml-1" />
    </div>
  </div>
)}
```

---

## Result Parsing (No Raw JSON Display)

Parse the result string and extract structured data. Never display raw JSON to users.

```typescript
const LINE_COLLAPSE_THRESHOLD = 20;
const MAX_COLLAPSED_HEIGHT = 300;

interface ParsedWriteResult {
  filePath: string;
  diff: string;
  operation: "create" | "modify";
}

/**
 * Parse Write tool result from JSON string.
 * Returns null if parsing fails or result is an error.
 */
function parseWriteResult(
  result: string | undefined,
  isError: boolean
): ParsedWriteResult | null {
  if (!result || isError) return null;

  try {
    const parsed = JSON.parse(result);
    // Validate required fields (defensive - data comes from agent)
    if (
      typeof parsed.filePath === "string" &&
      typeof parsed.diff === "string" &&
      (parsed.operation === "create" || parsed.operation === "modify")
    ) {
      return {
        filePath: parsed.filePath,
        diff: parsed.diff,
        operation: parsed.operation,
      };
    }
  } catch {
    // Not valid JSON - likely error message
  }
  return null;
}

/**
 * Extract error message from result when isError is true.
 */
function extractErrorMessage(result: string | undefined): string {
  if (!result) return "Unknown error";

  // Result might be plain text error message or JSON with error field
  try {
    const parsed = JSON.parse(result);
    return parsed.error ?? parsed.message ?? result;
  } catch {
    return result;  // Plain text error
  }
}
```

---

## Expand State Management

Use `useToolExpandStore` (Zustand) to persist state across virtualization remounts, matching BashToolBlock:

```typescript
// Main block expand state
const isExpanded = useToolExpandStore(
  (state) => state.isToolExpanded(threadId, id)
);
const setToolExpanded = useToolExpandStore((state) => state.setToolExpanded);
const setIsExpanded = (expanded: boolean) => setToolExpanded(threadId, id, expanded);

// Output collapse state (for long diffs)
const isLongDiff = diffLines.length > LINE_COLLAPSE_THRESHOLD;
const defaultOutputExpanded = !isLongDiff;
const isDiffOutputExpanded = useToolExpandStore((state) =>
  state.isOutputExpanded(threadId, id, defaultOutputExpanded)
);
const setOutputExpanded = useToolExpandStore((state) => state.setOutputExpanded);
const setDiffOutputExpanded = (expanded: boolean) => setOutputExpanded(threadId, id, expanded);
```

---

## Component Implementation

### File Location

`/Users/zac/Documents/juice/mort/mortician/src/components/thread/tool-blocks/write-tool-block.tsx`

### Complete Implementation Structure

```tsx
import { cn } from "@/lib/utils";
import { formatDuration } from "@/lib/utils/time-format";
import { useToolExpandStore } from "@/stores/tool-expand-store";
import { CopyButton } from "@/components/ui/copy-button";
import { ShimmerText } from "@/components/ui/shimmer-text";
import { ExpandChevron } from "@/components/ui/expand-chevron";
import { StatusIcon } from "@/components/ui/status-icon";
import { CollapsibleOutputBlock } from "@/components/ui/collapsible-output-block";
import { InlineDiffBlock } from "../inline-diff-block";
import { useToolDiff } from "../use-tool-diff";
import { FilePlus } from "lucide-react";
import type { ToolBlockProps } from "./index";

interface WriteInput {
  file_path: string;
  content: string;
}

const LINE_COLLAPSE_THRESHOLD = 20;
const MAX_COLLAPSED_HEIGHT = 300;

export function WriteToolBlock({
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
  // Expand state from Zustand store
  const isExpanded = useToolExpandStore((state) => state.isToolExpanded(threadId, id));
  const setToolExpanded = useToolExpandStore((state) => state.setToolExpanded);
  const setIsExpanded = (expanded: boolean) => setToolExpanded(threadId, id, expanded);

  // Parse input
  const writeInput = input as unknown as WriteInput;
  const filePath = writeInput.file_path || "";

  // Get diff data (from result or generated from input)
  const diffData = useToolDiff("Write", input, result);

  // Output expand state for long diffs
  const isLongDiff = (diffData?.lines?.length ?? 0) > LINE_COLLAPSE_THRESHOLD;
  const defaultOutputExpanded = !isLongDiff;
  const isDiffOutputExpanded = useToolExpandStore((state) =>
    state.isOutputExpanded(threadId, id, defaultOutputExpanded)
  );
  const setOutputExpanded = useToolExpandStore((state) => state.setOutputExpanded);
  const setDiffOutputExpanded = (expanded: boolean) => setOutputExpanded(threadId, id, expanded);

  // Extract error message if needed
  const errorMessage = isError ? extractErrorMessage(result) : null;

  const isRunning = status === "running";
  const hasDiff = diffData !== null;

  return (
    <div
      className="group py-0.5"
      aria-label={`Write file: ${filePath}, status: ${status}`}
      data-testid={`write-tool-${id}`}
      data-tool-status={status}
    >
      {/* Clickable header */}
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
        {/* First line: Chevron + description text (shimmer when running) */}
        {/* No icon on this line - the chevron controls expand/collapse */}
        <div className="flex items-center gap-2">
          <ExpandChevron isExpanded={isExpanded} size="md" />
          <ShimmerText
            isShimmering={isRunning}
            className="text-sm text-zinc-200 truncate min-w-0"
          >
            {isRunning ? "Writing file" : "Write file"}
          </ShimmerText>

          {/* Error indicator */}
          {!isRunning && isError && <StatusIcon isSuccess={false} />}

          {/* Duration - right justified */}
          <span className="ml-auto shrink-0">
            {durationMs !== undefined && !isRunning && (
              <span className="text-xs text-muted-foreground">
                {formatDuration(durationMs)}
              </span>
            )}
          </span>
        </div>

        {/* Second line: Icon + file path */}
        {/* Icon appears here (not first line) since chevron is on first line */}
        <div className="flex items-center gap-1 mt-0.5 ml-6">
          <code className="text-xs font-mono text-zinc-500 flex items-center gap-1 min-w-0 flex-1">
            <FilePlus className="w-3 h-3 text-zinc-500/60 shrink-0" />
            <span className="truncate">{filePath}</span>
          </code>
          <CopyButton text={filePath} label="Copy file path" alwaysVisible />
        </div>
      </div>

      {/* Expanded diff */}
      {isExpanded && hasDiff && (
        <div className="relative mt-2">
          <CollapsibleOutputBlock
            isExpanded={isDiffOutputExpanded}
            onToggle={() => setDiffOutputExpanded(!isDiffOutputExpanded)}
            isLongContent={isLongDiff}
            maxCollapsedHeight={MAX_COLLAPSED_HEIGHT}
          >
            <InlineDiffBlock
              filePath={diffData.filePath}
              diff={diffData.diff}
              lines={diffData.lines}
              stats={diffData.stats}
            />
          </CollapsibleOutputBlock>
        </div>
      )}

      {/* Expanded error */}
      {isExpanded && isError && errorMessage && (
        <div className="mt-2">
          <CollapsibleOutputBlock
            isExpanded={true}
            onToggle={() => {}}
            isLongContent={false}
            variant="error"
          >
            <pre className="text-xs font-mono p-2 text-red-200 whitespace-pre-wrap break-words">
              <code>{errorMessage}</code>
            </pre>
          </CollapsibleOutputBlock>
        </div>
      )}

      {/* Running state without output */}
      {isExpanded && !hasDiff && !isError && isRunning && (
        <div className="mt-2 ml-6">
          <div className="text-xs font-mono p-2 rounded border border-zinc-700/50 text-zinc-500">
            Writing file...
            <span className="inline-block w-2 h-4 bg-zinc-400 animate-pulse ml-1" />
          </div>
        </div>
      )}

      {/* Screen reader status */}
      <span className="sr-only">
        {isRunning
          ? "Writing file in progress"
          : isError
            ? "Write failed"
            : "Write completed successfully"}
      </span>
    </div>
  );
}

function extractErrorMessage(result: string | undefined): string {
  if (!result) return "Unknown error";
  try {
    const parsed = JSON.parse(result);
    return parsed.error ?? parsed.message ?? result;
  } catch {
    return result;
  }
}
```

---

## Registration

Update `/Users/zac/Documents/juice/mort/mortician/src/components/thread/tool-blocks/index.ts`:

```typescript
import { WriteToolBlock } from "./write-tool-block";

const TOOL_BLOCK_REGISTRY: Record<string, ToolBlockComponent> = {
  bash: BashToolBlock,
  write: WriteToolBlock,
};

export { BashToolBlock, WriteToolBlock };
```

---

## Testing

Create tests at `/Users/zac/Documents/juice/mort/mortician/src/components/thread/tool-blocks/write-tool-block.test.tsx`:

**Test cases:**
1. Renders "Write file" header with FilePlus icon
2. Shows file path in second line with copy button
3. Header shows "Writing file" with shimmer during running state
4. Expand/collapse functionality works via click and keyboard (Enter/Space)
5. Displays inline diff with proper formatting when expanded
6. Shows correct addition/deletion stats in diff
7. Handles error state with StatusIcon and error message display
8. Does not display raw JSON anywhere
9. Copy button copies file path correctly
10. Handles long file paths (truncation)
11. Handles empty content gracefully
12. Expand state persists across virtualization remounts
13. Long diffs use CollapsibleOutputBlock with gradient overlay
14. Duration displays when complete (not during running)
15. Screen reader text announces correct status

---

## Visual Consistency Checklist

Match BashToolBlock patterns exactly:

- [ ] Two-line layout:
  - First line: Chevron + description text (shimmer when running) + error indicator + duration
  - Second line: Icon + file path + copy button (indented with ml-6 to align with first line text)
- [ ] First line has chevron (controls expand/collapse), NO icon
- [ ] Second line has the FilePlus icon (since first line has the chevron)
- [ ] Icons: lucide-react, small (w-3 h-3 on second line), muted zinc-500/60 color
- [ ] Text sizing: First line text-sm, second line text-xs font-mono
- [ ] Spacing: gap-2 between elements, mt-2 for expanded content, mt-0.5 for second line
- [ ] Colors: First line text-zinc-200, second line text-zinc-500, errors text-red-200
- [ ] Expand chevron placement: leftmost on first line, using ExpandChevron component
- [ ] Copy button: alwaysVisible on second line
- [ ] Duration: text-xs text-muted-foreground, right-justified on first line, hidden during running
- [ ] Error indicator: StatusIcon on first line (right side), only shown on error

---

## Dependencies

**Existing components to import:**
- `@/components/ui/copy-button`
- `@/components/ui/shimmer-text`
- `@/components/ui/expand-chevron`
- `@/components/ui/status-icon`
- `@/components/ui/collapsible-output-block`
- `@/components/thread/inline-diff-block`
- `@/components/thread/use-tool-diff`
- `@/stores/tool-expand-store`
- `@/lib/utils/time-format`
- `lucide-react` (FilePlus icon)

**No new components needed** - all building blocks exist.

---

## Success Criteria

1. Component renders with header and file path matching BashToolBlock style
2. All reusable UI components used correctly (ExpandChevron, ShimmerText, CopyButton, StatusIcon, CollapsibleOutputBlock)
3. No raw JSON displayed anywhere - all data properly formatted
4. Diff displays with InlineDiffBlock showing additions in green
5. Handles all states: pending, running, complete, error
6. Expand state persists via Zustand store
7. Keyboard navigation works (Enter/Space to toggle)
8. ARIA attributes present for accessibility
9. Visual consistency with BashToolBlock verified
10. Tests pass with good coverage
