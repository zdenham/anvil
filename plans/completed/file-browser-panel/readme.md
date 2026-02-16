# File Browser Panel

## Problem

Users need to browse the file tree for a worktree, but there's no good place to put a full file explorer. The left sidebar is for threads/plans/terminals and a nested file tree would overwhelm it with vertical space. We need a way to browse files that:

1. Is scoped to a specific worktree (each worktree has different files)
2. Doesn't take over the content pane (user wants to browse files alongside a thread)
3. Doesn't bloat the left sidebar

## Solution

**Right-side slide-out panel** with **single-directory-at-a-time navigation** (not a nested tree). Entry point is a "Files" button pinned to the top of each worktree section in the left sidebar.

```
┌──────────┬─────────────────┬──────────────┐
│ MORT     │  Thread view    │ src/ 🔄 ✕    │
│──────────│                 │──────────────│
│ ▾ wt     │                 │ 📁components/│
│  📁Files │                 │ 📁stores/    │
│  Thread 1│                 │ 📁lib/       │
│  Plan 1  │                 │ 📄App.tsx    │
│  Term 1  │                 │ 📄main.tsx   │
│──────────│                 │              │
│ Legend   │                 │              │
└──────────┴─────────────────┴──────────────┘
```

## Decisions

All architectural and design decisions are documented in [decisions.md](./decisions.md).

## Phases

- [x] 01 — File view type + navigateToFile *(complete — see [01-file-view-type.md](./01-file-view-type.md))*
- [x] 02 — Rust file watcher module *(complete — see [02-rust-file-watcher.md](./02-rust-file-watcher.md))*
- [x] 03 — File type icons *(complete — see [03-file-icons.md](./03-file-icons.md))*
- [x] 04 — FileBrowserPanel component *(complete — see [04-file-browser-component.md](./04-file-browser-component.md))*
- [x] 05 — Layout integration + tree menu entry + wiring *(complete — see [05-layout-and-integration.md](./05-layout-and-integration.md))*

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Parallel Execution Strategy

```
Time ──────────────────────────────────────────────►

Track A: [01-file-view-type]──────┐ ✅ DONE
                                  │
Track B: [02-rust-file-watcher]───┼──► [04-file-browser-component] ──► [05-layout-and-integration]
                                  │
Track C: [03-file-icons]──────────┘
```

**Track A** is complete. The file view type, navigation, and full file viewer were implemented as part of `plans/completed/file-viewer-pane.md`.

**Tracks B and C** have zero dependencies on each other and can execute simultaneously:
- **B** touches Rust backend (`Cargo.toml`, `file_watcher.rs`, `lib.rs`) + one new TS client file
- **C** touches only a new icons mapping file + npm dependency

**Track 04** joins B and C (no longer depends on A since A is done).

**Track 05** is pure integration: layout slot, tree menu entry, and wiring file clicks.

## Sub-Plans

| Plan | Description | Status | Dependencies |
|------|-------------|--------|--------------|
| [01-file-view-type.md](./01-file-view-type.md) | Add `file` view type to ContentPaneView + navigateToFile | **Complete** | None |
| [02-rust-file-watcher.md](./02-rust-file-watcher.md) | Custom `notify`-based file watcher Rust module + TS client | **Complete** | None |
| [03-file-icons.md](./03-file-icons.md) | VS Code Material Icon Theme SVG mapping | **Complete** | None |
| [04-file-browser-component.md](./04-file-browser-component.md) | FileBrowserPanel component with navigation, refresh, watcher | **Complete** | 02, 03 |
| [05-layout-and-integration.md](./05-layout-and-integration.md) | Right panel layout slot, tree menu entry, file click wiring | **Complete** | 04 |

## Existing Infrastructure (already implemented)

These files exist and are used by plan 01 / the file viewer. Plans 02-05 build on top of them.

| File | What it provides |
|------|------------------|
| `src/components/content-pane/types.ts:22` | `ContentPaneView` `file` variant |
| `src/stores/content-panes/types.ts:20` | `ContentPaneViewSchema` Zod `file` variant |
| `src/stores/navigation-service.ts:41-51` | `navigateToFile()` — clears tree selection, opens file in pane |
| `src/components/content-pane/file-content.tsx` | Full file viewer (syntax highlighting, markdown toggle, binary detection) |
| `src/components/content-pane/content-pane-header.tsx:76-85` | `FileHeader` with breadcrumb |
| `src/components/content-pane/content-pane.tsx:113-119` | File view routing to `<FileContent>` |
| `src/lib/filesystem-client.ts` | `FilesystemClient` class with `listDir()`, `readFile()`, `DirEntry` type |
| `src-tauri/src/filesystem.rs` | Rust `fs_list_dir` command |

## Files Summary (remaining work)

| File | Action | Sub-Plan |
|------|--------|----------|
| `src-tauri/Cargo.toml` | Modify — add `notify-debouncer-mini` | 02 |
| `src-tauri/src/file_watcher.rs` | **New** | 02 |
| `src-tauri/src/lib.rs` | Modify — register watcher module/state/commands | 02 |
| `src/lib/file-watcher-client.ts` | **New** | 02 |
| `package.json` | Modify — add `material-icon-theme` + postinstall script | 03 |
| `src/components/file-browser/icon-manifest.ts` | **New** | 03 |
| `src/components/file-browser/file-icons.ts` | **New** | 03 |
| `src/components/file-browser/dir-utils.ts` | **New** | 04 |
| `src/components/file-browser/file-entry-list.tsx` | **New** | 04 |
| `src/components/file-browser/file-browser-header.tsx` | **New** | 04 |
| `src/components/file-browser/file-browser-error.tsx` | **New** | 04 |
| `src/components/file-browser/file-browser-panel.tsx` | **New** | 04 |
| `src/hooks/use-file-browser-panel.ts` | **New** | 05 |
| `src/components/main-window/main-window-layout.tsx` | Modify | 05 |
| `src/components/tree-menu/files-item.tsx` | **New** | 05 |
| `src/components/tree-menu/repo-worktree-section.tsx` | Modify | 05 |
| `src/components/tree-menu/tree-menu.tsx` | Modify | 05 |

## Success Criteria

- Each worktree section has a keyboard-navigable "Files" button at the top of its items list
- Clicking "Files" opens a resizable right-side panel scoped to that worktree
- Panel shows one directory at a time with clickable breadcrumb navigation (middle-truncated for long paths)
- All files shown including dotfiles, with Material Icon Theme SVG icons per type
- Clicking a file opens it in the content pane with syntax highlighting (already works via file viewer); panel stays open
- Directory listing auto-refreshes via custom `notify`-based file watcher; manual refresh button as fallback
- Panel toggles off via "Files" button, Escape, or close button
- Switching worktrees swaps the panel instantly
- Stale paths show error state consistent with existing patterns
