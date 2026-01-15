# Sub-Plan 01: Diff Extraction Utilities

## Overview

Create utility functions for extracting and generating diffs from Edit/Write tool inputs and results. This is a foundational module that other phases depend on.

## Dependencies

- **None** - This is a standalone utility module

## Depends On This

- `02-inline-diff-components.md` - Uses types and functions from this module
- `04-tooluse-block-integration.md` - Uses extraction functions

---

## Scope

### Files to Create

1. `src/lib/utils/diff-extractor.ts` (~80 lines)
2. `src/lib/utils/diff-extractor.test.ts` (~120 lines)

### Files to Modify

1. `src/lib/utils/index.ts` - Add `sanitizeTestId` utility export

---

## Implementation Details

### 1.1 Create diff-extractor.ts

**File:** `src/lib/utils/diff-extractor.ts`

```typescript
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
```

**Functions to implement:**

1. `extractDiffFromToolResult(toolName: string, result: string | undefined): ExtractedDiff | null`
   - Parse JSON safely with try/catch
   - Validate required fields (filePath, diff are strings)
   - Return null for any invalid input or non-Edit/Write tools
   - **Returns:** `ExtractedDiff` containing a unified diff string (not annotated lines)

2. `generateEditDiff(input: EditToolInput): { filePath: string; diff: string; stats: { additions: number; deletions: number } }`
   - Split old_string and new_string by newlines
   - Mark deleted lines, added lines, and unchanged lines
   - Compute stats
   - **Returns:** Unified diff string format (compatible with `parseDiff` from `src/lib/diff-parser.ts`)

3. `generateWriteDiff(input: WriteToolInput, existingContent?: string): { filePath: string; diff: string; stats: { additions: number; deletions: number } }`
   - If no existingContent, all lines are additions
   - If existingContent exists, compute line-by-line diff
   - **Returns:** Unified diff string format (compatible with `parseDiff` from `src/lib/diff-parser.ts`)

**Diff Algorithm:**
- Use the existing `src/lib/diff-parser.ts` module for parsing unified diffs
- For generating diffs, implement a simple line-by-line Myers diff algorithm or use the `diff` npm package
- All functions return unified diff strings to ensure consistency with `InlineDiffBlock` which expects diff strings

### 1.2 Add sanitizeTestId Utility

**File:** Add to `src/lib/utils/index.ts`

```typescript
export function sanitizeTestId(path: string): string {
  return path.replace(/[^a-zA-Z0-9-]/g, "-");
}
```

### 1.3 Unit Tests

**File:** `src/lib/utils/diff-extractor.test.ts`

Test cases:
- `extractDiffFromToolResult`:
  - Extracts diff from valid Edit tool JSON result
  - Extracts diff from valid Write tool result with operation
  - Returns null for non-Edit/Write tools (Read, Bash)
  - Returns null for undefined result
  - Returns null for non-JSON result
  - Returns null when diff field missing
  - Returns null when filePath field missing

- `generateEditDiff`:
  - Marks replaced lines as deletion + addition
  - Handles multiline edits correctly
  - Returns empty diff for identical strings
  - Correctly computes stats

- `generateWriteDiff`:
  - Marks all lines as additions for new file
  - Computes diff when existing content provided

---

## Verification

```bash
# Run unit tests
pnpm test src/lib/utils/diff-extractor.test.ts

# Type check
pnpm tsc --noEmit
```

---

## Acceptance Criteria

- [ ] `extractDiffFromToolResult` safely parses JSON and validates fields
- [ ] `generateEditDiff` produces correct AnnotatedLine arrays
- [ ] `generateWriteDiff` handles both new files and overwrites
- [ ] `sanitizeTestId` is exported from utils
- [ ] All unit tests pass
- [ ] No TypeScript errors
