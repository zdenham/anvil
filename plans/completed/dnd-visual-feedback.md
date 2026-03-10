# Improve DnD Visual Feedback in Sidebar Tree

## Problem

1. **Invalid drops show a red box overlay** (`bg-red-500/10 border border-red-500/30`) on the target row — feels alarming/confusing
2. **Valid "inside" drops** only show a subtle accent highlight (`bg-accent-500/15 border border-accent-500/40`) — not clear enough that you're nesting the item *into* the target

## Phases

- [x] Replace red invalid-drop overlay with `cursor-not-allowed`

- [x] Improve valid "inside" drop indicator to show nesting intent

&lt;!-- IMPORTANT: Mark phases complete with \[x\] as you finish them. Update this file immediately after completing each phase - do not batch updates. --&gt;

---

## Phase 1: Replace red box with `not-allowed` cursor

**File:** `src/components/tree-menu/drop-indicator.tsx`

Remove the red box `<div>` that renders when `!validation.valid && validation.reason`. Instead, return `null` (same as the no-reason invalid case on line 52).

**File:** `src/components/tree-menu/use-tree-dnd.ts`

Expose a derived `isInvalidDrop` boolean from the hook: `true` when `dropTarget` exists and `!dropTarget.validation.valid`. This lets the tree container set the cursor.

**File:** `src/components/tree-menu/tree-menu.tsx`

On the tree container `<div>` (line 196–204), conditionally add `cursor-not-allowed` when `isInvalidDrop` is true during an active drag. This gives the user clear feedback without the jarring red overlay.

Also add `cursor-grabbing` when there's an active drag and the drop is valid (or no target), so the cursor reflects the dragging state.

### Summary of cursor states during drag:

| State | Cursor |
| --- | --- |
| Dragging, hovering valid target | `cursor-grabbing` |
| Dragging, hovering invalid target | `cursor-not-allowed` |
| Not dragging | default (`cursor-pointer` on items) |

## Phase 2: Improve "inside" drop indicator

**File:** `src/components/tree-menu/drop-indicator.tsx`

Update the `position === "inside"` branch to make it visually distinct as a "nesting" operation:

1. **Left accent bar**: Add a 2–3px solid accent-colored left border to clearly show "dropping into" (similar to how file trees show folder targets)
2. **Slightly stronger background**: Bump from `bg-accent-500/15` to `bg-accent-500/20` for better visibility
3. **Rounded corners + inset**: Add `rounded` and slight left padding so it looks like a container receiving content

The updated class might look like:

```
"absolute pointer-events-none bg-accent-500/20 border-l-[3px] border-l-accent-400 border border-accent-500/30 rounded z-10"
```

This creates a clear visual distinction between:

- **Reorder** (above/below): thin horizontal line
- **Nest inside**: highlighted box with a strong left accent bar