# Sub-Plan 05: Test IDs and Query Helpers

## Overview

Add test IDs for inline diff components and query helpers for use in UI tests. This enables reliable test targeting without depending on implementation details.

## Dependencies

- **None** - Can be implemented in parallel with other phases

## Depends On This

- `06-ui-tests.md` - Uses these test IDs and query helpers

---

## Scope

### Files to Modify

1. `src/test/helpers/queries.ts` - Add test IDs and query helpers

---

## Implementation Details

### 5.1 Add Test IDs to testIds Object

**File:** `src/test/helpers/queries.ts`

First, add the required import at the top of the file:

```typescript
import { sanitizeTestId } from "@/lib/utils";
```

Then add to the `testIds` object:

```typescript
export const testIds = {
  // ... existing test IDs ...

  // Inline Diff (using imported sanitizeTestId for consistency)
  inlineDiff: (filePath: string) =>
    `inline-diff-${sanitizeTestId(filePath)}`,
  inlineDiffHeader: (filePath: string) =>
    `inline-diff-header-${sanitizeTestId(filePath)}`,
  inlineDiffExpandButton: (filePath: string) =>
    `inline-diff-expand-${sanitizeTestId(filePath)}`,
  inlineDiffContent: (filePath: string) =>
    `inline-diff-content-${sanitizeTestId(filePath)}`,
  inlineDiffAcceptButton: (filePath: string) =>
    `inline-diff-accept-${sanitizeTestId(filePath)}`,
  inlineDiffRejectButton: (filePath: string) =>
    `inline-diff-reject-${sanitizeTestId(filePath)}`,
};
```

### 5.2 Add Query Helpers

```typescript
/**
 * Get an inline diff block by file path
 */
export function getInlineDiff(filePath: string): HTMLElement {
  return screen.getByTestId(testIds.inlineDiff(filePath));
}

/**
 * Query an inline diff block by file path (returns null if not found)
 */
export function queryInlineDiff(filePath: string): HTMLElement | null {
  return screen.queryByTestId(testIds.inlineDiff(filePath));
}

/**
 * Get the accept button for a specific inline diff
 */
export function getInlineDiffAcceptButton(filePath: string): HTMLElement {
  return screen.getByTestId(testIds.inlineDiffAcceptButton(filePath));
}

/**
 * Get the reject button for a specific inline diff
 */
export function getInlineDiffRejectButton(filePath: string): HTMLElement {
  return screen.getByTestId(testIds.inlineDiffRejectButton(filePath));
}

/**
 * Get the expand button for a specific inline diff
 */
export function getInlineDiffExpandButton(filePath: string): HTMLElement {
  return screen.getByTestId(testIds.inlineDiffExpandButton(filePath));
}

/**
 * Query the expand button for a specific inline diff (returns null if not found)
 */
export function queryInlineDiffExpandButton(filePath: string): HTMLElement | null {
  return screen.queryByTestId(testIds.inlineDiffExpandButton(filePath));
}
```

### 5.3 Path Sanitization Consistency

The sanitization logic **MUST** be imported from the shared utility to ensure consistency:
- `src/lib/utils/index.ts` - `sanitizeTestId()` (source of truth)
- `src/test/helpers/queries.ts` - **MUST import** from utils

**REQUIRED** - Import `sanitizeTestId` into queries.ts:

```typescript
import { sanitizeTestId } from "@/lib/utils";

export const testIds = {
  inlineDiff: (filePath: string) => `inline-diff-${sanitizeTestId(filePath)}`,
  inlineDiffHeader: (filePath: string) => `inline-diff-header-${sanitizeTestId(filePath)}`,
  inlineDiffExpandButton: (filePath: string) => `inline-diff-expand-${sanitizeTestId(filePath)}`,
  inlineDiffContent: (filePath: string) => `inline-diff-content-${sanitizeTestId(filePath)}`,
  inlineDiffAcceptButton: (filePath: string) => `inline-diff-accept-${sanitizeTestId(filePath)}`,
  inlineDiffRejectButton: (filePath: string) => `inline-diff-reject-${sanitizeTestId(filePath)}`,
};
```

**Do NOT duplicate** the regex `path.replace(/[^a-zA-Z0-9-]/g, "-")` inline. Always use the imported `sanitizeTestId` function.

---

## Verification

```bash
# Type check
pnpm tsc --noEmit

# Verify exports work
# Create a simple test file that imports and uses these
```

---

## Acceptance Criteria

- [ ] All inline diff test IDs are defined in `testIds` object
- [ ] Query helpers `getInlineDiff`, `queryInlineDiff` work correctly
- [ ] Button query helpers work correctly
- [ ] Path sanitization is consistent between utils and queries
- [ ] No TypeScript errors
