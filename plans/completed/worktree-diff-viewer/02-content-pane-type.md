# Phase 2: Content Pane View Type + Navigation

**Parallelism**: Can run in parallel with [01-tauri-backend.md](./01-tauri-backend.md). No Rust dependencies — pure TypeScript types and stubs.

## Overview

Add the `"changes"` variant to `ContentPaneView`, wire up navigation methods, and add rendering/header stubs in the content pane. The actual `ChangesView` component (Phase 4) is rendered lazily — this phase just adds the type plumbing.

## Phases

- [x] Add `"changes"` to `ContentPaneView` union type + content props interface
- [x] Add `navigateToChanges()` to navigation service
- [x] Update `Breadcrumb` component to accept `"changes"` category
- [x] Add rendering branch in content pane
- [x] Add header in content pane header

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## 2a. Add `"changes"` to `ContentPaneView`

**File:** `src/components/content-pane/types.ts`

The view type supports three modes (per key decision #23):
1. **All changes** (default): Just `repoId` + `worktreeId` — full diff from merge base to working tree (committed + uncommitted)
2. **Uncommitted only**: Adds `uncommittedOnly: true` — diff from HEAD to working tree only (staged + unstaged + untracked)
3. **Single commit**: Adds `commitHash` — shows diff introduced by one commit

Add this variant to the existing `ContentPaneView` union (after the `"pull-request"` variant):

```typescript
  | {
      type: "changes";
      repoId: string;
      worktreeId: string;
      /** If true, show only uncommitted changes (HEAD to working tree) */
      uncommittedOnly?: boolean;
      /** If set, show diff for this single commit */
      commitHash?: string;
    };
```

The full `ContentPaneView` type after this change:

```typescript
export type ContentPaneView =
  | { type: "empty" }
  | { type: "thread"; threadId: string; autoFocus?: boolean }
  | { type: "plan"; planId: string }
  | { type: "settings" }
  | { type: "logs" }
  | { type: "archive" }
  | { type: "terminal"; terminalId: string }
  | { type: "file"; filePath: string; repoId?: string; worktreeId?: string }
  | { type: "pull-request"; prId: string }
  | {
      type: "changes";
      repoId: string;
      worktreeId: string;
      /** If true, show only uncommitted changes (HEAD to working tree) */
      uncommittedOnly?: boolean;
      /** If set, show diff for this single commit */
      commitHash?: string;
    };
```

Also add a `ChangesContentProps` interface to `types.ts`, following the existing `ThreadContentProps`/`PlanContentProps` pattern:

```typescript
export interface ChangesContentProps {
  repoId: string;
  worktreeId: string;
  uncommittedOnly?: boolean;
  commitHash?: string;
}
```

This props interface will be consumed by the `ChangesView` component built in Phase 4.

## 2b. Add navigation methods

**File:** `src/stores/navigation-service.ts`

Add a new `navigateToChanges` method to the `navigationService` object (after `navigateToPullRequest`):

```typescript
/**
 * Navigate to the Changes view for a worktree.
 * Default mode: all changes from merge base.
 */
async navigateToChanges(repoId: string, worktreeId: string, options?: {
  uncommittedOnly?: boolean;
  commitHash?: string;
  /** Tree item ID to select (the "changes" parent or "commit" child item) */
  treeItemId?: string;
}): Promise<void> {
  const { treeItemId, ...viewOptions } = options ?? {};
  // Select the corresponding tree item so it highlights in the sidebar
  await treeMenuService.setSelectedItem(treeItemId ?? null);
  await contentPanesService.setActivePaneView({
    type: "changes",
    repoId,
    worktreeId,
    ...viewOptions,
  });
},
```

Also add a `"changes"` branch to `navigateToView()`. Insert this before the `else` fallthrough block:

```typescript
} else if (view.type === "changes") {
  // Changes views are navigated via navigateToChanges with explicit treeItemId,
  // but navigateToView doesn't know the tree item ID, so just set the view directly.
  await treeMenuService.setSelectedItem(null);
  await contentPanesService.setActivePaneView(view);
```

The full `navigateToView` method after this change:

```typescript
async navigateToView(view: ContentPaneView): Promise<void> {
  if (view.type === "thread") {
    await this.navigateToThread(view.threadId, { autoFocus: view.autoFocus });
  } else if (view.type === "plan") {
    await this.navigateToPlan(view.planId);
  } else if (view.type === "file") {
    await this.navigateToFile(view.filePath, {
      repoId: view.repoId,
      worktreeId: view.worktreeId,
    });
  } else if (view.type === "pull-request") {
    await this.navigateToPullRequest(view.prId);
  } else if (view.type === "changes") {
    await treeMenuService.setSelectedItem(null);
    await contentPanesService.setActivePaneView(view);
  } else {
    // For settings, logs, empty - clear tree selection
    await treeMenuService.setSelectedItem(null);
    await contentPanesService.setActivePaneView(view);
  }
},
```

Note: In practice, tree menu click handlers in Phase 3 will call `navigateToChanges()` directly (with `treeItemId`) rather than `navigateToView()`. The `navigateToView()` branch is for completeness (e.g., restoring persisted views on app restart).

## 2c. Update `Breadcrumb` component

**File:** `src/components/content-pane/breadcrumb.tsx`

The `Breadcrumb` component's `category` prop is currently typed as:

```typescript
category: "threads" | "plans" | "files" | "pull-requests";
```

Add `"changes"` to this union:

```typescript
category: "threads" | "plans" | "files" | "pull-requests" | "changes";
```

No other changes to the `Breadcrumb` component are needed — it already renders the category string as-is.

## 2d. Add rendering in ContentPane

**File:** `src/components/content-pane/content-pane.tsx`

Add a rendering branch for `view.type === "changes"`. Since the actual `ChangesView` component is built in Phase 4, use a placeholder that will be replaced.

At the top of the file, add a placeholder import (to be replaced in Phase 4 with a lazy import to the real component):

```typescript
// TODO(Phase 4): Replace with: const ChangesView = lazy(() => import("../changes/changes-view"));
function ChangesViewPlaceholder({ repoId, worktreeId, uncommittedOnly, commitHash }: {
  repoId: string; worktreeId: string; uncommittedOnly?: boolean; commitHash?: string;
}) {
  return (
    <div className="flex items-center justify-center h-full text-surface-400 text-sm">
      Changes view ({commitHash ? `commit ${commitHash.slice(0, 8)}` : uncommittedOnly ? "uncommitted" : "all changes"})
    </div>
  );
}
```

Add the rendering branch inside the `<div ref={contentRef}>` block, after the `"pull-request"` branch:

```tsx
{view.type === "changes" && (
  <ChangesViewPlaceholder
    repoId={view.repoId}
    worktreeId={view.worktreeId}
    uncommittedOnly={view.uncommittedOnly}
    commitHash={view.commitHash}
  />
)}
```

**Phase 4 wiring**: When Phase 4 implements `ChangesView` in `src/components/changes/changes-view.tsx`, this placeholder is replaced with a `React.lazy` import:

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

## 2e. Add header

**File:** `src/components/content-pane/content-pane-header.tsx`

Add a `ChangesHeader` component and wire it into the `ContentPaneHeader` function.

First, add the rendering branch in `ContentPaneHeader` (after the `"pull-request"` branch, before the settings/logs fallthrough):

```tsx
if (view.type === "changes") {
  return (
    <ChangesHeader
      repoId={view.repoId}
      worktreeId={view.worktreeId}
      uncommittedOnly={view.uncommittedOnly}
      commitHash={view.commitHash}
      onClose={onClose}
    />
  );
}
```

Then add the `ChangesHeader` component itself. It follows the `PlanHeader` pattern: uses `useBreadcrumbContext` for repo/worktree names, `Breadcrumb` for the path, and includes a close button.

```tsx
/**
 * Header for Changes view mode.
 * Breadcrumb format:
 * - All changes: repoName / worktreeName / changes / All Changes
 * - Uncommitted: repoName / worktreeName / changes / Uncommitted
 * - Single commit: repoName / worktreeName / changes / abc1234
 */
function ChangesHeader({
  repoId,
  worktreeId,
  uncommittedOnly,
  commitHash,
  onClose,
}: {
  repoId: string;
  worktreeId: string;
  uncommittedOnly?: boolean;
  commitHash?: string;
  onClose: () => void;
}) {
  const { repoName, worktreeName } = useBreadcrumbContext(repoId, worktreeId);

  const itemLabel = (() => {
    if (commitHash) return commitHash.slice(0, 7);
    if (uncommittedOnly) return "Uncommitted";
    return "All Changes";
  })();

  return (
    <div className="@container flex items-center gap-2.5 pl-3 pr-2 py-2 border-b border-surface-700">
      <Breadcrumb
        repoName={repoName}
        worktreeName={worktreeName}
        category="changes"
        itemLabel={itemLabel}
        onCategoryClick={onClose}
      />

      <div className="ml-auto">
        <button
          onClick={onClose}
          className="flex items-center justify-center w-5 h-5 rounded hover:bg-surface-700 text-surface-400 hover:text-surface-200 transition-colors"
          aria-label="Close pane"
        >
          <X size={12} />
        </button>
      </div>
    </div>
  );
}
```

Note: Key decision #30 says the "All Changes" header should include subtext indicating the merge base (e.g., "from `abc1234` (merge base with `main`)`"). That information is not available at the header level — it is resolved by the data hook in Phase 4. When Phase 4 is implemented, it can either pass the merge base info up via a store or context, or the subtext can be rendered inside the `ChangesView` component itself (below the header). For this phase, the header renders the basic breadcrumb only; the merge base subtext will be added as part of Phase 4's `changes-view.tsx` summary header.

## Wiring Points to Other Sub-Plans

- **Phase 3** (`03-tree-menu.md`): Tree menu click handlers call `navigationService.navigateToChanges()` with `treeItemId` to navigate and highlight the correct tree item. Phase 3 depends on this method existing.
- **Phase 4** (`04-changes-viewer.md`): The `ChangesView` component consumes `ChangesContentProps` and renders inside the content pane branch added here. Phase 4 replaces the placeholder with the real component.
- **Phase 5** (`05-file-browser.md`): File browser checks `view.type === "changes"` on the active pane to determine when to filter to changed files.

## Completion Criteria

- `ContentPaneView` union includes the `"changes"` variant with `repoId`, `worktreeId`, optional `uncommittedOnly`, and optional `commitHash`
- `ChangesContentProps` interface exported from `types.ts`
- `Breadcrumb` component accepts `"changes"` as a `category` value
- `navigateToChanges()` works and sets both tree selection and content pane view
- `navigateToView()` handles `"changes"` type
- Content pane renders a placeholder for `view.type === "changes"` (to be replaced in Phase 4)
- Header shows correct breadcrumb label for each mode: "All Changes", "Uncommitted", or short commit hash
- Close button sets the pane to empty view
