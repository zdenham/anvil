# Sub-Plan 06: ThreadInput Integration

## Overview
Integrate mode switching keyboard shortcut (Shift+Tab) and ModeIndicator display into the ThreadInput component.

## Dependencies
- **02-entity-types-and-store.md** - Requires store
- **03-ui-components.md** - Requires ModeIndicatorWithShortcut and useModeKeyboard hook

## Can Run In Parallel With
- **05-simple-task-integration.md** - Can run in parallel after dependencies are met

## Scope
- Add threadId prop to ThreadInput
- Integrate useModeKeyboard hook for Shift+Tab handling
- Display ModeIndicatorWithShortcut in input area

## Files Involved

### Modified Files
| File | Change |
|------|--------|
| `src/components/reusable/thread-input.tsx` | Add threadId prop, integrate mode switching |

### Test Files
| File | Lines |
|------|-------|
| `src/components/reusable/thread-input.ui.test.tsx` | ~120 |

## Implementation Details

### Step 1: Update ThreadInput

**File:** `src/components/reusable/thread-input.tsx`

Add imports:
```typescript
import { useModeKeyboard } from "@/components/simple-task/use-mode-keyboard";
import { ModeIndicatorWithShortcut } from "@/components/simple-task/mode-indicator";
```

Update props interface:
```typescript
interface ThreadInputProps {
  threadId: string;  // NEW
  onSubmit: (prompt: string) => void;
  disabled?: boolean;
  workingDirectory?: string;
  placeholder?: string;
}
```

Inside component, add the hook:
```typescript
const { handleKeyDown: handleModeKeyDown, currentMode } = useModeKeyboard({
  threadId,
  enabled: !disabled,
});
```

Modify handleKeyDown to chain both handlers:
```typescript
const handleKeyDown = useCallback(
  (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Check for mode switching first
    handleModeKeyDown(e);
    if (e.defaultPrevented) return;

    // Existing Cmd+Enter handling...
    if (e.key === "Enter" && e.metaKey) {
      e.preventDefault();
      e.stopPropagation();
      handleSubmit();
      return;
    }
  },
  [handleModeKeyDown, handleSubmit]
);
```

Add ModeIndicator to the JSX (before the Send button):
```typescript
<div className="flex items-center gap-2 self-end">
  <ModeIndicatorWithShortcut mode={currentMode} />
  <button ...>Send</button>
</div>
```

## Tests Required

### thread-input.ui.test.tsx
- Test mode indicator displays current mode
- Test shortcut hint is shown
- Test Shift+Tab cycles through all modes
- Test Cmd+Enter still submits
- Test mode switching disabled when input is disabled
- Test mode persists per thread
- Test different threadId shows default mode

```typescript
describe("ThreadInput with Mode Switching", () => {
  describe("mode indicator display", () => {
    it("shows mode indicator with current mode", () => {
      render(<ThreadInput {...defaultProps} />);
      expect(screen.getByRole("status")).toHaveTextContent("Normal");
    });

    it("shows shortcut hint", () => {
      render(<ThreadInput {...defaultProps} />);
      expect(screen.getByText("Shift+Tab")).toBeInTheDocument();
    });
  });

  describe("keyboard interaction", () => {
    it("cycles through all modes", () => {
      render(<ThreadInput {...defaultProps} />);
      const textarea = screen.getByRole("textbox");
      const indicator = screen.getByRole("status");

      expect(indicator).toHaveTextContent("Normal");
      fireEvent.keyDown(textarea, { key: "Tab", shiftKey: true });
      expect(indicator).toHaveTextContent("Plan");
      fireEvent.keyDown(textarea, { key: "Tab", shiftKey: true });
      expect(indicator).toHaveTextContent("Auto");
      fireEvent.keyDown(textarea, { key: "Tab", shiftKey: true });
      expect(indicator).toHaveTextContent("Normal");
    });

    it("does not interfere with Cmd+Enter submit", () => {
      render(<ThreadInput {...defaultProps} />);
      const textarea = screen.getByRole("textbox");
      fireEvent.change(textarea, { target: { value: "test message" } });
      fireEvent.keyDown(textarea, { key: "Enter", metaKey: true });
      expect(mockOnSubmit).toHaveBeenCalledWith("test message");
    });
  });
});
```

## Verification
- [ ] `pnpm tsc --noEmit` passes
- [ ] `pnpm test:ui src/components/reusable/thread-input` passes
- [ ] Shift+Tab cycles modes in input
- [ ] Mode indicator visible with shortcut hint
- [ ] Cmd+Enter still submits

## Estimated Time
~30 minutes

## Notes
- Need to check if ThreadInput already has a handleKeyDown that needs to be merged
- May need to update callers of ThreadInput to pass threadId prop

## Additional Implementation Steps

### Step 2: Update Caller to Pass threadId

**File:** `src/components/simple-task/simple-task-window.tsx`

ThreadInput is used within SimpleTaskWindow. Update the call site to pass the required `threadId` prop:

```typescript
<ThreadInput
  threadId={threadId}
  onSubmit={handleSubmit}
  disabled={isStreaming}
  workingDirectory={workingDirectory}
  placeholder="Ask a follow-up..."
/>
```

Ensure the `threadId` is available in the component (it should already be passed via props or route params).

### Handling Shift+Tab Conflict with Trigger Dropdown

If ThreadInput uses a trigger dropdown (e.g., for command completion or mentions), there may be a conflict with the Shift+Tab shortcut when the dropdown is open:

1. **Check if dropdown is open** before handling Shift+Tab in `useModeKeyboard`
2. **Option A:** Pass a `dropdownOpen` state to `useModeKeyboard` and skip mode cycling when open
3. **Option B:** In the `handleKeyDown` chain, check for dropdown open state before calling `handleModeKeyDown`

Example implementation:
```typescript
const handleKeyDown = useCallback(
  (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Skip mode switching if trigger dropdown is open (Shift+Tab navigates dropdown)
    if (triggerState.isOpen && e.shiftKey && e.key === "Tab") {
      return; // Let dropdown handle it
    }

    // Check for mode switching
    handleModeKeyDown(e);
    if (e.defaultPrevented) return;

    // Existing handlers...
  },
  [triggerState.isOpen, handleModeKeyDown, handleSubmit]
);
```

If using a ref-based dropdown state, access it via `triggerRef.current?.isOpen` or similar pattern.
