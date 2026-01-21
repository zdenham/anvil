# Spotlight Arrow Navigation Scroll Flashing Issue

## Problem Summary

When using arrow keys to navigate down through a file list that overflows the visible area, holding down the arrow key causes jarring visual flashing. The scroll + navigation combination when held down does not feel smooth.

## Root Cause Analysis

### The Current Implementation

**Location:** `src/components/spotlight/results-tray.tsx:160-168`

```tsx
useEffect(() => {
  if (selectedRef.current && containerRef.current) {
    selectedRef.current.scrollIntoView({
      block: "nearest",
      behavior: "smooth",
    });
  }
}, [selectedIndex]);
```

### Why Flashing Occurs

The issue stems from three interacting problems:

#### 1. Smooth Scroll Animation Queuing

When `behavior: "smooth"` is used with `scrollIntoView`, the browser initiates an animated scroll. When arrow keys are held down:

1. Key repeat fires rapidly (typically 15-30 times per second depending on OS settings)
2. Each keypress triggers `selectedIndex` state update
3. Each state update triggers the `useEffect`
4. Each effect calls `scrollIntoView({ behavior: "smooth" })`
5. **Problem:** New smooth scroll animations are started before previous ones complete, causing visual stuttering and jarring jumps as animations fight each other

#### 2. Selected Item Reference Timing

The `selectedRef` assignment happens during render:
```tsx
<div key={getResultKey(result, index)} ref={isSelected ? selectedRef : undefined}>
```

When rapid state updates occur:
1. React batches state updates and renders
2. The ref may point to different elements between effect runs
3. `scrollIntoView` is called on potentially stale or transitioning element references

#### 3. Selection State vs Visual Feedback Desync

The selection visual (background color change) is CSS-driven and immediate, but the scroll is animated. This creates a visual desync where:
- User sees selection highlight jump instantly
- Scroll lags behind with smooth animation
- On next key repeat, selection jumps again while scroll is still animating
- Result: flickering/flashing appearance

## Proposed Solutions

### Solution 1: Use Instant Scroll (Recommended - Simplest)

Change `behavior: "smooth"` to `behavior: "instant"` (or remove it entirely since "auto" defaults to instant):

```tsx
useEffect(() => {
  if (selectedRef.current && containerRef.current) {
    selectedRef.current.scrollIntoView({
      block: "nearest",
      behavior: "instant", // or just remove behavior property
    });
  }
}, [selectedIndex]);
```

**Pros:**
- Simplest fix, one-line change
- Scroll matches selection highlight timing perfectly
- Works consistently across all browsers
- No animation queue conflicts

**Cons:**
- Less visually polished than smooth scrolling (though the current flashing is worse)

### Solution 2: Debounced Smooth Scroll

Only trigger smooth scroll after rapid input settles:

```tsx
const scrollTimeoutRef = useRef<NodeJS.Timeout | null>(null);

useEffect(() => {
  if (scrollTimeoutRef.current) {
    clearTimeout(scrollTimeoutRef.current);
  }

  if (selectedRef.current && containerRef.current) {
    // Instant scroll for immediate visual feedback
    selectedRef.current.scrollIntoView({
      block: "nearest",
      behavior: "instant",
    });

    // Note: Could add smooth scroll after delay, but instant is usually sufficient
  }
}, [selectedIndex]);
```

**Pros:**
- Immediate visual feedback
- Could optionally add smooth "settling" animation

**Cons:**
- More complex than Solution 1 for minimal benefit

### Solution 3: Manual Scroll Calculation

Calculate scroll position manually to avoid `scrollIntoView` quirks:

```tsx
useEffect(() => {
  if (!selectedRef.current || !containerRef.current) return;

  const container = containerRef.current;
  const selected = selectedRef.current;

  const containerRect = container.getBoundingClientRect();
  const selectedRect = selected.getBoundingClientRect();

  // Check if item is below visible area
  if (selectedRect.bottom > containerRect.bottom) {
    container.scrollTop += selectedRect.bottom - containerRect.bottom;
  }
  // Check if item is above visible area
  else if (selectedRect.top < containerRect.top) {
    container.scrollTop -= containerRect.top - selectedRect.top;
  }
}, [selectedIndex]);
```

**Pros:**
- Full control over scroll behavior
- No browser animation conflicts
- Can be optimized for specific use case

**Cons:**
- More code to maintain
- Essentially reimplementing what `scrollIntoView({ block: "nearest", behavior: "instant" })` does

### Solution 4: CSS scroll-behavior with Override

Use CSS for default smooth scrolling but disable during rapid input:

```tsx
const [isRapidNavigation, setIsRapidNavigation] = useState(false);
const rapidNavTimeoutRef = useRef<NodeJS.Timeout | null>(null);

// In keyboard handler
case "ArrowDown":
case "ArrowUp":
  setIsRapidNavigation(true);
  if (rapidNavTimeoutRef.current) clearTimeout(rapidNavTimeoutRef.current);
  rapidNavTimeoutRef.current = setTimeout(() => setIsRapidNavigation(false), 150);
  // ... rest of handler
```

```tsx
<div
  ref={containerRef}
  style={{ scrollBehavior: isRapidNavigation ? 'auto' : 'smooth' }}
>
```

**Pros:**
- Smooth scrolling when clicking/single-stepping
- Instant scrolling during held navigation

**Cons:**
- Complex state management
- Requires coordination between keyboard handler and scroll container

## Recommendation

**Use Solution 1: Instant Scroll**

The visual flash from competing smooth scroll animations is much worse than the slight "snappiness" of instant scrolling. Most native applications (Spotlight, VS Code, file browsers) use instant scroll for keyboard navigation specifically because it feels more responsive and predictable.

The smooth scroll animation, while visually pleasant for single-step navigation, breaks down completely under rapid input. Instant scroll provides:
- Consistent behavior regardless of input speed
- Perfect sync between selection highlight and scroll position
- Simpler code with fewer edge cases

## Implementation

### Files to Modify

1. `src/components/spotlight/results-tray.tsx` - Change scroll behavior

### Code Change

```diff
// src/components/spotlight/results-tray.tsx:160-168
useEffect(() => {
  if (selectedRef.current && containerRef.current) {
    selectedRef.current.scrollIntoView({
      block: "nearest",
-     behavior: "smooth",
+     behavior: "instant",
    });
  }
}, [selectedIndex]);
```

## Testing Checklist

After implementing the fix, verify:

- [ ] Single arrow key press scrolls item into view without jarring motion
- [ ] Holding arrow key down scrolls smoothly through list without flashing
- [ ] Navigation wraps correctly at list boundaries (if applicable)
- [ ] Mouse hover selection still works correctly
- [ ] Scrolling with mouse wheel doesn't interfere with selection
- [ ] Works correctly with both compact (file) and normal results
- [ ] No visual artifacts when navigating from visible item to item requiring scroll

## Related Issues

This is separate from the height calculation bug documented in `plans/spotlight-height-calculation-bug.md`, which deals with the native window sizing. This issue is purely about the scroll behavior within the web content of the already-sized window.
