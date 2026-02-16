# 01 — File View Type + navigateToFile

**Status: COMPLETE** — Implemented as part of `plans/completed/file-viewer-pane.md`. The implementation went beyond the placeholder described here: a full `FileContent` component with syntax highlighting and a `FileHeader` with breadcrumbs are in place.

## Phases

- [x] Extend ContentPaneView with `file` variant (type + Zod schema)
- [x] Add `navigateToFile` to navigationService
- [x] Add `file` view routing in ContentPane and FileHeader

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Implemented Files

| File | What was done |
|------|---------------|
| `src/components/content-pane/types.ts:22` | `file` variant added to `ContentPaneView` union: `{ type: "file"; filePath: string; repoId?: string; worktreeId?: string }` |
| `src/stores/content-panes/types.ts:20` | `file` variant added to `ContentPaneViewSchema` Zod discriminated union |
| `src/stores/navigation-service.ts:41-51` | `navigateToFile()` method — clears tree selection, sets pane to file view |
| `src/stores/navigation-service.ts:56-66` | `navigateToView()` updated to route `file` type through `navigateToFile()` |
| `src/components/content-pane/content-pane.tsx:113-119` | File view routing — renders `<FileContent>` (not a placeholder) |
| `src/components/content-pane/content-pane-header.tsx:76-85` | `FileHeader` sub-component with breadcrumb and close button |
| `src/components/content-pane/file-content.tsx` | **Full file viewer** — syntax highlighting via Shiki, line numbers, markdown rendering toggle, binary file detection |

## Notes

- The original plan described a placeholder view and header fallback. The actual implementation (via `file-viewer-pane.md`) delivered the full file viewer with syntax highlighting, so Phase 3 was superseded.
- `navigateToView()` was updated to explicitly handle `file` type (routing through `navigateToFile()`) rather than relying on the generic `else` branch as the plan suggested.
