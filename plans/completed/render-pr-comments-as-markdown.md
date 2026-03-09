# Render PR comments as markdown

## Problem

PR review comments display raw HTML/markdown source instead of rendered content. The `PrCommentsSection` renders `comment.body` as plain text inside a `<p>` tag (line 83-85 of `pr-comments-section.tsx`), while the PR description correctly uses `MarkdownRenderer`.

## Phases

- [x] Update `CommentRow` in `pr-comments-section.tsx` to use `MarkdownRenderer` for comment body

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Changes

### `src/components/content-pane/pr-comments-section.tsx`

1. Import `MarkdownRenderer` from `@/components/thread/markdown-renderer`
2. Replace the plain text `<p>` tag rendering of `comment.body` (lines 82-86):

**Before:**
```tsx
{comment.body && (
  <p className="mt-1 text-xs text-surface-400 whitespace-pre-wrap leading-relaxed">
    {comment.body}
  </p>
)}
```

**After:**
```tsx
{comment.body && (
  <div className="mt-1 text-xs text-surface-400 leading-relaxed [&_.prose]:text-xs [&_.prose]:text-surface-400">
    <MarkdownRenderer content={comment.body} />
  </div>
)}
```

This matches how `PrDescriptionSection` handles the PR body — wrapping `MarkdownRenderer` in a sized container. The extra CSS overrides ensure the prose styles from MarkdownRenderer don't override the comment-level sizing/color.

May need to tune the className overrides after visual testing — the `prose-sm` default in MarkdownRenderer might be fine without overrides if the parent `text-xs` cascades properly.
