# Spotlight Trigger Auto-Complete Resize Cursor Jump Fix

## Problem

When tagging a file in the spotlight (using `@` trigger for file autocomplete), selecting a file causes a jarring visual cursor change. The same issue occurs with history cycling.

The issue is specifically about **programmatic value changes** (history cycling, auto-complete) causing cursor confusion when font size changes. This does **not** happen when typing normally.

## Investigation

### Relevant Files

| File | Purpose |
|------|---------|
| `src/components/reusable/search-input.tsx:73-103` | `checkExpansion` - measures text and triggers font size change |
| `src/components/reusable/search-input.tsx:96-98` | `handleChange` - calls checkExpansion synchronously on typing |
| `src/components/reusable/search-input.tsx:101-103` | useEffect - calls checkExpansion **after render** on value prop change |
| `src/components/spotlight/spotlight.tsx:987-991` | `handleQueryChange` - sets query state programmatically |
| `src/components/spotlight/spotlight.tsx:1027-1032` | `handleExpandedChange` - resizes window when expansion changes |

### Root Cause Identified

The issue is a **timing mismatch between font size changes and window resize** during programmatic value changes.

#### How Expansion/Font Size Works

In `search-input.tsx`, there are two ways `checkExpansion` gets called:

1. **When typing** (line 96-98):
   ```typescript
   const handleChange = (e) => {
     checkExpansion();  // SYNCHRONOUS - same event loop
     onChange?.(e);
   };
   ```

2. **When value changes programmatically** (line 101-103):
   ```typescript
   useEffect(() => {
     checkExpansion();  // AFTER RENDER - separate event loop
   }, [value, checkExpansion]);
   ```

When `checkExpansion` determines font size should change, it calls `onExpandedChange` which triggers `handleExpandedChange` in spotlight.tsx, which then calls `resizeWindow`.

#### Sequence of Events - Typing (Works Fine)

```
1. User types a character
   ↓
2. SearchInput.handleChange called:
   - checkExpansion() runs SYNCHRONOUSLY
   - If expansion changes → onExpandedChange → resize happens
   - onChange passes event up
   ↓
3. handleQueryChange runs with current inputExpanded state
   ↓
4. Everything is synchronized - no cursor confusion
```

#### Sequence of Events - Programmatic (Broken)

```
1. User selects file from trigger (or cycles history)
   ↓
2. handleQueryChange called:
   - setState({ query: newValue }) - updates value
   - await search()
   - await resizeWindow(count, inputExpanded) ← uses STALE expansion state!
   ↓
3. React renders with new value
   ↓
4. SearchInput's useEffect runs:
   - checkExpansion() sees new value needs different font size
   - onExpandedChange(newExpanded) called
   ↓
5. handleExpandedChange runs:
   - setState({ inputExpanded: newExpanded })
   - await resizeWindow(count, newExpanded) ← SECOND resize with correct state
   ↓
6. VISUAL GLITCH: Two resizes happen, font size changes between them
   Cursor gets confused by the intermediate state
```

**The problem**: When value changes programmatically, the resize in `handleQueryChange` uses the **old** expansion state. Then a **second** resize happens after the font size change is detected. The cursor gets confused during this two-phase update.

## Diagnosis

The fix pattern from cursor-jumping-fix.md applies: **synchronize state changes**.

Just as we needed to update query state synchronously before async operations, we need to **calculate and apply expansion state synchronously** with the value change, so the resize uses the correct font size from the start.

## Proposed Fix

### Option A: Calculate Expansion Synchronously in handleQueryChange

Before calling resize, synchronously calculate what the expansion state **will be** for the new query, and use that for the resize.

**File**: `src/components/spotlight/spotlight.tsx`

```typescript
const handleQueryChange = useCallback(
  async (newQuery: string) => {
    const controller = controllerRef.current;
    const displayQuery = controller.formatQueryForDisplay(newQuery);

    // Calculate what expansion state WILL be for this new query
    // This mirrors the logic in SearchInput.checkExpansion
    const willBeExpanded = calculateExpansion(displayQuery, inputRef.current);

    // Update query AND expansion state together
    setState((prev) => ({
      ...prev,
      query: displayQuery,
      inputExpanded: willBeExpanded,
      selectedIndex: 0,
    }));

    if (!displayQuery.trim()) {
      setState((prev) => ({ ...prev, results: [] }));
      await controller.resizeWindow(0, willBeExpanded);
      return;
    }

    const newResults = await controller.search(displayQuery);
    await controller.resizeWindow(newResults.length, willBeExpanded);

    setState((prev) => ({
      ...prev,
      results: newResults,
      selectedIndex: 0,
    }));
  },
  []  // No dependency on inputExpanded - we calculate it fresh
);
```

### Option B: Expose checkExpansion and Call Before Resize

Add a ref method to SearchInput that allows parent to trigger expansion check synchronously.

**File**: `src/components/reusable/search-input.tsx`

Expose `checkExpansion` via ref:
```typescript
useImperativeHandle(ref, () => ({
  ...internalRef.current!,
  checkExpansion,  // Allow parent to trigger synchronously
}));
```

**File**: `src/components/spotlight/spotlight.tsx`

Call it before resize:
```typescript
const handleQueryChange = useCallback(
  async (newQuery: string) => {
    // ... set query state ...

    // Force expansion check NOW, before resize
    inputRef.current?.checkExpansion?.();

    // Now inputExpanded state is correct for resize
    await controller.resizeWindow(count, inputExpandedRef.current);
  },
  []
);
```

### Option C: Use flushSync for Synchronous Render

Force React to render synchronously after setting query state, so the useEffect runs immediately.

```typescript
import { flushSync } from 'react-dom';

const handleQueryChange = useCallback(
  async (newQuery: string) => {
    // Force synchronous render so useEffect runs immediately
    flushSync(() => {
      setState((prev) => ({
        ...prev,
        query: displayQuery,
        selectedIndex: 0,
      }));
    });

    // Now expansion has been checked and inputExpanded is current
    await controller.resizeWindow(count, inputExpandedRef.current);
  },
  []
);
```

## Recommended Approach

**Option B (expose checkExpansion)** is cleanest because:
1. Keeps expansion logic in SearchInput where it belongs
2. Minimal changes to existing code
3. Parent can call it when needed for programmatic changes
4. Doesn't require duplicating expansion calculation logic

### Implementation Steps

1. Expose `checkExpansion` via useImperativeHandle in SearchInput
2. In spotlight's `handleQueryChange`, call `inputRef.current?.checkExpansion?.()` after setting query state but before resize
3. Same fix for history `onQueryChange` callback
4. Test with trigger selection and history cycling

### Test Cases

1. **Trigger selection with expansion change**:
   - Have short query (large font)
   - Type `@` and select a long file path
   - Verify smooth transition to small font without cursor glitch

2. **History cycling with expansion change**:
   - Have empty input (large font)
   - Press up arrow to cycle to a long history entry
   - Verify smooth transition

3. **No expansion change**:
   - Verify normal behavior still works when font size doesn't change

## Risk Assessment

**Low Risk**:
- Exposing existing function via ref is safe
- Calling checkExpansion synchronously matches what happens during typing
- No changes to expansion logic itself
