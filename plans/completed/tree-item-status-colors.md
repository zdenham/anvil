# Tree Menu Item Status Colors

Add subtle text coloring to left panel items based on their read status.

## Phases

- [x] Add CSS animations and utility classes
- [x] Update ThreadItem component
- [x] Update PlanItem component
- [x] Test and refine subtle tinting

---

## Requirements

1. **Unread items**: Text should be SLIGHTLY tinted blue
2. **Read items**: Text should be SLIGHTLY tinted grey
3. **Running items**: Text should be SLIGHTLY tinted green with a subtle pulsing animation (matching the status dot animation style)

The tinting should be **very subtle** - enhancing the visual feedback without being distracting.

## Implementation Plan

### 1. CSS Animation for Running Text

Add a new CSS animation in `src/index.css` that creates a subtle pulsing effect on text for running items. This will mirror the existing `statusDotPulse` animation but for text.

```css
/* Tree item text - running state with subtle pulse */
.tree-item-text-running {
  animation: treeItemTextPulse 1.5s ease-in-out infinite;
}

@keyframes treeItemTextPulse {
  0%, 100% {
    opacity: 1;
  }
  50% {
    opacity: 0.7;
  }
}
```

### 2. Text Color Classes

Define subtle color tints using Tailwind's opacity variants:

| Status | Color Approach | Rationale |
|--------|---------------|-----------|
| **Unread** | `text-blue-200/90` or similar | Very subtle blue tint over base text |
| **Read** | `text-surface-400` (existing gray) | Slightly dimmed from default |
| **Running** | `text-green-200/90` + pulse animation | Subtle green with animation |

Since we want the colors to be **very subtle**, we'll use light color variants with reduced opacity or mix with the existing surface colors.

### 3. Component Updates

#### ThreadItem (`src/components/tree-menu/thread-item.tsx`)

Update the text `<span>` element to include status-based coloring:

```tsx
// Add a helper function or inline logic to get text color class based on status
const getTextColorClass = (status: StatusDotVariant, isSelected: boolean) => {
  if (isSelected) return ""; // Selected state overrides
  switch (status) {
    case "running":
      return "text-green-300/80 tree-item-text-running";
    case "unread":
      return "text-blue-300/80";
    case "read":
    default:
      return "text-surface-400";
  }
};
```

Apply this to the title span, keeping the base container colors for hover/selection states.

#### PlanItem (`src/components/tree-menu/plan-item.tsx`)

Same approach - apply status-based text coloring to the title span.

### 4. Refinement Notes

- The **running** animation should use the same 1.5s duration as the status dot for visual consistency
- Colors should be subtle enough that they don't clash with the selection highlight (`bg-accent-500/20`)
- The grey (read) state should be distinguishable but not look "disabled"
- Test on both light-on-dark UI to ensure visibility

## Files to Modify

1. `src/index.css` - Add `.tree-item-text-running` animation
2. `src/components/tree-menu/thread-item.tsx` - Apply status-based text colors
3. `src/components/tree-menu/plan-item.tsx` - Apply status-based text colors

## Color Palette Reference

From the existing codebase:
- `surface-100`: Bright text
- `surface-300`: Default item text
- `surface-400`: Muted/secondary
- `blue-500`: Unread dot color
- `green-500` / `#22c55e`: Running dot color
- `zinc-400`: Read dot color
