# Fix inline diff double-border

## Problem

`InlineDiffBlock` has its own border (`rounded-lg border border-surface-700`), and when it gets wrapped in `CollapsibleOutputBlock` (which also has `rounded border border-zinc-700/50`), you get two nested borders creating an ugly visual artifact.

Affected locations:

- `write-tool-block.tsx:133-145` — `CollapsibleOutputBlock` wraps `InlineDiffBlock`
- `tool-use-block.tsx:188-195` — `InlineDiffBlock` rendered without `CollapsibleOutputBlock`, but if it were wrapped the same issue would appear
- `inline-diff-block.tsx:210-219` — internal `CollapsibleOutputBlock` already overrides with `className="border-0 rounded-none rounded-b-lg"` (partial fix)

## Fix

Remove the border from `InlineDiffBlock`'s outer wrapper when it's inside a `CollapsibleOutputBlock`. The simplest approach:

**In** `write-tool-block.tsx`: Pass `className="border-0 rounded-none"` to `CollapsibleOutputBlock`, since `InlineDiffBlock` already provides its own border and rounding. Alternatively, strip the border from `InlineDiffBlock` and let the parent control it — but that's more invasive.

Cleanest fix: **strip the outer border from** `CollapsibleOutputBlock` in `write-tool-block.tsx` where it wraps the diff, same pattern already used inside `inline-diff-block.tsx`:

```tsx
// write-tool-block.tsx ~line 133
<CollapsibleOutputBlock
  ...
  className="border-0 rounded-none"
>
  <InlineDiffBlock ... />
</CollapsibleOutputBlock>
```

This matches the existing pattern at `inline-diff-block.tsx:216`.

## Phases

- [x] Add `className="border-0"` to `CollapsibleOutputBlock` in `write-tool-block.tsx` where it wraps `InlineDiffBlock`

- [x] Verify `edit-tool-block.tsx` — its collapsible block wraps raw old/new strings (not `InlineDiffBlock`), so it should be fine. The pending-permission path renders `InlineDiffBlock` directly without collapsible wrapper, also fine.

- [ ] Visually verify no remaining double borders across Edit, Write, and generic tool-use-block

&lt;!-- IMPORTANT: Mark phases complete with \[x\] as you finish them. Update this file immediately after completing each phase - do not batch updates. --&gt;

---