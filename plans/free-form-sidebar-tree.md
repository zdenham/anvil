# Free-Form Sidebar Tree

## Summary

Transform the left sidebar into a single user-organizable tree. Worktrees, threads, plans, folders — all just nodes in one uniform tree with drag-and-drop reordering and nesting.

## Current State

The sidebar is built reactively from entity stores. `RepoWorktreeSection` is a structurally separate type from `TreeItemNode`, creating a rigid two-tier model. Items are grouped by repo/worktree automatically. Parent-child nesting is derived directly from domain relationships (`parentThreadId`, `parentId`). Cross-type nesting is impossible. Sections can't be reordered or grouped.

Key files:
- `src/hooks/use-tree-data.ts` — builds tree from entities via `buildTreeFromEntities()` → `buildSectionItems()`
- `src/stores/tree-menu/types.ts` — `RepoWorktreeSection`, `TreeItemNode`
- `src/stores/tree-menu/store.ts` + `service.ts` — expansion/selection/pin/hide state
- `src/components/tree-menu/` — all rendering components

## Goals

1. **One tree** — everything is a node: worktrees, folders, threads, plans, terminals, PRs
2. **User-created folders** with custom icons, nestable at any level
3. **Decoupled hierarchy** — visual parent-child via `visualTreeParentId` on every entity, domain relationships as fallback
4. **Drag-and-drop** with fractional sort keys and clear valid/invalid drop indicators
5. **Cascade archive** — archiving a node archives all visual descendants

## Design

### Core Idea: One Flat Model

Eliminate `RepoWorktreeSection` as a separate structural concept. Worktrees become `TreeItemNode` nodes with `type: "worktree"`. The entire sidebar is one tree built from one pool of nodes, one recursive function, one set of rules.

```
📁 Active Work              ← folder node
  ├── mortician / main      ← worktree node
  │   ├── Thread A
  │   ├── 📁 Auth bugs      ← folder node
  │   │   ├── Thread B
  │   │   └── Plan: auth-fix
  │   └── Changes
  └── other-repo / feature  ← worktree node
📁 On Hold                  ← folder node
  └── old-repo / main       ← worktree node
bare-repo / experiment      ← worktree node at root
```

No levels, no scopes, no special cases. One `visualTreeParentId`, one `visualSortKey`, one DnD context.

---

### `visualTreeParentId` + `visualSortKey` on Every Entity

Add to `ThreadMetadata`, `PlanMetadata`, `TerminalSession`, `PullRequestMetadata`, `FolderMetadata`, and `WorktreeState`:

```typescript
/** Visual tree parent — any node ID, or undefined for root / domain default */
visualTreeParentId?: string;

/** Lexicographic sort key within visual parent. Undefined = sort by createdAt.
 *  Uses fractional indexing so inserting between two items only writes the moved item. */
visualSortKey?: string;
```

**Resolution order for visual parent:**
1. `visualTreeParentId` if set → place under that node
2. Else if domain parent exists (sub-agent `parentThreadId`, child plan `parentId`) → place under domain parent's worktree node (not under parent directly — see below)
3. Else → tree root

**Important default for threads/plans:** When `visualTreeParentId` is unset and there's no domain parent, items default to being children of their worktree node (derived from their `worktreeId`). This preserves the current behavior where threads appear under their worktree section.

**Default for sub-agents:** When `visualTreeParentId` is unset and `parentThreadId` is set, the sub-agent appears under its parent thread. Same as today.

**Sorting within a parent:**
- Items with `visualSortKey`: lexicographic ascending
- Items without: `createdAt` descending (current behavior)
- Mixed: keyed items first, then unkeyed

Sort keys use **fractional indexing** — string keys where you can always generate a key between any two adjacent keys. On drag, only the moved item is written. Library: `fractional-indexing` or ~50 lines of implementation.

---

### Worktree as Tree Node

`WorktreeState` already has `id`, `name`, and lives in `RepositorySettings.worktrees[]`. Add `visualTreeParentId` and `visualSortKey` to `WorktreeState`:

```typescript
type WorktreeState = {
  id: string;
  path: string;
  name: string;
  currentBranch?: string | null;
  // ...existing fields...
  visualTreeParentId?: string;  // folder ID or undefined (root)
  visualSortKey?: string;
};
```

Worktree nodes become `TreeItemNode` with `type: "worktree"`. They display as `"repoName / worktreeName"` (same as current section headers). They're always containers — threads/plans/etc. are their children.

**This eliminates `RepoWorktreeSection` entirely.** The tree is just `TreeItemNode[]` with depth.

---

### Folder Entity

```
~/.mort/folders/{id}/metadata.json
```

```typescript
type FolderMetadata = {
  id: string;                    // nanoid
  name: string;
  icon: string;                  // lucide icon identifier
  visualTreeParentId?: string;   // nestable — folders in folders
  visualSortKey?: string;
  createdAt: number;
  updatedAt: number;
};
```

Note: **no `repoId`/`worktreeId`** — folders are not scoped to a worktree. They can live at any level: root, inside another folder, or inside a worktree. This keeps the model uniform.

Loaded into `useFolderStore` (Zustand entity store, same pattern as threads/plans).

---

### Unified Tree Builder

One function replaces `buildTreeFromEntities()` + `buildSectionItems()` + the separate `addThreadAndChildren` / `addPlanAndChildren` recursion:

```
1. Pool ALL nodes: worktrees, folders, threads, plans, terminals, PRs
2. Resolve each node's visual parent:
     visualTreeParentId
       ?? domain parent (parentThreadId for sub-agents, parentId for child plans)
       ?? worktreeId (threads/plans/terminals default under their worktree)
       ?? "root" (worktrees and folders without a parent)
3. Build childrenMap: Map<parentId | "root", node[]>
4. Sort children per parent (fractional key, then createdAt fallback)
5. Single recursive addNodeAndChildren(node, depth)
```

**Container types** (can have children): `worktree`, `folder`, `plan`, `thread`
**Leaf types**: `terminal`, `pull-request`, `changes`, `uncommitted`, `commit`

Synthetic items (Changes, Uncommitted, Commits) are still generated per-worktree and attached as children of the worktree node, same as today.

---

### Drag-and-Drop

One `DndContext` for the entire sidebar. Use `@dnd-kit/core` + `@dnd-kit/sortable`.

**Draggable:** All nodes except synthetic items (changes, uncommitted, commit)
**Drop targets:** Container types + between-items for reorder

**Drop constraints:**
- Threads, plans, terminals, PRs cannot be dragged out of their worktree (they have a `worktreeId` — the drop target must be the same worktree or a descendant of it)
- Worktrees can be dragged into folders or to root, but not into other worktrees
- Folders can go anywhere (root, inside folders, inside worktrees)
- Cannot create cycles (no dropping a node into its own descendant)
- Cannot drop into leaf-only types

**On drop:**
- Set `visualTreeParentId` on the dragged node
- Generate `visualSortKey` between its new neighbors
- Write to disk (single entity file)

#### Drop Zone Detection

Positional hit regions per row:

```
┌─────────────────────────────┐
│  top 25%    → reorder above │
│  middle 50% → nest inside   │  (container types only)
│  bottom 25% → reorder below │
└─────────────────────────────┘
```

Leaf types: top 50% = above, bottom 50% = below (no nesting).

#### Visual Indicators

| State | Indicator |
|-------|-----------|
| Dragging | Semi-transparent ghost of the dragged item |
| Valid reorder | Blue horizontal line between items |
| Valid nest target | Container highlighted with accent background |
| Invalid drop | Red tint on row + disabled cursor. Tooltip with reason (e.g., "Can't move between worktrees") |
| Hover on collapsed container | Auto-expand after 500ms |

---

### Cascade Archive

Archiving a node archives **all visual descendants** recursively:

- Archive a folder → archive all contents (threads, plans, sub-folders, etc.)
- Archive a thread → archive its visual children (sub-agents, anything user placed there)
- Archive a worktree → archive everything inside it

**Implementation:** Walk the `childrenMap` from the tree builder, collect all descendant IDs, archive each.

**Key rule:** Follows visual tree, not domain relationships. If a sub-agent was moved out of its parent, archiving the parent doesn't touch it. Visual grouping = user intent.

**Unarchive:** Restoring a node restores descendants. Entities still have `visualTreeParentId` so they reappear correctly.

---

## Phases

- [ ] Add `visualTreeParentId` and `visualSortKey` optional fields to `WorktreeState`, `ThreadMetadata`, `PlanMetadata`, `TerminalSession`, `PullRequestMetadata` and their Zod schemas
- [ ] Create `FolderMetadata` entity type, Zod schema, `useFolderStore`, folder service (CRUD + disk persistence at `~/.mort/folders/{id}/metadata.json`)
- [ ] Add `"worktree"` and `"folder"` to `TreeItemNode.type` union; remove `RepoWorktreeSection` type
- [ ] Rewrite tree builder as single unified recursion: one `addNodeAndChildren()` with visual parent resolution and fractional sort key ordering
- [ ] Update all tree-menu rendering components to handle the flat node model (worktree rows replace section headers, folder rows with icons)
- [ ] Implement cascade archive — visual tree walk to archive all descendants
- [ ] Add folder CRUD UI: create, rename, delete, icon picker (Lucide icon set)
- [ ] Add `@dnd-kit` and implement DnD with drop zone detection, constraint validation, and visual indicators
- [ ] Add context menu actions: "New folder", "Move to...", "Move to root"
- [ ] Write tests: unified tree builder (visual parent resolution, domain fallback, cross-type nesting, sort ordering), cascade archive, drop constraint validation

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Anticipated Complications

### 1. Worktree Boundary Enforcement
The "can't drag items between worktrees" rule needs to check ancestry, not just immediate parent. If a thread is inside a folder that's inside a worktree, dragging it to a folder inside a *different* worktree must be blocked. The drop validator needs to walk up the target's ancestor chain to find its worktree and compare with the dragged item's `worktreeId`.

### 2. Removing `RepoWorktreeSection`
This type is used throughout the rendering layer. Every component that renders the current section headers needs to be updated to render worktree-type `TreeItemNode` nodes instead. This is a significant but straightforward refactor — the data is the same, just the container type changes.

### 3. Domain Hierarchy Still Matters for Display
Sub-agent badges, plan-thread relations, etc. still use `parentThreadId`/`parentId`. These fields remain. `isSubAgent` on `TreeItemNode` is derived from domain `parentThreadId`, not visual position. A sub-agent dragged to a different location still shows its sub-agent badge.

### 4. Worktree Default Parenting
Threads/plans without `visualTreeParentId` default to their worktree node (via `worktreeId`). This means the tree builder needs to resolve `worktreeId` → worktree node ID for the fallback. Since worktree IDs are already on every entity, this is a simple map lookup.

### 5. Folders Without Worktree Scope
Folders have no `worktreeId` since they can live at any level. This means the drop constraint checker can't just compare `worktreeId` fields — for folders, it needs to walk up the tree to determine which worktree (if any) the folder is inside.

### 6. Fractional Index Exhaustion (Theoretical)
Keys grow with repeated same-position insertions. In practice, never matters for sidebar-scale data (dozens to hundreds of items). Compaction available if ever needed — YAGNI.

### 7. Auto-Expand on Drag Hover
Hovering over a collapsed container should auto-expand after ~500ms. Requires a timer in the DnD overlay that resets on drag leave. Standard pattern.

## Feasibility

**Feasible: Yes.** The unified model is actually simpler than both the current code and the previous two-level proposal:

1. **One node type** — `TreeItemNode` with `"worktree"` added. Eliminates `RepoWorktreeSection`.
2. **Two optional fields** on existing entities — backward compatible, no migration.
3. **One recursive builder** — replaces two separate recursions + section grouping logic. Net code reduction.
4. **One DnD context** — simpler than two coordinated contexts.
5. **Folder entity** — follows existing patterns exactly.

The biggest work item is updating the rendering layer to handle worktree-as-node instead of worktree-as-section. Everything else is additive.
