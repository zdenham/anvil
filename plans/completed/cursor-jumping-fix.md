# Cursor Jumping Fix for Spotlight Search Input

## Problem Diagnosis

The cursor jumping to the end of input during typing in Spotlight is caused by **delayed state updates** due to async operations happening before the input value is committed to React state.

### Root Cause Identified

**Spotlight-Specific Issue: Async Operations Before State Update**

The issue occurs in `src/components/spotlight/spotlight.tsx` in the `handleQueryChange` function (lines 945-974):

1. **User types a character** (e.g., "h" in "hello")
2. **`handleQueryChange` is called** with the new value
3. **Async operations begin**:
   - `await controller.search(displayQuery)` - Search operation
   - `await controller.resizeWindow(...)` - Window resize operation
4. **State update happens AFTER async work**:
   ```typescript
   setState((prev) => ({
     ...prev,
     query: displayQuery,  // This happens AFTER async operations
     results: newResults,
   }));
   ```
5. **React re-renders** with the new value, but the **original keystroke event is long gone**
6. **Cursor position is lost** because React can't preserve it across this delayed update

### Why ThreadInput Doesn't Have This Issue

**ThreadInput** (used in simple task windows) works correctly because:
```typescript
onChange={setValue}  // Direct synchronous state setter
```
- State updates happen immediately within the same event loop as the keystroke
- React can preserve cursor position because the re-render is synchronous

### Why This Isn't a Normal Controlled Component Issue

- **Normal controlled components** update state synchronously and preserve cursor position
- **Spotlight breaks this pattern** by delaying the state update until after async operations
- The async delay causes the input value update to happen outside the original keystroke event context

### Math Expression Transformation is NOT the Cause

Initially suspected `formatQueryForDisplay` transforms (`* → ×`, `/ → ÷`), but:
- This only affects math expressions
- The cursor jumping happens on **all input**, not just math
- For regular text, `formatQueryForDisplay` returns the original string unchanged

## Solution Implementation

### Proper Fix: Update State Immediately Before Async Operations

**Problem**: Spotlight delays input state updates until after async operations complete.

**Fix**: Update the query state immediately (synchronously), then perform async operations separately.

**File**: `src/components/spotlight/spotlight.tsx` - `handleQueryChange` function (lines 945-974)

```typescript
const handleQueryChange = useCallback(
  async (newQuery: string) => {
    const controller = controllerRef.current;
    const displayQuery = controller.formatQueryForDisplay(newQuery);

    // Update input state immediately (fixes cursor jumping)
    setState((prev) => ({
      ...prev,
      query: displayQuery,
      selectedIndex: 0,
    }));

    if (!displayQuery.trim()) {
      // Clear results and resize for empty query
      setState((prev) => ({ ...prev, results: [] }));
      await controller.resizeWindow(0, inputExpanded);
      return;
    }

    // Perform async operations after input state is updated
    const newResults = await controller.search(displayQuery);
    await controller.resizeWindow(newResults.length, inputExpanded);

    // Update results separately
    setState((prev) => ({
      ...prev,
      results: newResults,
      selectedIndex: 0,
    }));
  },
  [inputExpanded]
);
```

### Why This Fix is Safe

1. **Search operation** - `controller.search(displayQuery)` takes the query string as a parameter, doesn't depend on component state
2. **Window resize** - `controller.resizeWindow(resultCount, expanded)` only needs result count and expansion state
3. **Other query usages** - History operations and task creation work with string values directly, not component state
4. **No breaking changes** - All existing functionality continues to work

### Alternative Fix (Patch Approach): Manual Cursor Restoration

If immediate state updates cause other issues, the fallback is to manually restore cursor position:

**File**: `src/components/reusable/trigger-search-input.tsx` - `handleChange` function

```typescript
const handleChange = useCallback(
  (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    const cursorPos = e.target.selectionStart ?? 0;
    cursorPositionRef.current = cursorPos;

    onChange?.(value);

    // Restore cursor position after React re-render (for Spotlight async handling)
    requestAnimationFrame(() => {
      if (textareaRef.current && textareaRef.current.selectionStart !== cursorPos) {
        textareaRef.current.setSelectionRange(cursorPos, cursorPos);
      }
    });

    // Skip analysis during IME composition
    if (!isComposing && enableTriggers) {
      const inputType = (e.nativeEvent as InputEvent).inputType;
      analyzeInput(value, cursorPos, inputType);
      updateAnchorRect();
    }
  },
  [onChange, isComposing, enableTriggers, analyzeInput, updateAnchorRect]
);
```

## Implementation Priority

1. **Preferred Solution**: Fix Spotlight's `handleQueryChange` to update state immediately
2. **Fallback Solution**: Add cursor restoration to `TriggerSearchInput.handleChange`

## Testing Strategy

### For Preferred Solution (Spotlight handleQueryChange fix):

1. **Cursor Position Testing**:
   - Type in Spotlight input and place cursor in middle of text
   - Continue typing - cursor should stay in place
   - Test with rapid typing, backspacing, and arrow key movement
   - Test with math expressions (`2*3+4` should work without cursor jumping)

2. **Functionality Testing**:
   - Verify search results appear correctly
   - Test window resizing behavior
   - Ensure trigger autocomplete (`@` file mentions) still works
   - Test history navigation (up/down arrows)
   - Verify task creation works for both simple and full modes

3. **Performance Testing**:
   - Ensure no visual lag or flashing during typing
   - Test with rapid keystrokes to check for race conditions
   - Verify multiple setState calls don't cause performance issues

### Edge Cases:
- IME composition (international text input)
- Copy/paste operations
- Very long queries (>1000 characters)
- Empty query handling

## Files to Modify

**Preferred Solution**:
- `/src/components/spotlight/spotlight.tsx` - Update `handleQueryChange` function

**Fallback Solution** (if needed):
- `/src/components/reusable/trigger-search-input.tsx` - Add cursor restoration

## Risk Assessment

**Preferred Solution - Very Low Risk**:
- Changes are isolated to when state updates occur
- No changes to business logic or async operations
- Search and resize operations remain unchanged
- Easy to revert if issues arise

**Fallback Solution - Low Risk**:
- Adds cursor restoration mechanism similar to existing working code
- Non-breaking additive change to existing event handler