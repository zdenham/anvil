# Sub-Plan 02: InlineDiffBlock Components

## Overview

Create the React components for displaying inline diffs within tool use blocks. This includes the main container, header with file info and stats, and action buttons for pending edits.

## Dependencies

- **01-diff-extraction-utilities.md** - Uses types from diff-extractor

## Depends On This

- `04-tooluse-block-integration.md` - Imports and renders InlineDiffBlock
- `06-ui-tests.md` - Tests these components

---

## Scope

### Files to Create

1. `src/components/thread/inline-diff-block.tsx` (~150 lines)
2. `src/components/thread/inline-diff-header.tsx` (~60 lines)
3. `src/components/thread/inline-diff-actions.tsx` (~50 lines)

### Existing Components to Reuse

- `src/components/diff-viewer/annotated-line-row.tsx` - Line rendering
- `src/components/diff-viewer/collapsed-region-placeholder.tsx` - Collapsed regions
- `src/components/diff-viewer/use-collapsed-regions.ts` - Collapse logic
- `src/lib/diff-parser.ts` - Parse unified diff format

---

## Implementation Details

### 2.1 InlineDiffBlock Component

**File:** `src/components/thread/inline-diff-block.tsx`

**Props Interface:**
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
  /** Whether this edit is pending user approval */
  isPending?: boolean;
  /** Callback when user accepts (only shown when isPending) */
  onAccept?: () => void;
  /** Callback when user rejects (only shown when isPending) */
  onReject?: () => void;
}
```

**Implementation Steps:**

1. Import dependencies from diff-viewer and lib
2. Parse diff string with `parseDiff(diff)` (memoized with useMemo)
3. Extract first file from parsed result
4. Build annotated lines using existing helpers
5. Use `useCollapsedRegions` hook for collapse state
6. Use `buildRenderItems` to generate render list

**Render Structure:**
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

**Edge Cases to Handle:**
- Empty diff: Show "No changes" message
- Parse error: Show error state with raw diff fallback (wrap `parseDiff` call in error boundary)
- Binary file: Show "Binary file changed" placeholder

**Error Boundary Handling:**
- Wrap the diff parsing logic in a try/catch block
- If `parseDiff(diff)` throws, render a fallback UI showing:
  - Error message: "Failed to parse diff"
  - Raw diff content in a `<pre>` block for debugging
- Log parse errors via logger for debugging

**Styling Constraints:**
- Set `min-height: 48px` on the diff container to prevent layout jumps for small diffs
- Max height of 256px (`max-h-64`) with overflow scroll as specified

### 2.2 InlineDiffHeader Component

**File:** `src/components/thread/inline-diff-header.tsx`

**Props:**
```typescript
interface InlineDiffHeaderProps {
  filePath: string;
  stats: { additions: number; deletions: number };
  onExpand?: () => void;
}
```

**Implementation:**
- File icon based on extension (reuse lucide-react icons)
- Truncated file path with tooltip showing full path
- Stats badge: `+N -M` with green/red coloring
- Expand button (ArrowUpRight icon) when `onExpand` provided
- Sticky header styling for scrolling within diff block

### 2.3 InlineDiffActions Component

**File:** `src/components/thread/inline-diff-actions.tsx`

**Props:**
```typescript
interface InlineDiffActionsProps {
  onAccept?: () => void;
  onReject?: () => void;
  isFocused?: boolean;
}
```

**Visual Layout:**
```
├─────────────────────────────────────────────────────────┤
│                              [Accept (y)]  [Reject (r)] │
└─────────────────────────────────────────────────────────┘
```

**Implementation:**
- Only rendered when parent passes `isPending={true}`
- Accept button with keyboard hint "(y)"
- Reject button with keyboard hint "(r)" - note: `r` key, not `n` (n is used for navigation)
- When `isFocused`, buttons receive visual focus styling
- Use consistent button styling with rest of app

**Keyboard Focus Management:**
- Container should have `tabindex={0}` when `isPending={true}` to allow keyboard focus
- When focused, show a visible focus outline (e.g., `ring-2 ring-blue-500`)
- Accept and Reject buttons should also be keyboard-accessible with proper focus states
- Focus should be trapped within the action bar when navigating with Tab

---

## Verification

```bash
# Type check
pnpm tsc --noEmit

# Visual verification (requires 04-tooluse-block-integration)
# Start dev server and trigger Edit tool in thread
```

---

## Acceptance Criteria

- [ ] InlineDiffBlock renders diff content with proper styling
- [ ] Header shows file name, stats badge, and optional expand button
- [ ] Actions component shows accept/reject only when pending
- [ ] Collapsed regions work correctly for long unchanged sections
- [ ] Proper accessibility attributes (role, aria-label)
- [ ] Test IDs follow pattern: `inline-diff-${sanitizedPath}`
- [ ] Files stay under 250 lines each
- [ ] No TypeScript errors
