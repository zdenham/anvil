# Simple Task Diff Viewer Improvements

## Problem Statement

The simple task diff viewer (in the Changes tab) has two UX issues:

1. **Fixed file height with internal scrolling**: Files with longer diffs are constrained to a fixed 256px height (`max-h-64`) with internal scrolling. Users expect the file container to expand to show all diff content without needing to scroll within each file.

2. **Missing expand/collapse for full file context**: Users expect to be able to expand collapsed regions to see the full file, not just the diff hunks. The current implementation only shows diff hunks (changed lines + ~3 lines of context) with no way to view the rest of the file.

## Investigation Findings

### Root Cause of Issue #2

The expand/collapse functionality **does exist** in `InlineDiffBlock` via the `useCollapsedRegions` hook, but **it effectively never triggers** because:

1. **`InlineDiffBlock` only has diff hunks, not full file content**
   - See `inline-diff-block.tsx` lines 74-86: it builds `annotatedLines` only from hunk data
   - Comment on line 74-75 explicitly states: "For inline display, we only have the diff lines (no full file content)"

2. **`useCollapsedRegions` requires 8+ consecutive unchanged lines to create a collapsible region**
   - See `use-collapsed-regions.ts` line 5: `MIN_COLLAPSE_LINES = 8`
   - Standard git diffs only include ~3 lines of context around each change
   - So there are never 8+ consecutive unchanged lines in the hunk data

3. **Contrast with the full `DiffViewer` component**
   - `DiffViewer` uses `buildAnnotatedFiles()` which merges the diff with `fullFileContents`
   - This creates the full file with all unchanged lines, making collapse/expand meaningful
   - `InlineDiffBlock` doesn't have access to full file contents

### Why This Matters

In the simple task changes tab, a small edit to a README shows only:
- The changed lines
- ~3 lines of context above/below

There's no way to see the rest of the file. Users expect a "show more" / "expand" button to reveal the full file context, similar to GitHub's diff viewer.

## Current Architecture

```
DiffViewer (full featured)
├── Has: fullFileContents prop
├── Uses: buildAnnotatedFiles() to merge diff + full content
├── Result: Full file with all lines, collapsible unchanged regions work
└── Has: Global expand/collapse all buttons

InlineDiffBlock (simple task)
├── Has: Only raw diff string
├── Uses: parseDiff() to extract hunk lines only
├── Result: Only diff hunks (~3 context lines), no collapsible regions
└── Missing: No expand/collapse UI at all
```

## Proposed Solution

### Issue 1: Remove Fixed Height Constraint

**File to modify**: `src/components/thread/inline-diff-block.tsx`

**Change**: Remove the `max-h-64 overflow-y-auto` classes from the diff content container:

```tsx
// Before (line 155):
className="bg-surface-900/50 max-h-64 overflow-y-auto"

// After:
className="bg-surface-900/50"
```

**Rationale**: The parent container (`changes-tab.tsx` line 199) already has `overflow-y-auto` on the outer wrapper, so the page itself will scroll. Each file diff should display at its natural height.

### Issue 2: Enable Full File Expansion

There are two approaches:

#### Option A: Fetch Full File Contents in Changes Tab (Recommended)

Modify `ChangesTab` to fetch full file contents and use the same annotation approach as `DiffViewer`.

**Changes needed**:

1. **Add file content fetching to `ChangesTab`**
   - After getting the diff, also fetch current file contents for each changed file
   - Use existing Tauri commands (or add one) to read file contents

2. **Use `buildAnnotatedFiles` instead of raw diff parsing**
   - Import and use the same `buildAnnotatedFiles` function from `@/lib/annotated-file-builder`
   - This merges diff hunks with full file content

3. **Pass annotated lines to `InlineDiffBlock`**
   - `InlineDiffBlock` already accepts a `lines` prop for pre-computed annotated lines
   - Pass the full annotated lines from `buildAnnotatedFiles`

4. **Add expand/collapse UI to `InlineDiffHeader`**
   - Add a toggle button when collapsible regions exist
   - Wire up `expandAll`/`collapseAll` from `useCollapsedRegions`

**Implementation in ChangesTab**:
```tsx
// After generating diff, fetch file contents
const fileContents: Record<string, string[]> = {};
for (const file of diffResult.diff.files) {
  const path = file.newPath ?? file.oldPath;
  if (path && file.type !== 'deleted') {
    const content = await readFileContents(path, workingDirectory);
    fileContents[path] = content.split('\n');
  }
}

// Build annotated files with full content
const annotatedFiles = buildAnnotatedFiles(diffResult.diff, fileContents);

// Render with full lines
<InlineDiffBlock
  filePath={filePath}
  lines={annotatedFile.lines}  // Full file, not just hunks
  stats={annotatedFile.file.stats}
/>
```

#### Option B: Add "Load Full File" Button (Alternative)

Keep current behavior but add a button to load the full file on demand.

**Pros**: Faster initial load, less data fetched upfront
**Cons**: More complex UX, requires additional click

### Expand/Collapse UI (for both options)

Once we have full file content, add the expand/collapse controls:

**Files to modify**:
1. `src/components/thread/inline-diff-block.tsx` - Pass collapse state to header
2. `src/components/thread/inline-diff-header.tsx` - Add toggle button

**In `InlineDiffBlock`**:
```tsx
<InlineDiffHeader
  filePath={filePath}
  stats={stats}
  onExpand={onExpand}
  // New props:
  hasCollapsedRegions={collapsedRegions.regions.length > 0}
  allExpanded={collapsedRegions.expanded.size === collapsedRegions.regions.length}
  onExpandAll={collapsedRegions.expandAll}
  onCollapseAll={collapsedRegions.collapseAll}
/>
```

**In `InlineDiffHeader`**:
```tsx
{hasCollapsedRegions && (
  <button
    onClick={allExpanded ? onCollapseAll : onExpandAll}
    className="text-xs text-surface-400 hover:text-surface-200 flex items-center gap-1"
    aria-label={allExpanded ? "Collapse unchanged regions" : "Expand unchanged regions"}
  >
    {allExpanded ? <ChevronsDownUp size={14} /> : <ChevronsUpDown size={14} />}
    <span>{allExpanded ? "Collapse" : "Expand"}</span>
  </button>
)}
```

## Implementation Steps

1. **Remove fixed height constraint**
   - Edit `inline-diff-block.tsx` line 155
   - Remove `max-h-64 overflow-y-auto` classes

2. **Add file content reading capability**
   - Check if a Tauri command exists to read file contents
   - If not, add one (simple fs read)

3. **Update `ChangesTab` to fetch full file contents**
   - After diff generation, read each changed file's current content
   - Build annotated files using `buildAnnotatedFiles`

4. **Pass full annotated lines to `InlineDiffBlock`**
   - Use the `lines` prop instead of `diff` prop
   - This enables proper collapsed regions

5. **Add expand/collapse UI to header**
   - Update `InlineDiffHeader` props
   - Add toggle button with appropriate icons
   - Wire up state and handlers

6. **Test thoroughly**
   - Verify collapsed regions appear for unchanged sections
   - Verify expand/collapse works
   - Verify full file is viewable when expanded

## Files to Modify

1. `src/components/simple-task/changes-tab.tsx`
   - Add file content fetching
   - Use `buildAnnotatedFiles` for full file annotation
   - Pass annotated lines to `InlineDiffBlock`

2. `src/components/thread/inline-diff-block.tsx`
   - Remove height constraint
   - Pass collapse state to header

3. `src/components/thread/inline-diff-header.tsx`
   - Add expand/collapse toggle button
   - Add new props interface

4. Possibly `src-tauri/src/lib.rs` or similar
   - Add file read command if not already present

## Testing Checklist

- [ ] Small diffs display without internal scroll
- [ ] Large diffs display at full height (page scrolls, not file)
- [ ] Collapsed region placeholders appear (e.g., "42 unchanged lines")
- [ ] Clicking placeholder expands that region
- [ ] Expand all button shows all unchanged lines
- [ ] Collapse all button hides unchanged regions
- [ ] Individual region toggles still work
- [ ] Deleted files handled correctly (no file to read)
- [ ] New files handled correctly
- [ ] Binary files don't break anything
