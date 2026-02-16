# File Browser Panel Fixes

Post-implementation feedback fixes for the file browser panel.

## Phases

- [x] 1. Remove folder icons — folders show chevrons only
- [x] 2. Fix left panel indentation — align Files item with thread/terminal dots
- [x] 3. Expandable folder tree — replace breadcrumb navigation with inline expand/collapse

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Overview

Three issues identified after the initial file browser panel implementation:

1. **Folder icons are redundant** — folders in the right panel currently show both a chevron and a folder icon. They should only show chevrons (the icon is noise since the chevron already signals "this is a folder").

2. **Left panel indentation is off** — the "Files" button in the tree menu uses `pl-5` (20px) which doesn't align with thread/terminal items that use `INDENT_BASE` (8px) via inline style. The Files icon should align with the status dots and terminal icons.

3. **Navigation model is wrong** — the current breadcrumb-based single-directory-at-a-time navigation prevents viewing files in sibling folders simultaneously. Should use VS Code-style expandable folder tree where clicking a folder expands/collapses it inline.

## Child Plans

- [01-remove-folder-icons.md](./01-remove-folder-icons.md) — Remove folder icons from directory entries
- [02-fix-indentation.md](./02-fix-indentation.md) — Fix Files item indentation in tree menu
- [03-expandable-folder-tree.md](./03-expandable-folder-tree.md) — Replace breadcrumb nav with expandable tree
