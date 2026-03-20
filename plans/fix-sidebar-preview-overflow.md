# Fix sidebar preview tooltip text overflow

## Problem

When hovering over a left sidebar item, the white preview tooltip can overflow horizontally when the last user message contains very long unbroken strings (URLs, file paths, code without spaces).

**Root cause:** `item-preview-tooltip.tsx:66` uses `max-w-[300px] whitespace-pre-wrap` but has no word-breaking rule. `whitespace-pre-wrap` only wraps at natural break points (spaces, hyphens). Long unbroken strings overflow the 300px container.

## Phases

- [x] Add overflow handling to tooltip content

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Fix

**File:** `src/components/tree-menu/item-preview-tooltip.tsx` (line 66)

Add `break-words` (Tailwind for `overflow-wrap: break-word`) and `overflow-hidden` to the tooltip content className:

```diff
- "max-w-[300px] whitespace-pre-wrap"
+ "max-w-[300px] whitespace-pre-wrap break-words overflow-hidden"
```

- `break-words` — breaks long words/strings that exceed the container width, wrapping them to the next line
- `overflow-hidden` — safety net to clip any edge-case content that still escapes the box (e.g. extremely wide inline elements)

This is a single-line CSS change. No logic or structural changes needed.
