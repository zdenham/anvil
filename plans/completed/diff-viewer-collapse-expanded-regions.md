# Diff Viewer: Collapse Expanded Regions

## Problem

Once a collapsed region is expanded, there's no UI to collapse it again. The `CollapsedRegionPlaceholder` only renders when the region is collapsed, so users lose access to the toggle functionality after expanding.

## Solution Overview

Add a collapse affordance that appears **in the same position as the expand placeholder**. When a user clicks to expand, the placeholder transforms into a collapse header - the clickable toggle stays in the same location so users can expand/collapse without moving their cursor. This creates a seamless toggle experience.

## Design Goals

1. **Zero cursor movement** - The toggle stays in the same position for expand AND collapse
2. **Seamless** - The collapse button should feel like a natural part of the diff UI
3. **Discoverable** - Users should be able to find it without documentation
4. **Consistent** - Use the same visual language as the expand placeholder (chevron icon, styling)

## Implementation

The key insight is that the `CollapsedRegionPlaceholder` should **always render** - both when collapsed AND when expanded. The expanded lines appear below it. This means:

- **Collapsed**: Placeholder shows "47 unchanged lines" with right chevron → click to expand
- **Expanded**: Same placeholder shows "47 unchanged lines" with down chevron → click to collapse, lines rendered below

### 1. Keep RenderItem Type As-Is

No changes needed to `RenderItem`. The collapsed placeholder item will render regardless of expanded state.

```typescript
export type RenderItem =
  | { type: "line"; line: AnnotatedLine; lineIndex: number }
  | { type: "collapsed"; region: CollapsedRegion; regionIndex: number };
```

### 2. Update buildRenderItems

The placeholder renders **before** the expanded lines (or alone if collapsed):

```typescript
// Always render the placeholder/header for this region
items.push({
  type: "collapsed",
  region,
  regionIndex,
});

if (expanded.has(regionIndex)) {
  // Region is expanded, render all lines AFTER the placeholder
  while (lineIndex <= region.endIndex) {
    items.push({
      type: "line",
      line: lines[lineIndex],
      lineIndex,
    });
    lineIndex++;
  }
} else {
  // Skip lines, they're hidden
  lineIndex = region.endIndex + 1;
}
```

### 3. Update CollapsedRegionPlaceholder

The component already has `isExpanded` prop - we just need to ensure it's passed correctly and the visual state reflects it:

```tsx
export function CollapsedRegionPlaceholder({
  region,
  regionId,
  isExpanded,
  onToggle,
}: CollapsedRegionPlaceholderProps) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="
        w-full py-1.5 px-4
        flex items-center justify-center gap-2
        text-xs text-slate-400
        bg-slate-800/30
        border-y border-dashed border-slate-700
        hover:bg-slate-800/50 hover:text-slate-300
        transition-colors
        focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-inset
        group
      "
      aria-expanded={isExpanded}
      aria-controls={regionId}
      aria-label={`${region.lineCount} unchanged lines, click to ${isExpanded ? "collapse" : "expand"}`}
    >
      <ChevronRight
        className={`
          w-4 h-4 transition-transform duration-150
          ${isExpanded ? "rotate-90" : ""}
          group-hover:text-slate-300
        `}
        aria-hidden="true"
      />
      <span>
        {region.lineCount} unchanged line{region.lineCount !== 1 ? "s" : ""}
      </span>
    </button>
  );
}
```

The chevron rotation already exists (`rotate-90` when expanded). This gives a natural visual cue:
- **Collapsed**: Chevron points right → "click to expand"
- **Expanded**: Chevron points down → "click to collapse"

### 4. Update DiffFileCard Rendering

Pass `isExpanded` state to the placeholder:

```tsx
{renderItems.map((item) => {
  if (item.type === "collapsed") {
    return (
      <CollapsedRegionPlaceholder
        key={`region-${item.regionIndex}`}
        region={item.region}
        regionId={`region-${item.regionIndex}`}
        isExpanded={expanded.has(item.regionIndex)}
        onToggle={() => toggle(item.regionIndex)}
      />
    );
  }

  return (
    <AnnotatedLineRow
      key={`line-${item.lineIndex}`}
      line={item.line}
      onLineClick={handleLineClick}
    />
  );
})}
```

### 5. Visual Behavior

The interaction is now seamless:

```
COLLAPSED STATE:
┌──────────────────────────────────────────┐
│  ▶ 47 unchanged lines                    │  ← Click anywhere
└──────────────────────────────────────────┘

EXPANDED STATE (after click):
┌──────────────────────────────────────────┐
│  ▼ 47 unchanged lines                    │  ← Same position! Click to collapse
└──────────────────────────────────────────┘
│ 10   10  │ const foo = bar;              │
│ 11   11  │ const baz = qux;              │
│ ...      │ ...                           │
│ 56   56  │ return result;                │
└──────────────────────────────────────────┘
```

- The toggle button stays in the **exact same position**
- User can rapidly expand/collapse without moving cursor
- Chevron rotation provides clear visual feedback

## Tasks

### Task 1: Update buildRenderItems in use-collapsed-regions.ts
- Always emit the `collapsed` item for each region (regardless of expanded state)
- When expanded, emit the lines AFTER the collapsed item
- The `collapsed` type item now serves as a toggle header in both states

### Task 2: Pass isExpanded to CollapsedRegionPlaceholder
- In DiffFileCard, pass `expanded.has(regionIndex)` to the placeholder
- The component already supports `isExpanded` prop and chevron rotation
- Verify aria-label updates appropriately for collapse action

### Task 3: Verify keyboard support
- Tab should focus the placeholder button
- Enter/Space toggles expand/collapse
- Already implemented in existing component

## Completion Criteria

- [ ] Placeholder renders above expanded lines (toggle stays in same position)
- [ ] Clicking toggle collapses the region (lines hide, placeholder remains)
- [ ] Chevron rotates to indicate state (right = collapsed, down = expanded)
- [ ] No cursor movement required to expand then collapse
- [ ] Keyboard navigation works (Tab to button, Enter/Space to activate)
- [ ] aria-expanded and aria-label update correctly for both states
