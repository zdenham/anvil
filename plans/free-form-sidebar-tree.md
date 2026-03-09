# Free-Form Sidebar Tree

## Summary

Transform the left sidebar into a single user-organizable tree. Worktrees, threads, plans, folders — all just nodes in one uniform tree with drag-and-drop reordering and nesting.

## Decisions

1. **Visual state lives on each entity** as a shared `visualSettings` object (standardized shape across all entity types). Not a separate store.
2. **Items stay within their worktree boundary** — drag-and-drop validates that threads/plans/terminals/PRs cannot leave their worktree's subtree.
3. **Pin is kept for worktree nodes** (replaces current section pin). Hide is dropped — users organize via folders + DnD instead.
4. **Big bang delivery** — implement on a branch, ship when complete. No feature flags or incremental compatibility layers.
5. **Default view = current behavior** — when no `visualSettings` are set, the tree renders identically to today (worktrees sorted by most recent activity, items by `createdAt` descending within each worktree).
6. **Terminals excluded from visual tree fields** — `TerminalSession` is runtime-only (not persisted to disk, lost on restart). Terminals appear under their worktree with no user-repositioning. Adding persistence for terminals is out of scope.
7. **Folders can exist at any level, including root** — root-level folders can contain worktrees for project grouping. Worktree boundary enforcement operates on entity `worktreeId`, not visual ancestry — a root folder wrapping two worktrees doesn't change constraint rules.
8. **Worktree row visual treatment is TBD** — worktree nodes are part of the unified tree and may get distinct visual treatment later, but rendering details are deferred.
9. **Folder icon picker: curated set (~20-30 icons)** — Folder, Star, Bug, Rocket, Lock, Settings, Code, etc. No full catalog search for V1.
10. **Folder creation via context menu only** — right-click any tree node → "New folder" creates a sibling folder. No keyboard shortcut or header button for V1.
11. **Empty folders remain visible** — users delete or archive manually via context menu. Folders are archivable (same cascade rules as other container types).
12. **Deleting a folder cascades to visual children** — when a folder is deleted (not archived), iterate over its visual children and delete them too. This is different from archive (which preserves data) — delete is destructive and recursive.
13. **New threads get `visualSettings.parentId` set to their domain parent at spawn** — `visualSettings.parentId` starts as a copy of the domain parent (e.g., worktreeId for top-level threads, parentThreadId for sub-agents). The difference is `visualSettings.parentId` is mutable by the user via DnD, while domain parent is immutable.
14. **`sectionId` removed, expansion keyed by node ID** — `TreeItemNode.sectionId` is eliminated. Expansion state keyed by each node's `id`. All items retain a `worktreeId` field (computed for folders from ancestry) used for pin filtering.
15. **Default type-group ordering within worktrees** — within each worktree node, items are grouped by type first (synthetic → PRs → threads → plans → terminals), then sorted within each group by createdAt desc. Once any item inside a parent gets a `sortKey` via DnD, that item is positioned by its sortKey while unkeyed items retain type-group ordering.
16. **"Move to root" is contextual** — for worktree-bound items it means "move to worktree root" (direct child of their worktree). Items cannot leave their worktree. For worktrees/root-folders it means actual tree root.
17. **Folder rename via context menu** — same inline-input pattern as worktree rename (context menu → "Rename" → inline input, Enter confirms, Escape cancels).
18. **No virtualization for the tree** — sidebar trees are small enough (<200 items typically) that virtualization is unnecessary. (Note: the tree already does not use virtualization — this is confirming that remains the case.)
19. **DnD overlay: clone of tree row** — `DragOverlay` renders a full-fidelity copy of the dragged row. Original row shows a semi-transparent ghost.
20. **Root folder creation via right-click on existing root nodes** — no empty-space context menu needed. There's always at least one worktree at root to right-click.
21. **`+` button stays on worktree rows** — worktree nodes keep the `+` button from current section headers for creating threads/terminals/PRs. Same functionality, new container type.
22. **Sub-agents appear under their parent thread** — `visualSettings.parentId` is set to parent thread at spawn. If parent was moved into a folder, sub-agent follows it there.
23. **Worktree deletion cascades archive** — deleting a worktree first archives all visual children (threads, plans, PRs, folders inside it), then removes the worktree itself. Preserves data, cleans the tree.
24. **Icon picker: context menu submenu** — "Change icon →" submenu shows a grid of ~20 curated icons inline in the context menu.
25. **"New folder" available on all node types** — right-clicking any node (including PRs, terminals) shows "New folder" which creates a sibling. Consistent behavior regardless of node type.
26. **Use `fractional-indexing` npm package** — well-tested, tiny, no need to reimplement.
27. **Drop zones always 25/50/25** — consistent hit zones regardless of context. Visual indicators distinguish nesting (container highlight) from reordering (line between items).
28. **Per-type context menu components with shared items** — each node type keeps its own context menu component but shared actions ("New folder", "Reset position") are extracted into reusable components composed into each menu.
29. **No "Move to..." picker** — DnD is the primary reposition mechanism. "Reset position" (contextual move-to-root) is the only non-DnD repositioning action.
30. **No keyboard DnD for V1** — mouse/touch only. "Reset position" in context menu provides a non-mouse escape hatch.
31. **No undo for DnD moves** — moves are instant. "Reset position" is the escape hatch.

## Current State

The sidebar is built reactively from entity stores. `RepoWorktreeSection` is a structurally separate type from `TreeItemNode`, creating a rigid two-tier model. Items are grouped by repo/worktree automatically. Parent-child nesting is derived directly from domain relationships (`parentThreadId`, `parentId`). Cross-type nesting is impossible. Sections can't be reordered or grouped.

Key files:
- `src/hooks/use-tree-data.ts` (625 lines) — builds tree from entities via `buildTreeFromEntities()` → `buildSectionItems()`
- `src/stores/tree-menu/types.ts` (107 lines) — `RepoWorktreeSection`, `TreeItemNode`
- `src/stores/tree-menu/store.ts` (114 lines) — expansion/pin/hide state, keyed by `"repoId:worktreeId"` section IDs
- `src/stores/tree-menu/service.ts` (277 lines) — hydrate, toggle, pin/hide, persist to `ui/tree-menu.json`
- `src/components/tree-menu/` (2,843 lines total) — all rendering components
  - `tree-menu.tsx` (261) — main container, keyboard nav, section iteration
  - `repo-worktree-section.tsx` (807) — section header, `+` dropdown, context menu, rename
  - `thread-item.tsx` (303) — thread rows, context menu (copy ID)
  - `plan-item.tsx` (384) — plan rows, archive/delete context menu with confirmation
  - `terminal-item.tsx` (167) — terminal rows
  - `pull-request-item.tsx` (182) — PR rows
  - `changes-item.tsx` (81), `uncommitted-item.tsx` (52), `commit-item.tsx` (72) — synthetic items
  - `menu-dropdown.tsx` (188), `item-preview-tooltip.tsx` (80), `section-divider.tsx` (19), `tree-panel-header.tsx` (110)

Dependencies already installed: `@dnd-kit/core` ^6.3.1, `@dnd-kit/sortable` ^10.0.0, `@dnd-kit/utilities` ^3.2.2 (currently used only in split-layout tab bar).

## Design

### Core Idea: One Flat Model

Eliminate `RepoWorktreeSection` as a separate structural concept. Worktrees become `TreeItemNode` nodes with `type: "worktree"`. The entire sidebar is one tree built from one pool of nodes, one recursive function, one set of rules.

```
📁 Active Work              ← folder node (root level)
  ├── mortician / main      ← worktree node
  │   ├── Thread A
  │   ├── 📁 Auth bugs      ← folder node (inside worktree)
  │   │   ├── Thread B
  │   │   └── Plan: auth-fix
  │   └── Changes
  └── other-repo / feature  ← worktree node
📁 On Hold                  ← folder node (root level)
  └── old-repo / main       ← worktree node
bare-repo / experiment      ← worktree node at root
```

One `visualSettings.parentId`, one `visualSettings.sortKey`, one DnD context.

---

### `visualSettings` — Shared Object on Every Persistable Entity

Add to `ThreadMetadata`, `PlanMetadata`, `PullRequestMetadata`, `FolderMetadata`, and `WorktreeState`:

```typescript
// core/types/visual-settings.ts
const VisualSettingsSchema = z.object({
  parentId: z.string().optional(),
  sortKey: z.string().optional(),
}).optional();

type VisualSettings = z.infer<typeof VisualSettingsSchema>;
```

Standardized across all entities. Mutations go through a shared `updateVisualSettings(entityType, entityId, patch)` function.

**NOT added to `TerminalSession`** — terminals are runtime-only and not persisted to disk.

**Resolution order for visual parent:**
1. `visualSettings.parentId` if set → place under that node
2. Else if domain parent exists (sub-agent `parentThreadId`, child plan `parentId`) → place under domain parent
3. Else for worktree-scoped entities → place under their worktree node (via `worktreeId`)
4. Else → tree root

**Initialization at spawn:** When a new thread/plan/PR is created, `visualSettings.parentId` is immediately set to the domain parent (worktreeId for top-level items, parentThreadId for sub-agents). This means `visualSettings.parentId` is always populated after creation — the resolution fallback chain above is only for legacy entities that predate this feature.

**Sorting within a parent (preserves current behavior when no visualSettings):**
- **Default (no sortKeys):** items grouped by type (synthetic → PRs → threads → plans → terminals), then sorted by `createdAt` descending within each type group. This matches current behavior.
- **Mixed (some items have sortKeys):** unkeyed items retain type-group ordering at the top, keyed items are positioned by `sortKey` below.
- **All keyed:** pure `sortKey` lexicographic ascending, no type grouping.

Sort keys use **fractional indexing** via `fractional-indexing` npm package.

---

### Worktree as Tree Node

`WorktreeState` already has `id`, `name`, and lives in `RepositorySettings.worktrees[]`. Add `visualSettings`:

```typescript
type WorktreeState = {
  id: string;
  path: string;
  name: string;
  currentBranch?: string | null;
  // ...existing fields...
  visualSettings?: VisualSettings;
};
```

Worktree nodes become `TreeItemNode` with `type: "worktree"`. They display as `"repoName / worktreeName"` (same as current section headers). They're always containers — threads/plans/etc. are their children. They keep the `+` button for creating new threads/terminals/PRs.

**Pin support:** Worktree nodes support pinning (same as current section pin). Pinning a worktree shows only that worktree's subtree. Pin state migrates from `"repoId:worktreeId"` section IDs to worktree node IDs.

**This eliminates `RepoWorktreeSection` entirely.**

---

### Folder Entity

```
~/.mort/folders/{id}/metadata.json
```

```typescript
type FolderMetadata = {
  id: string;                    // nanoid
  name: string;
  icon: string;                  // lucide icon identifier from curated set
  worktreeId?: string;           // set when folder is inside a worktree (for boundary enforcement)
  visualSettings?: VisualSettings;
  createdAt: number;
  updatedAt: number;
};
```

**`worktreeId` on folders:** When a folder is created inside a worktree (or dragged into one), it gets the worktree's ID. Folders at root level have no `worktreeId`. Moving a folder into a worktree sets it; moving it to root clears it (recursively for nested folders).

**Curated icon set (~20-30):** Folder, FolderOpen, Star, Bug, Rocket, Lock, Settings, Code, FileText, Zap, Shield, Heart, Bookmark, Flag, Tag, Lightbulb, Wrench, Package, Database, Globe, etc. Rendered via Lucide React.

**Context menu creation:** Right-click any node → "New folder" creates a sibling folder with default name "New folder" and inline rename active.

**Archive/Delete:** Folders can be archived (cascade archive descendants) or deleted (cascade delete descendants) via context menu.

Loaded into `useFolderStore` (Zustand entity store, same pattern as threads/plans).

---

### Unified Tree Builder

One function replaces `buildTreeFromEntities()` + `buildSectionItems()` + the separate `addThreadAndChildren` / `addPlanAndChildren` recursion:

```
1. Pool ALL nodes: worktrees, folders, threads, plans, terminals, PRs
2. Resolve each node's visual parent:
     visualSettings.parentId (always set for new entities)
       ?? domain parent fallback (legacy entities only)
       ?? "root"
3. Build childrenMap: Map<parentId | "root", node[]>
4. Sort children per parent:
     - If no children have sortKey: group by type, then createdAt desc within group
     - Mixed: unkeyed items (type-grouped) first, then keyed items by sortKey asc
     - All keyed: pure sortKey ordering
5. Compute worktreeId for each node (entities have it; folders inherit from ancestor)
6. Single recursive addNodeAndChildren(node, depth)
```

**Container types** (can have children): `worktree`, `folder`, `plan`, `thread`
**Leaf types**: `terminal`, `pull-request`, `changes`, `uncommitted`, `commit`

Synthetic items (Changes, Uncommitted, Commits) are still generated per-worktree and attached as children of the worktree node, same as today.

---

### Drag-and-Drop

One `DndContext` for the entire sidebar. Use `@dnd-kit/core` + `@dnd-kit/sortable` (already installed).

**Draggable:** All nodes except synthetic items (changes, uncommitted, commit) and terminals
**Drop targets:** Container types + between-items for reorder

**Drop constraints:**
- Threads, plans, PRs cannot be dragged out of their worktree
- Worktrees can be dragged into folders or to root, but not into other worktrees
- Folders can go anywhere except into a different worktree than their contents belong to
- Cannot create cycles (no dropping a node into its own descendant)
- Cannot drop into leaf-only types

**Worktree boundary validation:** Walk up the target's ancestor chain to find its worktree. Compare with the dragged item's `worktreeId`. Block if they differ.

**On drop:**
- Set `visualSettings.parentId` on the dragged node
- Generate `visualSettings.sortKey` between its new neighbors via `fractional-indexing`
- Write to disk via shared `updateVisualSettings()`

#### Drop Zone Detection

Positional hit regions per row (always 25/50/25):

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
| Dragging | `DragOverlay` with full-fidelity row clone. Original row semi-transparent ghost. |
| Valid reorder | Blue horizontal line between items |
| Valid nest target | Container highlighted with accent background |
| Invalid drop | Red tint on row + disabled cursor. Tooltip with reason. |
| Hover on collapsed container | Auto-expand after 500ms |

---

### Context Menus

Per-type context menu components with shared items extracted as reusable components.

**Shared items (all node types):**
- "New folder" — creates sibling folder with inline rename
- "Reset position" — moves item to its worktree root (or tree root for worktrees/root-folders)

**Worktree menu:** Pin workspace, New thread, New terminal, Create pull request, New worktree, New repository, Rename worktree, Archive worktree (cascade)

**Thread menu:** Copy Thread ID, Reset position, New folder

**Plan menu:** Archive, Delete, Delete + remove from git (with confirmation), Reset position, New folder

**Folder menu:** Rename, Change icon → (curated icon grid submenu), Archive folder (cascade), Delete folder (cascade), Reset position, New folder

**PR menu:** Reset position, New folder

**Terminal menu:** New folder (creates sibling)

---

### Cascade Archive & Cascade Delete

**Archive** a node archives **all visual descendants** recursively:
- Archive a folder → archive all contents (threads, plans, sub-folders, etc.)
- Archive a thread → archive its visual children (sub-agents, anything user placed there)
- Archive a worktree → archive everything inside it, then remove the worktree

**Delete** a folder **deletes all visual children** recursively. This is destructive — data is permanently removed.

**Implementation:** Walk the `childrenMap` from the tree builder, collect all descendant IDs, archive/delete each.

**Key rule:** Follows visual tree, not domain relationships. If a sub-agent was moved out of its parent, archiving the parent doesn't touch it. Visual grouping = user intent.

**Unarchive:** Restoring a node restores descendants. Entities still have `visualSettings.parentId` so they reappear correctly.

---

## Phases

- [ ] **Phase 1: Types & schemas** — Create `core/types/visual-settings.ts` with `VisualSettingsSchema`. Add `visualSettings?: VisualSettings` to `ThreadMetadataSchema` (`core/types/threads.ts`), `PlanMetadataSchema` (`core/types/plans.ts`), `PullRequestMetadataSchema` (`core/types/pull-request.ts`), `WorktreeStateSchema` (`core/types/repositories.ts`). Install `fractional-indexing`. Create shared `updateVisualSettings()` helper.
- [ ] **Phase 2: Folder entity** — Create `FolderMetadata` type + `FolderMetadataSchema` in `core/types/folders.ts`. Create `useFolderStore` in `src/entities/folders/store.ts`. Create `folderService` with CRUD + disk persistence at `~/.mort/folders/{id}/metadata.json` + hydration in `src/entities/folders/service.ts`.
- [ ] **Phase 3: Entity spawn integration** — Update `threadService.create()` (`src/entities/threads/service.ts`), `planService.create()` (`src/entities/plans/service.ts`), and `pullRequestService.create()` (`src/entities/pull-requests/service.ts`) to initialize `visualSettings.parentId` at creation time.
- [ ] **Phase 4: Unified tree model** — Add `"worktree"` and `"folder"` to `TreeItemNode.type` union, add `worktreeId` field, remove `sectionId` field (`src/stores/tree-menu/types.ts`). Remove `RepoWorktreeSection` type. Migrate expansion state keys from `"repoId:worktreeId"` to node IDs, migrate pin state from section IDs to worktree IDs, remove hide state (`src/stores/tree-menu/store.ts`, `service.ts`). Rewrite `use-tree-data.ts` as single unified recursion with visual parent resolution and type-group + fractional sort key ordering.
- [ ] **Phase 5: Rendering refactor** — Update `tree-menu.tsx` to iterate flat node list instead of sections. Replace `repo-worktree-section.tsx` section header rendering with worktree-type `TreeItemNode` rows (keeping `+` button, rename, pin). Add folder row rendering. Update `thread-item.tsx`, `plan-item.tsx`, `terminal-item.tsx`, `pull-request-item.tsx` to work with new `TreeItemNode` shape (no `sectionId`, uses `worktreeId`).
- [ ] **Phase 6: Context menus & folder UI** — Extract shared context menu items ("New folder", "Reset position") into reusable components. Add "New folder" to all per-type context menus. Build folder context menu (rename with inline input, "Change icon →" submenu with curated icon grid, archive, delete). Wire up folder creation (creates sibling of right-clicked node, default name, inline rename active).
- [ ] **Phase 7: Cascade archive & delete** — Implement visual-tree-walk cascade for archive (walk `childrenMap`, collect descendant IDs, archive each). Wire into folder archive, thread archive, worktree delete (archive children then remove worktree). Implement cascade delete for folders (destructive recursive delete of all visual children).
- [ ] **Phase 8: Drag-and-drop** — Wrap sidebar in `DndContext`. Make all non-synthetic, non-terminal nodes draggable via `useSortable`. Implement custom collision detection with 25/50/25 hit zones. Build `isDropAllowed()` validator (worktree boundary check via ancestor walk, cycle detection, leaf-type rejection). Render `DragOverlay` with row clone. Add visual indicators (blue line, accent highlight, red tint + tooltip for invalid). Auto-expand collapsed containers on 500ms hover. On drop: update `visualSettings` via `updateVisualSettings()`.
- [ ] **Phase 9: Tests** — Unit tests for unified tree builder (visual parent resolution, domain fallback for legacy entities, type-group sorting, fractional sort key ordering, mixed keyed/unkeyed). Unit tests for cascade archive (visual tree walk, moved-out items not affected). Unit tests for `isDropAllowed()` (worktree boundary, cycle detection, leaf rejection, folder with bound children).

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Anticipated Complications

### 1. Worktree Boundary Enforcement
The "can't drag items between worktrees" rule needs to check ancestry, not just immediate parent. If a thread is inside a folder that's inside a worktree, dragging it to a folder inside a *different* worktree must be blocked. The drop validator walks up the target's ancestor chain to find its worktree and compares with the dragged item's `worktreeId`.

### 2. Removing `RepoWorktreeSection`
This type is used throughout the rendering layer — especially `repo-worktree-section.tsx` (807 lines). Every component that renders section headers needs to render worktree-type `TreeItemNode` nodes instead. The data is the same, just the container type changes. The `+` button, rename, pin, and context menu all carry over to the worktree node.

### 3. Domain Hierarchy Still Matters for Display
Sub-agent badges, plan-thread relations, etc. still use `parentThreadId`/`parentId`. These fields remain. `isSubAgent` on `TreeItemNode` is derived from domain `parentThreadId`, not visual position. A sub-agent dragged to a different location still shows its sub-agent badge.

### 4. Folder Worktree Scoping
Folders get a `worktreeId` when placed inside a worktree. The drop constraint checker uses this to enforce boundaries. When a folder is moved between root and a worktree, its `worktreeId` is updated (and recursively for nested folders).

### 5. Expansion State Migration
Current expansion keys use `"repoId:worktreeId"` for sections and `"thread:{id}"`, `"plan:{id}"` for items. These all need to migrate to plain node IDs. On first load after the refactor, existing persisted expansion state will be stale — acceptable for a big-bang delivery.

### 6. Fractional Index Exhaustion (Theoretical)
Keys grow with repeated same-position insertions. In practice, never matters for sidebar-scale data (dozens to hundreds of items). Compaction available if ever needed — YAGNI.

### 7. Auto-Expand on Drag Hover
Hovering over a collapsed container should auto-expand after ~500ms. Requires a timer in the DnD overlay that resets on drag leave. Standard pattern.

### 8. Terminal Sessions Not Draggable
Terminals are runtime-only (no disk persistence). They always appear under their worktree and cannot be dragged. This is intentional — terminals are ephemeral and lost on restart, so user organization would be lost too.

## Feasibility

**Feasible: Yes.** The unified model is actually simpler than both the current code and the previous two-level proposal:

1. **One node type** — `TreeItemNode` with `"worktree"` and `"folder"` added. Eliminates `RepoWorktreeSection`.
2. **One shared `visualSettings` object** on existing entities — backward compatible, no migration needed.
3. **One recursive builder** — replaces two separate recursions + section grouping logic. Net code reduction.
4. **One DnD context** — `@dnd-kit` already installed, used in tab bar. Same patterns apply.
5. **Folder entity** — follows existing entity patterns exactly (store, service, disk persistence).

The biggest work item is Phase 5 (rendering refactor) — updating ~2,800 lines of tree-menu components to handle the flat model. Everything else is additive.
