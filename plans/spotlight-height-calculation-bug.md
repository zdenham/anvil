# Spotlight Native Window Height Calculation Bug

## Problem Summary

The spotlight native window height is incorrectly calculated in several scenarios, causing the list content to be cut off at the bottom:

1. **Programmatic input value changes** - when cycling through previous prompts (history) or auto-completing "@" file selection
2. **File selection mode** - the compact file results have smaller heights that aren't accounted for

## Root Cause Analysis

### Issue 1: Compact File Results Use Different Height

**Location:** `src/components/spotlight/result-item.tsx:30`

```tsx
compact ? "gap-2 px-3 h-8" : "gap-3 px-3 h-14",
```

The frontend uses two different heights:
- **Normal items:** `h-14` = 56px
- **Compact items (files):** `h-8` = 32px

**Location:** `src-tauri/src/panels.rs:94`

```rust
pub const RESULT_ITEM_HEIGHT: f64 = 56.0;
```

The Rust backend only knows about the 56px height. When file selection is active, all results are compact (32px each), but the native window is sized for 56px items.

### Issue 2: Resize Called Before React Renders

**Location:** `src/components/spotlight/spotlight.tsx:500-502`

```tsx
if (newQuery.trim()) {
  const newResults = await controller.search(newQuery);
  await controller.resizeWindow(newResults.length, inputExpandedRef.current);
```

When history is cycled via `onQueryChange`:
1. `setState` updates the query
2. `controller.resizeWindow()` is called with `inputExpandedRef.current`
3. **Problem:** React hasn't rendered yet, so `checkExpansion()` hasn't run
4. `inputExpandedRef.current` is stale (reflects old expansion state)

**Current flow:**
```
setState({ query: newQuery })
  → resizeWindow() called with STALE expansion state
  → React renders
  → useEffect fires → checkExpansion() → onExpandedChange
  → SECOND resizeWindow() call
```

### Issue 3: Double Resize with Conflicting Data

Multiple places call `resizeWindow`:
- The triggerState effect (lines 1114-1119)
- The `handleExpandedChange` callback (lines 1121-1129)
- Inside `onQueryChange` and `handleQueryChange`

These can fire in close succession with different result counts, causing flicker and incorrect sizing.

### Issue 4: Trigger Close Transitions Back to Full-Height Results

When a file is selected from the `@` autocomplete:

1. `selectTriggerResult()` inserts the file path into the query
2. The trigger closes (`triggerState.isActive` → `false`)
3. `displayResults` switches from compact file results back to normal `results`

**The resize must account for this transition:**
- Results change from `triggerState.results` (compact, 32px each) to `results` (full, 56px each)
- The result count may also change (e.g., 5 files → 3 normal results)
- Both dimensions change simultaneously

The single-effect approach in the proposed solution handles this because when `triggerState.isActive` changes:
- The effect's dependency array includes `triggerState.isActive`
- When it fires, `displayResults.length` reflects the NEW result set (normal results)
- `isCompact` is `false` because `triggerState.isActive` is `false`

**Critical:** The `displayResults` computed value must be re-evaluated BEFORE the effect runs. Since React re-renders with new state before running effects, this is guaranteed.

## Proposed Solution

### Core Fix: Single Resize After State Settles

The existing `useEffect` in SearchInput already handles calling `checkExpansion()` after React renders the new value. The fix is to:

1. **Remove all early/scattered resize calls** - don't call resize before React renders
2. **Have ONE place that calls resize** - after `checkExpansion()` runs via the existing effect
3. **Pass compact flag to Rust** - so it uses correct item height

### Step 1: Update Rust to Accept Compact Flag

```rust
// panels.rs
pub const RESULT_ITEM_HEIGHT: f64 = 56.0;
pub const RESULT_ITEM_HEIGHT_COMPACT: f64 = 32.0;

pub fn resize_spotlight(
    app: &AppHandle,
    result_count: usize,
    input_expanded: bool,
    compact_results: bool,
) -> Result<(), String> {
    if let Ok(panel) = app.get_webview_panel(SPOTLIGHT_LABEL) {
        let base_height = if input_expanded {
            SPOTLIGHT_HEIGHT_EXPANDED
        } else {
            SPOTLIGHT_HEIGHT
        };
        let item_height = if compact_results {
            RESULT_ITEM_HEIGHT_COMPACT
        } else {
            RESULT_ITEM_HEIGHT
        };
        let visible_results = result_count.min(MAX_VISIBLE_RESULTS);
        let results_height = visible_results as f64 * item_height;
        let new_height = base_height + results_height;

        panel.set_content_size(SPOTLIGHT_WIDTH, new_height);
    }
    Ok(())
}
```

### Step 2: Consolidate Resize to Single Effect

Remove all the scattered `resizeWindow` calls. Use ONE effect that runs after state changes:

```tsx
// Single effect handles all resize
useEffect(() => {
  const controller = controllerRef.current;

  // checkExpansion already ran via SearchInput's useEffect([value])
  // inputExpanded state is now correct
  const resultCount = displayResults.length;
  const isCompact = triggerState.isActive;

  controller.resizeWindow(resultCount, inputExpanded, isCompact);
}, [displayResults.length, inputExpanded, triggerState.isActive]);
```

### Step 3: Remove Scattered Resize Calls

Remove `resizeWindow` calls from:
- `onQueryChange` callback (lines 502, 510)
- `handleQueryChange` callback (lines 1095, 1101)
- `handleExpandedChange` callback (line 1126)
- The separate triggerState effect (lines 1114-1119)

### Step 4: Simplify handleExpandedChange

It should only update state, not call resize:

```tsx
const handleExpandedChange = useCallback((expanded: boolean) => {
  setState((prev) => ({ ...prev, inputExpanded: expanded }));
  // Don't call resizeWindow here - the effect will handle it
}, []);
```

### Step 5: Use Hard-Coded Pixel Heights in CSS

```tsx
// result-item.tsx
style={{ height: compact ? 32 : 56 }}
```

This makes the coupling with Rust constants explicit.

## Implementation Steps

1. **Add compact height constant to Rust** (`panels.rs`)
2. **Add `compact_results` parameter to Tauri command** (`lib.rs`)
3. **Update frontend controller** to pass compact flag
4. **Create single resize effect** in spotlight.tsx
5. **Remove all scattered `resizeWindow` calls**
6. **Simplify `handleExpandedChange`** to only update state
7. **Update result-item.tsx** to use explicit pixel heights

## Key Insight

The existing `useEffect([value])` in SearchInput already ensures `checkExpansion()` runs after React renders the new value. We just need to:
- Stop calling resize BEFORE this effect runs
- Have ONE resize call that runs AFTER state settles

The synchronous classList update in `checkExpansion()` (direct DOM manipulation) still happens, preserving cursor stability. We just ensure `resizeWindow()` happens after that, not before.

## Files to Modify

1. `src-tauri/src/panels.rs` - Add `RESULT_ITEM_HEIGHT_COMPACT`, update `resize_spotlight`
2. `src-tauri/src/lib.rs` - Update Tauri command signature
3. `src/components/spotlight/spotlight.tsx` - Consolidate to single resize effect
4. `src/components/spotlight/result-item.tsx` - Use explicit pixel heights

## Testing Checklist

After implementing fixes, verify:

### Basic Functionality
- [ ] Typing a long query expands input and window resizes correctly
- [ ] Pressing Up arrow to cycle history shows full results
- [ ] Calculator results display correctly
- [ ] App results display correctly
- [ ] Mix of result types (app + task) display correctly
- [ ] Rapidly typing/deleting doesn't cause flicker

### File Trigger (`@`) - Compact Mode
- [ ] Typing "@" shows file suggestions without cutoff (compact 32px items)
- [ ] Scrolling through file suggestions works correctly
- [ ] File list height is calculated correctly (count × 32px)

### File Selection Transition (Critical)
- [ ] Selecting a file via Tab transitions smoothly from compact→full height
- [ ] Selecting a file via Enter transitions smoothly from compact→full height
- [ ] Window resizes CORRECTLY after file selection (uses 56px for new results)
- [ ] No flicker during the compact→full transition
- [ ] Verify: after selecting file, normal results (apps, calculator, task) display at full height
