# Plan: Simplify Onboarding Hotkey Step

## Overview

Remove the dedicated hotkey configuration step from onboarding in favor of defaulting to Command+Space. Instead, provide a subtle option on the Spotlight step to change the hotkey if desired.

## Current Flow

1. Welcome
2. Permissions
3. **Hotkey** (user explicitly sets their hotkey)
4. Spotlight (conditional - only if Command+Space selected)
5. Repository

## Proposed Flow

1. Welcome
2. Permissions
3. **Spotlight** (always shown, with subtle option to change hotkey)
4. Repository

## Implementation Steps

### 1. Remove HotkeyStep from the flow

**File:** `src/components/onboarding/OnboardingFlow.tsx`

- Remove `'hotkey'` from the step progression logic in `getNextStep()` (~line 141)
- Update `getPreviousStep()` to skip the hotkey step (~line 156)
- Remove the hotkey step case from the step rendering switch statement (~line 229)
- Keep the `hotkey` state initialized to `"Command+Space"` as the default
- Remove the "hotkey" case from `canProceed()` function

### 2. Update SpotlightStep to always show (unconditionally)

**File:** `src/components/onboarding/OnboardingFlow.tsx`

- Remove the conditional logic in `getNextStep()` that skips Spotlight step when hotkey isn't Command+Space (~lines 146-150)
- The step should always appear after Permissions

### 3. Add subtle "Change Hotkey" option to SpotlightStep

**File:** `src/components/onboarding/steps/SpotlightStep.tsx`

- Add new props to SpotlightStep:
  ```typescript
  interface SpotlightStepProps {
    hasAccessibilityPermission: boolean | null;
    onChangeHotkey: () => void;  // NEW: callback to navigate to hotkey change view
  }
  ```
- Add a subtle link/button at the bottom of the step content using the existing dotted underline button pattern:
  ```tsx
  <button
    onClick={onChangeHotkey}
    className="text-surface-300 hover:text-surface-100 underline decoration-dotted underline-offset-4 transition-colors"
  >
    Change your hotkey
  </button>
  ```
- Text like: "Don't want to use ⌘ + Space?" followed by the underline button
- Clicking it should call `onChangeHotkey` which opens the hotkey change modal

### 4. Create a hotkey change modal or inline view

**Options:**

**Option A: Modal approach (recommended)**
- Create a simple modal that appears over SpotlightStep
- Contains the HotkeyRecorder component
- "Save" and "Cancel" buttons
- If user changes to something other than Command+Space, we can skip showing Spotlight disable instructions

**Option B: Navigate to separate step**
- Temporarily navigate to a hotkey configuration view
- Return to Spotlight step after selection
- More complex navigation state

### 5. Update OnboardingFlow to handle hotkey change from SpotlightStep

**File:** `src/components/onboarding/OnboardingFlow.tsx`

- Add state for showing hotkey change modal: `const [showHotkeyModal, setShowHotkeyModal] = useState(false)`
- Pass `onChangeHotkey={() => setShowHotkeyModal(true)}` to SpotlightStep
- Render a modal when `showHotkeyModal` is true containing:
  - HotkeyRecorder component with current `hotkey` value
  - Confirm/Cancel buttons
- When hotkey is changed and saved:
  - Update `hotkey` state
  - Close modal
  - If new hotkey is NOT Command+Space, optionally show different UI on SpotlightStep (or auto-advance to Repository step)

### 6. Update SpotlightStep content based on hotkey

**File:** `src/components/onboarding/steps/SpotlightStep.tsx`

- Accept `hotkey` as a prop
- If hotkey is NOT "Command+Space":
  - Don't show Spotlight disable instructions (no conflict)
  - Show a simple confirmation message like "Your hotkey is set to [hotkey]. You're all set!"
  - The step becomes a brief confirmation rather than Spotlight-specific
- If hotkey IS "Command+Space":
  - Show current Spotlight disable flow

### 7. Rename SpotlightStep to something more generic (optional)

Since the step may no longer always be about Spotlight, consider renaming:
- `SpotlightStep.tsx` → `HotkeyConfirmationStep.tsx`
- Or keep the name since it's primarily about Spotlight conflict resolution

## Files to Modify

1. `src/components/onboarding/OnboardingFlow.tsx` - Main flow logic changes
2. `src/components/onboarding/steps/SpotlightStep.tsx` - Add change hotkey option, conditional content
3. `src/components/onboarding/HotkeyRecorder.tsx` - No changes needed (reuse as-is)

## Files to Potentially Remove

1. `src/components/onboarding/steps/HotkeyStep.tsx` - Can be deleted after migration (or keep for the modal)

## Edge Cases

1. **User changes hotkey then changes back to Command+Space** - Should re-show Spotlight disable instructions
2. **User dismisses modal without saving** - Keep previous hotkey, stay on SpotlightStep
3. **Accessibility permission not granted** - Manual steps UI should still work with change hotkey option visible

## UI Mockup

```
┌─────────────────────────────────────────────────────────┐
│                                                         │
│             Disable macOS Spotlight Shortcut            │
│                                                         │
│   ⌘ + Space is also used by macOS Spotlight.           │
│   Let's disable it so Mort can use this shortcut.      │
│                                                         │
│          [Auto-disable Spotlight Shortcut]              │
│                                                         │
│              ── Or disable manually ──                  │
│                    (manual steps)                       │
│                                                         │
│   ─────────────────────────────────────────────────    │
│                                                         │
│   Don't want to use ⌘ + Space? [Change your hotkey]    │  ← dotted underline button
│                                                         │
└─────────────────────────────────────────────────────────┘
```

## Testing Considerations

1. Verify default hotkey is saved correctly without explicit user selection
2. Test hotkey change modal opens and closes properly
3. Verify changing to non-Command+Space hotkey updates SpotlightStep content
4. Ensure onboarding completes successfully with default hotkey
5. Test back navigation still works correctly with reduced steps
