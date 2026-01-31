# New Thread Input Missing Outline and Cursor Fix

## Problem Description

When creating a new thread in mortician and the input is selected/focused:
1. **No visible focus outline/ring** - The input doesn't show any visual indication it's focused
2. **No visible cursor (caret)** - The text cursor is not visible in the input

This creates a poor user experience as users can't tell if the input is active or where they're typing.

## Root Cause Analysis

The issue stems from the styling cascade through nested components:

```
ThreadInput (wrapper)
    ↓
TriggerSearchInput (handles trigger state)
    ↓
SearchInput (renders actual textarea)
```

### SearchInput Component (`src/components/reusable/search-input.tsx`)

The core textarea in `SearchInput` at line 143-156 has:

```tsx
className={cn(
  "block w-full resize-none",
  styles.padding,
  styles.background,
  "text-white font-light",
  isExpanded ? styles.expandedFontSize : styles.fontSize,
  "focus:outline-none",  // <-- Removes default outline
  "border border-surface-700/50",
  // ...
  className
)}
```

**Issues:**
- `focus:outline-none` removes the browser's default focus indicator
- **No replacement focus ring** (`focus:ring-*`) is provided
- **No focus border change** (`focus:border-*`) is applied
- **No explicit caret color** (`caret-*`) is set - the white caret blends with the light text

### ThreadInput Component (`src/components/reusable/thread-input.tsx`)

At line 141, ThreadInput passes className to TriggerSearchInput:

```tsx
className="min-h-[40px] max-h-[120px] flex-1 border-surface-600 focus:border-secondary-500 disabled:opacity-60 disabled:cursor-not-allowed placeholder:text-surface-500"
```

**Issues:**
- Has `focus:border-secondary-500` but this is passed as className and must merge properly
- **Missing `focus:ring-*` classes** for a visible focus ring
- **Missing `caret-*` classes** for cursor visibility

### Comparison with Working Input

The standard `Input` component (`src/components/reusable/Input.tsx`) shows proper patterns:

```tsx
"focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-surface-950"
```

This correctly:
1. Removes default outline
2. Adds a focus ring
3. Sets ring color

## Solution

### Fix 1: SearchInput - Add focus ring and caret color (Primary Fix)

**File:** `src/components/reusable/search-input.tsx`
**Location:** Lines 143-156

Change the textarea className to include focus ring and caret styling:

```tsx
className={cn(
  "block w-full resize-none",
  styles.padding,
  styles.background,
  "text-white font-light",
  isExpanded ? styles.expandedFontSize : styles.fontSize,
  "focus:outline-none focus:ring-1 focus:ring-secondary-500/50 focus:border-secondary-500",  // Added ring
  "caret-secondary-400",  // Explicit cursor color
  "border border-surface-700/50",
  hasContentBelow
    ? `${styles.borderRadiusTop} border-b-0`
    : styles.borderRadius,
  className
)}
```

**Changes:**
- Add `focus:ring-1 focus:ring-secondary-500/50` - Adds a subtle focus ring
- Add `focus:border-secondary-500` - Border color change on focus
- Add `caret-secondary-400` - Makes the cursor visible with a teal color that contrasts with text

### Fix 2: ThreadInput - Ensure ring styling (Optional Enhancement)

**File:** `src/components/reusable/thread-input.tsx`
**Location:** Line 141

Update the className to be consistent:

```tsx
className="min-h-[40px] max-h-[120px] flex-1 border-surface-600 focus:border-secondary-500 focus:ring-1 focus:ring-secondary-500/50 disabled:opacity-60 disabled:cursor-not-allowed placeholder:text-surface-500"
```

## Implementation Steps

1. [ ] Edit `src/components/reusable/search-input.tsx` line 149:
   - Change `"focus:outline-none"` to `"focus:outline-none focus:ring-1 focus:ring-secondary-500/50 focus:border-secondary-500"`
   - Add `"caret-secondary-400"` after the text styling

2. [ ] Test in the app:
   - Create a new thread
   - Click on the input
   - Verify focus ring appears
   - Verify cursor (caret) is visible when typing

3. [ ] Test other inputs that use SearchInput (spotlight, etc.) to ensure no regressions

## Color Justification

Using `secondary-500` (muted teal) for focus styling because:
- It's the established "AI/assistant" accent color per the design system
- It matches the existing `focus:border-secondary-500` intent in ThreadInput
- Using 50% opacity (`secondary-500/50`) keeps it subtle
- `caret-secondary-400` is slightly lighter for better visibility against the white text

## Alternative Colors (if teal doesn't look right)

- `accent-500` - Near-white, high contrast
- `surface-400` - Subtle gray
- `success-500` - Green (might imply validation state)

## Files to Modify

- `src/components/reusable/search-input.tsx` (primary)
- `src/components/reusable/thread-input.tsx` (optional, for consistency)
