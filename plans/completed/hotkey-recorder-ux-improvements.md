# Hotkey Recorder UX Improvements

## Problem

Users are confused when the hotkey recorder is not focused because:
1. There's no clear indication that they need to click/focus the recorder before it will accept input
2. The visual difference between focused and unfocused states is too subtle (just slightly different greys)
3. No text feedback tells users what action is expected from them

## Current State

The hotkey recorder (`src/components/onboarding/HotkeyRecorder.tsx`) has three states:
- **idle**: Waiting for input
- **recording**: User pressed modifier keys, waiting for a non-modifier key
- **locked**: Hotkey has been set

Focus is tracked via `isFocused` state, but the visual feedback is minimal:
- Focused: `border-surface-500 bg-surface-700`
- Unfocused: `border-surface-600 bg-surface-800`

## Proposed Solution

### 1. "Click to Start Recording" Overlay

When the recorder is **not focused** and in **idle state**, display a semi-transparent overlay button that says "Click to start recording". Clicking anywhere on the recorder will focus it (current behavior) and dismiss the overlay.

**Implementation:**
- Add a conditional overlay `div` that appears when `!isFocused && state === "idle"`
- Overlay should use a gaussian blur effect (`backdrop-blur-sm`) to blur the recorder contents behind it
- Include a button-like element with "Click to start recording" text
- Clicking the overlay triggers focus on the container

### 2. More Lively Focused State Color

Replace the grey focused state with a more noticeable color to clearly indicate the recorder is active and waiting for input.

**Implementation:**
- Change focused idle state from `border-surface-500 bg-surface-700` to use the `secondary` color (muted teal)
- Use `border-secondary-500 bg-secondary-900/20` to match the simple task input focus style
- `secondary-500` is `#5c857e` (turquoise/teal vibe)
- This creates a clear visual progression:
  - Unfocused (grey) → Focused/Waiting (teal) → Recording (blue) → Locked (green)

### 3. Status Text Indicator

Add text below or above the recorder that describes the current state and expected user action.

**Implementation:**
Add a status text element that shows:
- **Unfocused**: (handled by overlay)
- **Focused + Idle**: "Press modifier keys (⌘ ⌃ ⌥ ⇧) then a letter or key"
- **Recording**: "Now press a key to complete the shortcut..."
- **Locked**: "Hotkey set! Release all keys to continue"

## Implementation Steps

1. Add overlay component for unfocused state with "Click to start recording" button
2. Update focused idle state styling to use a more vibrant color (suggest purple or cyan)
3. Add status text element below the recorder
4. Update test file if needed to account for new UI elements

## Files to Modify

- `src/components/onboarding/HotkeyRecorder.tsx` - Main component changes
- `src/components/onboarding/hotkey-recorder.test.tsx` - Update tests if needed

## Visual Mockup (Conceptual)

```
┌─────────────────────────────────────────────────────┐
│  Unfocused State (grey, with overlay):              │
│  ┌───────────────────────────────────────────────┐  │
│  │ ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ │  │
│  │ ░░░░░ [Click to start recording] ░░░░░░░░░░░ │  │
│  │ ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ │  │
│  └───────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────┐
│  Focused Idle State (teal border):                  │
│  ┌───────────────────────────────────────────────┐  │
│  │    [⇧] [⌃] [⌥] [⌘]  +  [ ? ]                  │  │
│  └───────────────────────────────────────────────┘  │
│  Press modifier keys (⌘ ⌃ ⌥ ⇧) then a letter/key   │
└─────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────┐
│  Recording State (blue border):                     │
│  ┌───────────────────────────────────────────────┐  │
│  │    [⇧] [⌃] [⌥] [⌘]  +  [ ? ]                  │  │
│  └───────────────────────────────────────────────┘  │
│  Now press a key to complete the shortcut...        │
└─────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────┐
│  Locked State (green border):                       │
│  ┌───────────────────────────────────────────────┐  │
│  │    [⇧] [⌃] [⌥] [⌘]  +  [Space]                │  │
│  └───────────────────────────────────────────────┘  │
│  ✓ Hotkey set! Release all keys to continue         │
└─────────────────────────────────────────────────────┘
```

## Considerations

- The overlay should not interfere with the existing click-to-focus behavior
- The `secondary-500` teal color is already used in the app's design system for focus states
- Status text should be concise and not overly prominent
- Consider whether status text should be optional via prop for different use contexts (settings vs onboarding)
