# Plan: Read-only Markdown View for Plans Opened from Left Sidebar

## Goal

When a plan is opened from the **left sidebar** (tree menu), render it using the `MarkdownRenderer` (read-only view with the thread input section below). When opened from the **right sidebar** (file navigator), it already opens as a `file` view type which uses `TiptapEditor` for markdown — no change needed there.

## Current Architecture

- **Left sidebar** click → `navigationService.navigateToPlan(planId)` → opens `{ type: "plan", planId }` view → `PlanContent` component → `TiptapEditor` (WYSIWYG editable)
- **Right sidebar** click → `navigationService.navigateToFile(path)` → opens `{ type: "file", filePath }` view → `FileContent` component → `TiptapEditor` for `.md` files (with source toggle)

## Design

Replace `TiptapEditor` with `MarkdownRenderer` inside `PlanContent`. This is a single-component change since the routing already differentiates:

- Plans from left sidebar → `PlanContent` (uses `MarkdownRenderer` — **the change**)
- Files from right sidebar → `FileContent` (already uses `TiptapEditor`, unchanged)

### Key details

1. `PlanContent` **(**`src/components/content-pane/plan-content.tsx`**)** — Swap `TiptapEditor` for `MarkdownRenderer`:

   - Remove the `TiptapEditor` import and the `handlePlanSave` callback (no longer editing inline)
   - Import `MarkdownRenderer` from `@/components/thread/markdown-renderer`
   - Render `<MarkdownRenderer content={content} workingDirectory={workingDirectory} />` inside a scrollable container, styled similarly to how thread messages display markdown
   - Keep the `ThreadInputSection` at the bottom (users can still start threads about the plan)
   - Keep all existing logic: plan loading, stale detection, mark-as-read, draft sync, etc.

2. **No changes to types, navigation, or routing** — the `ContentPaneView` union, `ContentPane` dispatcher, and `navigationService` all stay the same.

3. **No changes to** `FileContent` — files opened from the right sidebar continue to use `TiptapEditor` with the source/rendered toggle.

## Phases

- [x] Replace TiptapEditor with MarkdownRenderer in PlanContent

- [x] Verify markdown styling (scrollable container, proper width constraints, prose classes)

- [x] Remove dead code (handlePlanSave, TiptapEditor import) and verify no regressions

&lt;!-- IMPORTANT: Mark phases complete with \[x\] as you finish them. Update this file immediately after completing each phase - do not batch updates. --&gt;

---

## Notes

- The `MarkdownRenderer` already supports GFM (tables, task lists, strikethrough), math (KaTeX), code blocks (Shiki), and file path auto-linking — all useful for plan content
- The `workingDirectory` prop is already resolved in `PlanContent`, so relative file links in plans will resolve correctly
- If we later want an "edit" toggle on the plan view, we could add a button that switches to TipTap, but that's out of scope