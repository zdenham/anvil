# Type-priority sorting for sidebar tree items

## Problem

Within each worktree, all child items are sorted by a single algorithm (Step 3 in `buildUnifiedTree`):

1. Items with `sortKey` sort lexicographically (ascending) — these are DnD-positioned items
2. Items without `sortKey` sort by `createdAt` descending (newest first)

There is no type-based priority. PRs, terminals, and the Changes node are interleaved with threads and plans purely by creation time. The Changes node (`createdAt: 0`) always sinks to the bottom.

Additionally, the **Files item is not a tree node at all** — it's hardcoded inside `WorktreeItem` (`worktree-item.tsx:73-82`) and rendered directly when a worktree is expanded. This means it can't participate in sorting, DnD, or keyboard navigation.

The user expectation is that **Files, PRs, terminals, and Changes should appear above threads and plans** within each parent, since they represent active operational items vs. conversation history. PRs should rank higher than Changes.

## Root cause

### Sorting

`src/hooks/use-tree-data.ts` lines 191–198 — the sort comparator has no concept of item type priority:

```ts
children.sort((a, b) => {
  if (a.sortKey && b.sortKey) return a.sortKey < b.sortKey ? -1 : ...;
  if (a.sortKey && !b.sortKey) return -1;
  if (!a.sortKey && b.sortKey) return 1;
  return b.createdAt - a.createdAt;  // ← flat sort, no type awareness
});
```

### Files not a tree node

`FilesItem` in `src/components/tree-menu/files-item.tsx` is a standalone React component rendered inside `WorktreeItem` via a conditional (`worktree-item.tsx:73-82`). It has no `TreeItemType` entry, no builder function, and no presence in `buildUnifiedTree`. It's effectively invisible to the tree data model.

## Proposed fix

### Part 1: Promote Files to a proper tree node

1. **Add** `"files"` **to** `TreeItemType` in `src/stores/tree-menu/types.ts`:

   ```ts
   export type TreeItemType =
     | "worktree"
     | "folder"
     | "thread"
     | "plan"
     | "terminal"
     | "pull-request"
     | "files"       // ← new
     | "changes"
     | "uncommitted"
     | "commit";
   ```

2. **Add** `repoId` **to** `TreeItemNode` (if not already present — needed for the Files click handler). Already exists on worktree nodes via `repoId?`.

3. **Add** `buildFilesNode()` **to** `tree-node-builders.ts` — synthetic node, one per worktree, similar to `buildChangesNodes`:

   ```ts
   export function buildFilesNode(worktreeId: string, repoId: string): TreeItemNode {
     return {
       type: "files",
       id: `files:${worktreeId}`,
       title: "Files",
       status: "read",
       updatedAt: 0,
       createdAt: 0,
       depth: 0,
       isFolder: false,
       isExpanded: false,
       worktreeId,
       parentId: worktreeId,
       repoId,
     };
   }
   ```

4. **Call** `buildFilesNode()` **in** `buildUnifiedTree()` (Step 1b area), one per worktree.

5. **Add a** `case "files"` **to** `TreeItemRenderer` that renders the existing `FilesItem` component (adapted to accept a `TreeItemNode`).

6. **Remove the hardcoded** `FilesItem` **from** `WorktreeItem` (`worktree-item.tsx:73-82`), since it will now be rendered as a regular tree node. Also remove the `onOpenFiles`/`isFileBrowserOpen` props from `WorktreeItem` and `TreeItemRendererProps` if no longer needed there (they move to `TreeItemRenderer`).

### Part 2: Type-priority sorting

Add a type-priority tier to the sort comparator, applied **only when neither item has a sortKey** (so DnD-positioned items remain fully user-controlled).

Priority tiers (lower number = sorts first):

| Tier | Types |
| --- | --- |
| 0 | `files` |
| 1 | `pull-request`, `terminal` |
| 2 | `changes` |
| 3 | `thread`, `plan`, `folder`, everything else |

Within the same tier, keep the existing `createdAt` descending order.

#### Code change

In `src/hooks/use-tree-data.ts`, add a priority map and modify Step 3:

```ts
/** Type-based sort priority — lower number sorts first within a parent.
 *  Only applies to items without an explicit sortKey (non-DnD items). */
const TYPE_SORT_PRIORITY: Partial<Record<TreeItemType, number>> = {
  files: 0,
  "pull-request": 1,
  terminal: 1,
  changes: 2,
  // thread, plan, folder, etc. default to 3
};

function typePriority(node: TreeItemNode): number {
  return TYPE_SORT_PRIORITY[node.type] ?? 3;
}
```

Then in the sort comparator, between the sortKey checks and the `createdAt` fallback:

```ts
children.sort((a, b) => {
  if (a.sortKey && b.sortKey) return a.sortKey < b.sortKey ? -1 : a.sortKey > b.sortKey ? 1 : 0;
  if (a.sortKey && !b.sortKey) return -1;
  if (!a.sortKey && b.sortKey) return 1;
  // Type priority: operational items above conversations
  const pa = typePriority(a);
  const pb = typePriority(b);
  if (pa !== pb) return pa - pb;
  return b.createdAt - a.createdAt;
});
```

### Test changes

Update `src/hooks/__tests__/use-tree-data.test.ts`:

1. Add a test that creates a thread, a PR, a terminal, and a files node, and verifies the order is: Files → PR → terminal → Changes → thread
2. Verify that DnD-positioned items (with sortKey) still override type priority

## Phases

- [x] Add `"files"` to `TreeItemType` and create `buildFilesNode()` in tree-node-builders

- [x] Wire files node into `buildUnifiedTree()` and add `case "files"` to `TreeItemRenderer`

- [x] Remove hardcoded `FilesItem` from `WorktreeItem`

- [x] Add type priority map and update sort comparator in `use-tree-data.ts`

- [x] Add/update tests for type-priority ordering and files node

- [x] Run tests to verify nothing breaks

&lt;!-- IMPORTANT: Mark phases complete with \[x\] as you finish them. Update this file immediately after completing each phase - do not batch updates. --&gt;

---

## Files to modify

- `src/stores/tree-menu/types.ts` — add `"files"` to `TreeItemType`
- `src/hooks/tree-node-builders.ts` — add `buildFilesNode()`
- `src/hooks/use-tree-data.ts` — call `buildFilesNode()` + sort comparator + priority map
- `src/components/tree-menu/tree-item-renderer.tsx` — add `case "files"`
- `src/components/tree-menu/worktree-item.tsx` — remove hardcoded `FilesItem` rendering
- `src/components/tree-menu/files-item.tsx` — adapt to accept `TreeItemNode` (or keep as-is if renderer wraps it)
- `src/hooks/__tests__/use-tree-data.test.ts` — new test cases