# Diff Viewer Header Improvements

Improve the sticky file header in the diff viewer: remove redundant badge, match original header width, use CSS sticky properly, add collapse-on-click, copy filename button, and a "show full file" button.

## Phases

- [x] Phase 1: Remove "Modified" badge and add collapse chevron + click-to-collapse
- [x] Phase 2: Add "Show full file" button to header
- [x] Phase 3: Apply same fixes to changes-diff-content sticky header

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Context

There are **two** file header implementations:

1. **`src/components/diff-viewer/file-header.tsx`** — used inside `DiffFileCard` (thread diff viewer). Already uses `sticky top-0 z-10` via Tailwind. This is the primary target.
2. **`src/components/changes/changes-diff-content.tsx`** (`StickyFileHeader`) — used in the virtualized changes pane. Uses `absolute` positioning because Virtuoso unmounts off-screen items. Same improvements should be mirrored here.

The file header is rendered by `DiffFileCard` (`diff-file-card.tsx`), which wraps it in a `rounded-lg overflow-hidden border` div. CSS `position: sticky` already works here — the `overflow-hidden` on the card creates the containing block, so the header sticks within each card. **No CSS changes needed for sticky behavior itself.**

## Phase 1: Remove badge, add chevron + click-to-collapse

### Problem
- The "Modified" badge is redundant — the diff itself shows what changed. Other badges (Added, Deleted, Renamed) are useful.
- There's no chevron or visual affordance to collapse a file card.
- Clicking the header does nothing.

### Changes

**`src/components/diff-viewer/file-header.tsx`**

1. **Add new props** to `FileHeaderProps`:
   ```ts
   interface FileHeaderProps {
     file: ParsedDiffFile;
     isCollapsed?: boolean;       // whether the file card content is collapsed
     onToggleCollapse?: () => void; // callback to toggle collapse
   }
   ```

2. **Remove the "Modified" badge** — conditionally hide `OperationBadge` when `type === "modified"`. Keep it for `added`, `deleted`, `renamed`, `binary`.

3. **Add a collapse chevron** at the left side of the header (before the file icon):
   ```tsx
   import { ChevronRight } from "lucide-react";

   {onToggleCollapse && (
     <ChevronRight
       className={cn(
         "w-4 h-4 text-surface-400 transition-transform duration-150 flex-shrink-0",
         !isCollapsed && "rotate-90"
       )}
       aria-hidden="true"
     />
   )}
   ```
   When not collapsed → rotated 90° (pointing down). When collapsed → pointing right.

4. **Make the entire header clickable** to toggle collapse:
   - Wrap header content in a `<button>` or add `onClick={onToggleCollapse}` and `cursor-pointer` to the outer div.
   - Use `role="button"` + `tabIndex={0}` + keyboard handler if using a div, or just switch to a `<button>` that wraps the whole header.
   - The `CopyButton` already calls `e.stopPropagation()` so it won't trigger collapse.

5. **Keep the copy button** — it's already there at line 49. Ensure it remains visible and functional. It uses `e.stopPropagation()` so no conflict with click-to-collapse.

**`src/components/diff-viewer/diff-file-card.tsx`**

6. **Add file-level collapse state** — new `useState<boolean>(false)` for `isFileCollapsed`.

7. **Pass collapse props to FileHeader**:
   ```tsx
   <FileHeader
     file={file.file}
     isCollapsed={isFileCollapsed}
     onToggleCollapse={() => setIsFileCollapsed(prev => !prev)}
   />
   ```

8. **Conditionally render diff content** — when `isFileCollapsed`, hide the diff table:
   ```tsx
   {!isFileCollapsed && (
     <div role="table" aria-label="Diff content" className="bg-surface-900/50 overflow-x-auto">
       ...
     </div>
   )}
   ```

### Width matching
The header already uses `sticky top-0` within the card's `rounded-lg overflow-hidden` container, which constrains it to the card width. The header is a flex row that fills the card. **No width changes needed** — the sticky header is already the same width as the card.

## Phase 2: Add "Show full file" button

### Problem
The diff viewer only shows diff hunks with collapsed unchanged regions between them. Users want to see the entire file.

### Key insight
The `AnnotatedFile.lines` array **already contains all lines** (full file + deletions). The `useCollapsedRegions` hook just hides consecutive unchanged lines (≥8 lines). "Show full file" = expand all collapsed regions for that file.

### Changes

**`src/components/diff-viewer/file-header.tsx`**

1. **Add new prop**:
   ```ts
   interface FileHeaderProps {
     file: ParsedDiffFile;
     isCollapsed?: boolean;
     onToggleCollapse?: () => void;
     isFullFile?: boolean;          // whether all regions are expanded
     onToggleFullFile?: () => void;  // toggle show full file
   }
   ```

2. **Add a "Show full file" button** in the header (right side, before stats):
   ```tsx
   import { FileCode } from "lucide-react";

   {onToggleFullFile && (
     <Tooltip content={isFullFile ? "Show hunks only" : "Show full file"}>
       <button
         onClick={(e) => { e.stopPropagation(); onToggleFullFile(); }}
         className={cn(
           "p-1 hover:bg-zinc-700 rounded transition-opacity shrink-0",
           "opacity-0 group-hover:opacity-100",
           isFullFile && "opacity-100 text-accent-400"
         )}
         aria-label={isFullFile ? "Show hunks only" : "Show full file"}
       >
         <FileCode className="h-3.5 w-3.5 text-zinc-400" />
       </button>
     </Tooltip>
   )}
   ```
   - Hidden by default, visible on hover (like CopyButton)
   - When active (`isFullFile`), stays visible with accent color
   - `e.stopPropagation()` to prevent triggering collapse

**`src/components/diff-viewer/diff-file-card.tsx`**

3. **Add full-file toggle state** — `useState<boolean>(false)` for `isFullFileExpanded`.

4. **Wire up to `useCollapsedRegions`** — when `isFullFileExpanded` is true, call `expandAll()`. When toggled off, call `collapseAll()`.
   ```tsx
   const [isFullFileExpanded, setIsFullFileExpanded] = useState(false);

   const handleToggleFullFile = useCallback(() => {
     setIsFullFileExpanded(prev => {
       const next = !prev;
       if (next) expandAll();
       else collapseAll();
       return next;
     });
   }, [expandAll, collapseAll]);
   ```

5. **Pass to FileHeader**:
   ```tsx
   <FileHeader
     file={file.file}
     isCollapsed={isFileCollapsed}
     onToggleCollapse={handleToggleCollapse}
     isFullFile={isFullFileExpanded}
     onToggleFullFile={handleToggleFullFile}
   />
   ```

6. **Sync state** — if user manually expands/collapses individual regions, the `isFullFileExpanded` state may become stale. A simple approach: derive `isFullFile` from `expanded.size === regions.length` instead of separate state. Pass this computed value to the header.

## Phase 3: Mirror changes to changes-diff-content

### Problem
The `StickyFileHeader` in `changes-diff-content.tsx` is a separate implementation that duplicates `file-header.tsx`. It should get the same improvements.

### Changes

1. **Remove "Modified" badge** from `StickyFileHeader` — same logic, hide for `type === "modified"`.

2. **Add copy button** — import and use `CopyButton` component.

3. The sticky header in the changes pane is a **read-only overlay** tracking the currently visible file in a virtualized list. It doesn't control collapse state since each card renders independently via Virtuoso. So **no chevron or collapse behavior** — those only apply to the thread diff viewer's `FileHeader`.

4. Consider **extracting shared header rendering** into a shared sub-component or at least keeping the badge/copy logic consistent between the two files. However, since the changes-diff-content `StickyFileHeader` has fundamentally different behavior (absolute overlay vs. sticky within card), keeping them separate with consistent styling is acceptable.

## File Change Summary

| File | Changes |
|------|---------|
| `src/components/diff-viewer/file-header.tsx` | Add collapse chevron, click-to-collapse, remove Modified badge, add "show full file" button |
| `src/components/diff-viewer/diff-file-card.tsx` | Add file collapse state, full-file toggle state, wire props to FileHeader |
| `src/components/changes/changes-diff-content.tsx` | Remove Modified badge from StickyFileHeader, add CopyButton |

## Notes
- No new files needed — all changes are edits to existing components
- No CSS framework changes — all styling via existing Tailwind utilities
- `CopyButton` already exists at `src/components/ui/copy-button.tsx` — reuse it
- `Tooltip` already exists at `src/components/ui/tooltip.tsx` — reuse it
- Lucide icons `ChevronRight`, `FileCode` are already available in the project
