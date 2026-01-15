# Action Panel Height Fix

## Problem

When a review is requested, the action panel displays the review content but the default height (120px) is too small to see the content meaningfully. The panel contains:

1. Header with icon and "Review Requested" label
2. Helper text explaining Enter/feedback options
3. Optional PR URL
4. **Markdown review content** (the main content that needs visibility)
5. Input field with agent selector dropdown and submit button

With all these elements, the markdown content area gets barely any space at the current 120px default height.

## Current Implementation

`src/components/workspace/action-panel.tsx:24-26`:

```typescript
const MIN_HEIGHT = 80;
const MAX_HEIGHT = 400;
const DEFAULT_HEIGHT = 120;
```

The panel is resizable via `DragHandle`, but users may not realize they need to drag it larger to see the review content.

## Proposed Solution

### 1. Increase Default Height When Review is Present

Add state-aware default height that expands when there's a pending review:

```typescript
const MIN_HEIGHT = 80;
const MAX_HEIGHT = 500;  // Increase max to allow more expansion
const DEFAULT_HEIGHT = 120;
const REVIEW_DEFAULT_HEIGHT = 280;  // Larger default when review is shown
```

When `pendingReview` becomes non-null, automatically expand to `REVIEW_DEFAULT_HEIGHT` if currently at or below `DEFAULT_HEIGHT`.

### 2. Smooth Transition

Add CSS transition for height changes:

```typescript
<div
  className="relative border-t border-slate-700/50 bg-slate-900/80 backdrop-blur flex-shrink-0 transition-[height] duration-200"
  style={{ height }}
>
```

### 3. Auto-Expand Logic

Add a `useEffect` that watches for `pendingReview` changes:

```typescript
useEffect(() => {
  if (pendingReview && height <= DEFAULT_HEIGHT) {
    setHeight(REVIEW_DEFAULT_HEIGHT);
  }
}, [pendingReview]);
```

This ensures:
- Panel expands automatically when review arrives
- If user has manually resized larger, respect their preference
- If user has manually resized smaller, respect that too (only expand if at/below default)

### 4. Ensure Overflow Scrolling Works Correctly

The current implementation already has `overflow-auto` on the content div, but verify it's working:

```tsx
<div className="flex-1 overflow-auto min-h-0">
```

The `min-h-0` is critical for flex children to allow shrinking and enable scrolling.

## Implementation Steps

1. **Update constants** - Increase `MAX_HEIGHT` to 500, add `REVIEW_DEFAULT_HEIGHT = 280`

2. **Add auto-expand effect** - Watch `pendingReview` and expand height when review arrives

3. **Add height transition** - CSS transition for smooth expansion

4. **Test scenarios**:
   - Fresh review request: panel should auto-expand to 280px
   - Long review content: should scroll within the expanded area
   - User manually resized larger: should stay at user's preferred size
   - User manually resized smaller after review: should respect user preference

## Files to Modify

- `src/components/workspace/action-panel.tsx`

## Edge Cases

- **Multiple rapid review requests**: debounce or only expand if not already expanded
- **Review cleared then new review**: should re-expand
- **User preference persistence**: Consider storing preferred height in localStorage (future enhancement, not in scope)
