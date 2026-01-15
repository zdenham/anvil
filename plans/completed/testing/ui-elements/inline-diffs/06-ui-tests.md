# Sub-Plan 06: UI Tests

## Overview

Create comprehensive UI tests for the inline diff components. This includes unit tests for utilities, UI isolation tests for React components, and integration tests for the full thread flow.

## Dependencies

- **01-diff-extraction-utilities.md** - Utilities being tested
- **02-inline-diff-components.md** - Components being tested
- **03-keyboard-navigation.md** - Hook being tested
- **04-tooluse-block-integration.md** - Integration being tested
- **05-test-ids-and-queries.md** - Query helpers used in tests

## Depends On This

- None - This is the final testing phase

---

## Scope

### Files to Create

1. `src/components/thread/inline-diff-block.ui.test.tsx` (~200 lines)
2. `src/components/thread/tool-use-block.ui.test.tsx` (~150 lines)
3. `src/components/thread/thread-with-diffs.ui.test.tsx` (~100 lines)

### Test Pattern

UI isolation tests use `.ui.test.tsx` suffix and run headlessly via Vitest + happy-dom.

---

## Implementation Details

### 6.1 InlineDiffBlock UI Tests

**File:** `src/components/thread/inline-diff-block.ui.test.tsx`

```typescript
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@/test/helpers";
import { InlineDiffBlock } from "./inline-diff-block";

// Mock logger
vi.mock("@/lib/logger-client", () => ({
  logger: { log: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));

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
```

**Test Categories:**

1. **Rendering**
   - Renders file path in header
   - Renders addition lines with green styling
   - Renders deletion lines with red styling
   - Renders stats badge with correct counts
   - Has correct test ID

2. **Collapsed Regions**
   - Shows collapsed region placeholder for unchanged blocks >= 8 lines
   - Expands collapsed region when clicked

3. **Expand Button**
   - Renders expand button when onExpand provided
   - Does not render expand button when onExpand not provided
   - Calls onExpand when expand button clicked

4. **Pending Mode**
   - Does not show buttons when not pending
   - Shows accept/reject buttons when pending
   - Calls onAccept when accept clicked
   - Calls onReject when reject clicked
   - Responds to keyboard shortcuts when focused

5. **Accessibility**
   - Has region role with aria-label
   - Has table semantics for diff content
   - Has proper aria-labels on line rows

6. **Edge Cases**
   - Shows placeholder for empty diff
   - Shows error state for invalid diff format
   - Handles diff with no context lines

**Mocking parseDiff for Edge Cases:**

To test error handling and edge cases, mock the `parseDiff` function:

```typescript
import * as diffParser from "@/lib/diff-parser";

describe("InlineDiffBlock error handling", () => {
  it("shows error state when parseDiff throws", () => {
    vi.spyOn(diffParser, "parseDiff").mockImplementation(() => {
      throw new Error("Invalid diff format");
    });

    render(<InlineDiffBlock filePath="/test.ts" diff="invalid diff" />);

    expect(screen.getByText(/failed to parse diff/i)).toBeInTheDocument();
    // Should show raw diff as fallback
    expect(screen.getByText("invalid diff")).toBeInTheDocument();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });
});
```

**Snapshot Testing Recommendation:**

Consider adding snapshot tests for the rendered diff output to catch unintended visual regressions:

```typescript
it("matches snapshot for standard diff", () => {
  const { container } = render(
    <InlineDiffBlock filePath="/src/foo.ts" diff={sampleDiff} />
  );
  expect(container).toMatchSnapshot();
});
```

Snapshots are particularly useful for:
- Verifying line number formatting
- Catching CSS class changes
- Ensuring consistent rendering of additions/deletions

### 6.2 ToolUseBlock UI Tests

**File:** `src/components/thread/tool-use-block.ui.test.tsx`

**Test Categories:**

1. **Edit Tool**
   - Renders inline diff when Edit result contains diff
   - Does not render inline diff when Edit result has no diff
   - Renders accept/reject buttons for pending Edit
   - Generates preview diff from input when running

2. **Write Tool**
   - Renders inline diff for Write results
   - Handles new file creation (all additions)

3. **Non-Edit/Write Tools**
   - Does not render inline diff for Read tool
   - Does not render inline diff for Bash tool

4. **Status Handling**
   - Shows spinner for running status
   - Shows read-only diff for complete status
   - Shows accept/reject for pending status
   - Shows error styling for error status

### 6.3 Thread Integration Tests

**File:** `src/components/thread/thread-with-diffs.ui.test.tsx`

**Test Categories:**

1. **Thread with Edit Tools**
   - Renders inline diffs for Edit tool uses in assistant messages
   - Multiple Edit tools in same message render separately
   - Tool state updates reflect in diff display

2. **Scrolling Behavior**
   - Scrolls to keep diffs in view during streaming

3. **Pending Edit Flow**
   - Accept/reject buttons work in thread context
   - Keyboard shortcuts work for focused diff

### 6.4 Edge Cases to Cover

| Case | Expected Behavior |
|------|-------------------|
| Parse failures | Graceful error, show raw diff fallback |
| Large diffs (1000+ lines) | Scroll works, virtualization if needed |
| Binary files | "Binary file changed" placeholder |
| Renamed files | Show old path -> new path |
| Deleted files | All lines as deletions |
| New files | All lines as additions |
| Multiple hunks | Proper separation and line numbering |
| Special characters | Unicode, tabs, long lines handled |
| Empty files | Created/deleted empty files handled |
| Empty edits | old_string === new_string shows no changes |
| Path edge cases | Paths with spaces, unicode paths |
| Rapid updates | Multiple pending edits in quick succession |

---

## Verification

```bash
# Run all UI tests
pnpm test:ui

# Run specific test files
pnpm test src/components/thread/inline-diff-block.ui.test.tsx
pnpm test src/components/thread/tool-use-block.ui.test.tsx
pnpm test src/components/thread/thread-with-diffs.ui.test.tsx

# Run with coverage
pnpm test:ui --coverage
```

---

## Acceptance Criteria

- [ ] All InlineDiffBlock tests pass
- [ ] All ToolUseBlock tests pass
- [ ] All integration tests pass
- [ ] Edge cases are covered
- [ ] No flaky tests
- [ ] Tests follow established patterns (mock logger, use test helpers)
- [ ] Test files stay under 250 lines
