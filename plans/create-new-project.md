# Create New Project (Not Just Import Repo)

## Problem

Currently, users can only "import" an existing git repository (via folder picker). There's no option to create a brand new project from scratch. Additionally, there's no persistent "add project" button at the bottom of the left sidebar — the only way to add a repo is through the `...` menu dropdown &gt; "New repository".

## Goal

1. Add a "Create new project" option alongside the existing "import folder" flow
2. Add a visible "+ New Project" button at the bottom of the left sidebar (tree panel)

## Phases

- [ ] Add "Create New Project" to onboarding RepositoryStep

- [ ] Add "Create New Project" to the main-window `...` menu dropdown

- [ ] Add a persistent "+ New Project" button at the bottom of the tree panel sidebar

- [ ] Implement the "create project" flow (folder picker for location + name input → `git init`)

&lt;!-- IMPORTANT: Mark phases complete with \[x\] as you finish them. Update this file immediately after completing each phase - do not batch updates. --&gt;

---

## Design

### Phase 1: Onboarding RepositoryStep

**File:** `src/components/onboarding/steps/RepositoryStep.tsx`

Currently only shows "Browse for Repository". Add a second option:

- **"Create a new project"** — Opens a folder picker for the *parent directory*, then prompts for a project name. Runs `git init` in the new directory.
- **"Import existing project"** — Current behavior (folder picker → validate git repo).

The two options can be presented as two cards/buttons side by side in the empty state.

### Phase 2: Main-window menu dropdown

**File:** `src/components/tree-menu/menu-dropdown.tsx`

- Rename "New repository" menu item to "Import project"
- Add a new "Create project" menu item above it

### Phase 3: Persistent sidebar button

**File:** `src/components/tree-menu/tree-menu.tsx` (or a new sibling)

Add a `+ New Project` button at the very bottom of the tree panel (below the tree list, pinned to the bottom). This should be visible even when there are no repos. Styled subtly (ghost/text style, matches existing UI).

Wire it to the same "create project" flow from Phase 4.

Also consider updating `src/components/content-pane/empty-pane-content.tsx` — the "Add a repository to get started" empty state message should offer both options.

### Phase 4: Create project flow

Create a reusable service/function (e.g., in `src/lib/project-creation-service.ts` or extend `repoService`):

1. Open folder picker for **parent directory** (title: "Choose where to create your project")
2. Prompt for project name (inline input or small dialog)
3. Create directory: `{parentDir}/{projectName}`
4. Run `git init` in the new directory
5. Call `repoService.createFromFolder(newPath)` to register it
6. Optionally scaffold minimal files (`.gitignore`, `README.md`)

**Rust side:** May need a new Tauri command `create_project` that handles `mkdir` + `git init`, or reuse existing shell commands. Check if `repoService.createFromFolder` already handles non-git dirs or if validation needs updating.

**File:** `src/entities/repositories/service.ts` — check `createFromFolder` and `validateNewRepository` to understand what validation currently happens (it rejects non-git repos).

## Key files

| File | Role |
| --- | --- |
| `src/components/onboarding/steps/RepositoryStep.tsx` | Onboarding repo selection step |
| `src/components/tree-menu/menu-dropdown.tsx` | `...` menu in tree panel header |
| `src/components/tree-menu/tree-menu.tsx` | Main tree menu component |
| `src/components/tree-menu/tree-panel-header.tsx` | Header with `onNewRepo` callback |
| `src/components/content-pane/empty-pane-content.tsx` | Empty state with "Add a repository" |
| `src/components/main-window/main-window-layout.tsx` | Wires up `onNewRepo` for tree panel |
| `src/entities/repositories/service.ts` | Repository CRUD service |
