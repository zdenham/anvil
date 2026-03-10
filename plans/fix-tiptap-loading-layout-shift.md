# Fix TipTap Editor Loading Layout Shift

## Problem

When navigating to a plan in the content pane, the `ThreadInputSection` briefly appears at the top of the screen before jumping to the bottom once TipTap finishes initializing. Before the TipTap migration, the `MarkdownRenderer` (react-markdown) rendered synchronously with no gap.

## Root Cause

Two sequential null-render gaps create a layout collapse where the content area has zero height, allowing the input to float to the top of the flex column:

### Gap 1: Content loading from disk

`plan-content.tsx:239` — while `usePlanContent()` fetches markdown from disk:

```tsx
{isContentLoading ? null : /* TipTap or stale view */}
```

Renders `null` for the content area. The only child in the flex column is `ThreadInputSection`, so it appears at the top.

### Gap 2: TipTap editor initialization

`tiptap-editor.tsx:114` — while `useEditor()` initializes extensions:

```tsx
if (!editor) return null;
```

Even after content arrives, TipTap takes time to initialize 12+ extensions (StarterKit bundle, ShikiCodeBlock with ProseMirror decoration plugin, Markdown serializer, Table suite, etc.). During this time the component returns `null` — again no space reserved.

### Why it didn't happen before

The control panel's `plan-view.tsx:362` still uses `MarkdownRenderer` (react-markdown), which renders **synchronously** — no initialization delay, no null gap. The thread view (`thread-content.tsx:391-401`) wraps `ThreadView` in a `flex-1` container that shows a `LoadingState` spinner, so the input always stays pinned to the bottom.

## Affected Components

| File | Issue |
|------|-------|
| `src/components/content-pane/plan-content.tsx:239` | Renders `null` during content loading |
| `src/components/content-pane/tiptap-editor.tsx:114` | Returns `null` while `useEditor()` initializes |
| `src/components/content-pane/file-content.tsx:153-163` | Same issue for markdown files opened in content pane |

## Phases

- [x] Fix TipTap editor to reserve space during initialization
- [x] Fix PlanContent to reserve space during content loading
- [x] Fix FileContent markdown path to handle the same gap

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Phase 1: Fix TipTap editor initialization gap

In `src/components/content-pane/tiptap-editor.tsx`, replace the `return null` with a placeholder that matches the editor's layout dimensions:

```tsx
// Before (line 114)
if (!editor) return null;

// After
if (!editor) {
  return (
    <div className="tiptap-editor flex-1 min-h-0 overflow-y-auto pt-8">
      <div className="max-w-[900px] mx-auto p-4" />
    </div>
  );
}
```

This renders the same outer structure (class names, max-width, padding) as the real editor, so the flex layout reserves the correct space. The `flex-1` ensures it pushes the input to the bottom.

## Phase 2: Fix PlanContent loading gap

In `src/components/content-pane/plan-content.tsx`, replace `null` during loading with a flex spacer:

```tsx
// Before (line 239)
{isContentLoading ? null : /* ... */}

// After
{isContentLoading ? (
  <div className="flex-1 min-h-0" />
) : /* ... */}
```

This reserves the content area's flex space during the async disk read, keeping `ThreadInputSection` at the bottom.

## Phase 3: Fix FileContent markdown path

In `src/components/content-pane/file-content.tsx`, the markdown branch (lines 153-163) also uses `TiptapEditor` and has the same issue. Phase 1's fix to `tiptap-editor.tsx` handles this automatically since `TiptapEditor` will no longer return `null`. No additional changes needed in `file-content.tsx` — just verify the fix propagates.
