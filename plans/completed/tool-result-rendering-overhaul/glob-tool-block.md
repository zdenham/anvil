# GlobToolBlock Implementation Plan

## Overview

This plan details the implementation of `GlobToolBlock`, a specialized component for rendering Glob file search results. The component follows the BashToolBlock UI conventions established in the tool result rendering overhaul and uses reusable UI components from `src/components/ui/`.

---

## Anthropic API Types

The Glob tool uses standard Anthropic API types for tool use and tool results. Reference types from `@anthropic-ai/sdk`:

**Tool Use Block (from assistant message):**
```typescript
// From @anthropic-ai/sdk - Anthropic.ToolUseBlock
interface ToolUseBlock {
  id: string;      // Unique tool use ID (e.g., "toolu_01D7FLrfh4GYq7yT1ULFeyMV")
  input: unknown;  // Tool input parameters (parsed as GlobInput below)
  name: string;    // "Glob"
  type: 'tool_use';
}
```

**Tool Result Block (from user message):**
```typescript
// From @anthropic-ai/sdk - Anthropic.ToolResultBlockParam
interface ToolResultBlockParam {
  tool_use_id: string;
  type: 'tool_result';
  content?: string | Array<TextBlockParam | ImageBlockParam>;  // Result content
  is_error?: boolean;  // Whether the tool execution failed
  cache_control?: CacheControlEphemeral | null;
}
```

**Note:** The `result` prop passed to `GlobToolBlock` is the stringified `content` field from `ToolResultBlockParam`. The `isError` prop maps to `is_error` from the API.

---

## UI Pattern

**Follows BashToolBlock convention:**

- **First line:** Chevron (controls collapse/expand) + "Find files" description text (shimmer animation while running)
- **Second line:** Icon (`FolderSearch`) + Pattern + match count (e.g., `**/*.tsx -> 23 files`)
- **Expandable section:** Formatted list of matching file paths (never raw JSON)

**Layout requirement:** The chevron appears only on the first line (to control expand/collapse), and the icon appears only on the second line (where the command/pattern is displayed). This keeps the first line focused on the action description with shimmer feedback, while the second line shows the specific details with the tool-specific icon.

---

## Component Structure

### Component Location
`/Users/zac/Documents/juice/mort/mortician/src/components/thread/tool-blocks/glob-tool-block.tsx`

### Props Interface

Inherits from `ToolBlockProps` (defined in `index.ts`):

```typescript
interface ToolBlockProps {
  /** Unique tool use ID - maps to Anthropic.ToolUseBlock.id */
  id: string;
  /** Tool name - maps to Anthropic.ToolUseBlock.name */
  name: string;
  /** Tool input parameters - maps to Anthropic.ToolUseBlock.input */
  input: Record<string, unknown>;
  /** Tool execution result - stringified content from Anthropic.ToolResultBlockParam.content */
  result?: string;
  /** Whether the result was an error - maps to Anthropic.ToolResultBlockParam.is_error */
  isError?: boolean;
  /** Current execution status */
  status: ToolStatus;
  /** Execution duration in milliseconds */
  durationMs?: number;
  /** Whether this block is focused for keyboard navigation */
  isFocused?: boolean;
  /** Thread ID for persisting expand state across virtualization */
  threadId: string;
}
```

### Input Type

The `input` field from `Anthropic.ToolUseBlock` for Glob tool:

```typescript
interface GlobInput {
  pattern: string;  // The glob pattern (e.g., "**/*.tsx")
  path?: string;    // Optional search path (defaults to current directory)
}
```

### Result Type

The Glob tool returns matching file paths as a newline-separated string. The result is always parsed into a formatted display - never shown as raw JSON.

```typescript
/**
 * Claude Code's glob tool result format.
 * Not exported from @anthropic-ai/sdk - this is Claude Code's internal representation.
 * The result string from tool_result blocks contains newline-separated file paths.
 */

/**
 * Parse the glob result into an array of file paths.
 * Always returns a clean array - handles both JSON array format (legacy)
 * and newline-separated format (current).
 */
function parseGlobResult(result: string | undefined): string[] {
  if (!result) return [];

  // Try JSON array first (legacy format from some tool versions)
  try {
    const parsed = JSON.parse(result);
    if (Array.isArray(parsed)) {
      return parsed.filter((p) => typeof p === "string");
    }
  } catch {
    // Not JSON, use newline-separated format
  }

  // Standard format: newline-separated file paths
  return result
    .split("\n")
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
}
```

---

## Visual Design

### Collapsed State

```
> Find files                           [shimmer while running]
  [folder-search icon] **/*.tsx -> 23 files
```

**First line elements:**
1. `ExpandChevron` (animated chevron, controls collapse/expand)
2. "Find files" description text wrapped in `ShimmerText` (shimmers while running)

**Second line elements:**
1. `FolderSearch` icon (from lucide-react, muted color) - icon only appears here, not on first line
2. Pattern (monospace)
3. Arrow separator + match count summary

### Expanded State

```
v Find files                           [shimmer stops when complete]
  [folder-search icon] **/*.tsx -> 23 files

  [CollapsibleOutputBlock containing:]
    src/components/App.tsx          [copy icon]
    src/components/Button.tsx       [copy icon]
    src/hooks/useAuth.ts            [copy icon]
    src/hooks/useQuery.ts           [copy icon]
    src/utils/helpers.tsx           [copy icon]
    ... (with gradient overlay if many results)
```

**First line (always visible):**
- Chevron (down when expanded) + "Find files" description text

**Second line (always visible):**
- `FolderSearch` icon (only appears on this line)
- Pattern (left-aligned, monospace)
- Arrow separator: `->`
- Match count and unit (e.g., `23 files`)

**Expandable content (never shows raw JSON):**
- Formatted list of file paths, one per line
- Each path has a `CopyButton` for individual path copying
- Monospace font for file paths
- Search location/context at top (if path is non-default)

---

## Reusable UI Components

All components from `src/components/ui/`:

### 1. **ExpandChevron**
- **Location:** `src/components/ui/expand-chevron.tsx`
- **Usage:** Animate chevron in header to indicate expanded/collapsed state
- **Behavior:** Shows `ChevronRight` when collapsed, `ChevronDown` when expanded
- **Props:**
  ```typescript
  <ExpandChevron
    isExpanded={isExpanded}
    size="md"  // "sm" | "md" - affects margins
  />
  ```

### 2. **ShimmerText**
- **Location:** `src/components/ui/shimmer-text.tsx`
- **Usage:** Header text ("Find files") while status is "running"
- **Behavior:** Applies `animate-shimmer` CSS class during loading
- **Props:**
  ```typescript
  <ShimmerText
    isShimmering={status === "running"}
    className="text-sm text-zinc-200 truncate"
  >
    Find files
  </ShimmerText>
  ```

### 3. **CopyButton**
- **Location:** `src/components/ui/copy-button.tsx`
- **Usage:** Copy individual file paths; copy entire pattern
- **Behavior:** Shows copy icon, checkmark feedback on success, tooltip support
- **Props:**
  ```typescript
  <CopyButton
    text={filePath}
    label="Copy path"
    alwaysVisible={false}  // Show only on group hover
  />
  ```

### 4. **CollapsibleOutputBlock**
- **Location:** `src/components/ui/collapsible-output-block.tsx`
- **Usage:** Wrap file list when there are many results (>20 files)
- **Behavior:** Gradient overlay on collapsed state with Expand/Collapse button, full height when expanded
- **Props:**
  ```typescript
  <CollapsibleOutputBlock
    isExpanded={isOutputExpanded}
    onToggle={() => setIsOutputExpanded(!isOutputExpanded)}
    isLongContent={filePaths.length > LINE_COLLAPSE_THRESHOLD}
    maxCollapsedHeight={300}  // pixels
    variant={isError ? "error" : "default"}  // Controls border color
  >
    {/* Formatted file list JSX - never raw JSON */}
  </CollapsibleOutputBlock>
  ```

### 5. **StatusIcon**
- **Location:** `src/components/ui/status-icon.tsx`
- **Usage:** Show error indicator if glob failed
- **Behavior:** Shows red X icon for failures
- **Props:**
  ```typescript
  {!isRunning && isError && (
    <StatusIcon isSuccess={false} />
  )}
  ```

---

## Implementation Details

### 1. Component Skeleton

```typescript
import { cn } from "@/lib/utils";
import { formatDuration } from "@/lib/utils/time-format";
import { useToolExpandStore } from "@/stores/tool-expand-store";
import { CopyButton } from "@/components/ui/copy-button";
import { ShimmerText } from "@/components/ui/shimmer-text";
import { ExpandChevron } from "@/components/ui/expand-chevron";
import { StatusIcon } from "@/components/ui/status-icon";
import { CollapsibleOutputBlock } from "@/components/ui/collapsible-output-block";
import { FolderSearch } from "lucide-react";
import type { ToolBlockProps } from "./index";

/**
 * Input shape for the Glob tool.
 * Maps to the `input` field of Anthropic.ToolUseBlock when name === "Glob".
 */
interface GlobInput {
  pattern: string;
  path?: string;
}

const LINE_COLLAPSE_THRESHOLD = 20;
const MAX_COLLAPSED_HEIGHT = 300;

/**
 * Parse the glob result into an array of file paths.
 * Handles both JSON array (legacy) and newline-separated (current) formats.
 * Never returns raw JSON - always a clean array of strings.
 */
function parseGlobResult(result: string | undefined): string[] {
  if (!result) return [];

  try {
    const parsed = JSON.parse(result);
    if (Array.isArray(parsed)) {
      return parsed.filter((p) => typeof p === "string");
    }
  } catch {
    // Not JSON
  }

  return result
    .split("\n")
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
}

/**
 * Specialized block for rendering Glob tool calls.
 * Displays file search results in a formatted list, never as raw JSON.
 */
export function GlobToolBlock({
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
  // Implementation continues below...
}
```

### 2. State Management

Use `useToolExpandStore` (Zustand) for persist-across-virtualization, following BashToolBlock pattern:

```typescript
// Main block expand state
const isExpanded = useToolExpandStore((state) => state.isToolExpanded(threadId, id));
const setToolExpanded = useToolExpandStore((state) => state.setToolExpanded);
const setIsExpanded = (expanded: boolean) => setToolExpanded(threadId, id, expanded);

// Output section expand state (for CollapsibleOutputBlock)
const defaultOutputExpanded = filePaths.length <= LINE_COLLAPSE_THRESHOLD;
const isOutputExpanded = useToolExpandStore((state) =>
  state.isOutputExpanded(threadId, id, defaultOutputExpanded)
);
const setOutputExpanded = useToolExpandStore((state) => state.setOutputExpanded);
const setIsOutputExpanded = (expanded: boolean) => setOutputExpanded(threadId, id, expanded);
```

### 3. Parse Input & Result

```typescript
const globInput = input as unknown as GlobInput;
const pattern = globInput.pattern || "";
const searchPath = globInput.path || ".";

// Parse result into formatted array - never display raw JSON
const filePaths = parseGlobResult(result);
const matchCount = filePaths.length;
const isRunning = status === "running";
const hasResults = matchCount > 0;
const isLongOutput = matchCount > LINE_COLLAPSE_THRESHOLD;
```

### 4. JSX Structure

Following BashToolBlock structure with `CollapsibleBlock`-style interaction:

```typescript
return (
  <div
    className="group py-0.5"
    aria-label={`Glob search: ${pattern}, status: ${status}`}
    data-testid={`glob-tool-${id}`}
    data-tool-status={status}
  >
    {/* Clickable Header Row */}
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
      {/* First line: chevron + description (shimmer while running) */}
      {/* Note: Chevron only on first line, no icon here */}
      <div className="flex items-center gap-2">
        <ExpandChevron isExpanded={isExpanded} size="md" />
        <ShimmerText
          isShimmering={isRunning}
          className="text-sm text-zinc-200 truncate min-w-0"
        >
          Find files
        </ShimmerText>

        {/* Error indicator */}
        {!isRunning && isError && <StatusIcon isSuccess={false} />}

        {/* Duration - right aligned */}
        {durationMs !== undefined && !isRunning && (
          <span className="text-xs text-muted-foreground ml-auto shrink-0">
            {formatDuration(durationMs)}
          </span>
        )}
      </div>

      {/* Second line: icon + pattern + match count */}
      {/* Note: Icon only on second line (first line has chevron) */}
      <div className="flex items-center gap-2 mt-0.5 pl-5">
        <FolderSearch className="w-3.5 h-3.5 text-zinc-500 shrink-0" />
        <code className="text-xs font-mono text-zinc-500 flex items-center gap-1 min-w-0 flex-1">
          <span className="truncate">{pattern}</span>
        </code>
        {!isRunning && (
          <span className="text-xs text-zinc-500 shrink-0">
            -> {matchCount} {matchCount === 1 ? "file" : "files"}
          </span>
        )}
        <CopyButton text={pattern} label="Copy pattern" alwaysVisible />
      </div>
    </div>

    {/* Expanded Content - Formatted File List */}
    {isExpanded && (
      <div className="relative mt-2">
        <CollapsibleOutputBlock
          isExpanded={isOutputExpanded}
          onToggle={() => setIsOutputExpanded(!isOutputExpanded)}
          isLongContent={isLongOutput}
          maxCollapsedHeight={MAX_COLLAPSED_HEIGHT}
          variant={isError ? "error" : "default"}
        >
          <div className="space-y-0.5 p-2">
            {/* Search context (if non-default path) */}
            {searchPath && searchPath !== "." && (
              <div className="text-xs text-zinc-500 mb-2">
                Search in: <span className="text-zinc-400">{searchPath}</span>
              </div>
            )}

            {/* Formatted file list - never raw JSON */}
            {hasResults ? (
              filePaths.map((filePath, index) => (
                <div
                  key={`${filePath}-${index}`}
                  className="flex items-center gap-2 group/item py-0.5"
                >
                  <code className="text-xs font-mono text-zinc-300 flex-1 truncate">
                    {filePath}
                  </code>
                  <CopyButton
                    text={filePath}
                    label="Copy path"
                    alwaysVisible={false}
                    className="opacity-0 group-hover/item:opacity-100"
                  />
                </div>
              ))
            ) : (
              <div className="text-xs text-zinc-500">No files matched</div>
            )}
          </div>
        </CollapsibleOutputBlock>
      </div>
    )}

    {/* Screen reader status */}
    <span className="sr-only">
      {isRunning
        ? "Finding files"
        : isError
          ? "Pattern matching failed"
          : `Found ${matchCount} ${matchCount === 1 ? "file" : "files"}`}
    </span>
  </div>
);
```

### 5. Error State Display

When `isError` is true (maps to `is_error` from `Anthropic.ToolResultBlockParam`), the result content contains the error message. Display it formatted, not as raw JSON:

```typescript
{isError && isExpanded && (
  <div className="mt-2 text-xs text-red-400 bg-red-950/30 p-2 rounded border border-red-500/30">
    {result || "Pattern matching failed"}
  </div>
)}
```

---

## Integration

### 1. Update tool-blocks/index.ts

Add GlobToolBlock to the registry (tool names are lowercase):

```typescript
// At top of index.ts
import { GlobToolBlock } from "./glob-tool-block";

// In TOOL_BLOCK_REGISTRY
const TOOL_BLOCK_REGISTRY: Record<string, ToolBlockComponent> = {
  bash: BashToolBlock,
  glob: GlobToolBlock,  // <-- Add this
  // ... other tools
};
```

### 2. Export from index.ts

```typescript
export { BashToolBlock };
export { GlobToolBlock };
```

---

## Testing

### Unit Tests

Create `/Users/zac/Documents/juice/mort/mortician/src/components/thread/tool-blocks/glob-tool-block.test.tsx`:

```typescript
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { GlobToolBlock } from "./glob-tool-block";

describe("GlobToolBlock", () => {
  const mockProps = {
    id: "toolu_01ABC123",  // Realistic tool_use_id format
    name: "Glob",
    input: { pattern: "**/*.tsx" },
    result: "src/App.tsx\nsrc/Button.tsx",  // Newline-separated format
    status: "complete" as const,
    threadId: "thread-1",
  };

  it("renders pattern and match count", () => {
    render(<GlobToolBlock {...mockProps} />);
    expect(screen.getByText("**/*.tsx")).toBeInTheDocument();
    expect(screen.getByText(/2 files/)).toBeInTheDocument();
  });

  it("expands to show formatted file list (not raw JSON)", async () => {
    const user = userEvent.setup();
    render(<GlobToolBlock {...mockProps} />);

    const expandButton = screen.getByRole("button", { expanded: false });
    await user.click(expandButton);

    // Should show formatted paths, not JSON
    expect(screen.getByText("src/App.tsx")).toBeInTheDocument();
    expect(screen.getByText("src/Button.tsx")).toBeInTheDocument();
    // Should NOT show raw JSON brackets
    expect(screen.queryByText(/\[/)).not.toBeInTheDocument();
  });

  it("shows shimmer text while running", () => {
    render(<GlobToolBlock {...mockProps} status="running" result={undefined} />);
    const findFilesText = screen.getByText("Find files");
    expect(findFilesText).toHaveClass("animate-shimmer");
  });

  it("shows error state with StatusIcon when failed", () => {
    render(
      <GlobToolBlock {...mockProps} isError={true} result="Invalid pattern syntax" />
    );
    // StatusIcon should be present (red X)
    expect(screen.getByRole("button")).toContainElement(
      document.querySelector('[class*="text-red"]')
    );
  });

  it("parses JSON array result format (legacy)", async () => {
    const user = userEvent.setup();
    render(
      <GlobToolBlock
        {...mockProps}
        result={JSON.stringify(["src/App.tsx", "src/Button.tsx", "src/utils.ts"])}
      />
    );
    expect(screen.getByText(/3 files/)).toBeInTheDocument();

    // Expand and verify formatted display
    await user.click(screen.getByRole("button"));
    expect(screen.getByText("src/App.tsx")).toBeInTheDocument();
  });

  it("handles empty results gracefully", () => {
    render(<GlobToolBlock {...mockProps} result="" />);
    expect(screen.getByText(/0 files/)).toBeInTheDocument();
  });

  it("copy button copies individual file paths", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn();
    Object.assign(navigator, { clipboard: { writeText } });

    render(<GlobToolBlock {...mockProps} />);

    await user.click(screen.getByRole("button"));
    const copyButtons = screen.getAllByLabelText(/Copy path/);
    await user.click(copyButtons[0]);

    expect(writeText).toHaveBeenCalledWith("src/App.tsx");
  });

  it("uses CollapsibleOutputBlock for long file lists", async () => {
    const manyFiles = Array.from({ length: 25 }, (_, i) => `src/file${i}.tsx`).join("\n");
    const user = userEvent.setup();

    render(<GlobToolBlock {...mockProps} result={manyFiles} />);
    await user.click(screen.getByRole("button"));

    // Should have expand/collapse button from CollapsibleOutputBlock
    expect(screen.getByLabelText(/Expand output|Collapse output/)).toBeInTheDocument();
  });
});
```

---

## Design Decisions

### Why always parse result into formatted display?
- **User experience:** Raw JSON is not scannable or user-friendly
- **Consistency:** BashToolBlock parses stdout/stderr - Glob should parse file paths
- **Copy functionality:** Individual file paths need to be extractable

### Why CollapsibleOutputBlock?
- **Readability:** Long file lists need scroll containment
- **Pattern:** Matches BashToolBlock conventions exactly
- **UX:** Gradient overlay + expand button is established pattern

### Why monospace font for paths?
- **Scannability:** File paths are easier to scan in monospace
- **Consistency:** Matches BashToolBlock command display
- **Copy-paste friendly:** Clear that it's copiable content

### Why copy button per-file?
- **Granular control:** Users can copy individual paths
- **Consistency:** Matches BashToolBlock command copy pattern
- **Productivity:** Common workflow is to copy a path for use elsewhere

---

## Edge Cases & Handling

| Case | Handling |
|------|----------|
| **No matches (empty result)** | Show "0 files" in second line; display "No files matched" in expanded view |
| **JSON array result (legacy)** | Parse with `JSON.parse()`, extract string array, display formatted |
| **Newline-separated result** | Split on newlines, trim, filter empty, display formatted |
| **Huge result set (10k+ files)** | Use `CollapsibleOutputBlock` with gradient; consider future virtualization |
| **Very long file paths** | Truncate with `truncate` class; full path available via copy button |
| **Pattern with special chars** | Display as-is; copy button provides clean copy |
| **Search path different from root** | Show in expanded view: "Search in: src/components" |
| **Error during search** | Display `StatusIcon` (red X), show error message in expanded view |

---

## Accessibility Checklist

- [ ] Header row has `role="button"` and is keyboard navigable (Tab, Enter, Space)
- [ ] `ExpandChevron` updates based on `aria-expanded` attribute
- [ ] Copy buttons are keyboard accessible with descriptive `aria-label`
- [ ] Screen reader announces: "Finding files" (running), "Found X files" (complete), "Pattern matching failed" (error)
- [ ] File paths in monospace font with sufficient contrast (zinc-300 on dark bg)
- [ ] `CollapsibleOutputBlock` expand/collapse button has `aria-label`

---

## Summary

The GlobToolBlock provides a clean, formatted display of file search results. By following BashToolBlock conventions and leveraging reusable UI components (`ExpandChevron`, `ShimmerText`, `CopyButton`, `CollapsibleOutputBlock`, `StatusIcon`), it maintains visual consistency while offering an optimized experience for file browsing. The implementation:

1. **Never displays raw JSON** - always parses into formatted file list
2. **Uses all shared UI components** for consistent behavior and styling
3. **Properly maps to Anthropic API types** (`ToolUseBlock.input`, `ToolResultBlockParam.content/is_error`)
4. **Follows BashToolBlock patterns** for state management, keyboard navigation, and accessibility
