# File Browser Panel — Decisions

All architectural and design decisions for the file browser panel feature. Sub-plans reference this file rather than repeating rationale.

---

## Scoping & Lifecycle

- **Worktree-scoped** — each worktree has its own entry point. One panel open at a time; clicking "Files" on a different worktree swaps instantly (unmount old, mount new).
- **Watchers unsubscribed on close** — file watchers are torn down when the panel closes or the viewed directory changes. No leaked watchers.
- **Panel always starts at worktree root** — no state persistence. Always start from the top when opened.

## File Watching

- **Custom `notify`-based watcher, no `tauri-plugin-fs`** — we own the file watching implementation. This avoids the broad `$HOME/**` permission scope that the plugin requires and avoids introducing a new Tauri plugin dependency.
- **Rust-side debounce** — 200ms buffer using `notify`'s built-in debounced mode. Prevents flooding the frontend during batch operations like `git checkout`.
- **Manual refresh button** — fallback in the header bar for explicit re-read if watching fails.
- **No visual feedback on refresh** — entries update silently when the watcher triggers a re-read.
- **No capability permissions needed** — unlike `tauri-plugin-fs`, our custom commands don't go through Tauri's fs scoping system. The `notify` crate watches at the OS level using the app's process permissions.

## Navigation

- **Single-directory list, not a tree** — shows one directory level at a time. Click a folder to descend, click the current path header to ascend. No nesting, no vertical explosion.
- **No back button** — ascending is done via clickable breadcrumb path segments in the header.
- **Breadcrumb truncation** — truncate from the middle for long paths: show root segment + last 1-2 segments with `...` in between (e.g., `wt/ > ... > deeply/ > nested/`).
- **No search/filter in v1** — may add command palette support later.

## File Display

- **Show all files including dotfiles** — developer tools need access to `.gitignore`, `.env`, `.eslintrc`, etc.
- **`node_modules` treated like any other directory** — no special handling or warnings.
- **No loading spinner** — `listDir` calls Rust and returns in <10ms for typical directories. Just render entries when ready.
- **Sort: directories first (alphabetical), then files (alphabetical).**

## File Clicks

- **Placeholder in content pane** — clicking a file shows a placeholder with the file path. Full syntax-highlighted viewer is a separate plan (`file-viewer-pane.md`).
- **Panel stays open after click** — user can browse through multiple files without re-opening.

## Icons

- **VS Code Material Icon Theme SVGs** — [MIT license, 377+ icons](https://github.com/material-extensions/vscode-material-icon-theme). Install `material-icon-theme` as npm dependency, import SVGs from the package at build time via Vite's asset handling. Exhaustive mapping of extensions and special folder names. Generic fallbacks for unrecognized types.

## Layout

- **Resizable right panel** — reuses `ResizablePanel` with `position="right"`. Default ~250px, min 180px, max capped at 50% of window width. User can drag to resize. Width persisted via existing `layoutService`.
- **Dismissible** — close button, Escape key, or clicking the Files button again toggles it off.

## Tree Menu Integration

- **"Files" is a normal keyboard-navigable tree item** — arrow keys land on it, but selection alone does NOT open the file browser. Only Enter or click triggers `onOpenFiles`.
- **Pinned at top** — "Files" appears before threads/plans/terminals in the worktree section.
- **Active state** — highlights in accent color when the file browser is open for that worktree.

## Worktree Switching

- **Instant swap** — no animation or transition when switching worktrees. Panel unmounts and remounts with new context, starting at root.

## Error Handling

- **Stale/missing paths** — show error state with message and close button, same pattern as plan-tab's "Plan file not found" state.

## Edge Cases

- Empty dirs, symlinks, context menus, snap-to-close threshold — handle with sensible defaults during implementation, no special treatment needed.

## Relationship to file-viewer-pane.md

This plan covers the **file browser panel** (the directory listing UI and right-side panel). The **file viewer** (syntax-highlighted file rendering in the content pane) is covered by `plans/file-viewer-pane.md`. Phase 1 of the browser plan implements the shared `file` view type + `navigateToFile` that both features need.
