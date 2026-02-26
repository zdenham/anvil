# Phase 3: Tree Menu "Changes" Item with Commit Sub-Items

**Dependencies**: Requires [01-tauri-backend.md](./01-tauri-backend.md) (for `git_get_branch_commits`) and [02-content-pane-type.md](./02-content-pane-type.md) (for `navigateToChanges()` and the `"changes"` variant in `ContentPaneView`).

**Parallelism**: Can run in parallel with [04-changes-viewer.md](./04-changes-viewer.md) once Group 1 is complete.

## Overview

Instead of a dedicated commit sidebar inside the content pane, commits are displayed as sub-items under a "Changes" entry in the left sidebar tree menu — the same place threads, plans, and terminals live. This keeps navigation consistent: clicking "Changes" shows the full worktree diff, clicking "Uncommitted Changes" shows just uncommitted changes, and clicking a commit sub-item shows that commit's diff.

## Phases

- [x] 3a: Extend `TreeItemNode.type` and add `changesItems` to `RepoWorktreeSection`
- [x] 3b: Create commit store for async commit fetching
- [x] 3c: Build tree items via `buildChangesItems` in `use-tree-data.ts`
- [x] 3d: Create `ChangesItem`, `UncommittedItem`, and `CommitItem` components
- [x] 3e: Wire into `RepoWorktreeSection` rendering + click handlers
- [x] 3f: Export new components from index

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## 3a. Extend types

### Extend `TreeItemNode.type` union

**File:** `src/stores/tree-menu/types.ts`

The `TreeItemNode` interface (line 51) has a `type` field that is a string union literal. Extend it and add optional commit fields:

```typescript
export interface TreeItemNode {
  type: "thread" | "plan" | "terminal" | "pull-request" | "changes" | "uncommitted" | "commit";
  // ... all existing fields remain unchanged ...

  // New optional fields for commit items:
  /** Full commit hash (for "commit" type items) */
  commitHash?: string;
  /** First line of commit message (for "commit" type items) */
  commitMessage?: string;
  /** Author name (for "commit" type items) */
  commitAuthor?: string;
  /** Relative date string like "3 days ago" (for "commit" type items) */
  commitRelativeDate?: string;
}
```

The `"changes"` item acts as a collapsible folder parent. The `"uncommitted"` and `"commit"` items are its children (depth 1).

For all three new types, the required `TreeItemNode` fields use synthetic values:
- `status`: `"read"` (neutral/inactive appearance via `StatusDot`)
- `updatedAt` / `createdAt`: `0` (not used for sorting — these items are positioned explicitly)
- `sectionId`: the parent section's `"repoId:worktreeId"` string

### Add `changesItems` to `RepoWorktreeSection`

**File:** `src/stores/tree-menu/types.ts`

Add a new field to the `RepoWorktreeSection` interface (line 28):

```typescript
export interface RepoWorktreeSection {
  // ... all existing fields remain unchanged ...
  /** Synthetic "Changes" folder items (changes parent + uncommitted + commits) */
  changesItems: TreeItemNode[];
}
```

This field is populated by `buildChangesItems()` (see 3c) and rendered in its own pass in `RepoWorktreeSection`, separate from the entity-backed `items` array.

### Optional: Extract a `TreeItemType` alias

To avoid repeating the full union string, consider adding a type alias:

```typescript
export type TreeItemType = TreeItemNode["type"];
```

This can be used in `onItemSelect` signatures elsewhere but is not required for this phase. The existing `onItemSelect` callbacks do NOT need to be widened — changes items call `navigationService.navigateToChanges()` directly inside `RepoWorktreeSection` rather than bubbling through `onItemSelect` (see 3e).

---

## 3b. Commit store

**File:** `src/stores/commit-store.ts` (new file)

Commit data is fetched asynchronously into a Zustand store so the tree can always be built synchronously from the store's state.

The existing `useGitCommits` hook (`src/hooks/use-git-commits.ts`) is a React hook with internal `useState`. It cannot be used by `buildChangesItems` (which needs synchronous access outside React). That is why we need this standalone Zustand store.

```typescript
import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { z } from "zod";
import { logger } from "@/lib/logger-client";

// Reuse the existing schema/type from use-git-commits.ts
import { GitCommitSchema, type GitCommit } from "@/hooks/use-git-commits";

const GitCommitArraySchema = z.array(GitCommitSchema);

interface CommitStoreState {
  /** Per-section commit lists, keyed by sectionId ("repoId:worktreeId") */
  commitsBySection: Record<string, GitCommit[]>;
  /** Per-section loading state */
  loadingBySection: Record<string, boolean>;
  /** Fetch commits for a section. Debounced internally per-section. */
  fetchCommits: (sectionId: string, worktreePath: string, branchName: string) => void;
}
```

Implementation details:
- `fetchCommits` is debounced per-section (~300ms) using a module-level `Map<string, ReturnType<typeof setTimeout>>`. Each call clears the previous timer for that sectionId and sets a new one.
- The debounced inner function calls `invoke("git_get_branch_commits", { branchName, workingDirectory: worktreePath, limit: 20 })`, validates with `GitCommitArraySchema`, and sets `commitsBySection[sectionId]`.
- On error, logs via `logger.error` and leaves the previous cached data in place (stale-while-revalidate, key decision #22).
- `loadingBySection[sectionId]` is set to `true` when fetch starts, `false` when it completes or errors.
- Limit is `20` (not 50 like the general hook) per key decision #1.

The `GitCommit` type has these fields (defined in `src/hooks/use-git-commits.ts`): `hash`, `shortHash`, `message`, `author`, `authorEmail`, `date`, `relativeDate`.

---

## 3c. Build tree items (synchronous, in `use-tree-data.ts`)

**File:** `src/hooks/use-tree-data.ts`

The "Changes" items are synthetic (not backed by entity stores like threads/plans). They are built in a separate function and stored on `section.changesItems`, not mixed into the entity-sorted `items` array.

### New exported function: `buildChangesItems`

```typescript
import { useCommitStore } from "@/stores/commit-store";

/**
 * Build the "Changes" folder item and its children (uncommitted + commits)
 * for a section. Always returns at least the Changes parent item.
 * When expanded, also includes the Uncommitted child + up to 20 commits.
 * Reads commits synchronously from the commit store.
 */
export function buildChangesItems(
  sectionId: string,
  expandedSections: Record<string, boolean>,
): TreeItemNode[] {
  const items: TreeItemNode[] = [];

  const changesItemId = `changes:${sectionId}`;
  // Key convention: "changes:<sectionId>" for folder expand state
  const isExpanded = expandedSections[changesItemId] ?? false; // Default collapsed

  items.push({
    type: "changes",
    id: changesItemId,
    title: "Changes",
    status: "read",
    updatedAt: 0,
    createdAt: 0,
    sectionId,
    depth: 0,
    isFolder: true,
    isExpanded,
  });

  if (!isExpanded) return items;

  // Always add "Uncommitted Changes" as first child
  const uncommittedItemId = `uncommitted:${sectionId}`;
  items.push({
    type: "uncommitted",
    id: uncommittedItemId,
    title: "Uncommitted Changes",
    status: "read",
    updatedAt: 0,
    createdAt: 0,
    sectionId,
    depth: 1,
    isFolder: false,
    isExpanded: false,
    parentId: changesItemId,
  });

  // Read commits from commit store (synchronous getState())
  const { commitsBySection } = useCommitStore.getState();
  const commits = commitsBySection[sectionId] ?? [];
  for (const commit of commits.slice(0, 20)) {
    items.push({
      type: "commit",
      id: `commit:${sectionId}:${commit.hash}`,
      title: commit.message,
      status: "read",
      updatedAt: 0,
      createdAt: 0,
      sectionId,
      depth: 1,
      isFolder: false,
      isExpanded: false,
      parentId: changesItemId,
      commitHash: commit.hash,
      commitMessage: commit.message,
      commitAuthor: commit.author,
      commitRelativeDate: commit.relativeDate,
    });
  }

  return items;
}
```

### Wire into `buildTreeFromEntities`

In `buildTreeFromEntities` (line 262), when pushing each section, add the `changesItems` field:

```typescript
sections.push({
  type: "repo-worktree",
  id: sectionId,
  repoName: info.repoName,
  worktreeName: info.worktreeName,
  repoId: info.repoId,
  worktreeId: info.worktreeId,
  worktreePath: info.worktreePath,
  items,
  isExpanded: expandedSections[sectionId] ?? true,
  changesItems: buildChangesItems(sectionId, expandedSections),
});
```

### Subscribe to commit store in `useTreeData`

In the `useTreeData` hook (line 421), subscribe to the commit store so the tree re-renders when commits arrive:

```typescript
import { useCommitStore } from "@/stores/commit-store";

// Inside useTreeData():
const commitsBySection = useCommitStore((state) => state.commitsBySection);
```

Add `commitsBySection` to the `useMemo` dependency array (line 505) alongside the existing deps.

---

## 3d. Create components

### `ChangesItem` component

**File:** `src/components/tree-menu/changes-item.tsx` (new file, <100 lines)

A tree menu row for the "Changes" parent item. Follows the visual pattern of `FilesItem` (`src/components/tree-menu/files-item.tsx`) but adds folder expand/collapse.

```typescript
import { ChevronRight, GitCompare } from "lucide-react";
import { cn } from "@/lib/utils";
import { treeMenuService } from "@/stores/tree-menu/service";
import { TREE_INDENT_BASE } from "@/lib/tree-indent";
import type { TreeItemNode } from "@/stores/tree-menu/types";

interface ChangesItemProps {
  item: TreeItemNode;
  isSelected: boolean;
  onNavigate: () => void;
}
```

Behavior:
- Clicking the row label calls `onNavigate()` which triggers `navigationService.navigateToChanges(...)` in the parent
- Clicking the chevron toggles expansion via `treeMenuService.toggleSection(item.id)` where `item.id` is `"changes:<sectionId>"`
- Shows `GitCompare` icon (from lucide-react) + "Changes" label, no badge (key decision #21)
- Uses `TREE_INDENT_BASE` (`8px`) for left padding (depth 0), matching `FilesItem`
- Visual highlight when selected: `bg-accent-500/20 text-surface-100` (same as `ThreadItem`)
- Chevron rotates 90 degrees when expanded (same CSS as `ThreadItem` folder toggle: `transition-transform duration-150` + `rotate-90`)
- Default appearance when not selected: `text-surface-400 hover:text-surface-200` (matching `FilesItem`)

### `UncommittedItem` component

**File:** `src/components/tree-menu/uncommitted-item.tsx` (new file, <60 lines)

```typescript
import { cn } from "@/lib/utils";
import { TREE_INDENT_BASE, TREE_INDENT_STEP } from "@/lib/tree-indent";
import type { TreeItemNode } from "@/stores/tree-menu/types";

interface UncommittedItemProps {
  item: TreeItemNode;
  isSelected: boolean;
  onNavigate: () => void;
}
```

- Indented at depth 1: `paddingLeft = TREE_INDENT_BASE + TREE_INDENT_STEP` = `16px`
- Shows label "Uncommitted Changes"
- Clicking calls `onNavigate()` which triggers `navigationService.navigateToChanges(...)` with `uncommittedOnly: true`
- Visual highlight when selected (same accent pattern)
- Simple row, no icon — keep it minimal

### `CommitItem` component

**File:** `src/components/tree-menu/commit-item.tsx` (new file, <80 lines)

```typescript
import { cn } from "@/lib/utils";
import { TREE_INDENT_BASE, TREE_INDENT_STEP } from "@/lib/tree-indent";
import type { TreeItemNode } from "@/stores/tree-menu/types";

interface CommitItemProps {
  item: TreeItemNode;
  isSelected: boolean;
  onNavigate: () => void;
}
```

- Indented at depth 1: `paddingLeft = TREE_INDENT_BASE + TREE_INDENT_STEP` = `16px`
- Shows truncated commit message (1 line, primary text), with author + relative date as secondary dimmed text
- Clicking calls `onNavigate()` which triggers `navigationService.navigateToChanges(...)` with `commitHash`
- Visual highlight when selected
- Use `text-[13px] leading-[22px]` sizing consistent with `ThreadItem` and `TerminalItem`

Compact single-line layout:
```
[indent] truncated message       author · 3d ago
```

The `item.commitMessage`, `item.commitAuthor`, and `item.commitRelativeDate` fields are available from the `TreeItemNode`.

---

## 3e. Wire into `RepoWorktreeSection` rendering

**File:** `src/components/tree-menu/repo-worktree-section.tsx`

### Add imports

```typescript
import { useEffect } from "react";  // if not already imported
import { ChangesItem } from "./changes-item";
import { UncommittedItem } from "./uncommitted-item";
import { CommitItem } from "./commit-item";
import { navigationService } from "@/stores/navigation-service";
import { useCommitStore } from "@/stores/commit-store";
```

### Add click handlers (direct navigation, bypassing `onItemSelect`)

The changes items call `navigationService.navigateToChanges()` directly inside `RepoWorktreeSection`, rather than bubbling through the `onItemSelect` callback. This avoids needing to widen the `onItemSelect` type signature or parse synthetic IDs in the parent. The `navigationService.navigateToChanges()` method (from Phase 2) handles both tree item selection and content pane updates.

```typescript
const handleChangesClick = async (itemId: string) => {
  await navigationService.navigateToChanges(section.repoId, section.worktreeId, {
    treeItemId: itemId,
  });
};

const handleUncommittedClick = async (itemId: string) => {
  await navigationService.navigateToChanges(section.repoId, section.worktreeId, {
    uncommittedOnly: true,
    treeItemId: itemId,
  });
};

const handleCommitClick = async (item: TreeItemNode) => {
  await navigationService.navigateToChanges(section.repoId, section.worktreeId, {
    commitHash: item.commitHash!,
    treeItemId: item.id,
  });
};
```

### Add commit fetch effect

Fetch commits when the Changes folder is expanded. Add this inside the `RepoWorktreeSection` function body:

```typescript
const changesItem = section.changesItems.find(i => i.type === "changes");
const isChangesExpanded = changesItem?.isExpanded ?? false;

useEffect(() => {
  if (isChangesExpanded && section.worktreePath) {
    useCommitStore.getState().fetchCommits(
      section.id,
      section.worktreePath,
      section.worktreeName, // branch name
    );
  }
}, [isChangesExpanded, section.id, section.worktreePath, section.worktreeName]);
```

**Branch name caveat**: `section.worktreeName` is the display name (which may differ from the git branch name if the worktree has been renamed — see `WorktreeState.isRenamed` in `core/types/repositories.ts`). The `RepoWorktreeSection` type does not currently carry the raw git branch name. If worktree renaming is common in practice, this will need to be resolved by adding a `currentBranch` field to `RepoWorktreeSection` (sourced from `WorktreeState.currentBranch` via the lookup store). For now, `worktreeName` works for the common case where names match branches.

### Render changes items in the template

In the `<div role="group">` block (line 638), insert the Changes items **between the `FilesItem` and the Terminals pass**. The current render order is:

1. `FilesItem` (lines 644-652)
2. Terminals pass (lines 655-666)
3. PR items pass (lines 669-680)
4. Threads and plans pass (lines 683-708)

Insert the changes block after `FilesItem` and before Terminals:

```tsx
{/* "Files" pinned at top of expanded section */}
{onOpenFiles && (
  <FilesItem
    repoId={section.repoId}
    worktreeId={section.worktreeId}
    worktreePath={section.worktreePath}
    isActive={isFileBrowserOpen ?? false}
    onOpenFiles={onOpenFiles}
  />
)}

{/* "Changes" folder with commit sub-items — always present */}
{section.changesItems.map((item) => {
  if (item.type === "changes") {
    return (
      <ChangesItem
        key={item.id}
        item={item}
        isSelected={selectedItemId === item.id}
        onNavigate={() => handleChangesClick(item.id)}
      />
    );
  }
  if (item.type === "uncommitted") {
    return (
      <UncommittedItem
        key={item.id}
        item={item}
        isSelected={selectedItemId === item.id}
        onNavigate={() => handleUncommittedClick(item.id)}
      />
    );
  }
  if (item.type === "commit") {
    return (
      <CommitItem
        key={item.id}
        item={item}
        isSelected={selectedItemId === item.id}
        onNavigate={() => handleCommitClick(item)}
      />
    );
  }
  return null;
})}

{/* Terminals pinned after Changes */}
{section.items.map((item, index) => {
  if (item.type !== "terminal") return null;
  return (
    <TerminalItem ... />
  );
})}
```

---

## 3f. Export new components

**File:** `src/components/tree-menu/index.ts`

Add exports:

```typescript
export { ChangesItem } from "./changes-item";
export { UncommittedItem } from "./uncommitted-item";
export { CommitItem } from "./commit-item";
```

---

## Wiring Points to Other Sub-Plans

- **Phase 1** (`01-tauri-backend.md`): `git_get_branch_commits` Rust command must exist for the commit store to call `invoke("git_get_branch_commits", ...)`.
- **Phase 2** (`02-content-pane-type.md`): `navigationService.navigateToChanges()` must exist with signature `(repoId, worktreeId, options?: { uncommittedOnly?, commitHash?, treeItemId? })`. The `"changes"` variant in `ContentPaneView` must exist. Both are added in Phase 2.
- **Phase 4** (`04-changes-viewer.md`): The content pane renders `ChangesView` when `view.type === "changes"`. Phase 3 drives which view mode is shown by setting `commitHash`, `uncommittedOnly`, etc. via navigation. Phase 4 consumes these props.
- **Phase 5** (`05-file-browser.md`): File browser checks the active `ContentPaneView` to determine filtering. No direct dependency from Phase 3.

## Completion Criteria

- `TreeItemNode.type` union includes `"changes"`, `"uncommitted"`, and `"commit"`
- `TreeItemNode` has optional `commitHash`, `commitMessage`, `commitAuthor`, `commitRelativeDate` fields
- `RepoWorktreeSection` interface has `changesItems: TreeItemNode[]` field
- Commit store (`src/stores/commit-store.ts`) fetches and caches up to 20 commits per section with debouncing (~300ms)
- `buildChangesItems` function in `use-tree-data.ts` builds the changes folder + children synchronously from the commit store
- `useTreeData` subscribes to `useCommitStore` so tree re-renders when commits arrive
- "Changes" item always appears in tree menu (between Files and Terminals), even when there are no changes
- "Uncommitted Changes" child always appears as first child when expanded
- Up to 20 commit sub-items appear when expanded
- Clicking items calls `navigationService.navigateToChanges()` directly from `RepoWorktreeSection` (not through `onItemSelect`)
- Active item highlights correctly via `selectedItemId` in the tree menu store
- Stale-while-revalidate: tree shows cached commits while refreshing
- Commits are fetched when the Changes folder is expanded (via `useEffect` in `RepoWorktreeSection`)
- Changes folder defaults to collapsed
- Expansion state persisted via `expandedSections["changes:<sectionId>"]` key convention
- `onItemSelect` callback type NOT widened — changes items bypass it entirely
