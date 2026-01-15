# Plan: Input Component Consolidation

## Overview

Consolidate logic between `Spotlight` and `SimpleTaskInput` to maximize code reuse while respecting their different contexts:
- **Spotlight**: Creates new tasks, @ tags shown in tray
- **SimpleTaskInput**: Responds to existing threads, @ tags shown in dropdown

## Current State

| Component | Lines | @ Tag Support | Purpose |
|-----------|-------|---------------|---------|
| `Spotlight` | 994 | Yes (in tray) | Create new tasks |
| `SimpleTaskInput` | 49 | No | Respond to threads |
| `TriggerSearchInput` | 282 | Yes (configurable) | Reusable input with triggers |

**Key insight**: `TriggerSearchInput` already supports both modes via `disableDropdown` prop:
- `disableDropdown=true` -> Parent renders results (used by Spotlight)
- `disableDropdown=false` -> Component renders dropdown (available but unused)

## Implementation Plan

### Step 1: Add `variant` prop to SearchInput

**File**: `src/components/reusable/search-input.tsx`

Add variant support to handle spotlight vs compact styling. This is the foundation for all subsequent steps.

**Interface changes**:
```typescript
export type SearchInputVariant = "spotlight" | "compact";

export interface SearchInputProps
  extends Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, "rows"> {
  /** Visual variant: "spotlight" (large, frosted) or "compact" (thread input) */
  variant?: SearchInputVariant;
  /** Whether there's content below this input (affects border radius when not expanded) */
  hasContentBelow?: boolean;
  /** Width fill ratio (0-1) at which to expand. Default 0.85 */
  expandThreshold?: number;
  /** Callback when expansion state changes */
  onExpandedChange?: (expanded: boolean) => void;
}
```

**Variant style definitions** (add near top of file):
```typescript
const VARIANT_STYLES = {
  spotlight: {
    fontSize: "text-3xl",
    expandedFontSize: "text-xl",
    padding: "px-4 py-4",
    background: "bg-surface-900/80 backdrop-blur-xl",
    measureFontSize: "text-3xl", // For hidden span measurement
    rows: { collapsed: 1, expanded: 6 },
    useExpansion: true, // Enable expand/collapse behavior
  },
  compact: {
    fontSize: "text-sm",
    expandedFontSize: "text-sm", // No change when expanded
    padding: "px-3 py-2",
    background: "bg-surface-900",
    measureFontSize: "text-sm",
    rows: { collapsed: 1, expanded: 4 }, // Smaller expansion
    useExpansion: true, // Still expand for long messages
  },
} as const;
```

**Implementation details**:

1. **Measurement span** (line 79-83): Update to use variant's `measureFontSize`:
   ```typescript
   const styles = VARIANT_STYLES[variant];
   // ...
   <span
     ref={measureRef}
     className={cn(
       "fixed -top-[9999px] -left-[9999px] whitespace-pre font-light pointer-events-none",
       styles.measureFontSize
     )}
     aria-hidden="true"
   />
   ```

2. **Textarea styling** (line 87-99): Apply variant-specific styles:
   ```typescript
   const styles = VARIANT_STYLES[variant];
   // ...
   <textarea
     ref={internalRef}
     rows={isExpanded ? styles.rows.expanded : styles.rows.collapsed}
     className={cn(
       "block w-full resize-none",
       styles.padding,
       styles.background,
       "text-white font-light",
       isExpanded ? styles.expandedFontSize : styles.fontSize,
       "focus:outline-none",
       "border border-surface-700/50",
       hasContentBelow ? "rounded-t-xl border-b-0" : "rounded-xl",
       className
     )}
     // ...
   />
   ```

3. **Compact-specific adjustments**:
   - Remove `backdrop-blur-xl` (not appropriate for thread context)
   - Use smaller border radius for compact: `rounded-lg` instead of `rounded-xl`
   - Compact variant: use `min-h-[40px] max-h-[120px]` via className override if needed

**Default behavior**: `variant="spotlight"` to maintain backward compatibility. Existing Spotlight usage requires no changes.

**Verification**:
- Spotlight still renders with large text (text-3xl) and frosted glass effect
- Compact variant renders with text-sm and solid background
- Text measurement works correctly for both variants
- Expansion behavior works for both (different row counts)

---

### Step 2: Update TriggerStateInfo to include error

**File**: `src/components/reusable/trigger-search-input.tsx`

Add error field to the state info passed to parent components.

**Interface change** (line 19-24):
```typescript
export interface TriggerStateInfo {
  isActive: boolean;
  results: TriggerResult[];
  selectedIndex: number;
  isLoading: boolean;
  error?: string | null; // NEW: Pass through error state
}
```

**Implementation** (line 66-79): Update the effect to include error:
```typescript
useEffect(() => {
  onTriggerStateChange?.({
    isActive: triggerState.isActive,
    results: triggerState.results,
    selectedIndex: triggerState.selectedIndex,
    isLoading: triggerState.isLoading,
    error: triggerState.error, // NEW
  });
}, [
  triggerState.isActive,
  triggerState.results,
  triggerState.selectedIndex,
  triggerState.isLoading,
  triggerState.error, // NEW dependency
  onTriggerStateChange,
]);
```

---

### Step 3: Create `ThreadInput` Component

**File**: `src/components/reusable/thread-input.tsx`

A new reusable input component for responding to threads with @ mention support.

**Interface**:
```typescript
interface ThreadInputProps {
  onSubmit: (prompt: string) => void;
  disabled?: boolean;
  workingDirectory?: string;  // For @ file resolution
  placeholder?: string;
}
```

**Full implementation**:
```typescript
import { useState, useCallback, useRef } from "react";
import { TriggerSearchInput, type TriggerStateInfo } from "./trigger-search-input";
import type { TriggerSearchInputRef } from "@/lib/triggers/types";

interface ThreadInputProps {
  onSubmit: (prompt: string) => void;
  disabled?: boolean;
  workingDirectory?: string;
  placeholder?: string;
}

export function ThreadInput({
  onSubmit,
  disabled,
  workingDirectory,
  placeholder,
}: ThreadInputProps) {
  const [value, setValue] = useState("");
  const [triggerState, setTriggerState] = useState<TriggerStateInfo | null>(null);
  const inputRef = useRef<TriggerSearchInputRef>(null);

  const handleSubmit = useCallback(() => {
    if (value.trim() && !disabled) {
      onSubmit(value.trim());
      setValue("");
    }
  }, [value, disabled, onSubmit]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      // Cmd+Enter ALWAYS submits, even if trigger dropdown is open
      // This bypasses trigger selection behavior intentionally
      if (e.key === "Enter" && e.metaKey) {
        e.preventDefault();
        e.stopPropagation();
        handleSubmit();
        return;
      }

      // Note: Arrow keys, Tab, plain Enter are handled by TriggerSearchInput
      // when trigger is active and dropdown is enabled
    },
    [handleSubmit]
  );

  const handleTriggerStateChange = useCallback((state: TriggerStateInfo) => {
    setTriggerState(state);
  }, []);

  // Determine if triggers should be enabled
  // Disable if no working directory (file search won't work)
  const enableTriggers = Boolean(workingDirectory);

  // Build placeholder text
  const getPlaceholder = () => {
    if (placeholder) return placeholder;
    if (disabled) return "Agent is running...";
    if (!workingDirectory) return "Type a message (Cmd+Enter to send)";
    return "Type a message, @ to mention files (Cmd+Enter to send)";
  };

  return (
    <div className="flex gap-2 px-4 py-3 bg-surface-800 border-t border-surface-700">
      <div className="flex-1 min-w-0">
        <TriggerSearchInput
          ref={inputRef}
          value={value}
          onChange={setValue}
          onKeyDown={handleKeyDown}
          onTriggerStateChange={handleTriggerStateChange}
          disabled={disabled}
          placeholder={getPlaceholder()}
          triggerContext={{ rootPath: workingDirectory ?? null }}
          enableTriggers={enableTriggers}
          variant="compact"
          // disableDropdown defaults to false, so dropdown renders for @ tags
          className="min-h-[40px] max-h-[120px] flex-1 border-surface-600 focus:border-secondary-500 disabled:opacity-60 disabled:cursor-not-allowed placeholder:text-surface-500"
          aria-label="Message input"
          aria-expanded={triggerState?.isActive}
          aria-autocomplete="list"
        />
      </div>
      <button
        onClick={handleSubmit}
        disabled={disabled || !value.trim()}
        className="px-4 py-2 rounded-lg bg-accent-500 text-accent-900 font-medium text-sm hover:bg-accent-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors self-end"
        aria-label="Send message"
      >
        Send
      </button>
    </div>
  );
}
```

**Key design decisions**:

1. **Cmd+Enter always submits**: Even when trigger dropdown is open, Cmd+Enter submits the entire text. This is handled BEFORE the event reaches TriggerSearchInput.

2. **Trigger disabled without workingDirectory**: When `workingDirectory` is empty/undefined, `enableTriggers=false` prevents the @ trigger from activating. This avoids showing an empty dropdown with no feedback.

3. **Placeholder hints**: When triggers are enabled, placeholder mentions "@ to mention files" to guide users.

4. **Send button position**: Uses `self-end` to align with the bottom of the input when it expands.

5. **Accessibility**:
   - `aria-label` on input and button
   - `aria-expanded` reflects trigger dropdown state
   - `aria-autocomplete="list"` indicates autocomplete behavior
   - TriggerDropdown already has `role="listbox"` and `aria-activedescendant`

---

### Step 4: Update SimpleTaskWindow

**File**: `src/components/simple-task/simple-task-window.tsx`

Replace `SimpleTaskInput` with `ThreadInput`.

**Changes**:
```diff
- import { SimpleTaskInput } from "./simple-task-input";
+ import { ThreadInput } from "@/components/reusable/thread-input";

// In JSX (around line 103):
- <SimpleTaskInput onSubmit={handleSubmit} disabled={isStreaming} />
+ <ThreadInput
+   onSubmit={handleSubmit}
+   disabled={isStreaming}
+   workingDirectory={workingDirectory}
+ />
```

**Note**: `workingDirectory` is already available in the component (line 55):
```typescript
const workingDirectory = activeMetadata?.workingDirectory ?? "";
```

When `workingDirectory` is empty string, ThreadInput will disable triggers and show appropriate placeholder.

---

### Step 5: Delete SimpleTaskInput

**File to delete**: `src/components/simple-task/simple-task-input.tsx`

After verification that ThreadInput works correctly, delete this file. Per project guidelines: "Delete dead code aggressively. Unused code pollutes AI context."

This step is **required**, not optional.

---

## Files to Modify

| File | Action | Est. Lines |
|------|--------|------------|
| `src/components/reusable/search-input.tsx` | Add `variant` prop | +25 |
| `src/components/reusable/trigger-search-input.tsx` | Add `error` to TriggerStateInfo | +3 |
| `src/components/reusable/thread-input.tsx` | Create new | ~90 |
| `src/components/simple-task/simple-task-window.tsx` | Use ThreadInput | +3/-1 |
| `src/components/simple-task/simple-task-input.tsx` | Delete | -49 |

**Net change**: ~+70 lines, well under file size limits.

---

## Behavior Differences

| Behavior | Spotlight | ThreadInput |
|----------|-----------|-------------|
| Default action | Create new task | Respond to thread |
| @ tags display | In tray below | In dropdown above |
| Submit shortcut | Enter (simple) / Cmd+Enter (full) | Cmd+Enter only |
| History navigation | Yes (arrow up) | No (could add later) |
| Result types | Apps, calculator, actions, tasks, files | Files only |
| Styling | Large text, frosted glass | Compact, solid bg |
| Error display | In tray | In dropdown |

---

## Keyboard Behavior Specification

### ThreadInput keyboard handling

| Key | Trigger Active | Trigger Inactive | Notes |
|-----|---------------|------------------|-------|
| Cmd+Enter | **Submit** | Submit | Always submits, bypasses trigger |
| Enter | Select result | Newline | Plain Enter selects when dropdown open |
| Shift+Enter | Newline | Newline | Standard newline behavior |
| Tab | Select result | Default | Completes selection like shell |
| ArrowUp/Down | Navigate results | Default | When dropdown visible |
| Escape | Close dropdown | Default | Closes trigger |
| @ | Activate trigger | N/A | Only when enableTriggers=true |

### Edge cases

| Scenario | Expected Behavior |
|----------|-------------------|
| Type "@" then delete | Dropdown closes immediately |
| Type "@foo" then click away | Dropdown closes on blur |
| Type "@foo", select, then Cmd+Z | Undo removes inserted file path, does NOT reopen dropdown |
| No workingDirectory | @ key does nothing (triggers disabled), placeholder explains |
| workingDirectory empty string | Same as no workingDirectory |
| File search IPC error | Error shown in dropdown: "Error searching files: [message]" |
| Large repository | Debounced search, loading indicator shown |

---

## Dropdown Positioning

TriggerDropdown (in `trigger-dropdown.tsx`) already handles positioning correctly:

```typescript
// Lines 82-108: calculatePosition()
// Prefers below input, flips to above if not enough space
// In thread context (input at bottom), will flip to above
```

**Verification needed**: Confirm dropdown appears ABOVE input in thread context since input is at screen bottom.

---

## Error Handling

### File search errors

1. **TriggerDropdown already handles errors** (lines 138-144):
   ```typescript
   if (error) {
     return (
       <div className="p-3 text-red-400 text-sm">
         {EMPTY_STATES.error}: {error}
       </div>
     );
   }
   ```

2. **Error propagation path**:
   - `useTriggerAutocomplete` catches search errors and sets `triggerState.error`
   - `TriggerSearchInput` passes `error={triggerState.error}` to `TriggerDropdown`
   - `TriggerDropdown` renders error message

### Missing workingDirectory

Handled by disabling triggers entirely rather than showing an error. User sees standard textarea behavior.

---

## Testing Requirements

### Unit tests (`thread-input.test.tsx`)

1. **Rendering**:
   - Renders textarea and send button
   - Shows correct placeholder when disabled
   - Shows correct placeholder when no workingDirectory
   - Shows trigger hint in placeholder when workingDirectory present

2. **Submit behavior**:
   - Cmd+Enter submits and clears input
   - Click send button submits and clears input
   - Empty input cannot be submitted (button disabled)
   - Disabled state prevents submission

3. **Trigger behavior**:
   - Typing @ activates trigger when workingDirectory set
   - Typing @ does nothing when workingDirectory empty
   - Cmd+Enter submits even when trigger active

### UI isolation tests

1. **Keyboard navigation**:
   - ArrowDown/Up navigates trigger results
   - Tab completes selection
   - Escape closes dropdown
   - Cmd+Enter submits (not selects)

2. **Dropdown positioning**:
   - Dropdown appears above input (since input is at bottom)
   - Dropdown scrolls selected item into view

3. **Error states**:
   - Error message displays in dropdown
   - Loading indicator shows during search

### Integration tests

1. **File search**:
   - Type "@foo" -> shows matching files from workingDirectory
   - Select file -> inserts @path into input
   - Submit message with file reference -> sent to agent correctly

### Regression tests for Spotlight

1. **Verify all existing Spotlight tests still pass**
2. **Manual verification**:
   - Spotlight still shows results in tray (not dropdown)
   - Large text styling preserved
   - Frosted glass effect preserved
   - All keyboard shortcuts work

---

## Verification Checklist

### ThreadInput @ mentions
- [ ] Open a simple task window
- [ ] Verify workingDirectory is set (check thread metadata)
- [ ] Type `@` in the input
- [ ] Verify dropdown appears ABOVE input with file suggestions
- [ ] Use ArrowDown/Up to navigate
- [ ] Press Tab or Enter to select a file
- [ ] Verify file path is inserted with @ prefix
- [ ] Type more text, press Cmd+Enter
- [ ] Verify message submits with file reference

### ThreadInput without workingDirectory
- [ ] Open a task where workingDirectory is not set
- [ ] Type `@` in the input
- [ ] Verify NO dropdown appears
- [ ] Verify placeholder does NOT mention @ mentions

### ThreadInput error handling
- [ ] Simulate file search failure (e.g., disconnect IPC)
- [ ] Type `@foo`
- [ ] Verify error message appears in dropdown

### Spotlight unchanged
- [ ] Open spotlight
- [ ] Type `@`
- [ ] Verify file results appear in tray (NOT dropdown)
- [ ] Select file, verify insertion works
- [ ] Verify large text and frosted glass styling

### Edge cases
- [ ] Type "@" then immediately delete it -> dropdown closes
- [ ] Type "@foo" then click outside input -> dropdown closes
- [ ] Type "@foo", select file, press Cmd+Z -> path removed, dropdown stays closed
- [ ] Type "@foo", while dropdown open press Cmd+Enter -> submits "@foo" literally
- [ ] Very long file paths display correctly (truncation)

### Performance
- [ ] Large repository: file search doesn't block UI
- [ ] Search is debounced (no request per keystroke)
- [ ] Loading indicator appears during search

### Accessibility
- [ ] Screen reader announces dropdown opening
- [ ] Screen reader announces result count
- [ ] Keyboard-only navigation works completely
- [ ] Focus stays in input while navigating dropdown

---

## Migration Strategy

1. **Implement Step 1** (SearchInput variant) as a separate PR
   - Includes tests for both variants
   - No changes to consumer code
   - Low risk, easy to verify

2. **Implement Steps 2-4** (ThreadInput + integration) as second PR
   - Includes all ThreadInput tests
   - Includes manual verification of both contexts

3. **Implement Step 5** (delete SimpleTaskInput) in same PR as Step 4
   - Only after all tests pass
   - Prevents dead code from lingering

**Rollback**: If issues found after merge, revert the entire PR. No feature flag needed since:
- Changes are scoped to a single UI context (simple task window)
- Spotlight is unchanged
- Full verification required before merge

---

## Future Enhancements (Out of Scope)

- History navigation for ThreadInput (arrow up for previous messages)
- Shared keyboard handling hook between Spotlight and ThreadInput
- Additional trigger types (/, #) for thread context
- Ctrl+Enter support for non-Mac platforms (when cross-platform support added)
