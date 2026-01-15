# Inline Diffs Implementation Plan

## Consolidated From

This plan consolidates two previous plans:
- `diff-viewing.md` - Inline diff display for completed edits
- `edit-diffs.md` - Inline diff display with accept/reject for pending edits

Both plans display inline diffs in the thread using shared diff-viewer components. This consolidated plan builds a single `InlineDiffBlock` component with optional pending-edit mode.

---

## Overview

Display file changes inline when Edit/Write tools are used, with optional Accept/Reject buttons for confirming changes before they're applied.

## Prerequisites

The pending-edit mode (accept/reject) depends on the **Permission Prompts** feature (`permission-prompts.md`) which handles:
- `PreToolUse` hook integration in the agent
- Permission request/response event flow via stdin/stdout
- The underlying accept/reject mechanism

This plan focuses specifically on the **diff visualization** aspect within the tool use block.

## Design Decisions

This plan follows several documented patterns:

- **YAGNI**: Reuse existing diff-viewer components rather than creating new abstractions
- **Type Layering**: All new types are frontend-only (component props), so they stay in `src/`
- **Zod at Boundaries**: Use plain TypeScript for component props (not Zod), but JSON.parse results need defensive handling
- **Testing**: UI isolation tests with `.ui.test.tsx` suffix, unit tests for utilities

---

## Current State

Existing diff-viewer at `src/components/diff-viewer/`:
- `DiffViewer` - Main component
- `DiffFileCard` - Per-file card rendering
- `AnnotatedLineRow` - Line-by-line rendering with +/- indicators
- `VirtualizedFileContent` - Performance for large files
- `useDiffKeyboard` - j/k navigation, e/c expand/collapse
- `useCollapsedRegions` - Collapsed regions for unchanged lines
- Full accessibility support

Existing diff parsing at `src/lib/`:
- `diff-parser.ts` - Parses unified diff format into structured `ParsedDiff`
- `annotated-file-builder.ts` - Builds annotated line arrays from parsed diffs

Tool state tracking:
- `ToolExecutionState` in `core/types/events.ts:159-165`
- `ToolUseBlock` (`src/components/thread/tool-use-block.tsx`) currently shows raw JSON input/output
- Agents run with `permissionMode: "bypassPermissions"` (see `agents/src/runners/shared.ts:237`)

---

## Phase 1: Diff Extraction Utilities

### 1.1 Create DiffExtractor Utility

**File:** `src/lib/utils/diff-extractor.ts` (~60 lines)

Per **Zod at Boundaries**: The tool result is JSON from an external source (agent process), so we need defensive parsing. A try/catch with manual field checks is sufficient for this narrow use case.

```typescript
// src/lib/utils/diff-extractor.ts
import type { AnnotatedLine } from "@/components/diff-viewer/types";

export interface ExtractedDiff {
  filePath: string;
  diff: string;
  operation: "create" | "modify" | "delete";
}

export interface EditToolInput {
  file_path: string;
  old_string: string;
  new_string: string;
}

export interface WriteToolInput {
  file_path: string;
  content: string;
}

/**
 * Extract diff from tool result JSON.
 * Used when the agent has already computed and returned a diff.
 */
export function extractDiffFromToolResult(
  toolName: string,
  result: string | undefined
): ExtractedDiff | null {
  if (!result) return null;
  if (toolName !== "Edit" && toolName !== "Write") return null;

  try {
    const parsed = JSON.parse(result);
    // Defensive field checking - data comes from agent process
    if (typeof parsed.diff !== "string" || typeof parsed.filePath !== "string") {
      return null;
    }
    return {
      filePath: parsed.filePath,
      diff: parsed.diff,
      operation: parsed.operation ?? "modify",
    };
  } catch {
    return null;
  }
}

/**
 * Generate annotated lines from Edit tool input.
 * Compares old_string and new_string to produce a minimal diff.
 */
export function generateEditDiff(input: EditToolInput): {
  filePath: string;
  lines: AnnotatedLine[];
  stats: { additions: number; deletions: number };
};

/**
 * Generate annotated lines from Write tool input.
 * For new files, all lines are additions. For overwrites, shows full content.
 */
export function generateWriteDiff(
  input: WriteToolInput,
  existingContent?: string
): {
  filePath: string;
  lines: AnnotatedLine[];
  stats: { additions: number; deletions: number };
};
```

### 1.2 Implementation Details

1. For `extractDiffFromToolResult`:
   - Parse JSON safely with try/catch
   - Validate required fields exist and are strings
   - Return null for any invalid input

2. For `generateEditDiff`:
   - Split `old_string` and `new_string` by newlines
   - Mark lines unique to `old_string` as deletions
   - Mark lines unique to `new_string` as additions
   - Context lines (unchanged) are marked as unchanged

3. For `generateWriteDiff`:
   - If `existingContent` is null, all lines are additions
   - If `existingContent` exists, compute line-by-line diff

4. Functions should be pure (no side effects) and under 50 lines each.

### 1.3 Add sanitizeTestId Utility

**File:** Add to `src/lib/utils/index.ts`

```typescript
export function sanitizeTestId(path: string): string {
  return path.replace(/[^a-zA-Z0-9-]/g, "-");
}
```

**Note:** This is a pure utility function - keep it simple, no unnecessary abstractions (YAGNI).

### 1.4 Unit Tests

**File:** `src/lib/utils/diff-extractor.test.ts` (~120 lines)

```typescript
import { describe, it, expect } from "vitest";
import {
  extractDiffFromToolResult,
  generateEditDiff,
  generateWriteDiff,
} from "./diff-extractor";

describe("extractDiffFromToolResult", () => {
  describe("valid Edit tool results", () => {
    it("extracts diff from Edit tool JSON result", () => {
      const result = JSON.stringify({
        filePath: "/src/foo.ts",
        success: true,
        diff: "diff --git a/src/foo.ts...",
      });

      const extracted = extractDiffFromToolResult("Edit", result);

      expect(extracted).toEqual({
        filePath: "/src/foo.ts",
        diff: "diff --git a/src/foo.ts...",
        operation: "modify",
      });
    });

    it("extracts diff from Write tool result", () => {
      const result = JSON.stringify({
        filePath: "/src/new.ts",
        success: true,
        diff: "diff --git...",
        operation: "create",
      });

      const extracted = extractDiffFromToolResult("Write", result);

      expect(extracted?.operation).toBe("create");
    });
  });

  describe("invalid inputs", () => {
    it("returns null for non-Edit/Write tools", () => {
      expect(extractDiffFromToolResult("Read", "...")).toBeNull();
      expect(extractDiffFromToolResult("Bash", "...")).toBeNull();
    });

    it("returns null for undefined result", () => {
      expect(extractDiffFromToolResult("Edit", undefined)).toBeNull();
    });

    it("returns null for non-JSON result", () => {
      expect(extractDiffFromToolResult("Edit", "not json")).toBeNull();
    });

    it("returns null when diff field missing", () => {
      const result = JSON.stringify({ filePath: "/foo.ts", success: true });
      expect(extractDiffFromToolResult("Edit", result)).toBeNull();
    });

    it("returns null when filePath field missing", () => {
      const result = JSON.stringify({ diff: "...", success: true });
      expect(extractDiffFromToolResult("Edit", result)).toBeNull();
    });
  });
});

describe("generateEditDiff", () => {
  it("marks replaced lines as deletion + addition", () => {
    const result = generateEditDiff({
      file_path: "/test.txt",
      old_string: "hello world",
      new_string: "hello universe",
    });

    expect(result.lines).toHaveLength(2);
    expect(result.lines[0]).toMatchObject({ type: "deletion", content: "hello world" });
    expect(result.lines[1]).toMatchObject({ type: "addition", content: "hello universe" });
    expect(result.stats).toEqual({ additions: 1, deletions: 1 });
  });

  it("handles multiline edits", () => {
    const result = generateEditDiff({
      file_path: "/test.txt",
      old_string: "line1\nline2",
      new_string: "line1\nline2\nline3",
    });

    expect(result.lines).toHaveLength(3);
    expect(result.lines[2]).toMatchObject({ type: "addition", content: "line3" });
    expect(result.stats).toEqual({ additions: 1, deletions: 0 });
  });

  it("returns empty diff for identical strings", () => {
    const result = generateEditDiff({
      file_path: "/test.txt",
      old_string: "same",
      new_string: "same",
    });

    expect(result.lines).toHaveLength(0);
    expect(result.stats).toEqual({ additions: 0, deletions: 0 });
  });
});

describe("generateWriteDiff", () => {
  it("marks all lines as additions for new file", () => {
    const result = generateWriteDiff({
      file_path: "/new.txt",
      content: "line1\nline2",
    });

    expect(result.lines).toHaveLength(2);
    expect(result.lines.every(l => l.type === "addition")).toBe(true);
    expect(result.stats).toEqual({ additions: 2, deletions: 0 });
  });

  it("computes diff when existing content provided", () => {
    const result = generateWriteDiff(
      { file_path: "/test.txt", content: "new content" },
      "old content"
    );

    expect(result.lines.some(l => l.type === "deletion")).toBe(true);
    expect(result.lines.some(l => l.type === "addition")).toBe(true);
  });
});
```

---

## Phase 2: Create InlineDiffBlock Component

### 2.1 Component Types

The existing types in `src/components/diff-viewer/types.ts` already cover:
- `AnnotatedLine` - Line with type (addition/deletion/unchanged)
- `CollapsedRegion` - Region of unchanged lines to collapse
- `ParsedDiffFile` - Parsed file metadata

No new types required - reuse existing ones. Per **Zod at Boundaries** pattern, component props use plain TypeScript interfaces (not Zod) since they are internal code structure.

### 2.2 Create InlineDiffBlock Component

**File:** `src/components/thread/inline-diff-block.tsx` (~150 lines)

```typescript
interface InlineDiffBlockProps {
  /** Absolute file path */
  filePath: string;
  /** Raw unified diff string */
  diff: string;
  /** Whether this block is currently focused for keyboard nav */
  isFocused?: boolean;
  /** Callback when user wants to open full diff viewer */
  onExpand?: () => void;
  /** Whether this edit is pending user approval (enables accept/reject mode) */
  isPending?: boolean;
  /** Callback when user accepts (only shown when isPending) */
  onAccept?: () => void;
  /** Callback when user rejects (only shown when isPending) */
  onReject?: () => void;
}
```

**Implementation steps:**

1. **Import dependencies:**
   ```typescript
   import { memo, useMemo } from "react";
   import { parseDiff } from "@/lib/diff-parser";
   import { AnnotatedLineRow } from "../diff-viewer/annotated-line-row";
   import { CollapsedRegionPlaceholder } from "../diff-viewer/collapsed-region-placeholder";
   import { useCollapsedRegions, buildRenderItems } from "../diff-viewer/use-collapsed-regions";
   import { InlineDiffHeader } from "./inline-diff-header";
   import { InlineDiffActions } from "./inline-diff-actions";
   import type { AnnotatedLine } from "../diff-viewer/types";
   ```

2. **Create main component:**
   - Parse diff string with `parseDiff(diff)` (memoized)
   - Extract first file from parsed result
   - Build annotated lines using existing helpers
   - Use `useCollapsedRegions` hook for collapse state
   - Use `buildRenderItems` to generate render list

3. **Render structure:**
   ```tsx
   <div
     data-testid={`inline-diff-${sanitizeTestId(filePath)}`}
     className="rounded-lg border border-surface-700 overflow-hidden max-h-64 overflow-y-auto"
     role="region"
     aria-label={`Changes to ${fileName}`}
   >
     <InlineDiffHeader filePath={filePath} stats={stats} onExpand={onExpand} />
     <div role="table" aria-label="Diff content" className="bg-surface-900/50">
       <div role="rowgroup">
         {renderItems.map((item) => (
           // Render AnnotatedLineRow or CollapsedRegionPlaceholder
         ))}
       </div>
     </div>
     {isPending && (
       <InlineDiffActions
         onAccept={onAccept}
         onReject={onReject}
         isFocused={isFocused}
       />
     )}
   </div>
   ```

4. **Handle edge cases:**
   - Empty diff: Show "No changes" message
   - Parse error: Show error state with raw diff fallback
   - Binary file: Show "Binary file changed" placeholder

### 2.3 Create InlineDiffHeader Component

**File:** `src/components/thread/inline-diff-header.tsx` (~60 lines)

```typescript
interface InlineDiffHeaderProps {
  filePath: string;
  stats: { additions: number; deletions: number };
  onExpand?: () => void;
}
```

**Implementation:**
- File icon based on extension (reuse lucide-react icons)
- Truncated file path with tooltip
- Stats badge: `+N -M`
- Expand button (ArrowUpRight icon) when `onExpand` provided
- Sticky header when scrolling within diff block

### 2.4 Create InlineDiffActions Component

**File:** `src/components/thread/inline-diff-actions.tsx` (~50 lines)

```typescript
interface InlineDiffActionsProps {
  onAccept?: () => void;
  onReject?: () => void;
  isFocused?: boolean;
}
```

**Visual Design:**
```
├─────────────────────────────────────────────────────────┤
│                              [✓ Accept (y)]  [✗ Reject] │
└─────────────────────────────────────────────────────────┘
```

**Implementation:**
- Only rendered when parent passes `isPending={true}`
- Accept button with keyboard hint "(y)"
- Reject button with keyboard hint "(n)"
- When `isFocused`, buttons receive keyboard focus

---

## Phase 3: Integrate with ToolUseBlock

### 3.1 Identify Edit/Write Tool Results

The tool result for Edit/Write contains a JSON string with the diff. Parse pattern:

```typescript
interface EditToolResult {
  filePath: string;
  success: boolean;
  diff?: string;  // Unified diff format
}
```

### 3.2 Modify ToolUseBlock

**File:** `src/components/thread/tool-use-block.tsx`

Add imports:
```typescript
import { InlineDiffBlock } from "./inline-diff-block";
import { extractDiffFromToolResult, generateEditDiff, generateWriteDiff } from "@/lib/utils/diff-extractor";
import type { EditToolInput, WriteToolInput } from "@/lib/utils/diff-extractor";
```

Detect Edit/Write tools and extract/generate diff:
```typescript
function ToolUseBlock({ name, input, status, result, ... }: ToolUseBlockProps) {
  const isEditTool = name.toLowerCase() === "edit";
  const isWriteTool = name.toLowerCase() === "write";

  // Try to extract diff from result, or generate from input
  const diffData = useMemo(() => {
    // First try extracting from completed result
    const extracted = extractDiffFromToolResult(name, result);
    if (extracted) return extracted;

    // For pending/running, generate from input
    if (isEditTool) {
      return generateEditDiff(input as EditToolInput);
    }
    if (isWriteTool) {
      return generateWriteDiff(input as WriteToolInput);
    }
    return null;
  }, [name, result, input, isEditTool, isWriteTool]);

  // ...
}
```

Add conditional rendering of `InlineDiffBlock`:
```typescript
{diffData && (
  <div className="px-3 pb-3">
    <InlineDiffBlock
      filePath={diffData.filePath}
      diff={diffData.diff}
      isPending={status === "pending"}
      onAccept={onAccept}
      onReject={onReject}
      onExpand={() => onOpenDiff?.(diffData.filePath)}
    />
  </div>
)}
```

### 3.3 Updated Props

```typescript
interface ToolUseBlockProps {
  id: string;
  name: string;
  input: Record<string, unknown>;
  result?: string;
  isError?: boolean;
  status: "running" | "complete" | "error" | "pending"; // Add "pending"
  durationMs?: number;
  // Props for diff expansion
  onOpenDiff?: (filePath: string) => void;
  // Props for pending edits (from permission-prompts integration)
  onAccept?: () => void;
  onReject?: () => void;
  isFocused?: boolean;
}
```

---

## Phase 4: Keyboard Navigation

### 4.1 Create useInlineDiffKeyboard Hook

**File:** `src/components/thread/use-inline-diff-keyboard.ts` (~80 lines)

Pattern: Follow `use-diff-keyboard.ts` exactly.

```typescript
interface UseInlineDiffKeyboardOptions {
  /** Collapse/expand controls */
  expandAllRegions: () => void;
  collapseAllRegions: () => void;
  /** Full viewer expansion */
  openFullViewer?: () => void;
  /** Pending edit navigation (only when pending edits exist) */
  focusedIndex?: number;
  pendingCount?: number;
  onFocusChange?: (index: number) => void;
  /** Accept/reject actions (only for pending mode) */
  onAccept?: () => void;
  onReject?: () => void;
  onAcceptAll?: () => void;
  /** Whether keyboard shortcuts are enabled */
  enabled?: boolean;
}

export function useInlineDiffKeyboard({
  expandAllRegions,
  collapseAllRegions,
  openFullViewer,
  focusedIndex = 0,
  pendingCount = 0,
  onFocusChange,
  onAccept,
  onReject,
  onAcceptAll,
  enabled = true,
}: UseInlineDiffKeyboardOptions) {
  useEffect(() => {
    if (!enabled) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Skip if in input/textarea
      const target = e.target as HTMLElement;
      if (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable
      ) {
        return;
      }

      switch (e.key) {
        // Collapse/expand
        case "e":
          e.preventDefault();
          expandAllRegions();
          break;
        case "c":
          e.preventDefault();
          collapseAllRegions();
          break;
        case "Enter":
          e.preventDefault();
          openFullViewer?.();
          break;

        // Pending edit navigation (only when pending edits exist)
        case "n":
          if (pendingCount > 0 && onFocusChange) {
            e.preventDefault();
            onFocusChange((focusedIndex + 1) % pendingCount);
          }
          break;
        case "p":
          if (pendingCount > 0 && onFocusChange) {
            e.preventDefault();
            onFocusChange((focusedIndex - 1 + pendingCount) % pendingCount);
          }
          break;

        // Accept/reject (only for pending mode)
        case "y":
          if (onAccept) {
            e.preventDefault();
            onAccept();
          }
          break;
        case "r":
        case "Escape":
          if (onReject) {
            e.preventDefault();
            onReject();
          }
          break;
        case "a":
          if (onAcceptAll) {
            e.preventDefault();
            onAcceptAll();
          }
          break;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    enabled,
    expandAllRegions,
    collapseAllRegions,
    openFullViewer,
    focusedIndex,
    pendingCount,
    onFocusChange,
    onAccept,
    onReject,
    onAcceptAll,
  ]);
}
```

### 4.2 Keyboard Mappings

| Key | Action | Mode |
|-----|--------|------|
| `e` | Expand all collapsed regions | All |
| `c` | Collapse unchanged regions | All |
| `Enter` | Open full diff viewer | All |
| `n` | Focus next pending edit | Pending |
| `p` | Focus previous pending edit | Pending |
| `y` | Accept focused edit | Pending |
| `r` / `Escape` | Reject focused edit | Pending |
| `a` | Accept all pending edits | Pending |
| `j` / `k` | Navigate within diff (scroll hunks) | All |
| `?` | Show keyboard help modal | All |

### 4.3 Wire Keyboard to InlineDiffBlock

Add keyboard support when focused:
```typescript
useInlineDiffKeyboard({
  expandAllRegions: collapsedRegions.expandAll,
  collapseAllRegions: collapsedRegions.collapseAll,
  openFullViewer: onExpand,
  onAccept: isPending ? onAccept : undefined,
  onReject: isPending ? onReject : undefined,
  enabled: isFocused,
});
```

---

## Phase 5: Test IDs and Query Helpers

### 5.1 Update testIds in queries.ts

**File:** `src/test/helpers/queries.ts`

Add to `testIds` object:
```typescript
// Inline Diff
inlineDiff: (filePath: string) => `inline-diff-${filePath.replace(/[^a-zA-Z0-9-]/g, "-")}`,
inlineDiffHeader: (filePath: string) => `inline-diff-header-${filePath.replace(/[^a-zA-Z0-9-]/g, "-")}`,
inlineDiffExpandButton: (filePath: string) => `inline-diff-expand-${filePath.replace(/[^a-zA-Z0-9-]/g, "-")}`,
inlineDiffContent: (filePath: string) => `inline-diff-content-${filePath.replace(/[^a-zA-Z0-9-]/g, "-")}`,
inlineDiffAcceptButton: (filePath: string) => `inline-diff-accept-${filePath.replace(/[^a-zA-Z0-9-]/g, "-")}`,
inlineDiffRejectButton: (filePath: string) => `inline-diff-reject-${filePath.replace(/[^a-zA-Z0-9-]/g, "-")}`,
```

### 5.2 Add Query Helpers

```typescript
export function getInlineDiff(filePath: string): HTMLElement {
  return screen.getByTestId(testIds.inlineDiff(filePath));
}

export function queryInlineDiff(filePath: string): HTMLElement | null {
  return screen.queryByTestId(testIds.inlineDiff(filePath));
}
```

---

## Phase 6: Integration with Permission System

This phase connects to the broader permission prompts feature. The key integration points are:

### 6.1 Event Types (in `core/types/events.ts`)

Add new events for pending edits:

```typescript
// Add to EventName
EDIT_PENDING: "edit:pending",
EDIT_ACCEPTED: "edit:accepted",
EDIT_REJECTED: "edit:rejected",

// Add to EventPayloads
// NOTE: Per event-bridge pattern, payloads are SIGNALS only - just enough to identify the entity.
// The diff data is stored in ToolExecutionState on disk/memory, NOT carried in the event.
[EventName.EDIT_PENDING]: {
  toolUseId: string;
  threadId: string;
};
[EventName.EDIT_ACCEPTED]: { toolUseId: string; threadId: string };
[EventName.EDIT_REJECTED]: { toolUseId: string; threadId: string };
```

**Important**: The `filePath` and `diff` data are retrieved from `ToolExecutionState` after the event triggers a refresh, NOT from the event payload itself. This follows the "events are signals, not data carriers" principle.

### 6.2 ToolExecutionState Extension

Add "pending" status to `core/types/events.ts`:

```typescript
export const ToolExecutionStateSchema = z.object({
  status: z.enum(["running", "complete", "error", "pending"]), // Add "pending"
  result: z.string().optional(),
  isError: z.boolean().optional(),
  toolName: z.string().optional(),
  // New fields for pending edits
  pendingDiff: z.string().optional(),
  filePath: z.string().optional(),
});
```

---

## File Structure Summary

Per **General Coding Practices**: Files stay under 250 lines, functions under 50 lines.

```
src/components/thread/
  inline-diff-block.tsx           # ~150 lines - Main component
  inline-diff-header.tsx          # ~60 lines - Header with stats and expand
  inline-diff-actions.tsx         # ~50 lines - Accept/reject buttons
  use-inline-diff-keyboard.ts     # ~80 lines - Keyboard nav hook
  inline-diff-block.ui.test.tsx   # ~200 lines - Component tests
  tool-use-block.tsx              # MODIFY - Add inline diff integration
  tool-use-block.ui.test.tsx      # CREATE - Tool use block tests

src/lib/utils/
  diff-extractor.ts               # ~80 lines - Extract/generate diff from tool result
  diff-extractor.test.ts          # ~120 lines - Unit tests

src/test/helpers/
  queries.ts                      # MODIFY - Add inline diff test IDs
```

All files are kebab-cased per naming conventions.

---

## Testing Strategy

Per **Testing** docs: All code must be verified. Unit tests for utilities, UI isolation tests for React components.

### Unit Tests

#### diff-extractor.test.ts

See Phase 1.4 for full test implementation.

### UI Component Tests

Per **Testing** docs: UI isolation tests use `.ui.test.tsx` suffix and run headlessly via Vitest + happy-dom.

#### inline-diff-block.ui.test.tsx

```typescript
import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@/test/helpers";
import { InlineDiffBlock } from "./inline-diff-block";

// Mock logger per Logging guidelines - never use console.log
vi.mock("@/lib/logger-client", () => ({
  logger: { log: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));

describe("InlineDiffBlock", () => {
  const sampleDiff = `diff --git a/src/foo.ts b/src/foo.ts
index abc123..def456 100644
--- a/src/foo.ts
+++ b/src/foo.ts
@@ -1,3 +1,4 @@
 const x = 1;
-const y = 2;
+const y = 3;
+const z = 4;
 export { x };`;

  describe("rendering", () => {
    it("renders file path in header", () => {
      render(<InlineDiffBlock filePath="/src/foo.ts" diff={sampleDiff} />);

      expect(screen.getByText("foo.ts")).toBeInTheDocument();
    });

    it("renders addition lines in green", () => {
      render(<InlineDiffBlock filePath="/src/foo.ts" diff={sampleDiff} />);

      const addedLine = screen.getByText("const y = 3;");
      expect(addedLine.closest('[role="row"]')).toHaveClass("bg-emerald-950/30");
    });

    it("renders deletion lines in red", () => {
      render(<InlineDiffBlock filePath="/src/foo.ts" diff={sampleDiff} />);

      const deletedLine = screen.getByText("const y = 2;");
      expect(deletedLine.closest('[role="row"]')).toHaveClass("bg-red-950/30");
    });

    it("renders stats badge with correct counts", () => {
      render(<InlineDiffBlock filePath="/src/foo.ts" diff={sampleDiff} />);

      expect(screen.getByText("+2")).toBeInTheDocument();
      expect(screen.getByText("-1")).toBeInTheDocument();
    });

    it("has correct test ID", () => {
      render(<InlineDiffBlock filePath="/src/foo.ts" diff={sampleDiff} />);

      expect(screen.getByTestId("inline-diff--src-foo-ts")).toBeInTheDocument();
    });
  });

  describe("collapsed regions", () => {
    const largeDiff = `diff --git a/big.ts b/big.ts
--- a/big.ts
+++ b/big.ts
@@ -1,20 +1,21 @@
 line1
 line2
 line3
 line4
 line5
 line6
 line7
 line8
 line9
-line10
+line10 changed
 line11
 line12
 line13
 line14
 line15
 line16
 line17
 line18
 line19
 line20`;

    it("shows collapsed region placeholder for unchanged blocks >= 8 lines", () => {
      render(<InlineDiffBlock filePath="/big.ts" diff={largeDiff} />);

      // Should show "N unchanged lines" placeholder
      expect(screen.getByText(/unchanged lines/)).toBeInTheDocument();
    });

    it("expands collapsed region when clicked", async () => {
      const { user } = render(<InlineDiffBlock filePath="/big.ts" diff={largeDiff} />);

      const placeholder = screen.getByRole("button", { name: /unchanged lines/i });
      await user.click(placeholder);

      // After expanding, should show individual lines
      expect(screen.getByText("line1")).toBeInTheDocument();
    });
  });

  describe("expand button", () => {
    it("renders expand button when onExpand provided", () => {
      const onExpand = vi.fn();
      render(
        <InlineDiffBlock filePath="/src/foo.ts" diff={sampleDiff} onExpand={onExpand} />
      );

      expect(screen.getByRole("button", { name: /expand/i })).toBeInTheDocument();
    });

    it("does not render expand button when onExpand not provided", () => {
      render(<InlineDiffBlock filePath="/src/foo.ts" diff={sampleDiff} />);

      expect(screen.queryByRole("button", { name: /expand/i })).not.toBeInTheDocument();
    });

    it("calls onExpand when expand button clicked", async () => {
      const onExpand = vi.fn();
      const { user } = render(
        <InlineDiffBlock filePath="/src/foo.ts" diff={sampleDiff} onExpand={onExpand} />
      );

      await user.click(screen.getByRole("button", { name: /expand/i }));

      expect(onExpand).toHaveBeenCalledTimes(1);
    });
  });

  describe("pending mode", () => {
    it("does not show buttons when not pending", () => {
      render(
        <InlineDiffBlock
          filePath="/src/foo.ts"
          diff={sampleDiff}
          isPending={false}
        />
      );

      expect(screen.queryByRole("button", { name: /accept/i })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /reject/i })).not.toBeInTheDocument();
    });

    it("shows and handles accept/reject buttons when pending", async () => {
      const onAccept = vi.fn();
      const onReject = vi.fn();

      const { user } = render(
        <InlineDiffBlock
          filePath="/src/foo.ts"
          diff={sampleDiff}
          isPending={true}
          onAccept={onAccept}
          onReject={onReject}
        />
      );

      const acceptBtn = screen.getByRole("button", { name: /accept/i });
      const rejectBtn = screen.getByRole("button", { name: /reject/i });

      await user.click(acceptBtn);
      expect(onAccept).toHaveBeenCalledTimes(1);

      await user.click(rejectBtn);
      expect(onReject).toHaveBeenCalledTimes(1);
    });

    it("responds to keyboard shortcuts when focused", () => {
      const onAccept = vi.fn();
      const onReject = vi.fn();

      render(
        <InlineDiffBlock
          filePath="/src/foo.ts"
          diff={sampleDiff}
          isPending={true}
          isFocused={true}
          onAccept={onAccept}
          onReject={onReject}
        />
      );

      // Simulate 'y' keypress for accept
      fireEvent.keyDown(document, { key: "y" });
      expect(onAccept).toHaveBeenCalledTimes(1);

      // Simulate 'n' keypress for reject
      fireEvent.keyDown(document, { key: "r" });
      expect(onReject).toHaveBeenCalledTimes(1);
    });
  });

  describe("accessibility", () => {
    it("has region role with aria-label", () => {
      render(<InlineDiffBlock filePath="/src/foo.ts" diff={sampleDiff} />);

      expect(screen.getByRole("region", { name: /changes to foo.ts/i })).toBeInTheDocument();
    });

    it("has table semantics for diff content", () => {
      render(<InlineDiffBlock filePath="/src/foo.ts" diff={sampleDiff} />);

      expect(screen.getByRole("table", { name: /diff content/i })).toBeInTheDocument();
    });

    it("has proper aria-labels on line rows", () => {
      render(<InlineDiffBlock filePath="/src/foo.ts" diff={sampleDiff} />);

      expect(screen.getByRole("row", { name: /added/i })).toBeInTheDocument();
      expect(screen.getByRole("row", { name: /deleted/i })).toBeInTheDocument();
    });
  });

  describe("edge cases", () => {
    it("shows placeholder for empty diff", () => {
      render(<InlineDiffBlock filePath="/src/foo.ts" diff="" />);

      expect(screen.getByText(/no changes/i)).toBeInTheDocument();
    });

    it("shows error state for invalid diff format", () => {
      render(<InlineDiffBlock filePath="/src/foo.ts" diff="not a valid diff" />);

      expect(screen.getByText(/unable to parse/i)).toBeInTheDocument();
    });

    it("handles diff with no context lines", () => {
      const diffNoContext = `diff --git a/foo.ts b/foo.ts
--- a/foo.ts
+++ b/foo.ts
@@ -1 +1 @@
-old
+new`;

      render(<InlineDiffBlock filePath="/foo.ts" diff={diffNoContext} />);

      expect(screen.getByText("old")).toBeInTheDocument();
      expect(screen.getByText("new")).toBeInTheDocument();
    });
  });
});
```

#### tool-use-block.ui.test.tsx

```typescript
describe("ToolUseBlock with diff rendering", () => {
  describe("Edit tool", () => {
    it("renders inline diff when Edit result contains diff", () => {
      const result = JSON.stringify({
        filePath: "/src/app.ts",
        success: true,
        diff: `diff --git a/src/app.ts b/src/app.ts
--- a/src/app.ts
+++ b/src/app.ts
@@ -1 +1 @@
-old
+new`,
      });

      render(
        <ToolUseBlock
          id="tool-1"
          name="Edit"
          input={{ file_path: "/src/app.ts", old_string: "old", new_string: "new" }}
          result={result}
          status="complete"
        />
      );

      expect(screen.getByTestId(/inline-diff/)).toBeInTheDocument();
      expect(screen.getByText("new")).toBeInTheDocument();
    });

    it("does not render inline diff when Edit result has no diff", () => {
      const result = JSON.stringify({
        filePath: "/src/app.ts",
        success: true,
      });

      render(
        <ToolUseBlock
          id="tool-1"
          name="Edit"
          input={{ file_path: "/src/app.ts" }}
          result={result}
          status="complete"
        />
      );

      expect(screen.queryByTestId(/inline-diff/)).not.toBeInTheDocument();
    });

    it("renders accept/reject buttons for pending Edit", () => {
      render(
        <ToolUseBlock
          id="tool-1"
          name="Edit"
          input={{ file_path: "/src/app.ts", old_string: "old", new_string: "new" }}
          status="pending"
        />
      );

      expect(screen.getByRole("button", { name: /accept/i })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /reject/i })).toBeInTheDocument();
    });
  });

  describe("non-Edit tools", () => {
    it("does not render inline diff for Read tool", () => {
      render(
        <ToolUseBlock
          id="tool-1"
          name="Read"
          input={{ file_path: "/src/app.ts" }}
          result="file contents"
          status="complete"
        />
      );

      expect(screen.queryByTestId(/inline-diff/)).not.toBeInTheDocument();
    });
  });
});
```

### Integration Tests

#### Thread with diff blocks test

Create `src/components/thread/thread-with-diffs.ui.test.tsx`:

```typescript
describe("Thread with diff blocks", () => {
  it("renders inline diffs for Edit tool uses in assistant messages", async () => {
    const messagesWithEdit: MessageParam[] = [
      { role: "user", content: "Fix the bug" },
      {
        role: "assistant",
        content: [
          { type: "text", text: "I'll fix that." },
          {
            type: "tool_use",
            id: "edit-1",
            name: "Edit",
            input: { file_path: "/src/bug.ts", old_string: "bad", new_string: "good" },
          },
        ],
      },
    ];

    const toolStates = {
      "edit-1": {
        status: "complete" as const,
        result: JSON.stringify({
          filePath: "/src/bug.ts",
          success: true,
          diff: `diff --git...`,
        }),
      },
    };

    render(
      <ThreadView
        messages={messagesWithEdit}
        isStreaming={false}
        status="running"
        toolStates={toolStates}
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId(/inline-diff/)).toBeInTheDocument();
    });
  });

  it("scrolls to keep diffs in view during streaming", async () => {
    // Test auto-scroll behavior with new diff blocks
  });
});
```

### Keyboard Hook Tests

**File:** `src/components/thread/use-inline-diff-keyboard.test.ts`

```typescript
import { renderHook } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { useInlineDiffKeyboard } from "./use-inline-diff-keyboard";

describe("useInlineDiffKeyboard", () => {
  const defaultOptions = {
    expandAllRegions: vi.fn(),
    collapseAllRegions: vi.fn(),
  };

  describe("collapse/expand", () => {
    it("calls expandAllRegions when 'e' is pressed", () => {
      const expandAllRegions = vi.fn();

      renderHook(() =>
        useInlineDiffKeyboard({ ...defaultOptions, expandAllRegions })
      );

      window.dispatchEvent(new KeyboardEvent("keydown", { key: "e" }));

      expect(expandAllRegions).toHaveBeenCalledTimes(1);
    });

    it("calls collapseAllRegions when 'c' is pressed", () => {
      const collapseAllRegions = vi.fn();

      renderHook(() =>
        useInlineDiffKeyboard({ ...defaultOptions, collapseAllRegions })
      );

      window.dispatchEvent(new KeyboardEvent("keydown", { key: "c" }));

      expect(collapseAllRegions).toHaveBeenCalledTimes(1);
    });
  });

  describe("pending edit navigation", () => {
    it("calls onFocusChange when 'n' is pressed", () => {
      const onFocusChange = vi.fn();

      renderHook(() =>
        useInlineDiffKeyboard({
          ...defaultOptions,
          focusedIndex: 0,
          pendingCount: 3,
          onFocusChange,
        })
      );

      window.dispatchEvent(new KeyboardEvent("keydown", { key: "n" }));

      expect(onFocusChange).toHaveBeenCalledWith(1);
    });

    it("wraps focus index at boundaries", () => {
      const onFocusChange = vi.fn();

      renderHook(() =>
        useInlineDiffKeyboard({
          ...defaultOptions,
          focusedIndex: 2,
          pendingCount: 3,
          onFocusChange,
        })
      );

      window.dispatchEvent(new KeyboardEvent("keydown", { key: "n" }));
      expect(onFocusChange).toHaveBeenCalledWith(0); // Wraps to start
    });
  });

  describe("accept/reject", () => {
    it("calls onAccept when 'y' is pressed", () => {
      const onAccept = vi.fn();

      renderHook(() =>
        useInlineDiffKeyboard({
          ...defaultOptions,
          onAccept,
        })
      );

      window.dispatchEvent(new KeyboardEvent("keydown", { key: "y" }));
      expect(onAccept).toHaveBeenCalledTimes(1);
    });

    it("calls onReject when 'r' is pressed", () => {
      const onReject = vi.fn();

      renderHook(() =>
        useInlineDiffKeyboard({
          ...defaultOptions,
          onReject,
        })
      );

      window.dispatchEvent(new KeyboardEvent("keydown", { key: "r" }));
      expect(onReject).toHaveBeenCalledTimes(1);
    });

    it("calls onAcceptAll when 'a' is pressed", () => {
      const onAcceptAll = vi.fn();

      renderHook(() =>
        useInlineDiffKeyboard({
          ...defaultOptions,
          onAcceptAll,
        })
      );

      window.dispatchEvent(new KeyboardEvent("keydown", { key: "a" }));
      expect(onAcceptAll).toHaveBeenCalledTimes(1);
    });
  });

  describe("input exclusion", () => {
    it("does not trigger when typing in input", () => {
      const onAccept = vi.fn();

      renderHook(() =>
        useInlineDiffKeyboard({
          ...defaultOptions,
          onAccept,
        })
      );

      // Create and dispatch event with input as target
      const input = document.createElement("input");
      document.body.appendChild(input);
      input.focus();

      const event = new KeyboardEvent("keydown", { key: "y", bubbles: true });
      Object.defineProperty(event, "target", { value: input });
      input.dispatchEvent(event);

      expect(onAccept).not.toHaveBeenCalled();
      document.body.removeChild(input);
    });
  });

  describe("enabled state", () => {
    it("is disabled when enabled=false", () => {
      const onAccept = vi.fn();

      renderHook(() =>
        useInlineDiffKeyboard({
          ...defaultOptions,
          onAccept,
          enabled: false,
        })
      );

      window.dispatchEvent(new KeyboardEvent("keydown", { key: "y" }));
      expect(onAccept).not.toHaveBeenCalled();
    });
  });
});
```

### Edge Cases to Test

1. **Parse failures:** Invalid diff format should show graceful error
2. **Large diffs:** Performance with 1000+ line diffs (verify scroll works)
3. **Binary files:** Show "Binary file changed" instead of diff
4. **Renamed files:** Show old path -> new path
5. **Deleted files:** All lines shown as deletions
6. **New files:** All lines shown as additions
7. **Multiple hunks:** Proper separation and line numbering
8. **Special characters:** Unicode, tabs, long lines
9. **Empty files:** Created/deleted empty files
10. **Empty edits**: `old_string === new_string`
11. **Path edge cases**: Paths with spaces, unicode paths
12. **Rapid updates**: Multiple pending edits in quick succession

---

## Running Tests

```bash
# Run all tests
pnpm test

# Run UI isolation tests only
pnpm test:ui

# Run specific test file
pnpm test src/components/thread/inline-diff-block.ui.test.tsx

# Type check
pnpm tsc --noEmit
```

---

## Implementation Checklist

- [ ] Phase 1: Diff Extraction Utilities
  - [ ] Create `diff-extractor.ts`
  - [ ] Create `diff-extractor.test.ts`
  - [ ] Add `sanitizeTestId` utility

- [ ] Phase 2: InlineDiffBlock Component
  - [ ] Create `inline-diff-block.tsx`
  - [ ] Create `inline-diff-header.tsx`
  - [ ] Create `inline-diff-actions.tsx`

- [ ] Phase 3: ToolUseBlock Integration
  - [ ] Modify `tool-use-block.tsx`
  - [ ] Create `tool-use-block.ui.test.tsx`

- [ ] Phase 4: Keyboard Navigation
  - [ ] Create `use-inline-diff-keyboard.ts`
  - [ ] Create `use-inline-diff-keyboard.test.ts`
  - [ ] Wire to InlineDiffBlock

- [ ] Phase 5: Test IDs
  - [ ] Add test IDs to queries.ts
  - [ ] Add query helpers

- [ ] Phase 6: Permission System Integration (depends on permission-prompts.md)
  - [ ] Add event types to `core/types/events.ts`
  - [ ] Extend `ToolExecutionStateSchema`

- [ ] Full Test Coverage
  - [ ] Create `inline-diff-block.ui.test.tsx`
  - [ ] Create integration tests
  - [ ] Verify accessibility
  - [ ] Test edge cases

- [ ] Final Verification
  - [ ] `pnpm test` passes
  - [ ] `pnpm tsc --noEmit` passes
  - [ ] Manual testing with real agent output

---

## Critical Files Reference

| File | Purpose |
|------|---------|
| `src/components/diff-viewer/annotated-line-row.tsx` | Reuse for line rendering |
| `src/components/diff-viewer/use-collapsed-regions.ts` | Reuse collapse logic |
| `src/components/diff-viewer/collapsed-region-placeholder.tsx` | Reuse placeholder |
| `src/components/diff-viewer/types.ts` | Existing type definitions |
| `src/lib/diff-parser.ts` | Parse unified diff format |
| `src/components/thread/tool-use-block.tsx` | Integration point |
| `src/test/helpers/queries.ts` | Test ID constants |

---

## Pattern Compliance Summary

| Pattern | Status | Notes |
|---------|--------|-------|
| **Adapters** | N/A | No cross-platform code (frontend-only feature) |
| **Disk as Truth** | N/A | No disk persistence involved (UI rendering only) |
| **Event Bridge** | Compliant | Phase 6 adds events following signals-not-data pattern |
| **Entity Stores** | Compliant | Extends existing `ToolExecutionState` (single-copy principle) |
| **YAGNI** | Compliant | Reuses existing diff-viewer components; no speculative features |
| **Zod at Boundaries** | Compliant | Plain TS for props; defensive JSON.parse for external data |
| **Type Layering** | Compliant | All new types stay in `src/` (frontend-only) |

### General Coding Practices Compliance

| Guideline | Status | Notes |
|-----------|--------|-------|
| kebab-case file names | Compliant | All new files use kebab-case |
| Files < 250 lines | Compliant | Largest file is ~200 lines |
| Functions < 50 lines | Compliant | All functions are focused and concise |
| No console.log | Compliant | Tests mock the logger |
| Tests verify code | Compliant | Unit + UI isolation tests included |
| Early return pattern | Compliant | extractDiffFromToolResult uses early returns |
| Strong types | Compliant | No `any` types; plain TS interfaces for props |
