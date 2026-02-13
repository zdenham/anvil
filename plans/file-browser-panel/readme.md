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

- [ ] 01 — File view type + navigateToFile *(parallel track A)*
- [ ] 02 — Rust file watcher module *(parallel track B)*
- [ ] 03 — File type icons *(parallel track C)*
- [ ] 04 — FileBrowserPanel component *(depends on 01, 02, 03)*
- [ ] 05 — Layout integration + tree menu entry + wiring *(depends on 04)*

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Parallel Execution Strategy

```
Time ──────────────────────────────────────────────►

Track A: [01-file-view-type]──────┐
                                  │
Track B: [02-rust-file-watcher]───┼──► [04-file-browser-component] ──► [05-layout-and-integration]
                                  │
Track C: [03-file-icons]──────────┘
```

**Tracks A, B, C** have zero dependencies on each other and can execute simultaneously:
- **A** touches frontend types/navigation (`types.ts`, `navigation-service.ts`, `content-pane.tsx`)
- **B** touches Rust backend (`Cargo.toml`, `file_watcher.rs`, `lib.rs`) + one new TS client file
- **C** touches only a new icons mapping file + npm dependency

**Track 4** joins all three: the `FileBrowserPanel` component uses the view type (A), the file watcher client (B), and the icon mapping (C).

**Track 5** is pure integration: layout slot, tree menu entry, and wiring file clicks.

## Sub-Plans

| Plan | Description | Dependencies |
|------|-------------|--------------|
| [01-file-view-type.md](./01-file-view-type.md) | Add `file` view type to ContentPaneView + navigateToFile | None |
| [02-rust-file-watcher.md](./02-rust-file-watcher.md) | Custom `notify`-based file watcher Rust module + TS client | None |
| [03-file-icons.md](./03-file-icons.md) | VS Code Material Icon Theme SVG mapping | None |
| [04-file-browser-component.md](./04-file-browser-component.md) | FileBrowserPanel component with navigation, refresh, watcher | 01, 02, 03 |
| [05-layout-and-integration.md](./05-layout-and-integration.md) | Right panel layout slot, tree menu entry, file click wiring | 04 |

## Files Summary

| File | Action | Sub-Plan |
|------|--------|----------|
| `src/components/content-pane/types.ts` | Modify | 01 |
| `src/stores/navigation-service.ts` | Modify | 01 |
| `src/components/content-pane/content-pane.tsx` | Modify | 01 |
| `src-tauri/Cargo.toml` | Modify | 02 |
| `src-tauri/src/file_watcher.rs` | **New** | 02 |
| `src-tauri/src/lib.rs` | Modify | 02 |
| `src/lib/file-watcher-client.ts` | **New** | 02 |
| `src/components/file-browser/file-icons.ts` | **New** | 03 |
| `src/components/file-browser/file-browser-panel.tsx` | **New** | 04 |
| `src/components/main-window/main-window-layout.tsx` | Modify | 05 |
| `src/components/tree-menu/repo-worktree-section.tsx` | Modify | 05 |
| `src/components/tree-menu/tree-menu.tsx` | Modify | 05 |

## Success Criteria

- Each worktree section has a keyboard-navigable "Files" button at the top of its items list
- Clicking "Files" opens a resizable right-side panel scoped to that worktree
- Panel shows one directory at a time with clickable breadcrumb navigation (middle-truncated for long paths)
- All files shown including dotfiles, with Material Icon Theme SVG icons per type
- Clicking a file shows a placeholder in the content pane; panel stays open
- Directory listing auto-refreshes via custom `notify`-based file watcher; manual refresh button as fallback
- Panel toggles off via "Files" button, Escape, or close button
- Switching worktrees swaps the panel instantly
- Stale paths show error state consistent with existing patterns
