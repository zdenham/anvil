# Sub-Plan 04: ToolUseBlock Integration

## Overview

Modify the existing ToolUseBlock component to render inline diffs when Edit/Write tools are used, with optional accept/reject buttons for pending edits.

## Dependencies

- **01-diff-extraction-utilities.md** - Uses `extractDiffFromToolResult`, `generateEditDiff`, `generateWriteDiff`
- **02-inline-diff-components.md** - Renders `InlineDiffBlock`

## Depends On This

- `06-ui-tests.md` - Tests the integrated behavior

---

## Scope

### Files to Modify

1. `src/components/thread/tool-use-block.tsx` - Add inline diff rendering

### Files to Reference

- `core/types/events.ts` - `ToolExecutionState` type

---

## Implementation Details

### 4.1 Add Imports

```typescript
import { InlineDiffBlock } from "./inline-diff-block";
import {
  extractDiffFromToolResult,
  generateEditDiff,
  generateWriteDiff,
} from "@/lib/utils/diff-extractor";
import type { EditToolInput, WriteToolInput } from "@/lib/utils/diff-extractor";
```

### 4.2 Update Props Interface

Add new props to `ToolUseBlockProps`:

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

### 4.3 Diff Detection Logic

Add inside ToolUseBlock component:

```typescript
function ToolUseBlock({ name, input, status, result, ... }: ToolUseBlockProps) {
  const isEditTool = name.toLowerCase() === "edit";
  const isWriteTool = name.toLowerCase() === "write";

  // Helper to validate EditToolInput shape at runtime
  function isValidEditInput(input: unknown): input is EditToolInput {
    return (
      typeof input === "object" &&
      input !== null &&
      typeof (input as EditToolInput).file_path === "string" &&
      typeof (input as EditToolInput).old_string === "string" &&
      typeof (input as EditToolInput).new_string === "string"
    );
  }

  // Helper to validate WriteToolInput shape at runtime
  function isValidWriteInput(input: unknown): input is WriteToolInput {
    return (
      typeof input === "object" &&
      input !== null &&
      typeof (input as WriteToolInput).file_path === "string" &&
      typeof (input as WriteToolInput).content === "string"
    );
  }

  // Try to extract diff from result, or generate from input
  const diffData = useMemo(() => {
    // First try extracting from completed result
    const extracted = extractDiffFromToolResult(name, result);
    if (extracted) {
      return {
        filePath: extracted.filePath,
        diff: extracted.diff,
        fromResult: true,
      };
    }

    // For pending/running, generate from input with runtime validation
    if (isEditTool && input) {
      if (isValidEditInput(input)) {
        const generated = generateEditDiff(input);
        return {
          filePath: generated.filePath,
          diff: generated.diff, // generateEditDiff now returns diff string directly
          fromResult: false,
        };
      } else {
        // Fallback: cannot extract diff data from malformed input
        logger.warn("Invalid EditToolInput shape", { input });
        return null;
      }
    }

    if (isWriteTool && input) {
      if (isValidWriteInput(input)) {
        const generated = generateWriteDiff(input);
        return {
          filePath: generated.filePath,
          diff: generated.diff, // generateWriteDiff now returns diff string directly
          fromResult: false,
        };
      } else {
        // Fallback: cannot extract diff data from malformed input
        logger.warn("Invalid WriteToolInput shape", { input });
        return null;
      }
    }

    return null;
  }, [name, result, input, isEditTool, isWriteTool]);

  // ...
}
```

### 4.4 Conditional Rendering

Add to the render section:

```typescript
{diffData && (
  <div className="px-3 pb-3">
    <InlineDiffBlock
      filePath={diffData.filePath}
      diff={diffData.diff}
      isPending={status === "pending"}
      onAccept={onAccept}
      onReject={onReject}
      isFocused={isFocused}
      onExpand={() => onOpenDiff?.(diffData.filePath)}
    />
  </div>
)}
```

### 4.5 Status Handling

The component should visually indicate status:

- `running`: Show spinner, diff may be generated from input
- `pending`: Show diff with accept/reject buttons
- `complete`: Show diff from result (read-only)
- `error`: Show error state, optionally show partial diff

### 4.6 Return Type Clarification

**Note:** Per the updated Sub-Plan 01, `generateEditDiff` and `generateWriteDiff` now return unified diff strings directly (not `AnnotatedLine[]` arrays). This eliminates the need for a `buildUnifiedDiff` helper function.

The return type is:
```typescript
{ filePath: string; diff: string; stats: { additions: number; deletions: number } }
```

This ensures consistency: all diff data flows as unified diff strings, and `InlineDiffBlock` uses `parseDiff()` to convert to annotated lines for rendering.

### 4.7 Fallback Behavior

When diff data cannot be extracted (due to malformed input or missing fields):
- Log a warning via logger for debugging
- Return `null` from diffData computation
- `InlineDiffBlock` will not be rendered
- The tool use block falls back to showing standard tool input/output display
- User can still see the raw tool input JSON for debugging

---

## Verification

```bash
# Type check
pnpm tsc --noEmit

# Run related tests
pnpm test src/components/thread/

# Manual verification
# 1. Start dev server
# 2. Trigger an Edit tool in a thread
# 3. Verify inline diff appears
# 4. Verify expand button works (if onOpenDiff provided)
```

---

## Acceptance Criteria

- [ ] Edit tool results render inline diff
- [ ] Write tool results render inline diff
- [ ] Pending status shows accept/reject buttons
- [ ] Running status shows spinner with generated preview
- [ ] Complete status shows read-only diff
- [ ] Non-Edit/Write tools are unaffected
- [ ] Expand button calls `onOpenDiff` with file path
- [ ] No TypeScript errors
- [ ] Component stays under 250 lines
