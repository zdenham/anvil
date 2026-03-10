# Free-Form Sidebar Tree — Sub-Plans

Parent plan: [plans/free-form-sidebar-tree.md](../free-form-sidebar-tree.md)

## Dependency Graph

```
Layer 0: [01-visual-settings-foundation]
                     │
    ┌────────────────┼────────────────┬────────────────┐
    ▼                ▼                ▼                ▼
Layer 1: [02a-terminal]  [02b-folder]  [02c-seeding]  [02d-migration]
    │                │                │                │
    └────────────────┴────────────────┴────────────────┘
                     │
                     ▼
Layer 2: [03-unified-tree-model]
                     │
              ┌──────┴──────┐
              ▼             ▼
Layer 3: [04a-rendering]  [04b-cascade-archive]
              │
         ┌────┴────┐
         ▼         ▼
Layer 4: [05a-dnd]  [05b-folder-crud-ui]
         │         │
         └────┬────┘
              ▼
       [05c-context-menus]
              │
              ▼
Layer 5: [06-tests]
```

## Parallelism

| Layer | Sub-plans | Can run in parallel |
| --- | --- | --- |
| 0 | `01-visual-settings-foundation` | No — blocks everything |
| 1 | `02a`, `02b`, `02c`, `02d` | **Yes — all 4 in parallel** |
| 2 | `03-unified-tree-model` | No — single critical path |
| 3 | `04a-rendering`, `04b-cascade-archive` | **Yes — both in parallel** |
| 4 | `05a-dnd`, `05b-folder-crud-ui` | **Yes — both in parallel** (then `05c` after both) |
| 5 | `06-tests` | No — needs all implementations |

**Maximum parallelism: 4 agents at Layer 1.**

## Sub-Plans

### Layer 0 — Foundation

- [01-visual-settings-foundation](./01-visual-settings-foundation.md) — `VisualSettingsSchema`, add `visualSettings` to all entity types, shared `updateVisualSettings()` helper

### Layer 1 — Data Layer (all parallel)

- [02a-terminal-persistence](./02a-terminal-persistence.md) — Persist terminal metadata to disk, including `visualSettings` seeding on create
- [02b-folder-entity](./02b-folder-entity.md) — New `FolderMetadata` entity with store, service, and disk persistence
- [02c-creation-time-seeding](./02c-creation-time-seeding.md) — Set `visualSettings.parentId` at creation for threads, plans, and PRs
- [02d-migration](./02d-migration.md) — One-time startup migration to backfill `visualSettings` on existing entities

### Layer 2 — Tree Architecture

- [03-unified-tree-model](./03-unified-tree-model.md) — Add `"worktree"` and `"folder"` to type union, remove `RepoWorktreeSection`, rewrite tree builder

### Layer 3 — UI Adaptation (parallel)

- [04a-rendering-components](./04a-rendering-components.md) — Update all tree-menu components for flat node model
- [04b-cascade-archive](./04b-cascade-archive.md) — Archive visual descendants recursively

### Layer 4 — Interactions (05a ∥ 05b, then 05c)

- [05a-drag-and-drop](./05a-drag-and-drop.md) — `@dnd-kit` DnD with drop zones, `canCrossWorktreeBoundary()`, fractional sort keys
- [05b-folder-crud-ui](./05b-folder-crud-ui.md) — Create, rename, delete folders with icon picker
- [05c-context-menus](./05c-context-menus.md) — "New folder", "Move to...", "Move to root" actions

### Layer 5 — Verification

- [06-tests](./06-tests.md) — Tree builder, cascade archive, drop constraints, boundary validation tests

## Phases

- [x] Layer 0: Visual settings foundation

- [x] Layer 1: Data layer (terminal persistence, folder entity, creation seeding, migration)

- [x] Layer 2: Unified tree model

- [x] Layer 3: Rendering + cascade archive

- [x] Layer 4: DnD + folder CRUD + context menus

- [x] Layer 5: Tests

&lt;!-- IMPORTANT: Mark phases complete with \[x\] as you finish them. Update this file immediately after completing each phase - do not batch updates. --&gt;

---