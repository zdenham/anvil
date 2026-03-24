# ReadToolBlock Implementation Plan

## Overview

Implement a specialized `ReadToolBlock` component that renders file read operations in a clean, focused manner. This follows the BashToolBlock UI conventions established in Phase 1 of the Tool Result Rendering Overhaul.

## Anthropic API Types Reference

The Read tool uses standard Anthropic tool call/result types from `@anthropic-ai/sdk`:

**Tool Use (Input) - `Anthropic.ToolUseBlock`:**
```typescript
interface ToolUseBlock {
  id: string;           // Unique tool use ID (e.g., "toolu_01ABC...")
  input: unknown;       // Tool-specific input object
  name: string;         // "Read" for this tool
  type: 'tool_use';
}
```

**Tool Result (Output) - `Anthropic.ToolResultBlockParam`:**
```typescript
interface ToolResultBlockParam {
  tool_use_id: string;                              // References the ToolUseBlock.id
  type: 'tool_result';
  content?: string | Array<TextBlockParam | ImageBlockParam>;  // Result content
  is_error?: boolean;                               // True if tool execution failed
  cache_control?: CacheControlEphemeral | null;
}
```

**Read Tool Input Shape (Claude Code specific):**
```typescript
interface ReadInput {
  file_path: string;    // Absolute path to file being read
  offset?: number;      // Optional: line number to start reading from
  limit?: number;       // Optional: number of lines to read
}
```

**Read Tool Result Shape:**
The `result` string in `ToolBlockProps` is the raw file content that was read. Unlike Bash which returns structured JSON with stdout/stderr, the Read tool returns:
- **Success:** Plain text file contents (possibly truncated with line numbers)
- **Error:** Error message string describing why the read failed

Note: We intentionally do NOT display file contents in the UI. The result is available for copying but not rendered inline.

## Design Specification

### Two-Line Layout

**First line (always visible) - Description line:**
- `ExpandChevron` - Expand/collapse indicator (controls collapse/expand, so NO icon on this line)
- Text: "Read file" (static) or "Reading file" (shimmer animation via `ShimmerText` while running)
- Duration: Right-aligned (like BashToolBlock)

**Second line (always visible) - Command/Details line:**
- Icon: `FileText` from lucide-react (w-3 h-3 text-zinc-500/60) - icon ONLY appears on this line
- Content: File path (e.g., `src/components/App.tsx`) - displayed as monospace text, NOT raw JSON
- `CopyButton`: Copy file path to clipboard

**Example when collapsed:**
```
  > Read file                                         [1.2s]
    FileText src/components/App.tsx                   [copy]
```

**Example when expanded:**
```
  v Read file                                         [1.2s]
    FileText src/components/App.tsx                   [copy]
    [expanded content area - error messages if any]
```

### Important Design Notes

1. **No File Contents Display:** We intentionally do NOT display file contents in the expanded section. The file path is sufficient context. File contents should be viewed in the code editor or via Edit/Write tools to see diffs.

2. **No Raw JSON:** Never display raw JSON objects to users. The input `file_path` is extracted and displayed as formatted text. Any error messages are displayed as plain text, not JSON.

3. **Collapsible Design:** Use `CollapsibleBlock` for the expand/collapse behavior to ensure consistent interaction patterns with other tool blocks.

4. **Two-Line Layout Structure:**
   - **First line:** Description text with shimmer animation (for in-progress state) + chevron for collapse/expand. NO icon on this line.
   - **Second line:** Command/details (file path) with the `FileText` icon. The icon ONLY appears on this line because the first line has the chevron.

## Component Structure

```tsx
// File: src/components/thread/tool-blocks/read-tool-block.tsx

import { cn } from "@/lib/utils";
import { formatDuration } from "@/lib/utils/time-format";
import { useToolExpandStore } from "@/stores/tool-expand-store";
import { CollapsibleBlock } from "@/components/ui/collapsible-block";
import { CopyButton } from "@/components/ui/copy-button";
import { ShimmerText } from "@/components/ui/shimmer-text";
import { ExpandChevron } from "@/components/ui/expand-chevron";
import { StatusIcon } from "@/components/ui/status-icon";
import { FileText } from "lucide-react";
import type { ToolBlockProps } from "./index";

/**
 * Claude Code's Read tool input shape.
 * Matches the input parameter passed to the Read tool.
 */
interface ReadInput {
  file_path: string;
  offset?: number;
  limit?: number;
}

export function ReadToolBlock({
  id,
  name: _name,
  input,
  result,
  isError = false,
  status,
  durationMs,
  threadId,
}: ToolBlockProps) {
  // Implementation follows...
}
```

## Reusable UI Components

This component uses the following shared UI components to ensure consistency with BashToolBlock:

### 1. `CollapsibleBlock` (`@/components/ui/collapsible-block`)

Handles the expand/collapse interaction pattern with proper keyboard accessibility.

```tsx
<CollapsibleBlock
  isExpanded={isExpanded}
  onToggle={() => setIsExpanded(!isExpanded)}
  testId={`read-tool-${id}`}
  ariaLabel={`Read file: ${filePath}, status: ${status}`}
  className="py-0.5"
  header={
    // Primary line content (icon, text, duration)
  }
>
  {/* Expanded content (file path with copy button) */}
</CollapsibleBlock>
```

### 2. `ExpandChevron` (`@/components/ui/expand-chevron`)

Animated chevron indicator on the first line. Rotates between right (collapsed) and down (expanded). The chevron takes the place of an icon on the first line (since it controls expand/collapse behavior).

```tsx
<ExpandChevron isExpanded={isExpanded} size="md" />
```

- Use `size="md"` for the first line
- Automatically handles the rotation animation
- The icon (`FileText`) only appears on the second line, not the first line with the chevron

### 3. `ShimmerText` (`@/components/ui/shimmer-text`)

Animated loading state text. Shows shimmer effect during running status.

```tsx
<ShimmerText
  isShimmering={status === "running"}
  className="text-sm text-zinc-200 truncate"
>
  {status === "running" ? "Reading file" : "Read file"}
</ShimmerText>
```

### 4. `CopyButton` (`@/components/ui/copy-button`)

Copy-to-clipboard button with tooltip and checkmark feedback.

```tsx
// In expanded section - copy file path
<CopyButton
  text={filePath}
  label="Copy file path"
  alwaysVisible  // Always visible since it's in expanded content
/>
```

### 5. `StatusIcon` (`@/components/ui/status-icon`)

Shows success/failure indicator after completion. Only display on error.

```tsx
{!isRunning && isError && (
  <StatusIcon isSuccess={false} />
)}
```

## State Management

### Expanded State

Use `useToolExpandStore` to persist expand state across virtualization remounts:

```tsx
const isExpanded = useToolExpandStore((state) => state.isToolExpanded(threadId, id));
const setToolExpanded = useToolExpandStore((state) => state.setToolExpanded);
const setIsExpanded = (expanded: boolean) => setToolExpanded(threadId, id, expanded);
```

This pattern mirrors BashToolBlock and ensures state persists when components unmount/remount during list virtualization.

## Input/Output Handling

### Extracting Input Data

```tsx
// Type-safe extraction of input parameters
const readInput = input as unknown as ReadInput;
const filePath = readInput.file_path || "";

// Optional: show range info if offset/limit specified
const hasRange = readInput.offset !== undefined || readInput.limit !== undefined;
const rangeInfo = hasRange
  ? `lines ${readInput.offset ?? 1}${readInput.limit ? `-${(readInput.offset ?? 1) + readInput.limit - 1}` : '+'}`
  : null;
```

### Display Format (No Raw JSON)

The file path is displayed as formatted monospace text:

```tsx
// Correct: Display as formatted text
<code className="text-xs font-mono text-zinc-400 truncate">
  {filePath}
</code>

// INCORRECT: Never display raw JSON
// <pre>{JSON.stringify(input, null, 2)}</pre>  // DON'T DO THIS
```

### Error Handling

When `isError` is true, the result contains an error message (plain text, not JSON):

```tsx
{isError && result && (
  <div className="mt-2 ml-6 text-xs text-red-400">
    {result}
  </div>
)}
```

## Implementation

### Full Component Code

```tsx
import { cn } from "@/lib/utils";
import { formatDuration } from "@/lib/utils/time-format";
import { useToolExpandStore } from "@/stores/tool-expand-store";
import { CollapsibleBlock } from "@/components/ui/collapsible-block";
import { CopyButton } from "@/components/ui/copy-button";
import { ShimmerText } from "@/components/ui/shimmer-text";
import { ExpandChevron } from "@/components/ui/expand-chevron";
import { StatusIcon } from "@/components/ui/status-icon";
import { FileText } from "lucide-react";
import type { ToolBlockProps } from "./index";

interface ReadInput {
  file_path: string;
  offset?: number;
  limit?: number;
}

export function ReadToolBlock({
  id,
  name: _name,
  input,
  result,
  isError = false,
  status,
  durationMs,
  threadId,
}: ToolBlockProps) {
  // Persist expand state across virtualization
  const isExpanded = useToolExpandStore((state) => state.isToolExpanded(threadId, id));
  const setToolExpanded = useToolExpandStore((state) => state.setToolExpanded);
  const setIsExpanded = (expanded: boolean) => setToolExpanded(threadId, id, expanded);

  // Extract input parameters
  const readInput = input as unknown as ReadInput;
  const filePath = readInput.file_path || "";

  const isRunning = status === "running";

  // Build header content (contains BOTH lines - first line is description, second line is command/details)
  const header = (
    <>
      {/* First line: Description with chevron (NO icon - chevron controls expand/collapse) */}
      <div className="flex items-center gap-2">
        <ExpandChevron isExpanded={isExpanded} size="md" />
        <ShimmerText
          isShimmering={isRunning}
          className="text-sm text-zinc-200 truncate"
        >
          {isRunning ? "Reading file" : "Read file"}
        </ShimmerText>

        {/* Error indicator */}
        {!isRunning && isError && <StatusIcon isSuccess={false} />}

        {/* Duration - right justified */}
        {durationMs !== undefined && !isRunning && (
          <span className="ml-auto text-xs text-muted-foreground shrink-0">
            {formatDuration(durationMs)}
          </span>
        )}
      </div>

      {/* Second line: File path with icon (icon ONLY on this line) */}
      <div className="flex items-center gap-1 mt-1 ml-5">
        <FileText className="w-3 h-3 text-zinc-500/60 shrink-0" />
        <code className="text-xs font-mono text-zinc-400 truncate min-w-0">
          {filePath}
        </code>
        <CopyButton text={filePath} label="Copy file path" alwaysVisible />
      </div>
    </>
  );

  return (
    <CollapsibleBlock
      isExpanded={isExpanded}
      onToggle={() => setIsExpanded(!isExpanded)}
      testId={`read-tool-${id}`}
      ariaLabel={`Read file: ${filePath}, status: ${status}`}
      className="py-0.5"
      header={header}
    >
      {/* Expanded content: Error message if present */}
      {isError && result && (
        <div className="mt-2 ml-6 text-xs text-red-400 font-mono">
          {result}
        </div>
      )}

      {/* Screen reader status */}
      <span className="sr-only">
        {isRunning
          ? "Reading file"
          : isError
            ? "File read failed"
            : "File read complete"}
      </span>
    </CollapsibleBlock>
  );
}
```

## Registration in Tool Registry

After implementation, add to `/Users/zac/Documents/juice/anvil/anvil/src/components/thread/tool-blocks/index.ts`:

```tsx
import { ReadToolBlock } from "./read-tool-block";

const TOOL_BLOCK_REGISTRY: Record<string, ToolBlockComponent> = {
  bash: BashToolBlock,
  read: ReadToolBlock,  // ADD THIS LINE
};

export { BashToolBlock, ReadToolBlock };
```

## Testing Approach

### Unit Tests

1. **Render with valid file path**
   - Verify first line shows "Read file" text with chevron (no icon)
   - Verify second line shows file path with FileText icon
   - Verify expand/collapse toggles correctly

2. **Status transitions**
   - Verify first line shows "Reading file" + shimmer animation during running status
   - Verify first line shows static "Read file" when complete
   - Verify StatusIcon appears on first line on error

3. **Copy functionality**
   - Verify CopyButton copies file path to clipboard
   - Verify tooltip shows "Copy file path"

4. **Keyboard navigation**
   - Verify Enter/Space toggles expand/collapse (via CollapsibleBlock)
   - Verify focus styles visible

5. **Edge cases**
   - Very long file paths (should truncate with `truncate` class)
   - Missing file_path input (should show empty string gracefully)
   - Error state with error message

### Visual Consistency Tests

- Compare layout to BashToolBlock for consistency
- Verify two-line layout: first line has chevron + description, second line has icon + file path
- Verify icon size on second line matches (w-3 h-3 text-zinc-500/60)
- Verify color scheme matches (text-zinc-200, text-zinc-400, text-zinc-500)

## Success Criteria

1. Component renders without errors
2. Uses `CollapsibleBlock` for consistent expand/collapse behavior
3. Uses `ShimmerText` for running state animation on the first line
4. Uses `CopyButton` for clipboard functionality on the second line
5. Uses `StatusIcon` for error indication on the first line
6. Uses `ExpandChevron` for expand/collapse indicator on the first line (no icon on first line)
7. `FileText` icon ONLY appears on the second line (command/details line)
8. No raw JSON is ever displayed to users
9. File path displayed as formatted monospace text on the second line
10. Error messages displayed as plain text in expanded content
11. Expand state persists via `useToolExpandStore`
12. Visual style matches BashToolBlock conventions
13. Accessibility: aria-label, sr-only status, keyboard navigation
14. Component registered in tool-blocks/index.ts registry
15. Two-line layout: first line = description + shimmer, second line = icon + command/file path

## Related Files

### Components Used
- `CollapsibleBlock` - `/src/components/ui/collapsible-block.tsx`
- `CopyButton` - `/src/components/ui/copy-button.tsx`
- `ShimmerText` - `/src/components/ui/shimmer-text.tsx`
- `ExpandChevron` - `/src/components/ui/expand-chevron.tsx`
- `StatusIcon` - `/src/components/ui/status-icon.tsx`

### Utilities Used
- `formatDuration` - `/src/lib/utils/time-format.ts`
- `cn` - `/src/lib/utils/index.ts`
- `useToolExpandStore` - `/src/stores/tool-expand-store.ts`

### Reference Implementation
- `BashToolBlock` - `/src/components/thread/tool-blocks/bash-tool-block.tsx`

### Type Definitions
- `ToolBlockProps` - `/src/components/thread/tool-blocks/index.ts`
- `Anthropic.ToolUseBlock` - `@anthropic-ai/sdk` (for reference)
- `Anthropic.ToolResultBlockParam` - `@anthropic-ai/sdk` (for reference)

## Related Plans

- **Main plan:** `/plans/tool-result-rendering-overhaul.md`
- **Reusable components:** `/plans/completed/extract-reusable-tool-block-components.md`
