# Diff View Scroll Performance

Reduce DOM/layout/paint cost in the diff viewer. The changes pane virtualizes at the file-card level, but within each file card every line is a real DOM node — a 500-line file produces 500+ `AnnotatedLineRow` components with 5-15 Shiki token spans each. With 400px overscan, thousands of nodes mount simultaneously.

## Problem

1. **No line-level virtualization** — all lines in a visible file card are in the DOM
2. **Token span explosion** — Shiki tokens create 5-15 `<span>` per line (2,500-7,500 for a 500-line file)
3. **Comment infra per line** — `DiffContentWithComments` renders `InlineCommentDisplay` for every line even when empty
4. **Highlight-triggered full re-render** — `useDiffHighlight` resolves async and replaces all line objects, re-rendering the entire file card
5. **No CSS containment** — browsers can't optimize layout/paint for off-screen lines

## Phases

- [x] CSS containment + skip empty comment renders
- [x] Stabilize highlight output identity to reduce re-renders (already implemented)
- [ ] Add content-visibility-margin to eliminate scroll pop-in
- [ ] Token span reduction (optional, if Phase 1 isn't enough)

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Phase 1: CSS containment + skip empty comment renders

### 1a. Add CSS `contain` to line rows
In `annotated-line-row.tsx`, add `content-visibility: auto` and `contain-intrinsic-size` to each line div. The browser will skip layout/paint for off-screen lines within a file card:

```tsx
// annotated-line-row.tsx — add to the outer div
style={{ contentVisibility: 'auto', containIntrinsicSize: 'auto 24px' }}
```

Single-line change with large impact.

### 1b. Skip rendering empty `InlineCommentDisplay`
In `inline-diff-block.tsx` `DiffContentWithComments`, only render when comments exist:

```tsx
// Before:
<InlineCommentDisplay comments={lineComments} />

// After:
{lineComments.length > 0 && <InlineCommentDisplay comments={lineComments} />}
```

---

## Phase 2: Stabilize highlight output identity

When highlighting resolves, `setHighlighted(...)` creates a brand-new array, causing every `AnnotatedLineRow` to receive new props even though content hasn't changed.

In `applyTokensByLineNumber` and `applyPerHunkTokens`, the spread `{ ...line, tokens }` always creates a new object even when `tokens` is undefined. Add a guard:

```ts
if (!tokens) return line; // reuse original object
return { ...line, tokens }; // only for lines that actually got tokens
```

Verify this is consistent across both functions.

---

## Phase 3: Add content-visibility-margin to eliminate scroll pop-in

`content-visibility: auto` skips rendering for off-screen lines, but with no margin the browser starts rendering exactly at the viewport edge — causing visible pop-in as lines animate into view.

Add `contentVisibilityMargin` to pre-render lines 500px before they enter the viewport:

```tsx
// annotated-line-row.tsx — update the existing style prop on the outer div
style={{ contentVisibility: 'auto', containIntrinsicSize: 'auto 24px', contentVisibilityMargin: '500px' }}
```

Single property addition. The `500px` value means lines within 500px of the viewport in any direction are pre-rendered, eliminating the visual pop-in while preserving the performance benefit for lines further away.

---

## Phase 4: Token span reduction (optional)

If Phase 1 + 2 aren't sufficient, reduce span count for long lines.

**Option A (simpler)**: Set a max token count in `TokenizedContent`. If a line has >30 tokens, merge adjacent same-color tokens to reduce span count.

**Option B**: For `type === "unchanged"` lines, render content as a single `textContent` string during scroll (use `data-scrolling` attribute from `useScrolling`), then show tokenized content when idle.

---

## Impact

| Change | Effort | Impact |
|--------|--------|--------|
| CSS containment | Small | **High** — browser skips off-screen lines |
| Skip empty comments | Trivial | Medium — fewer DOM nodes |
| Stable highlight refs | Small | Medium — fewer re-renders |
| Token merging | Medium | Medium — fewer spans |
