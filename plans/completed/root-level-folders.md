# Root-Level Folders (Above Worktrees)

Split from `folder-item-ux-fixes.md` issue #2 — this is the most architectural change and needs dedicated attention.

## Problem

Currently folders must have a `worktreeId`. There's no way to create a folder that contains worktrees — folders are always scoped inside a worktree. `validFolders` in `use-tree-data.ts:154` filters out folders without a known `worktreeId`, and `createFolderAndRename()` requires both `parentId` and `worktreeId`.

## Expected Behavior

Repos and worktrees should be nestable inside root-level folders. Users should be able to create organizational folders at the top level of the sidebar that group worktrees together.

**Constraint**: Worktrees can only be placed inside root-level folders — not inside other worktrees. The nesting hierarchy is strictly: root-level folder → worktree(s). Worktree-to-worktree nesting is not supported.

## Design Considerations

### Data model

- `worktreeId` on `FolderMetadata` is already optional — no schema change needed for folders themselves.

### Tree builder (`use-tree-data.ts`)

- Stop filtering folders by `knownWorktreeIds` (line 154) — allow folders with no `worktreeId`
- Root-level folders (no `worktreeId`, no `parentId` or `parentId` is ROOT) appear at depth 0
- Worktree nodes need to support `parentId` to be nested inside root-level folders (but never inside other worktrees)

### Worktree nesting (the hard part)

Worktrees don't currently have `visualSettings`. Options:

1. **Add** `visualSettings` **to worktree metadata** — consistent with how threads/plans/folders work, but requires changes to core types and worktree service
2. **Separate mapping file** (e.g., `~/.anvil/ui/worktree-parents.json`) — maps worktree IDs to folder parents, avoids touching core types
3. **Store on folder side** — folders have a `children` array of worktree IDs

**Recommendation**: Option 1 (`visualSettings` on worktree info) is simplest and most consistent. Requires adding visual settings support to the repo-worktree-lookup store or a parallel store.

### UI affordance

- "New folder" option in top-level context menu (right-click on empty sidebar space) or in the tree panel header

### DnD

- Allow dragging worktrees into root-level folders (cross-boundary DnD)
- Reject drops of worktrees onto other worktrees — only root-level folders are valid drop targets for worktrees

## Key Files

- `src/hooks/use-tree-data.ts`
- `src/components/tree-menu/folder-actions.ts`
- `src/components/tree-menu/tree-menu.tsx`
- `src/entities/folders/service.ts`
- `core/types/folders.ts`

## Phases

- [x] Research worktree metadata and visual settings patterns in core types

- [x] Update data model — allow root-level folders in tree builder

- [x] Add visual settings support for worktree nesting

- [x] Add UI affordance for creating root-level folders

- [x] Enable cross-boundary DnD (worktrees into root-level folders)

&lt;!-- IMPORTANT: Mark phases complete with \[x\] as you finish them. Update this file immediately after completing each phase - do not batch updates. --&gt;

---