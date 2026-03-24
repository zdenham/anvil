# Phase 4: Changes Content Pane (Diff Viewer)

**Dependencies**: Requires [01-tauri-backend.md](./01-tauri-backend.md) (for all git diff commands) and [02-content-pane-type.md](./02-content-pane-type.md) (for `"changes"` view type rendering and `ChangesContentProps`).

**Parallelism**: Can run in parallel with [03-tree-menu.md](./03-tree-menu.md) once Group 1 is complete.

## Overview

The content pane shows the diff content — no sidebar inside the pane itself since commit navigation lives in the tree menu.

Create a new component directory:

```
src/components/changes/
├── changes-view.tsx           # Main container (full-width diff area)
├── changes-diff-content.tsx   # Diff display: virtualized file cards
└── use-changes-data.ts        # Hook: fetches merge base, commits, diffs
```

## Phases

- [x] Implement `use-changes-data.ts` data hook (merge base resolution + diff fetching)
- [x] Build `changes-view.tsx` main container
- [x] Build `changes-diff-content.tsx` with file-level virtualization
- [x] Wire into content pane (replace Phase 2 placeholder)

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## 4a. `use-changes-data.ts` — Data hook

### Interface

```typescript
import type { ParsedDiff, ParsedDiffFile } from "@/lib/diff-parser";

interface UseChangesDataOptions {
  repoId: string;
  worktreeId: string;
  /** If true, show only uncommitted changes (HEAD → working tree) */
  uncommittedOnly?: boolean;
  /** If set, show diff for this single commit */
  commitHash?: string;
}

interface UseChangesDataResult {
  /** The parsed diff for current selection */
  parsedDiff: ParsedDiff | null;
  /** Per-file raw diff strings, keyed by file path (for InlineDiffBlock's `diff` prop) */
  rawDiffsByFile: Record<string, string>;
  /** Total file count from the parsed diff (may exceed 300) */
  totalFileCount: number;
  /** Capped list of ParsedDiffFile entries (up to 300) for rendering */
  files: ParsedDiffFile[];
  /** The list of changed file paths (for Phase 5 file browser integration) */
  changedFilePaths: string[];
  /** Loading state */
  loading: boolean;
  /** Error */
  error: string | null;
  /** Refresh */
  refresh: () => void;
  /** Current branch name (null if detached HEAD) */
  branchName: string | null;
  /** Merge base commit hash (null if not resolved yet or N/A) */
  mergeBase: string | null;
  /** Default branch name */
  defaultBranch: string | null;
  /** Worktree path resolved from repoId + worktreeId */
  worktreePath: string;
}
```

**Important design decision (key decision #20 — diff-first, full file on expand)**: This hook does NOT call `buildAnnotatedFiles()` from `src/lib/annotated-file-builder.ts`. That function requires full file contents for every file, which would be expensive upfront. Instead, the hook returns `rawDiffsByFile` — per-file raw diff strings extracted from the full diff output. Each file card renders using `InlineDiffBlock`'s `diff` string prop (showing only changed lines + limited context from the diff itself). Full file content is loaded lazily per-file when the user clicks to expand a collapsed context region (see 4c).

### Prerequisite: Extend `useRepoWorktreeLookupStore`

The lookup store (`src/stores/repo-worktree-lookup-store.ts`) currently caches only `name` and `path` per worktree. This hook needs `defaultBranch` and `currentBranch`. There are two approaches — pick whichever is simpler at implementation time:

**Option A (preferred): Extend the lookup store** to also cache `defaultBranch` (per repo) and `currentBranch` (per worktree) from the `RepositorySettings` / `WorktreeState` data it already reads during hydration:

```typescript
interface RepoInfo {
  name: string;
  defaultBranch: string; // NEW — from RepositorySettings.defaultBranch
  worktrees: Map<string, { name: string; path: string; currentBranch: string | null }>; // currentBranch NEW
}
```

Add getters:
```typescript
getDefaultBranch: (repoId: string) => string;        // returns "main" if not found
getCurrentBranch: (repoId: string, worktreeId: string) => string | null;
```

**Option B: Use git commands at fetch time.** Use `gitCommands.getDefaultBranch(worktreePath)` (already exists in `src/lib/tauri-commands.ts`) for the default branch, and `invoke("git_get_current_branch", { workingDirectory })` for the current branch. This requires adding a `git_get_current_branch` Rust command to Phase 1 (running `git rev-parse --abbrev-ref HEAD`). More accurate but adds a Phase 1 dependency.

**Note**: `WorktreeState.currentBranch` is stored in `settings.json` and may be stale if the branch changed outside Anvil. For the initial implementation, Option A is sufficient. If accuracy is critical later, Option B can be layered on.

### Merge base resolution logic (critical)

1. Resolve `worktreePath` from `repoId` + `worktreeId` via `useRepoWorktreeLookupStore.getState().getWorktreePath(repoId, worktreeId)`
2. Get the worktree's `currentBranch` (via the extended lookup store getter or git command)
3. Get the repo's `defaultBranch` (via the extended lookup store getter or `gitCommands.getDefaultBranch(worktreePath)`)
4. **If detached HEAD** (`currentBranch` is null): Fall back to diffing against `origin/<defaultBranch>` (same as GitHub PR behavior). Use `gitCommands.getRemoteBranchCommit(worktreePath, "origin", defaultBranch)` — this wrapper is added to `src/lib/tauri-commands.ts` in Phase 1.
5. **If the current branch IS the default branch**:
   - Diff against `origin/<defaultBranch>` — use `gitCommands.getRemoteBranchCommit(worktreePath, "origin", defaultBranch)` to get the remote HEAD commit
   - This shows "what's local but not pushed" — same as GitHub's comparison view
6. **If the current branch is NOT the default branch**:
   - Compute merge base: `gitCommands.getMergeBase(worktreePath, currentBranch, defaultBranch)` — this wrapper is added in Phase 1
   - If merge base succeeds, diff from there
   - If merge base fails (e.g., unrelated histories), fall back to `gitCommands.getRemoteBranchCommit(worktreePath, "origin", defaultBranch)`

### Diff fetching by mode

7. **All changes mode** (no `commitHash`, no `uncommittedOnly`): `gitCommands.diffRange(worktreePath, mergeBase)` — shows everything: committed + staged + unstaged + untracked changes from merge base to current working tree. This is the "what would this PR look like" view.
8. **Uncommitted only mode** (`uncommittedOnly: true`): `gitCommands.diffUncommitted(worktreePath)` — shows only the delta between HEAD and working tree (staged + unstaged + untracked). No committed changes.
9. **Single commit mode** (`commitHash` set): `gitCommands.diffCommit(worktreePath, commitHash)` — shows only the committed changes introduced by that specific commit (no working tree state)

All three wrappers (`diffRange`, `diffUncommitted`, `diffCommit`) are defined in Phase 1's `tauri-commands.ts` additions to the `gitCommands` object. They return raw unified diff strings.

### Parsing and processing

10. Parse the raw diff string through `parseDiff()` from `src/lib/diff-parser.ts`. This returns a `ParsedDiff` with a `files: ParsedDiffFile[]` array. **Exclude binary files** by filtering out entries where `file.isBinary === true` or `file.type === "binary"`.
11. **Extract per-file raw diff strings** (`rawDiffsByFile`): For each non-binary `ParsedDiffFile`, reconstruct the raw diff string for that single file (header + hunks). This is passed to `InlineDiffBlock`'s `diff` prop for initial rendering. To reconstruct per-file diffs from the parsed data, iterate `parsedDiff.files` and rebuild the unified diff format (see existing pattern in `src/components/diff-viewer/diff-viewer.tsx` lines 123-142 in the `rawDiffsMap` reconstruction logic).
12. **Cap displayed files at 300** — `files` array is sliced to first 300 entries. `totalFileCount` tracks the full count.
13. Extract `changedFilePaths` from parsed diff: `files.map(f => f.newPath ?? f.oldPath).filter(Boolean)`
14. **Files with >1000 changed lines** (additions + deletions): Flag these in the result so the view can auto-collapse them (see key decision #32). The threshold check is: `file.stats.additions + file.stats.deletions > 1000`.

**Stale-while-revalidate (key decision #22)**: When re-entering the Changes view, return stale data immediately and re-fetch in the background. Single commit diffs (`commitHash` set) are immutable — cache the result keyed by `commitHash` and skip re-fetch. The "All Changes" and "Uncommitted" modes always re-fetch since the working tree may have changed.

Note: commit fetching for the sidebar is handled separately in Phase 3's commit store. This hook only handles diff data for the content pane.

---

## 4b. `changes-view.tsx` — Main container

This component receives `ChangesContentProps` (defined in Phase 2 at `src/components/content-pane/types.ts`):

```typescript
import type { ChangesContentProps } from "@/components/content-pane/types";
```

The props are: `{ repoId, worktreeId, uncommittedOnly?, commitHash? }`.

Full-width layout (no internal sidebar — commits are in the tree menu):

```
┌──────────────────────────────────────────────────────┐
│  12 files changed, +340, -89                         │
│  from abc1234 (merge base with main)                 │
├──────────────────────────────────────────────────────┤
│                                                      │
│  src/foo.ts                                          │
│  + added line                                        │
│  - removed line                                      │
│                                                      │
│  src/bar.ts                                          │
│  + added line                                        │
│                                                      │
│  ... (300 file cap, N more not shown)                │
└──────────────────────────────────────────────────────┘
```

- Full width `ChangesDiffContent` (scrollable virtualized diff cards)
- Summary header inside the view (NOT in the content pane header — the header is handled by Phase 2's `ChangesHeader`). This summary shows:
  - File count + additions/deletions stats: "N files changed, +X, -Y"
  - **All changes**: Subtext indicating the baseline, e.g., "from `abc1234` (merge base with `main`)" or "from `origin/main`" (key decision #30). The merge base info comes from the hook's `mergeBase` and `defaultBranch` fields.
  - **Uncommitted**: Subtext "relative to HEAD"
  - **Single commit**: Subtext "Commit `abc1234`" (no merge base info needed)
- **Empty state**: When diff is empty (no changes from merge base), show empty state message: "No changes from `<defaultBranch>`"
- **Error state**: When git operations fail (no remote, offline, etc.), show error screen with explanation (key decision #13)
- **Loading state**: Show a skeleton or spinner while the hook is loading
- If >300 files, show truncation message at bottom: "Showing 300 of N files"

### Phase 5 wiring

On mount (and when `changedFilePaths` changes), call `changesViewStore.setActive(worktreeId, changedFilePaths)` from the store created in Phase 5 (`src/stores/changes-view-store.ts`). On unmount, call `changesViewStore.clearActive()`. If Phase 5 is not yet implemented, guard with a conditional import or skip this step.

### Replace Phase 2 placeholder

When this component is ready, update `src/components/content-pane/content-pane.tsx` to replace the `ChangesViewPlaceholder` with a lazy import:

```typescript
import { lazy, Suspense } from "react";
const ChangesView = lazy(() => import("../changes/changes-view"));
```

And the rendering branch becomes:

```tsx
{view.type === "changes" && (
  <Suspense fallback={<div className="flex items-center justify-center h-full text-surface-400 text-sm">Loading...</div>}>
    <ChangesView
      repoId={view.repoId}
      worktreeId={view.worktreeId}
      uncommittedOnly={view.uncommittedOnly}
      commitHash={view.commitHash}
    />
  </Suspense>
)}
```

The `ChangesView` component must have a `default` export for `React.lazy` to work.

---

## 4c. `changes-diff-content.tsx`

Renders the diff for the current selection with **file-level virtualization**:

### Props

```typescript
import type { ParsedDiffFile } from "@/lib/diff-parser";
import type { VirtuosoHandle } from "react-virtuoso";

interface ChangesDiffContentProps {
  /** Capped file list (up to 300) */
  files: ParsedDiffFile[];
  /** Per-file raw diff strings, keyed by file path */
  rawDiffsByFile: Record<string, string>;
  /** Total file count (may exceed 300, for truncation notice) */
  totalFileCount: number;
  /** Worktree path for loading full file content on expand */
  worktreePath: string;
  /** Commit hash if viewing a single commit (for git_show_file context) */
  commitHash?: string;
  /** Whether viewing uncommitted changes (affects context line source) */
  uncommittedOnly?: boolean;
}
```

### Virtualized file card list

Use `react-virtuoso`'s `Virtuoso` component (same library used by `MessageList` in `src/components/thread/message-list.tsx`). File cards have variable heights (different files have different line counts), and `react-virtuoso` handles variable-height items natively.

```tsx
import { Virtuoso, type VirtuosoHandle } from "react-virtuoso";

// Inside the component:
const virtuosoRef = useRef<VirtuosoHandle>(null);

<Virtuoso
  ref={virtuosoRef}
  data={files}
  itemContent={(index, file) => (
    <div className="py-2">
      <ChangesFileCard
        file={file}
        rawDiff={rawDiffsByFile[file.newPath ?? file.oldPath ?? ""] ?? ""}
        worktreePath={worktreePath}
        commitHash={commitHash}
        uncommittedOnly={uncommittedOnly}
      />
    </div>
  )}
  increaseViewportBy={400}
  style={{ height: "100%" }}
/>
```

- Use `increaseViewportBy={400}` (overscan) for smooth scrolling
- If `totalFileCount > 300`, render a footer notice: "Showing 300 of N files"

### `ChangesFileCard` — Per-file rendering (inline or extract to separate file)

Each file card reuses `InlineDiffBlock` from `src/components/thread/inline-diff-block.tsx`:

```tsx
import { InlineDiffBlock } from "@/components/thread/inline-diff-block";

<InlineDiffBlock
  filePath={file.newPath ?? file.oldPath ?? "unknown"}
  diff={rawDiff}
  fileType={file.type}
  defaultCollapsed={file.stats.additions + file.stats.deletions > 1000}
/>
```

Key points:
- **Initial render uses `diff` string prop**: `InlineDiffBlock` accepts a `diff` string and internally calls `parseDiff()` to build annotated lines. This shows only changed lines + context lines from the diff output (typically 3 lines per hunk boundary). Collapsed context regions between hunks are rendered as `CollapsedRegionPlaceholder` components (handled by `useCollapsedRegions` inside `InlineDiffBlock`).
- **Files with >1000 changed lines auto-collapsed**: Pass `defaultCollapsed={true}` so the entire diff content is collapsed behind a "Show more" toggle (using `CollapsibleOutputBlock` inside `InlineDiffBlock`). The user clicks to expand.
- **Full file content on expand (future enhancement)**: Key decision #20 says expanding a collapsed context region should lazy-load the full file content. However, `InlineDiffBlock`'s current `CollapsedRegionPlaceholder` toggles are purely local (they show/hide already-parsed lines from the diff, not full file content). To support loading full file context between hunks, a new mechanism would be needed (either extending `InlineDiffBlock` or wrapping it). For the initial implementation, collapsed regions expand to show whatever context lines exist in the diff output. A follow-up enhancement can add full-file lazy loading using:
  - **All changes / uncommitted mode**: `fsCommands.readFile(join(worktreePath, path))` to get current file from disk
  - **Single commit mode**: `invoke("git_show_file", { cwd: worktreePath, path, ref: commitHash })` to get file at the commit's version (key decision #19)
  - Once loaded, re-render using `InlineDiffBlock`'s `lines` prop (pre-computed `AnnotatedLine[]`) instead of the `diff` prop, providing full context

### Expose `scrollToIndex` ref

For Phase 5's file browser scroll-to-file feature, expose the `virtuosoRef` via `forwardRef` + `useImperativeHandle`:

```typescript
export interface ChangesDiffContentRef {
  scrollToIndex: (index: number) => void;
}

// In the component:
useImperativeHandle(ref, () => ({
  scrollToIndex: (index: number) => {
    virtuosoRef.current?.scrollToIndex({ index, behavior: "smooth", align: "start" });
  },
}), []);
```

Phase 5 will look up the file index from `files` array by path and call `scrollToIndex`.

---

## File size guidelines

Per coding conventions (`docs/agents.md`):
- Each file should be under 250 lines. The three files (`use-changes-data.ts`, `changes-view.tsx`, `changes-diff-content.tsx`) should each stay under this limit.
- Functions should be under 50 lines. The merge base resolution logic in the hook should be extracted into a separate async function (e.g., `resolveMergeBase`).
- Use `logger` from `@/lib/logger-client` for logging, never `console.log`.

---

## Wiring Points to Other Sub-Plans

- **Phase 1** (`01-tauri-backend.md`): This phase consumes the following `gitCommands` wrappers added to `src/lib/tauri-commands.ts`: `diffRange`, `diffUncommitted`, `diffCommit`, `getMergeBase`, `getRemoteBranchCommit`. Also uses `showFile` for single-commit context (future enhancement). These must exist before this phase can fetch data.
- **Phase 2** (`02-content-pane-type.md`): This phase consumes `ChangesContentProps` from `src/components/content-pane/types.ts`. The `"changes"` variant in `ContentPaneView` must exist. The `ChangesViewPlaceholder` in `content-pane.tsx` is replaced with the real `ChangesView` lazy import. The `ChangesHeader` in `content-pane-header.tsx` (added in Phase 2) handles the content pane header — this phase does NOT add another header.
- **Phase 3** (`03-tree-menu.md`): The tree menu drives navigation to this view by calling `navigationService.navigateToChanges()` with `commitHash`, `uncommittedOnly`, etc. Phase 3 does not depend on Phase 4 or vice versa — they both depend on Group 1.
- **Phase 5** (`05-file-browser.md`): Phase 5 creates `src/stores/changes-view-store.ts`. This phase calls `changesViewStore.setActive()` / `clearActive()` from `changes-view.tsx` to publish changed file paths. Phase 5 also uses the `scrollToIndex` ref exposed by `ChangesDiffContent`. If Phase 5 is not yet implemented when Phase 4 ships, guard the store calls.

## Completion Criteria

- `use-changes-data.ts` correctly resolves merge base for all branch scenarios (detached HEAD, on default branch, feature branch, merge base failure)
- All three diff modes (all changes, uncommitted, single commit) work
- Diff parsing reuses `parseDiff()` from `src/lib/diff-parser.ts` — no new diff parsing code
- Per-file rendering reuses `InlineDiffBlock` from `src/components/thread/inline-diff-block.tsx` — no new diff rendering code
- Binary files excluded from output (`file.isBinary === true` or `file.type === "binary"`)
- File-level virtualization with `react-virtuoso` `Virtuoso` component renders smoothly at 300 files
- Files >1000 changed lines auto-collapsed via `defaultCollapsed` prop
- Empty, error, and loading states displayed
- Summary header shows file count, additions/deletions, and merge base info
- Stale-while-revalidate: stale data shown immediately on re-entry, single commit diffs cached
- `changedFilePaths` extracted for Phase 5 file browser integration
- `scrollToIndex` ref exposed for Phase 5
- Phase 2 placeholder replaced with lazy import in `content-pane.tsx`
- All files under 250 lines, all functions under 50 lines
