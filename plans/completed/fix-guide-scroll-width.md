# Fix Guide Page Scroll Width

## Problem

The guide page scrollbar sits inline with the centered content (`max-w-2xl`) instead of at the full pane edge. Other content panes (plans, PR view, tiptap editor) have the scrollbar at the full pane width.

**Root cause:** In `guide-content.tsx:9`, `overflow-y-auto` and `max-w-2xl mx-auto` are on the **same div**, so the scroll container is constrained to `max-w-2xl` and the scrollbar renders at its right edge (inset from the pane edge).

Other panes follow a two-layer pattern:

- Outer div: `flex-1 min-h-0 overflow-y-auto w-full` (full-width scroll container, scrollbar at pane edge)
- Inner div: `max-w-2xl mx-auto px-6 py-8` (centered content)

## Fix

**File:** `src/components/content-pane/guide-content.tsx`

Split the root div into two layers:

```tsx
// Before (line 9):
<div className="flex-1 overflow-y-auto px-6 py-8 max-w-2xl mx-auto w-full">

// After:
<div className="flex-1 overflow-y-auto">
  <div className="px-6 py-8 max-w-2xl mx-auto w-full">
    ...existing content...
  </div>
</div>
```

This moves the scroll container to be full-width (inheriting from the flex parent), while keeping the content centered within it. The scrollbar will now appear at the pane edge, matching all other content panes.

## Phases

- [x] Split GuideContent root div into outer scroll container + inner centered content wrapper

&lt;!-- IMPORTANT: Mark phases complete with \[x\] as you finish them. Update this file immediately after completing each phase - do not batch updates. --&gt;

---