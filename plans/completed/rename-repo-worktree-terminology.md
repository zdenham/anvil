# Rename "Repo/Worktree" → "Project/Workspace" in User-Facing UI

## Problem

User-facing text uses git-centric terminology ("repository", "worktree") that is intimidating to non-git-expert users. The user wants to rename:

- **"repository" / "repo"** → **"project"**
- **"worktree"** → **"workspace"**

This is a **UI text only** change. Internal code (variable names, store names, file names, types, API calls) should remain unchanged to avoid a massive refactor.

## Goal

Update all user-visible strings, labels, tooltips, aria-labels, placeholders, and headings that say "repository" or "worktree" to say "project" or "workspace" respectively.

## Phases

- [x] Audit and list all user-facing occurrences

- [x] Update onboarding step text

- [x] Update sidebar tree menu text (menu dropdown, context menus, worktree menus, repo-item)

- [x] Update spotlight text (actions, results tray, error messages)

- [x] Update settings page text (repository-settings, sidebar-settings)

- [x] Update guide content and empty pane content

- [x] Update main-window-layout text (dialogs, toasts, confirmations)

- [x] Update window titlebar comment

&lt;!-- IMPORTANT: Mark phases complete with \[x\] as you finish them. Update this file immediately after completing each phase - do not batch updates. --&gt;

---

## Design

### Scope

**ONLY** change user-visible text (strings in JSX, title props, aria-labels, placeholder text, error messages shown to users). Do NOT rename:

- File names (e.g., `worktree-item.tsx` stays)
- Component names (e.g., `WorktreeItem` stays)
- Variable/prop/type names (e.g., `repoName`, `worktreeId` stay)
- Store names (e.g., `useRepoStore` stays)
- Tauri command names
- Entity type enums

### Mapping

| Old term | New term | Context |
| --- | --- | --- |
| Repository / Repositories | Project / Projects | Settings section titles, headings |
| repository | project | Labels, descriptions, error messages |
| repo | project | Abbreviated usages in UI |
| Worktree / Worktrees | Workspace / Workspaces | Section titles, headings, concept names |
| worktree | workspace | Labels, descriptions, tooltips |

### Phase 2: Onboarding

`src/components/onboarding/steps/RepositoryStep.tsx`

- "Select Your Repository" → "Select Your Project"
- "mort will write code to this directory" → keep as-is (already generic)
- "Existing Repository:" → "Existing Project:"
- "Selected Repository:" → "Selected Project:"
- "Browse for Repository" → "Browse for Project"
- "No repository selected" → "No project selected"
- "Select a repository folder" (dialog title) → "Select a project folder"
- "Invalid repository" → "Invalid project folder"
- "Failed to select repository" → "Failed to select project"

`src/components/onboarding/steps/SpotlightStep.tsx` (if not removed by the other plan)

- No "repo/worktree" text here, but double-check.

### Phase 3: Sidebar tree menu

`src/components/tree-menu/menu-dropdown.tsx`

- "New repository" → "New project"
- "Show all workspaces" → already says "workspaces" (keep)

`src/components/tree-menu/worktree-menus.tsx`

- `aria-label="Add new thread, worktree, or repository"` → "Add new thread, workspace, or project"
- `New worktree in ${item.repoName}` → `New workspace in ${item.repoName}`
- "New worktree" → "New workspace"
- "Rename worktree" → "Rename workspace"
- "Archive worktree" → "Archive workspace"
- "Create pull request" → keep as-is (git term is appropriate here)

`src/components/tree-menu/repo-item.tsx`

- `"Collapse repo"` / `"Expand repo"` → `"Collapse project"` / `"Expand project"`

`src/components/tree-menu/worktree-item.tsx`

- `"This worktree was not created by Mort"` → `"This workspace was not created by Mort"`

### Phase 4: Spotlight

`src/components/spotlight/spotlight.tsx`

- `"No repositories configured. Please add a repository first."` → "No projects configured. Please add a project first."
- `"Open Repository"` partial match → `"Import Project"` (or keep as "Open Project")
- `"Select a repository folder"` dialog title → "Select a project folder"
- `"Failed to open repository:"` → "Failed to open project:"
- `"No repositories available. Please add a repository first."` → "No projects available. Please add a project first."

`src/components/spotlight/results-tray.tsx`

- `"No repositories configured - add one in Settings"` → "No projects configured - add one in Settings"
- `"No worktrees available - create one in Worktrees tab"` → "No workspaces available - create one first"
- `"Open Repository"` → "Import Project"
- `"Import a local folder as a repository"` → "Import a local folder as a project"

### Phase 5: Settings

`src/components/main-window/settings/repository-settings.tsx`

- `title="Repositories"` → `title="Projects"`
- `description="Connected code repositories"` → `description="Connected code projects"`
- "Locate Repository Folder" dialog title → "Locate Project Folder"
- "This folder is not a git repository. Please select a folder with git tracking." → "This folder is not a git repository. Please select a git-tracked project folder."
- `{status.worktreeCount} worktree(s)` → `{status.worktreeCount} workspace(s)`
- "Configure worktree setup prompt" → "Configure workspace setup prompt"
- "Worktree setup prompt" label → "Workspace setup prompt"
- "Copy .env from the main worktree..." placeholder → "Copy .env from the main workspace..."
- "Runs automatically when a new worktree is created" → "Runs automatically when a new workspace is created"
- "No repositories connected. Use the + button..." → "No projects connected. Use the + button..."

`src/components/main-window/settings/sidebar-settings.tsx`

- "Hide external worktrees" → "Hide external workspaces"
- "Hide worktrees not created by Mort from the sidebar" → "Hide workspaces not created by Mort from the sidebar"

### Phase 6: Guide content & empty pane

`src/components/content-pane/guide-content.tsx`

- Core Concepts: "Worktrees" → "Workspaces"
- "Isolated git branches for parallel work without conflicts" → "Isolated branches for parallel work without conflicts"
- "Integrated terminal sessions tied to worktrees" → "Integrated terminal sessions tied to workspaces"
- "Conversations with Claude Code agents that run in your repo" → "Conversations with Claude Code agents that run in your project"

`src/components/content-pane/empty-pane-content.tsx`

- "Add a repository to get started" → "Add a project to get started" (appears twice)

### Phase 7: Main window layout

`src/components/main-window/main-window-layout.tsx`

- `"Archive worktree"` dialog title → `"Archive workspace"`
- `Archive worktree "${worktreeName}"...?` → `Archive workspace "${worktreeName}"...?`
- `"Select Repository Folder"` dialog title → `"Select Project Folder"`
- Various logger messages — leave as-is (not user-facing)

`src/components/reusable/trigger-dropdown.tsx`

- `"No repository selected"` → `"No project selected"`

### Phase 8: Window titlebar

`src/components/window-titlebar/window-titlebar.tsx`

- Comment: `"repo / worktree / threads / name"` → `"project / workspace / threads / name"` (comment only)

## Key files

| File | Changes |
| --- | --- |
| `src/components/onboarding/steps/RepositoryStep.tsx` | "Repository" → "Project" |
| `src/components/tree-menu/menu-dropdown.tsx` | "New repository" → "New project" |
| `src/components/tree-menu/worktree-menus.tsx` | "worktree" → "workspace" in labels |
| `src/components/tree-menu/repo-item.tsx` | aria-labels |
| `src/components/tree-menu/worktree-item.tsx` | "worktree" tooltip |
| `src/components/spotlight/spotlight.tsx` | Error messages, action names |
| `src/components/spotlight/results-tray.tsx` | Display text |
| `src/components/main-window/settings/repository-settings.tsx` | Section title, descriptions |
| `src/components/main-window/settings/sidebar-settings.tsx` | Labels |
| `src/components/content-pane/guide-content.tsx` | Concept names |
| `src/components/content-pane/empty-pane-content.tsx` | Empty state text |
| `src/components/main-window/main-window-layout.tsx` | Dialog titles |
| `src/components/reusable/trigger-dropdown.tsx` | Placeholder text |
| `src/components/window-titlebar/window-titlebar.tsx` | Comment |
