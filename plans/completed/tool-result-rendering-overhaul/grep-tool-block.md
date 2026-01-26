# GrepToolBlock Implementation Plan

## Overview

This document details the implementation of `GrepToolBlock`, a specialized component for rendering Grep tool results with semantic grouping, syntax highlighting, and an interactive search-friendly UI.

**Status:** Phase 3 of Tool Result Rendering Overhaul

**Parent Plan:** `/plans/tool-result-rendering-overhaul.md`

---

## Anthropic API Data Structure

The Grep tool follows the standard Anthropic tool use pattern. The component receives data derived from `ToolUseBlock` and `ToolResultBlockParam` from `@anthropic-ai/sdk/resources/messages`.

**Tool Use Block (from assistant message):**
```typescript
import type { ToolUseBlock } from "@anthropic-ai/sdk/resources/messages";

// ToolUseBlock shape:
{
  type: "tool_use";
  id: string;           // Unique tool use ID (e.g., "toolu_01ABC...")
  name: "Grep";         // Tool name
  input: GrepInput;     // Tool-specific input parameters
}
```

**Tool Result Block (from user message):**
```typescript
import type { ToolResultBlockParam } from "@anthropic-ai/sdk/resources/messages";

// ToolResultBlockParam shape:
{
  type: "tool_result";
  tool_use_id: string;  // Matches the tool_use.id
  content: string;      // Result as string (or array with text/image)
  is_error?: boolean;   // True if tool execution failed
}
```

**Important:** The `result` prop passed to `GrepToolBlock` is the `content` field from `ToolResultBlockParam`, which is always a string. The component must parse this string to extract structured data for display.

---

## Specification

### Two-Line Header Layout

**Line 1 (Description Line):**
- `ExpandChevron` component (from `@/components/ui/expand-chevron`) for animated expand/collapse indicator - controls expand/collapse on click
- `ShimmerText` component (from `@/components/ui/shimmer-text`) wrapping "Search" text - shimmers when `status === "running"`
- Duration (right-aligned, muted text) using `formatDuration()` from `@/lib/utils/time-format`
- **NO icon on this line** - the chevron serves as the visual anchor

**Line 2 (Command/Details Line):**
- `Search` icon from lucide-react (w-3 h-3, text-zinc-500/60, shrink-0) - icon ONLY appears on this line
- Pattern + match summary (e.g., `"useState" → 15 matches in 8 files`)
- `CopyButton` component (from `@/components/ui/copy-button`) for pattern - shown on group hover
- Truncate if pattern is very long

**Example Layout:**
```
▼ Search                                              [12ms]
  🔍 "useState" → 15 matches in 8 files               [Copy]
```

**Key Layout Rules:**
1. First line has the chevron (for expand/collapse) + description text with shimmer animation
2. Second line has the icon + command/details
3. This maintains consistency: chevron on line 1, tool-specific icon on line 2

### Expanded Content

**Layout:**
- Use `CollapsibleOutputBlock` (from `@/components/ui/collapsible-output-block`) as the main container for results
- List of files containing matches, grouped by file path
- Each file section uses `CollapsibleBlock` (from `@/components/ui/collapsible-block`) with `ExpandChevron`
- Each file header shows: file path + match count (e.g., `src/hooks/useState.ts (3 matches)`)
- `CopyButton` on each file path for easy copying

**Display Format by Output Mode (NO raw JSON):**

1. **Content mode** (`output_mode: "content"`): Render as formatted code blocks
   - File path as collapsible header
   - Line numbers in `text-zinc-600`
   - Context lines in `text-zinc-500` (muted)
   - Match lines in `text-zinc-200` with pattern highlighted using `<mark>` with `bg-yellow-200/30 text-yellow-100`
   - `CopyButton` on individual match lines (shown on hover)

2. **Files mode** (`output_mode: "files_with_matches"`): Render as file list
   - Each file path on its own line with file icon
   - `CopyButton` on each path
   - "X files found" summary

3. **Count mode** (`output_mode: "count"`): Render as count table
   - File path + count displayed as `path: count`
   - Right-aligned count numbers
   - Total count at bottom

**Example Expanded Content (Content Mode):**
```
src/hooks/useState.ts (3 matches)
├─ 42: function useAppState() {
│      const [state, setState] = useState(null);
│                               ^^^^^^^^ (highlighted)
│      return { state, setState };
├─ 67: function useData() {
│      const data = useState(() => ({...}));
│                   ^^^^^^^^ (highlighted)
│      return data;
└─ 89: // TODO: useState is slow here

src/components/App.tsx (5 matches)
├─ 10: import { useState } from 'react';
...
```

### Collapsed State

- Summary line visible, content hidden
- File list hidden
- Shows pattern + summary only

### Expanded State

- Full file grouping visible
- All match contexts shown
- File sections individually collapsible

---

## Data Structure

### GrepInput

This matches the input parameters from the Grep tool definition:

```typescript
interface GrepInput {
  pattern: string;           // The regex/literal pattern to search for
  path?: string;            // Search path (default: cwd)
  type?: string;            // File type filter (e.g., "js", "tsx")
  glob?: string;            // Glob pattern for file filtering
  output_mode?: "content" | "files_with_matches" | "count";
  "-i"?: boolean;           // Case insensitive
  "-n"?: boolean;           // Show line numbers (default true)
  "-C"?: number;            // Context lines (before/after)
  "-A"?: number;            // Lines after match
  "-B"?: number;            // Lines before match
  head_limit?: number;      // Limit number of results
  offset?: number;          // Skip first N results
  multiline?: boolean;      // Multiline mode
}
```

### GrepOutput

The Grep tool returns results as a plain string (the `content` field from `ToolResultBlockParam`). The format depends on `output_mode`:

1. **Content mode** (default): Line-by-line matches with context
   ```
   src/hooks/useState.ts
   42:function useAppState() {
   43:  const [state, setState] = useState(null);
   44:  return { state, setState };
   --
   src/components/App.tsx
   10:import { useState } from 'react';
   ```

2. **files_with_matches mode**: Just file paths, one per line
   ```
   src/hooks/useState.ts
   src/components/App.tsx
   src/utils/helpers.ts
   ```

3. **count mode**: Match counts per file
   ```
   src/hooks/useState.ts:3
   src/components/App.tsx:5
   ```

### Parsed Result

```typescript
interface ParsedGrepResult {
  pattern: string;
  outputMode: "content" | "files_with_matches" | "count";
  files: ParsedGrepFile[];
  totalMatches: number;
  totalFiles: number;
}

interface ParsedGrepFile {
  path: string;
  matchCount: number;
  matches: ParsedGrepMatch[];  // Empty for files_with_matches mode
}

interface ParsedGrepMatch {
  lineNumber: number;
  beforeContext: string[];
  line: string;           // Full line containing match
  afterContext: string[];
  matchOffsets: Array<{ start: number; end: number }>; // For highlighting
}
```

---

## Implementation Details

### Component Structure

```typescript
// File: src/components/thread/tool-blocks/grep-tool-block.tsx

import { Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDuration } from "@/lib/utils/time-format";
import { useToolExpandStore } from "@/stores/tool-expand-store";
import { CopyButton } from "@/components/ui/copy-button";
import { ShimmerText } from "@/components/ui/shimmer-text";
import { ExpandChevron } from "@/components/ui/expand-chevron";
import { StatusIcon } from "@/components/ui/status-icon";
import { CollapsibleOutputBlock } from "@/components/ui/collapsible-output-block";
import { CollapsibleBlock } from "@/components/ui/collapsible-block";
import type { ToolBlockProps } from "./index";

export function GrepToolBlock(props: ToolBlockProps) {
  // Implementation follows BashToolBlock pattern
}
```

### Key Functions

#### 1. Parse Grep Result

```typescript
/**
 * Parse the raw grep result string into structured data for display.
 * Handles all three output modes: content, files_with_matches, count.
 */
function parseGrepResult(
  result: string | undefined,
  input: GrepInput
): ParsedGrepResult {
  const outputMode = input.output_mode ?? "content";

  if (!result) {
    return {
      pattern: input.pattern,
      outputMode,
      files: [],
      totalMatches: 0,
      totalFiles: 0,
    };
  }

  const lines = result.split('\n').filter(l => l.trim());

  switch (outputMode) {
    case "files_with_matches":
      return parseFilesMode(lines, input.pattern);
    case "count":
      return parseCountMode(lines, input.pattern);
    default:
      return parseContentMode(lines, input.pattern);
  }
}

function parseFilesMode(lines: string[], pattern: string): ParsedGrepResult {
  const files = lines.map(path => ({
    path: path.trim(),
    matchCount: 1,  // Unknown in this mode
    matches: [],
  }));

  return {
    pattern,
    outputMode: "files_with_matches",
    files,
    totalMatches: files.length,
    totalFiles: files.length,
  };
}

function parseCountMode(lines: string[], pattern: string): ParsedGrepResult {
  const files: ParsedGrepFile[] = [];
  let totalMatches = 0;

  for (const line of lines) {
    const match = line.match(/^(.+):(\d+)$/);
    if (match) {
      const count = parseInt(match[2], 10);
      files.push({
        path: match[1],
        matchCount: count,
        matches: [],
      });
      totalMatches += count;
    }
  }

  return {
    pattern,
    outputMode: "count",
    files,
    totalMatches,
    totalFiles: files.length,
  };
}

function parseContentMode(lines: string[], pattern: string): ParsedGrepResult {
  // Parse file:linenum:content format
  // Group by file path
  // Track line numbers and context
  // Extract match positions for highlighting
  // ...implementation details
}
```

#### 2. Highlight Pattern in Line

```typescript
/**
 * Highlight all occurrences of pattern in a line.
 * Returns JSX with <mark> elements for highlighted sections.
 */
function highlightPattern(
  line: string,
  pattern: string,
  isCaseSensitive: boolean
): React.ReactNode {
  try {
    const flags = isCaseSensitive ? 'g' : 'gi';
    const regex = new RegExp(pattern, flags);
    const parts: Array<{ text: string; isMatch: boolean }> = [];
    let lastIndex = 0;

    for (const match of line.matchAll(regex)) {
      if (match.index! > lastIndex) {
        parts.push({ text: line.slice(lastIndex, match.index), isMatch: false });
      }
      parts.push({ text: match[0], isMatch: true });
      lastIndex = match.index! + match[0].length;
    }

    if (lastIndex < line.length) {
      parts.push({ text: line.slice(lastIndex), isMatch: false });
    }

    return (
      <>
        {parts.map((part, i) =>
          part.isMatch ? (
            <mark key={i} className="bg-yellow-200/30 text-yellow-100 rounded-sm px-0.5">
              {part.text}
            </mark>
          ) : (
            <span key={i}>{part.text}</span>
          )
        )}
      </>
    );
  } catch {
    // Invalid regex, fall back to literal string match
    return line;
  }
}
```

#### 3. Match Summary Line

```typescript
function getMatchSummary(parsed: ParsedGrepResult): string {
  const { pattern, totalMatches, totalFiles, outputMode } = parsed;
  const truncatedPattern = pattern.length > 30
    ? pattern.slice(0, 30) + "..."
    : pattern;

  if (outputMode === "files_with_matches") {
    return `"${truncatedPattern}" → ${totalFiles} file${totalFiles !== 1 ? 's' : ''}`;
  }

  if (totalMatches === 0) {
    return `"${truncatedPattern}" → no matches`;
  }

  return `"${truncatedPattern}" → ${totalMatches} match${totalMatches !== 1 ? 'es' : ''} in ${totalFiles} file${totalFiles !== 1 ? 's' : ''}`;
}
```

### Render Implementation

#### Main Component Structure (Following BashToolBlock Pattern)

```typescript
export function GrepToolBlock({
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
  // Use Zustand store for expand state (same pattern as BashToolBlock)
  const isExpanded = useToolExpandStore((state) => state.isToolExpanded(threadId, id));
  const setToolExpanded = useToolExpandStore((state) => state.setToolExpanded);
  const setIsExpanded = (expanded: boolean) => setToolExpanded(threadId, id, expanded);

  const grepInput = input as unknown as GrepInput;
  const pattern = grepInput.pattern || "";
  const isCaseSensitive = !grepInput["-i"];

  // Parse the result string into structured data
  const parsed = parseGrepResult(result, grepInput);

  const isRunning = status === "running";
  const hasResults = parsed.totalMatches > 0 || parsed.totalFiles > 0;

  // Determine if results are long enough to need expand/collapse
  const LINE_COLLAPSE_THRESHOLD = 20;
  const MAX_COLLAPSED_HEIGHT = 300;
  const isLongOutput = parsed.files.reduce((sum, f) => sum + f.matches.length, 0) > LINE_COLLAPSE_THRESHOLD;

  // Use store for output expand state
  const defaultOutputExpanded = !isLongOutput;
  const isOutputExpanded = useToolExpandStore((state) =>
    state.isOutputExpanded(threadId, id, defaultOutputExpanded)
  );
  const setOutputExpanded = useToolExpandStore((state) => state.setOutputExpanded);
  const setIsOutputExpanded = (expanded: boolean) => setOutputExpanded(threadId, id, expanded);

  // Per-file expand state (local, not persisted)
  const [expandedFiles, setExpandedFiles] = useState<Set<string>>(new Set());

  return (
    <div
      className="group py-0.5"
      aria-label={`Grep search: ${pattern}, status: ${status}`}
      data-testid={`grep-tool-${id}`}
      data-tool-status={status}
    >
      {/* Header - clickable to expand/collapse */}
      {/* Expanded content */}
      {/* Screen reader status */}
    </div>
  );
}
```

#### Line 1 (Description Line with Chevron)

```typescript
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
  {/* Line 1: Chevron + Description (shimmer when running) + Duration */}
  <div className="flex items-center gap-2">
    <ExpandChevron isExpanded={isExpanded} size="md" />
    <ShimmerText
      isShimmering={isRunning}
      className="text-sm text-zinc-200 truncate min-w-0"
    >
      Search
    </ShimmerText>

    {/* Error indicator */}
    {!isRunning && isError && (
      <StatusIcon isSuccess={false} />
    )}

    {/* Duration - right aligned */}
    <span className="flex items-center gap-2 shrink-0 ml-auto">
      {durationMs !== undefined && !isRunning && (
        <span className="text-xs text-muted-foreground">
          {formatDuration(durationMs)}
        </span>
      )}
    </span>
  </div>

  {/* Line 2: Icon + Command/Details (pattern + match summary) */}
  <div className="flex items-center gap-1 mt-0.5 ml-6">
    <Search className="w-3 h-3 text-zinc-500/60 shrink-0" />
    <code className="text-xs font-mono text-zinc-500 min-w-0 flex-1 truncate">
      {getMatchSummary(parsed)}
    </code>
    <CopyButton text={pattern} label="Copy pattern" />
  </div>
</div>
```

**Note:** The `ml-6` on line 2 aligns the icon with the content area (past the chevron). The icon ONLY appears on line 2, while the chevron on line 1 controls expand/collapse.

#### Expanded Results - Content Mode

```typescript
{isExpanded && hasResults && parsed.outputMode === "content" && (
  <div className="relative mt-2">
    <div className="absolute top-1 right-1 z-10">
      <CopyButton text={result ?? ""} label="Copy all results" />
    </div>
    <CollapsibleOutputBlock
      isExpanded={isOutputExpanded}
      onToggle={() => setIsOutputExpanded(!isOutputExpanded)}
      isLongContent={isLongOutput}
      maxCollapsedHeight={MAX_COLLAPSED_HEIGHT}
      variant={isError ? "error" : "default"}
    >
      <div className="p-2 space-y-3">
        {parsed.files.map((file) => (
          <CollapsibleBlock
            key={file.path}
            isExpanded={expandedFiles.has(file.path)}
            onToggle={() => toggleFileExpanded(file.path)}
            header={
              <div className="flex items-center gap-2">
                <ExpandChevron
                  isExpanded={expandedFiles.has(file.path)}
                  size="sm"
                />
                <code className="text-xs font-mono text-zinc-300 flex-1 min-w-0 truncate">
                  {file.path}
                </code>
                <span className="text-xs text-zinc-500 whitespace-nowrap">
                  {file.matchCount} match{file.matchCount !== 1 ? 'es' : ''}
                </span>
                <CopyButton text={file.path} label="Copy path" />
              </div>
            }
          >
            {/* Matches within file */}
            <div className="ml-4 mt-1 space-y-2 border-l border-zinc-700/50 pl-3">
              {file.matches.map((match, idx) => (
                <div key={idx} className="text-xs font-mono group/match">
                  {/* Context before */}
                  {match.beforeContext.map((line, i) => (
                    <div
                      key={`before-${i}`}
                      className="text-zinc-600 whitespace-pre-wrap break-words"
                    >
                      {line}
                    </div>
                  ))}

                  {/* Match line with highlighting */}
                  <div className="flex items-start gap-2">
                    <span className="text-zinc-600 select-none shrink-0 w-8 text-right">
                      {match.lineNumber}:
                    </span>
                    <span className="text-zinc-200 whitespace-pre-wrap break-words flex-1">
                      {highlightPattern(match.line, pattern, isCaseSensitive)}
                    </span>
                    <CopyButton
                      text={match.line}
                      label="Copy line"
                    />
                  </div>

                  {/* Context after */}
                  {match.afterContext.map((line, i) => (
                    <div
                      key={`after-${i}`}
                      className="text-zinc-600 whitespace-pre-wrap break-words"
                    >
                      {line}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </CollapsibleBlock>
        ))}
      </div>
    </CollapsibleOutputBlock>
  </div>
)}
```

#### Expanded Results - Files Mode

```typescript
{isExpanded && hasResults && parsed.outputMode === "files_with_matches" && (
  <div className="relative mt-2">
    <div className="absolute top-1 right-1 z-10">
      <CopyButton text={result ?? ""} label="Copy file list" />
    </div>
    <CollapsibleOutputBlock
      isExpanded={isOutputExpanded}
      onToggle={() => setIsOutputExpanded(!isOutputExpanded)}
      isLongContent={parsed.files.length > LINE_COLLAPSE_THRESHOLD}
      maxCollapsedHeight={MAX_COLLAPSED_HEIGHT}
      variant={isError ? "error" : "default"}
    >
      <div className="p-2 space-y-1">
        {parsed.files.map((file) => (
          <div key={file.path} className="flex items-center gap-2 group/file">
            <FileText className="w-3.5 h-3.5 text-zinc-500 shrink-0" />
            <code className="text-xs font-mono text-zinc-300 flex-1 min-w-0 truncate">
              {file.path}
            </code>
            <CopyButton text={file.path} label="Copy path" />
          </div>
        ))}
      </div>
    </CollapsibleOutputBlock>
  </div>
)}
```

#### Expanded Results - Count Mode

```typescript
{isExpanded && hasResults && parsed.outputMode === "count" && (
  <div className="relative mt-2">
    <div className="absolute top-1 right-1 z-10">
      <CopyButton text={result ?? ""} label="Copy counts" />
    </div>
    <CollapsibleOutputBlock
      isExpanded={isOutputExpanded}
      onToggle={() => setIsOutputExpanded(!isOutputExpanded)}
      isLongContent={parsed.files.length > LINE_COLLAPSE_THRESHOLD}
      maxCollapsedHeight={MAX_COLLAPSED_HEIGHT}
      variant={isError ? "error" : "default"}
    >
      <div className="p-2">
        <table className="w-full text-xs font-mono">
          <tbody>
            {parsed.files.map((file) => (
              <tr key={file.path} className="group/row">
                <td className="text-zinc-300 pr-4 py-0.5">
                  <div className="flex items-center gap-2">
                    <span className="truncate">{file.path}</span>
                    <CopyButton text={file.path} label="Copy path" />
                  </div>
                </td>
                <td className="text-zinc-500 text-right whitespace-nowrap py-0.5">
                  {file.matchCount}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-zinc-700/50">
              <td className="text-zinc-400 font-medium pt-1">Total</td>
              <td className="text-zinc-400 font-medium text-right pt-1">
                {parsed.totalMatches}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </CollapsibleOutputBlock>
  </div>
)}
```

#### Empty Results

```typescript
{isExpanded && !hasResults && !isRunning && (
  <div className="mt-2 text-xs text-zinc-500 italic px-2">
    No matches found for "{pattern}"
  </div>
)}
```

#### Running State (No Results Yet)

```typescript
{isExpanded && !hasResults && isRunning && (
  <div className="mt-2 ml-6">
    <div className="text-xs font-mono p-2 rounded border border-zinc-700/50 text-zinc-500">
      Searching...
      <span className="inline-block w-2 h-4 bg-zinc-400 animate-pulse ml-1" />
    </div>
  </div>
)}
```

### State Management

**Uses `useToolExpandStore` for persistence (same pattern as BashToolBlock):**

```typescript
// Main tool block expand/collapse - persisted in Zustand store
const isExpanded = useToolExpandStore((state) => state.isToolExpanded(threadId, id));
const setToolExpanded = useToolExpandStore((state) => state.setToolExpanded);
const setIsExpanded = (expanded: boolean) => setToolExpanded(threadId, id, expanded);

// Output expand/collapse - persisted in Zustand store
const isOutputExpanded = useToolExpandStore((state) =>
  state.isOutputExpanded(threadId, id, defaultOutputExpanded)
);
const setOutputExpanded = useToolExpandStore((state) => state.setOutputExpanded);
const setIsOutputExpanded = (expanded: boolean) => setOutputExpanded(threadId, id, expanded);

// Per-file expand/collapse - local state (not persisted)
const [expandedFiles, setExpandedFiles] = useState<Set<string>>(new Set());

function toggleFileExpanded(filePath: string) {
  setExpandedFiles(prev => {
    const next = new Set(prev);
    if (next.has(filePath)) {
      next.delete(filePath);
    } else {
      next.add(filePath);
    }
    return next;
  });
}
```

---

## Reusable UI Components

| Component | Import Path | Props Used | Purpose in GrepToolBlock |
|-----------|-------------|------------|--------------------------|
| `ExpandChevron` | `@/components/ui/expand-chevron` | `isExpanded`, `size` ("sm" or "md") | Animated chevron for main header and per-file headers |
| `ShimmerText` | `@/components/ui/shimmer-text` | `isShimmering`, `className` | "Search" text animation while `status === "running"` |
| `CopyButton` | `@/components/ui/copy-button` | `text`, `label`, `alwaysVisible?` | Copy pattern, file paths, individual match lines |
| `StatusIcon` | `@/components/ui/status-icon` | `isSuccess` | Show failure icon when `isError === true` |
| `CollapsibleOutputBlock` | `@/components/ui/collapsible-output-block` | `isExpanded`, `onToggle`, `isLongContent`, `maxCollapsedHeight`, `variant` | Main results container with gradient fade for long content |
| `CollapsibleBlock` | `@/components/ui/collapsible-block` | `isExpanded`, `onToggle`, `header`, `children` | Per-file collapsible sections |

---

## Special Considerations

### Pattern Highlighting

**Approach:**
1. Parse pattern as regex (handle literal strings too)
2. Find all match positions in each line using `String.matchAll()`
3. Split line into text + match segments
4. Render matches with `<mark className="bg-yellow-200/30 text-yellow-100 rounded-sm px-0.5">`

**Case Sensitivity:**
- Check `input["-i"]` flag
- Build regex with `i` flag if case-insensitive (`!input["-i"]`)

**Regex vs Literal:**
- Grep tool accepts regex patterns
- Use try/catch to parse pattern as RegExp
- Fall back to literal string highlighting if regex is invalid

### Context Lines

**Configuration:**
- Respect `-B` (lines before), `-A` (lines after), `-C` (context both) from input
- Default to 0 context if not specified
- Parse context from the raw result string

**Display:**
- Before/after lines styled in `text-zinc-600` (very muted)
- Match line in `text-zinc-200` (normal)
- Line numbers shown for match line only

### Large Result Sets

**Optimization:**
- If file count > 20 or total matches > 100, default `isOutputExpanded` to `false`
- Use `CollapsibleOutputBlock` with `maxCollapsedHeight={300}` for gradient fade
- Per-file sections default to collapsed
- Only render visible file sections (lazy render on expand)

### Error States

**When `isError === true`:**
- Display error message from result string (don't try to parse)
- Use `variant="error"` on `CollapsibleOutputBlock` for red border
- Show `StatusIcon` with `isSuccess={false}` in header

**Empty results:**
- Show "No matches found for [pattern]"
- Don't render file list
- Remain collapsible to keep UI compact

---

## Props Interface

The component uses `ToolBlockProps` from `./index.ts`, which matches the data extracted from Anthropic API types:

```typescript
import type { ToolBlockProps } from "./index";

// ToolBlockProps shape (already defined in index.ts):
interface ToolBlockProps {
  id: string;                      // From ToolUseBlock.id
  name: string;                    // From ToolUseBlock.name ("Grep")
  input: Record<string, unknown>;  // From ToolUseBlock.input (cast to GrepInput)
  result?: string;                 // From ToolResultBlockParam.content
  isError?: boolean;               // From ToolResultBlockParam.is_error
  status: ToolStatus;              // Derived from execution state
  durationMs?: number;             // Calculated from execution timing
  isFocused?: boolean;             // For keyboard navigation
  threadId: string;                // For persisting expand state
}
```

---

## Testing Strategy

### Unit Tests

```typescript
describe("GrepToolBlock", () => {
  it("renders 'Search' text with shimmer while running", () => {
    render(<GrepToolBlock {...runningProps} />);
    expect(screen.getByText("Search")).toHaveClass("animate-shimmer");
  });

  it("displays pattern + match summary when complete", () => {
    render(<GrepToolBlock {...completeProps} />);
    expect(screen.getByText(/"useState" → 15 matches in 8 files/)).toBeInTheDocument();
  });

  it("groups results by file path in content mode", () => {
    render(<GrepToolBlock {...contentModeProps} />);
    fireEvent.click(screen.getByRole("button")); // Expand
    expect(screen.getByText("src/hooks.ts")).toBeInTheDocument();
    expect(screen.getByText("src/components.tsx")).toBeInTheDocument();
  });

  it("highlights pattern in match lines", () => {
    render(<GrepToolBlock {...highlightProps} />);
    fireEvent.click(screen.getByRole("button")); // Expand
    const marks = screen.getAllByRole("mark") || document.querySelectorAll("mark");
    expect(marks.length).toBeGreaterThan(0);
  });

  it("renders file list in files_with_matches mode", () => {
    render(<GrepToolBlock {...filesModeProps} />);
    fireEvent.click(screen.getByRole("button")); // Expand
    // Should show file paths without match details
    expect(screen.queryByText(/\d+ match/)).not.toBeInTheDocument();
  });

  it("renders count table in count mode", () => {
    render(<GrepToolBlock {...countModeProps} />);
    fireEvent.click(screen.getByRole("button")); // Expand
    expect(screen.getByText("Total")).toBeInTheDocument();
  });

  it("expands/collapses main block on click", () => {
    render(<GrepToolBlock {...completeProps} />);
    const header = screen.getByRole("button");
    expect(screen.queryByText(/src\//)).not.toBeInTheDocument();
    fireEvent.click(header);
    expect(screen.getByText(/src\//)).toBeInTheDocument();
  });

  it("copies pattern to clipboard", async () => {
    render(<GrepToolBlock {...completeProps} />);
    const copyBtn = screen.getByLabelText("Copy pattern");
    fireEvent.click(copyBtn);
    expect(await navigator.clipboard.readText()).toBe("useState");
  });

  it("shows 'No matches found' when result is empty", () => {
    render(<GrepToolBlock {...noMatchesProps} />);
    fireEvent.click(screen.getByRole("button")); // Expand
    expect(screen.getByText(/No matches found/)).toBeInTheDocument();
  });

  it("shows error state with StatusIcon", () => {
    render(<GrepToolBlock {...errorProps} />);
    expect(screen.getByTestId("grep-tool-" + errorProps.id)).toHaveAttribute(
      "data-tool-status",
      "error"
    );
  });

  it("does not render raw JSON to users", () => {
    render(<GrepToolBlock {...completeProps} />);
    fireEvent.click(screen.getByRole("button")); // Expand
    // Ensure no JSON brackets or object notation visible
    expect(screen.queryByText(/^\{/)).not.toBeInTheDocument();
    expect(screen.queryByText(/"pattern":/)).not.toBeInTheDocument();
  });
});
```

### Integration Tests

- Test with real grep output from various file types (tsx, ts, js, json)
- Test with large result sets (100+ matches)
- Test with special regex patterns (escapes, character classes, lookahead)
- Test keyboard navigation (Tab, Enter, Space to expand/collapse)
- Test screen reader accessibility (aria labels, sr-only text)
- Test all three output modes with realistic data

### Visual Tests

- Snapshot test for basic layout
- Visual regression tests for:
  - Shimmer animation while running
  - Pattern highlighting in various contexts
  - Expanded/collapsed states
  - Different match counts (1, few, many)
  - Long file paths (truncation)
  - Error state styling
  - All three output modes

---

## Success Criteria

1. **Header follows two-line layout convention**
   - **Line 1:** `ExpandChevron` + `ShimmerText` ("Search") + Duration - chevron controls expand/collapse, shimmer when running
   - **Line 2:** `Search` icon + pattern/match summary + `CopyButton` - icon ONLY on this line
   - Consistent spacing and alignment with `ml-6` indent on line 2

2. **Results are displayed semantically (no raw JSON)**
   - Content mode: Grouped by file with line numbers and context
   - Files mode: Clean file list with copy buttons
   - Count mode: Table with totals

3. **Pattern is highlighted**
   - Yellow/orange background for matches
   - Correct match positions (case-sensitive if needed)
   - Works with regex patterns, falls back gracefully

4. **Reusable components are used consistently**
   - `CopyButton` for pattern, paths, lines, full output
   - `ShimmerText` for running state
   - `ExpandChevron` for collapsible headers
   - `CollapsibleBlock` for per-file sections
   - `CollapsibleOutputBlock` for main results with gradient
   - `StatusIcon` for error indication

5. **UX is polished**
   - Expand state persists via Zustand store
   - Keyboard navigation works (Tab, Enter, Space)
   - ARIA labels for accessibility
   - Respects input options (-i, -C, -A, -B, head_limit, output_mode)

6. **Performance is acceptable**
   - Handles 100+ matches gracefully
   - Large files don't cause layout shifts
   - Lazy rendering of expanded sections

---

## Files to Create/Modify

### Create

- `/src/components/thread/tool-blocks/grep-tool-block.tsx` - Main component
- `/src/components/thread/tool-blocks/__tests__/grep-tool-block.test.tsx` - Unit tests

### Modify

- `/src/components/thread/tool-blocks/index.ts` - Add GrepToolBlock to registry:
  ```typescript
  import { GrepToolBlock } from "./grep-tool-block";

  const TOOL_BLOCK_REGISTRY: Record<string, ToolBlockComponent> = {
    bash: BashToolBlock,
    grep: GrepToolBlock,  // Add this line
  };

  export { BashToolBlock, GrepToolBlock };
  ```

### Related (Already Exists)

- `/src/components/ui/copy-button.tsx` - Used for copying
- `/src/components/ui/shimmer-text.tsx` - Used for running state
- `/src/components/ui/expand-chevron.tsx` - Used for expand/collapse
- `/src/components/ui/status-icon.tsx` - Used for error indication
- `/src/components/ui/collapsible-block.tsx` - Used for file sections
- `/src/components/ui/collapsible-output-block.tsx` - Used for long results
- `/src/stores/tool-expand-store.ts` - Used for expand state persistence

---

## Dependencies

**Imports:**
```typescript
import { useState } from "react";
import { Search, FileText } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDuration } from "@/lib/utils/time-format";
import { useToolExpandStore } from "@/stores/tool-expand-store";
import { CopyButton } from "@/components/ui/copy-button";
import { ShimmerText } from "@/components/ui/shimmer-text";
import { ExpandChevron } from "@/components/ui/expand-chevron";
import { StatusIcon } from "@/components/ui/status-icon";
import { CollapsibleBlock } from "@/components/ui/collapsible-block";
import { CollapsibleOutputBlock } from "@/components/ui/collapsible-output-block";
import type { ToolBlockProps } from "./index";
```

**No new external dependencies** - all components already exist.

---

## Timeline & Effort

**Estimated effort:** 2-3 hours

**Tasks:**
1. Implement `parseGrepResult()` with all three output modes (40 min)
2. Implement `highlightPattern()` function (20 min)
3. Build main component structure following BashToolBlock (30 min)
4. Implement header + summary lines with reusable components (20 min)
5. Implement expanded results for content mode (30 min)
6. Implement expanded results for files and count modes (20 min)
7. Style and polish (15 min)
8. Write unit tests (25 min)
9. Test with real grep output (15 min)

---

## Related Plans

- **Parent:** `/plans/tool-result-rendering-overhaul.md` - Overall tool rendering overhaul
- **Prerequisite:** `/plans/extract-reusable-tool-block-components.md` - Reusable UI components (completed)
- **Similar:** `/plans/tool-result-rendering-overhaul/glob-tool-block.md` - Similar file listing component

---

## Notes

- The Grep tool in this codebase is the Grep tool from the Agent SDK (not a bash-level grep)
- The `result` prop is always a string from `ToolResultBlockParam.content` - must be parsed
- Results may be in different formats depending on `output_mode` input:
  - `"content"` (default): Full lines with context - display as code with highlighting
  - `"files_with_matches"`: Just file paths - display as clean file list
  - `"count"`: Count per file - display as table with totals
- **Never display raw JSON** - always parse and render semantically
- Pattern matching should respect the `-i` (case-insensitive) flag
- Context lines should respect `-B`, `-A`, `-C` input parameters
