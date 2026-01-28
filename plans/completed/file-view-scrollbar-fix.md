# File View Scrollbar Fix - Implementation Plan

## Problem

The file view in Write tool output displays horizontal and vertical scrollbars on **individual code lines**, making the diff output ugly and hard to read.

### Root Cause

In `src/components/diff-viewer/annotated-line-row.tsx` (line 100) and `src/components/diff-viewer/highlighted-line.tsx` (line 67), each line's content span has `overflow-x-auto`:

```tsx
// annotated-line-row.tsx:100
<span
  role="cell"
  className={`
    flex-1 px-2 whitespace-pre overflow-x-auto  // <-- Per-line scrollbar!
    ${line.tokens ? "" : getContentColor(line.type)}
  `}
>
```

This causes **each individual line** to show its own scrollbar when content overflows, instead of having a single scrollbar at the container level.

### Visual Impact

- Every long line gets its own tiny horizontal scrollbar
- Creates visual clutter with dozens of scrollbars
- Makes the diff unreadable
- Inconsistent with how code editors handle long lines

## Solution

Move the `overflow-x-auto` from individual line elements to the parent container, and use `overflow-x-visible` on individual lines so they extend into the scrollable area.

### Affected Files

| File | Change |
|------|--------|
| `src/components/diff-viewer/annotated-line-row.tsx` | Remove `overflow-x-auto` from line content span |
| `src/components/diff-viewer/highlighted-line.tsx` | Remove `overflow-x-auto` from line content span |
| `src/components/thread/inline-diff-block.tsx` | Add `overflow-x-auto` to diff content container |
| `src/components/diff-viewer/virtualized-file-content.tsx` | Verify container has `overflow-x-auto` (already has `overflow-auto`) |

## Implementation Steps

### Step 1: Fix `annotated-line-row.tsx`

Change line 100 from:
```tsx
flex-1 px-2 whitespace-pre overflow-x-auto
```

To:
```tsx
flex-1 px-2 whitespace-pre
```

The line content should extend naturally; the parent container handles scrolling.

### Step 2: Fix `highlighted-line.tsx`

Change line 67 from:
```tsx
<code className="flex-1 px-2 whitespace-pre overflow-x-auto">
```

To:
```tsx
<code className="flex-1 px-2 whitespace-pre">
```

### Step 3: Ensure parent containers scroll properly

In `inline-diff-block.tsx`, the diff content container (lines 163-168) should have horizontal scroll capability:

```tsx
<div
  role="table"
  aria-label="Diff content"
  className="bg-surface-900/50 overflow-x-auto"  // Add overflow-x-auto here
>
```

### Step 4: Verify virtualized content

In `virtualized-file-content.tsx`, the container already has `overflow-auto` (line 71) which handles both axes. No change needed, but verify this works correctly after the line-level changes.

## Alternative Approaches Considered

### 1. Text truncation with ellipsis
- **Approach**: Use `truncate` class instead of `overflow-x-auto`
- **Rejected**: Loses content, poor UX for code review

### 2. Word wrapping
- **Approach**: Use `whitespace-pre-wrap` to wrap long lines
- **Rejected**: Breaks code formatting, makes indentation confusing

### 3. Horizontal scroll indicator
- **Approach**: Keep per-line scroll but hide scrollbars, add visual indicator
- **Rejected**: Complex, doesn't solve the underlying layout issue

## Testing Checklist

- [ ] Write tool output with short lines - no scrollbar visible
- [ ] Write tool output with long lines - single horizontal scrollbar at container level
- [ ] Edit tool output with long lines - single horizontal scrollbar at container level
- [ ] Virtualized files (>1000 lines) - scrolling works correctly
- [ ] Collapsed/expanded regions - scroll state preserved
- [ ] Copy functionality still works
- [ ] Line highlighting (additions/deletions) renders correctly
- [ ] Syntax highlighting tokens render correctly

## Notes

- The `whitespace-pre` class is essential to preserve code indentation and prevent wrapping
- The parent container needs `overflow-x-auto` so users can scroll to see long lines
- `overflow-auto` on the virtualized container already handles this case
- No changes to scroll behavior for vertical scrolling (this is working correctly)
