# Fix: Find does not jump to correct scroll position

## Problem

In the changes/diff view, `useContentSearch` uses `scrollIntoView()` on the match element's parent. This fails because each `InlineDiffBlock` wraps its diff content in a `<div className="overflow-x-auto">`. Per CSS spec, `overflow-x: auto` implicitly sets `overflow-y: auto`, making the div a 2D scroll container. `scrollIntoView()` targets the **nearest** scrollable ancestor — the diff wrapper instead of the real virtualizer scroller (`scrollerRef` in `ChangesDiffContent`).

## Fix

Add `overflow-y-clip` alongside `overflow-x-auto` on the two diff content wrappers in `InlineDiffBlock`. `overflow-y: clip` is not `visible`, so the CSS spec doesn't auto-promote it to `auto` — but it also doesn't create a scroll container. This lets `scrollIntoView` pass through to the real scroller. No JS changes needed.

This matches how file-click scrolling works: the virtualizer's scroller (`scrollerRef`) is the single scroll target. We're just removing the accidental intermediate scroll containers.

## Files to Change

- `src/components/thread/inline-diff-block.tsx` — two class additions

## Changes

**Line 273** — `DiffContentTable`:

```diff
- className="bg-surface-900/50 overflow-x-auto rounded-b-lg"
+ className="bg-surface-900/50 overflow-x-auto overflow-y-clip rounded-b-lg"
```

**Line 356** — `AnnotatedDiffContent`:

```diff
- className="bg-surface-900/50 overflow-x-auto rounded-b-lg"
+ className="bg-surface-900/50 overflow-x-auto overflow-y-clip rounded-b-lg"
```

## Phases

- [ ] Add `overflow-y-clip` to both `overflow-x-auto` diff content wrappers in `inline-diff-block.tsx`

- [ ] Test find navigation scrolls to correct position in changes view

&lt;!-- IMPORTANT: Mark phases complete with \[x\] as you finish them. Update this file immediately after completing each phase - do not batch updates. --&gt;

---