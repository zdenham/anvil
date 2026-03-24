# Spotlight Step Improvements Plan

## Summary

Improve the SpotlightStep onboarding experience with:
1. Better copy that explains Anvil replaces Spotlight
2. Consistent styling for the "change hotkey" link
3. Full-screen hotkey change UI instead of modal

## Current State

- **Title**: "Disable MacOS Spotlight" (note: should use "macOS" per Apple style)
- **Description**: Talks about conflicts, doesn't explain Anvil replaces Spotlight
- **Change hotkey button**: Uses different styling (`text-sm text-surface-400`) vs "Show manual steps" (`text-xs text-surface-500`)
- **Change hotkey flow**: Opens a modal overlay

## Changes

### 1. Update Copy in SpotlightStep.tsx

**Title change** (line 257):
- From: `"Disable MacOS Spotlight"`
- To: `"Make Anvil Your Spotlight"`

**Description change** (lines 259-261):
- From: `"⌘ + Space conflicts with macOS Spotlight. We recommend disabling Spotlight's shortcut — it's worth it."`
- To: `"Anvil replaces macOS Spotlight. Disable the native shortcut to enable Anvil."`

### 2. Style "Change Hotkey" Link to Match "Show Manual Steps"

**File**: `SpotlightStep.tsx` (lines 293-298)

Change the button styling from:
```tsx
className="text-sm text-surface-400 hover:text-surface-200 underline decoration-dotted underline-offset-4 transition-colors"
```
To:
```tsx
className="text-xs text-surface-500 hover:text-surface-400 underline decoration-dotted underline-offset-4 transition-colors"
```

**Text change**:
- From: `"Don't want ⌘ + Space? Change hotkey"`
- To: `"Change Anvil hotkey"`

### 3. Replace Modal with Full-Screen Hotkey Change View

**File**: `OnboardingFlow.tsx`

Instead of showing a modal when editing the hotkey, we'll render a completely different full-screen UI that replaces the entire onboarding flow content.

**Variable renames** (no longer a modal):
- `showHotkeyModal` → `isEditingHotkey`
- `handleOpenHotkeyModal` → `handleStartHotkeyEdit`
- `handleCancelHotkeyModal` → `handleCancelHotkeyEdit`
- Remove `X` import from lucide-react (no longer needed)

**Implementation**:

1. When `isEditingHotkey` is true, render a full-screen hotkey change UI instead of the normal step content
2. The UI will include:
   - A title "Change Anvil Hotkey"
   - The HotkeyRecorder component
   - Back button (returns to spotlight step without saving)
   - Save button (saves and returns to spotlight step)
3. Hide the normal step navigation (progress dots, Back/Continue buttons) when in hotkey change mode

**Code changes**:

In the return statement, wrap the main content in a conditional:

```tsx
{isEditingHotkey ? (
  // Full-screen hotkey change UI
  <div className="min-h-screen w-full bg-surface-900 p-6">
    <div className="space-y-2">
      <h2 className="text-2xl font-bold text-surface-100 font-mono">
        Change Anvil Hotkey
      </h2>
      <p className="text-surface-300">
        Choose a keyboard shortcut to access Anvil from anywhere.
      </p>
    </div>

    <HotkeyRecorder
      defaultHotkey={pendingHotkey}
      onHotkeyChanged={setPendingHotkey}
      autoFocus={true}
    />

    {/* Fixed bottom buttons */}
    <div className="fixed bottom-6 left-6 z-10">
      <Button variant="ghost" onClick={handleCancelHotkeyEdit}>
        ← Back
      </Button>
    </div>

    <div className="fixed bottom-6 right-6 z-10">
      <Button variant="light" onClick={handleSaveHotkey} disabled={!pendingHotkey}>
        Save Hotkey ↵
      </Button>
    </div>
  </div>
) : (
  // Normal onboarding flow UI (existing code)
  ...
)}
```

## Files to Modify

1. `src/components/onboarding/steps/SpotlightStep.tsx`
   - Update title copy
   - Update description copy
   - Update "change hotkey" button text and styling

2. `src/components/onboarding/OnboardingFlow.tsx`
   - Replace modal with full-screen conditional UI
   - Remove the modal JSX at the bottom of the file

## Implementation Steps

1. Edit `SpotlightStep.tsx`:
   - Line 257: Change title to "Make Anvil Your Spotlight"
   - Lines 259-261: Change description to "Anvil replaces macOS Spotlight. Disable the native shortcut to enable Anvil."
   - Lines 293-298: Update button text to "Change Anvil hotkey" and styling to match "Show manual steps"

2. Edit `OnboardingFlow.tsx`:
   - Rename `showHotkeyModal` → `isEditingHotkey`
   - Rename `handleOpenHotkeyModal` → `handleStartHotkeyEdit`
   - Rename `handleCancelHotkeyModal` → `handleCancelHotkeyEdit`
   - Remove `X` import from lucide-react
   - Wrap the entire return content in a conditional based on `isEditingHotkey`
   - When true, render the full-screen hotkey change UI
   - When false, render the existing onboarding flow
   - Remove the modal JSX (lines 355-389)
