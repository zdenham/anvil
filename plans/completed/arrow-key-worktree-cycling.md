# Arrow Key Worktree Cycling Implementation Plan

## Overview

Update the spotlight component to improve worktree cycling UX:
1. Change the hint text from "use arrow keys to change" to use arrow symbols (← →)
2. Implement smart arrow key behavior that integrates with text input

## Current Behavior

- **Right Arrow**: Always cycles forward through worktrees when a task result is selected
- **Left Arrow**: Not implemented for worktree cycling
- **Hint Text**: "use arrow keys to change"

## Proposed Behavior

### Hint Text Update
**File:** `src/components/spotlight/results-tray.tsx` (line 84-86)

Change from:
```
Worktree: ${selectedWorktree.name} (use arrow keys to change)
```

To:
```
Worktree: ${selectedWorktree.name} (use ← → to change)
```

### Arrow Key Behavior

**Right Arrow (→):**
- If cursor position (`selectionStart`) is at the **end** of the input text AND there's no active text selection → cycle to the next worktree
- Otherwise → normal cursor movement (move cursor right in input)

**Left Arrow (←):**
- If the **first worktree is NOT selected** (selectedWorktreeIndex > 0) → cycle back to previous worktree
- Otherwise (first worktree IS selected) → normal cursor movement (move cursor left in input)

This creates an intuitive UX where:
- Users can still edit their task description normally
- Right arrow at end of text cycles forward through worktrees
- Left arrow only cycles back if not on the first worktree (so you can still move cursor left when on the first worktree)

## Implementation Steps

### Step 1: Update Hint Text
**File:** `src/components/spotlight/results-tray.tsx`

```typescript
// Line ~85
subtitle = availableWorktrees.length > 1
  ? `Worktree: ${selectedWorktree.name} (use ← → to change)`
  : `Worktree: ${selectedWorktree.name}`;
```

### Step 2: Add Input Ref for Cursor Position
**File:** `src/components/spotlight/spotlight.tsx`

Need to track the input element's cursor position (`selectionStart`) to determine if we're at the end of the input.

The input ref already exists as `inputRef` (line ~464). We'll use `inputRef.current?.selectionStart` and `inputRef.current?.value.length` to check cursor position.

### Step 3: Update Right Arrow Handler
**File:** `src/components/spotlight/spotlight.tsx` (lines 962-973)

Current implementation:
```typescript
if (event.key === "ArrowRight") {
  if (currentResult?.type === "task" && availableWorktrees.length > 0) {
    event.preventDefault();
    setState((prev) => ({
      ...prev,
      selectedWorktreeIndex:
        (prev.selectedWorktreeIndex + 1) % prev.availableWorktrees.length,
    }));
  }
}
```

New implementation:
```typescript
if (event.key === "ArrowRight") {
  if (currentResult?.type === "task" && availableWorktrees.length > 1) {
    const input = inputRef.current;
    // Only cycle if cursor is at the very end AND no text is selected
    // selectionStart === selectionEnd means no selection range (just a cursor)
    // selectionStart === value.length means cursor is at the end
    const isAtEnd = input &&
      input.selectionStart === input.value.length &&
      input.selectionStart === input.selectionEnd;

    if (isAtEnd) {
      event.preventDefault();
      setState((prev) => ({
        ...prev,
        selectedWorktreeIndex:
          (prev.selectedWorktreeIndex + 1) % prev.availableWorktrees.length,
      }));
    }
    // Otherwise: let default behavior happen (cursor moves right)
  }
}
```

### Step 4: Add Left Arrow Handler
**File:** `src/components/spotlight/spotlight.tsx` (after the ArrowRight handler)

Add new handler for ArrowLeft:
```typescript
if (event.key === "ArrowLeft") {
  if (currentResult?.type === "task" && availableWorktrees.length > 1) {
    const notOnFirstWorktree = selectedWorktreeIndex > 0;

    if (notOnFirstWorktree) {
      event.preventDefault();
      setState((prev) => ({
        ...prev,
        selectedWorktreeIndex: prev.selectedWorktreeIndex - 1,
      }));
    }
    // Otherwise (on first worktree): let default behavior happen (cursor moves left)
  }
}
```

## Summary of Changes

| File | Change |
|------|--------|
| `src/components/spotlight/results-tray.tsx` | Update hint text to use ← → symbols |
| `src/components/spotlight/spotlight.tsx` | Modify ArrowRight to only cycle when cursor at end |
| `src/components/spotlight/spotlight.tsx` | Add ArrowLeft handler to cycle back (unless on first worktree) |

## Edge Cases

1. **Empty input**: Cursor is at position 0, which equals length (0). Right arrow will cycle worktrees.
2. **Single worktree**: Neither arrow key will do worktree cycling (condition checks `length > 1`)
3. **Non-task results**: Arrow keys behave normally (worktree cycling only for task results)
4. **Text selection**: If user has selected text (`selectionStart !== selectionEnd`), right arrow won't cycle - it will collapse the selection as normal
5. **Cursor at start/middle**: If cursor is positioned anywhere except the very end, right arrow moves cursor normally

## Testing Checklist

- [ ] Hint text shows "← →" instead of "arrow keys"
- [ ] Right arrow at end of input (no selection) cycles to next worktree
- [ ] Right arrow in middle of input moves cursor normally
- [ ] Right arrow at start of input moves cursor normally
- [ ] Right arrow with text selected collapses selection (no cycling)
- [ ] Left arrow when not on first worktree cycles back
- [ ] Left arrow when on first worktree moves cursor normally
- [ ] Empty input: right arrow cycles worktrees
- [ ] Single worktree: no cycling occurs, arrows work normally
- [ ] Non-task results: arrows work normally (up/down navigation)
