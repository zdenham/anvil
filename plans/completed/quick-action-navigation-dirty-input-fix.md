# Fix Quick Action Navigation When Input is Dirty

## Problem Statement

Quick action navigation (arrow key up/down) is triggered even when the task input has content ("dirty" state). Users expect that when typing in the input field, arrow keys should perform normal cursor/text navigation within the textarea rather than navigating through quick actions.

## Current Behavior

When the user types in the `ThreadInput` and presses arrow keys:
1. Arrow keys navigate the quick action selection even when the input has text
2. This prevents normal textarea behavior (cursor movement, text selection)

## Expected Behavior

When the input is empty:
- Arrow keys should navigate through quick actions as they do now

When the input is dirty (has content):
- **ArrowUp on the first line**: Should bubble up to quick action navigation
- **ArrowUp on any other line**: Should perform normal cursor movement (stay within textarea)
- **ArrowDown**: Should perform normal textarea operations (quick action navigation via down arrow is less important when there's content)

## Root Cause Analysis

### Architecture Overview

The keyboard handling involves two layers:

1. **ThreadInput layer** (`src/components/reusable/thread-input.tsx:60-63`):
   ```tsx
   if ((e.key === "ArrowUp" || e.key === "ArrowDown") && value.trim() === "" && !triggerState?.isActive) {
     // Don't prevent default - let the quick actions panel handle it
     return;
   }
   ```
   This correctly returns early to allow propagation **only when input is empty**.

2. **SimpleTaskWindow layer** (`src/components/simple-task/simple-task-window.tsx:309-359`):
   ```tsx
   useEffect(() => {
     const handleKeyDown = (e: KeyboardEvent) => {
       // ...
       if (e.key === "ArrowUp") {
         e.preventDefault();
         navigateUp(actions.length);
       } else if (e.key === "ArrowDown") {
         e.preventDefault();
         navigateDown(actions.length);
       }
       // ...
     };

     document.addEventListener("keydown", handleKeyDown);
     return () => document.removeEventListener("keydown", handleKeyDown);
   }, [...]);
   ```
   This handler attaches at the **document level** and has **no visibility into the ThreadInput's value state**.

### The Core Problem

The ThreadInput component correctly checks if input is empty before allowing propagation. However, **it doesn't call `e.stopPropagation()`** - it only returns early without preventing propagation.

The result:
1. User types content in ThreadInput
2. User presses arrow key
3. ThreadInput's `handleKeyDown` executes but does NOT return early (because `value.trim() !== ""`)
4. ThreadInput does nothing with arrow keys when dirty (normal behavior)
5. Event continues to bubble up to document level
6. SimpleTaskWindow's document listener catches the event
7. Quick actions navigate despite the input being dirty

Wait - actually on re-reading the code, the ThreadInput's handler is passed via `onKeyDown` prop and fires on the textarea element directly. The issue is that:
- When input is dirty: ThreadInput handler doesn't return early, and doesn't stopPropagation
- Event bubbles to document
- SimpleTaskWindow handler catches it and navigates

The ThreadInput is designed to **only allow propagation when empty** but it doesn't **block propagation when dirty**.

### Files Involved

| File | Line Numbers | Purpose |
|------|--------------|---------|
| `src/components/simple-task/simple-task-window.tsx` | 309-359 | Global keyboard handler for quick actions |
| `src/components/reusable/thread-input.tsx` | 47-78 | Input-level keyboard handling |
| `src/components/reusable/trigger-search-input.tsx` | - | Underlying input component |
| `src/stores/quick-actions-store.ts` | 1-73 | Quick actions state management |

## Proposed Solution

### Option A: Add `e.stopPropagation()` in ThreadInput when dirty (Recommended)

**Pros:**
- Simple, localized fix
- ThreadInput becomes responsible for deciding what propagates
- No changes needed to SimpleTaskWindow
- Other components using ThreadInput get the same fix

**Cons:**
- Need to be careful not to break other keyboard shortcuts

**Implementation:**
```tsx
// In thread-input.tsx handleKeyDown
const handleKeyDown = useCallback(
  (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // ... existing Enter handling ...

    // Allow arrow keys to propagate to quick actions panel ONLY when input is empty
    if ((e.key === "ArrowUp" || e.key === "ArrowDown")) {
      if (value.trim() === "" && !triggerState?.isActive) {
        // Input is empty - let quick actions handle it
        return;
      } else {
        // Input has content - stop propagation to prevent quick action navigation
        // Don't preventDefault - let textarea handle cursor movement normally
        e.stopPropagation();
        return;
      }
    }

    // ... rest of handler ...
  },
  [handleSubmit, triggerState?.isActive, handleModeKeyDown, value]
);
```

### Option B: Check input state in SimpleTaskWindow handler

**Pros:**
- Keeps all quick action logic centralized in SimpleTaskWindow

**Cons:**
- Requires passing input ref or state up to SimpleTaskWindow
- SimpleTaskWindow needs to know about ThreadInput's internal state
- Tighter coupling between components

**Implementation:**
Would require adding a callback or exposing input value state from ThreadInput.

### Option C: Use quick actions store to track input dirty state

**Pros:**
- Centralized state management
- Could be useful for other features

**Cons:**
- Over-engineered for this specific issue
- Requires syncing state between ThreadInput and store
- More code to maintain

## Recommended Implementation

**Option A** is recommended as it:
1. Is the simplest solution
2. Follows the principle that the input component should manage its own keyboard behavior
3. Requires minimal code changes
4. Doesn't increase coupling between components

### Cursor Position Detection Strategy

To support "ArrowUp on first line bubbles, ArrowUp on other lines stays", we need to detect if the cursor is on the first line of a textarea.

#### Approach: Use `selectionStart` and check for preceding newlines

```tsx
/**
 * Check if cursor is on the first line of a textarea
 * Returns true if there are no newline characters before the cursor position
 */
function isCursorOnFirstLine(textarea: HTMLTextAreaElement): boolean {
  const cursorPosition = textarea.selectionStart;
  const textBeforeCursor = textarea.value.substring(0, cursorPosition);
  return !textBeforeCursor.includes('\n');
}
```

**Why this works:**
- `selectionStart` gives us the cursor position (0-indexed character offset)
- If there's no `\n` before the cursor, we're on the first line
- This is simple, fast, and doesn't require complex layout calculations

**Edge cases handled:**
- Empty input: `cursorPosition = 0`, `textBeforeCursor = ""`, no newlines → first line ✓
- Single line with text: no newlines → first line ✓
- Multiline, cursor on line 2+: newline exists before cursor → not first line ✓
- Cursor at very start of line 2 (right after newline): newline exists → not first line ✓

#### Alternative approaches considered:

1. **Use `getClientRects()` and compare Y positions** - More complex, depends on rendering
2. **Count newlines and compare to "line number"** - Essentially the same as above but more convoluted
3. **Use `scrollTop` heuristics** - Unreliable, depends on scroll state

## Implementation Steps

### Step 1: Add cursor position helper

**File:** `src/components/reusable/thread-input.tsx`

Add a helper function to check if cursor is on the first line:

```tsx
/**
 * Check if cursor is on the first line of a textarea
 * Returns true if there are no newline characters before the cursor position
 */
function isCursorOnFirstLine(textarea: HTMLTextAreaElement): boolean {
  const cursorPosition = textarea.selectionStart;
  const textBeforeCursor = textarea.value.substring(0, cursorPosition);
  return !textBeforeCursor.includes('\n');
}
```

### Step 2: Update ThreadInput keyboard handler

**File:** `src/components/reusable/thread-input.tsx`

Modify the `handleKeyDown` callback to use cursor-position-aware logic:

```tsx
const handleKeyDown = useCallback(
  (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter submits (unless Shift is held for newline, or trigger dropdown is active)
    // Only consume Enter if there's content to submit - otherwise let it propagate to quick actions
    if (e.key === "Enter" && !e.shiftKey && !triggerState?.isActive && value.trim()) {
      e.preventDefault();
      e.stopPropagation();
      handleSubmit();
      return;
    }

    // Handle arrow key propagation for quick actions
    if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      // When trigger dropdown is active, let it handle navigation
      if (triggerState?.isActive) {
        return;
      }

      // When input is empty, allow propagation to quick actions panel
      if (value.trim() === "") {
        return;
      }

      // Input has content - check cursor position for ArrowUp
      if (e.key === "ArrowUp") {
        const textarea = e.currentTarget;
        if (isCursorOnFirstLine(textarea)) {
          // Cursor is on first line - allow propagation to quick actions
          // Don't preventDefault so the event bubbles up
          return;
        }
      }

      // ArrowDown with content, or ArrowUp not on first line:
      // Stop propagation but allow normal textarea behavior
      e.stopPropagation();
      return;
    }

    // Skip mode switching if trigger dropdown is open (Shift+Tab navigates dropdown)
    if (triggerState?.isActive && e.shiftKey && e.key === "Tab") {
      return; // Let dropdown handle it
    }

    // Check for mode switching (Shift+Tab)
    handleModeKeyDown(e);
    if (e.defaultPrevented) return;

    // Note: Arrow keys, Tab, plain Enter are handled by TriggerSearchInput
    // when trigger is active and dropdown is enabled
  },
  [handleSubmit, triggerState?.isActive, handleModeKeyDown, value]
);
```

### Step 3: Verify behavior with trigger dropdown

Ensure that when the trigger dropdown (e.g., `@` file search) is active:
- Arrow keys navigate the dropdown
- Quick actions do not navigate

This should already be handled by the `triggerState?.isActive` check.

### Step 4: Test edge cases

Test the following scenarios:
1. Input empty + ArrowUp/ArrowDown → Quick actions navigate
2. Input has content, cursor on first line + ArrowUp → Quick actions navigate
3. Input has content, cursor on line 2+ + ArrowUp → Cursor moves up within textarea
4. Input has content + ArrowDown → Cursor moves down within textarea (or nothing if at end)
5. Input has whitespace only + arrow keys → Quick actions navigate (whitespace is trimmed)
6. Trigger dropdown active + arrow keys → Dropdown navigates
7. Multiline input, cursor at start of line 2 + ArrowUp → Cursor moves to line 1 (NOT quick actions)

## Testing Strategy

### Manual Testing Checklist

- [ ] Clear input, press Up/Down → Quick actions should navigate
- [ ] Type "hello" (single line), cursor at end, press Up → Quick actions should navigate (first line)
- [ ] Type "hello" (single line), press Down → Cursor should stay (no movement), quick actions should NOT change
- [ ] Type "hello\nworld" (multiline), cursor on line 2, press Up → Cursor moves to line 1, quick actions should NOT change
- [ ] Type "hello\nworld" (multiline), cursor on line 1, press Up → Quick actions should navigate
- [ ] Type "hello\nworld" (multiline), cursor on line 1, press Down → Cursor moves to line 2, quick actions should NOT change
- [ ] Type `@` to open trigger dropdown, press Up/Down → Dropdown should navigate
- [ ] Select file from dropdown, type more text on same line, press Up → Quick actions should navigate (still first line)
- [ ] Press Enter with content → Should submit
- [ ] Press Enter without content → Should trigger selected quick action

### Automated Testing

Consider adding unit tests for:
- `ThreadInput` keyboard handler behavior with different states
- Integration test for quick action navigation flow

## Success Criteria

1. **ArrowUp on first line** (empty or with content) bubbles to quick action navigation
2. **ArrowUp on line 2+** performs normal cursor movement within textarea
3. **ArrowDown with content** performs normal cursor movement (does not navigate quick actions)
4. **Arrow keys in empty input** navigate quick actions (both up and down)
5. **No regression** in existing keyboard shortcuts
6. **Trigger dropdown** continues to work correctly
7. **Enter key behavior** unchanged

## Risk Assessment

### Low Risk
- The change is isolated to ThreadInput's keyboard handler
- Only affects arrow key propagation
- Does not modify quick actions store or SimpleTaskWindow logic

### Considerations
- Ensure `stopPropagation()` doesn't break other features that might listen for arrow keys
- The trigger dropdown already handles its own navigation, so no conflict expected

## Files to Modify

### Primary
- `src/components/reusable/thread-input.tsx` - Add stopPropagation for arrow keys when dirty

### Review Only (no changes expected)
- `src/components/simple-task/simple-task-window.tsx` - Verify handler still works
- `src/components/reusable/trigger-search-input.tsx` - Verify no conflicts
- `src/stores/quick-actions-store.ts` - No changes needed
