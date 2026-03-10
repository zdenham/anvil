# Free-Form Sidebar Tree — Orchestration Plan

Orchestrates implementation of `plans/free-form-sidebar-tree/readme.md` using parallel sub-agents.

## Strategy

Each layer is implemented sequentially. Within a layer, independent sub-plans run as parallel foreground agents (using `isolation: "worktree"` for safe parallel writes). After each layer, changes are merged and verified before proceeding.

Each sub-agent receives:

1. The sub-plan file path to read and implement
2. `docs/agents.md` reference for coding conventions
3. Instructions to run relevant tests before finishing

## Execution Order

### Layer 0 — Foundation (1 agent)

- **Agent 1**: `01-visual-settings-foundation.md` — `VisualSettingsSchema`, add `visualSettings` to all entity types, shared helper

### Layer 1 — Data Layer (4 parallel agents)

- **Agent 2a**: `02a-terminal-persistence.md` — Terminal metadata persistence + visualSettings seeding
- **Agent 2b**: `02b-folder-entity.md` — New FolderMetadata entity with store, service, disk persistence
- **Agent 2c**: `02c-creation-time-seeding.md` — Set `visualSettings.parentId` at creation time
- **Agent 2d**: `02d-migration.md` — Startup migration to backfill visualSettings

### Layer 2 — Tree Architecture (1 agent)

- **Agent 3**: `03-unified-tree-model.md` — Add worktree/folder to type union, rewrite tree builder

### Layer 3 — UI Adaptation (2 parallel agents)

- **Agent 4a**: `04a-rendering-components.md` — Update tree-menu components for flat node model
- **Agent 4b**: `04b-cascade-archive.md` — Archive visual descendants recursively

### Layer 4 — Interactions (2 parallel, then 1)

- **Agent 5a**: `05a-drag-and-drop.md` — DnD with drop zones, boundary checks, fractional sort keys
- **Agent 5b**: `05b-folder-crud-ui.md` — Create, rename, delete folders with icon picker
- *(after 5a + 5b merge)*
- **Agent 5c**: `05c-context-menus.md` — "New folder", "Move to...", "Move to root" actions

### Layer 5 — Verification (1 agent)

- **Agent 6**: `06-tests.md` — Tree builder, cascade archive, drop constraints, boundary validation tests

## Merge Strategy

Each worktree agent works on an isolated branch. After a layer completes:

1. Review each agent's output for conflicts
2. Merge branches sequentially into `sidebar-refactor`
3. Run `pnpm build` to verify no compile errors before next layer

## Phases

- [x] Layer 0: Visual settings foundation (1 agent)

- [x] Layer 1: Data layer (4 parallel agents)

- [x] Layer 2: Unified tree model (1 agent)

- [x] Layer 3: Rendering + cascade archive (2 parallel agents)

- [x] Layer 4: DnD + folder CRUD + context menus (2+1 agents)

- [ ] Layer 5: Tests (1 agent)

&lt;!-- IMPORTANT: Mark phases complete with \[x\] as you finish them. Update this file immediately after completing each phase - do not batch updates. --&gt;

---