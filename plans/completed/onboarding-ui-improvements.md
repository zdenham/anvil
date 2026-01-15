# Onboarding Flow UI Improvements Plan

## Overview
This plan addresses user feedback on the onboarding flow, broken down into actionable tasks optimized for parallel execution.

## Issues Identified
1. **Layout Issues**: Card doesn't fill window, causing white borders
2. **Step 1 Content**: Missing Mort logo, incorrect welcome message and button styling
3. **Step 2 Problems**: Screen overflow, verbose copy, color conflicts in hotkey picker
4. **Repository Step**: Incorrect copy messaging

## Task Breakdown (Optimized for Parallel Execution)

### Group A: Layout & Structure (Can run in parallel)

#### Task A1: Fix Card Layout - "The onboarding card does not take up the whole window so there is a big white border around, I don't like it"
- **Original Feedback**: Card doesn't fill window, causing unwanted white borders
- **File**: `src/components/onboarding/OnboardingFlow.tsx`
- **Changes**:
  - Remove `max-w-2xl` constraint on Card that prevents full width
  - Change container to use full width/height without padding
  - Remove padding that creates white borders around the card
  - Update: `<div className="flex items-center justify-center min-h-screen w-full bg-surface-50 p-4">`
  - To: `<div className="min-h-screen w-full bg-surface-50">`
  - Update: `<Card className="w-full max-w-2xl">`
  - To: `<Card className="w-full h-screen">`

#### Task A2: Add Mort Logo Asset - "The mort logo should be displayed at the top of the first welcome screen"
- **Original Feedback**: Need Mort logo displayed on first welcome screen
- **Files**:
  - Add logo file to `src/assets/` (need logo file from user)
  - Update any import statements needed
- **Dependencies**: Requires logo file from user

### Group B: Step 1 Welcome Screen (Can run in parallel with A)

#### Task B1: Update Step 1 Content - "Step 1 should show the mort logo and say 'hi, I'm mort' I can help you orchestrate an army of parallel claude codes from your macOS spotlight"
- **Original Feedback**: Replace current welcome content with specific Mort introduction
- **File**: `src/components/onboarding/steps/WelcomeStep.tsx`
- **Changes**:
  - Add Mort logo at top of welcome screen
  - Change heading from "Welcome to Mort" to "Hi, I'm Mort"
  - Update copy to exactly: "I can help you orchestrate an army of parallel Claude codes from your macOS spotlight."
  - Remove existing bullet points and secondary descriptive copy
  - Simplify layout structure to focus on the new message

#### Task B2: Update Continue Button - "The continue button should be the light variant white background dark text and the copy should be 'begin'"
- **Original Feedback**: Change button styling and text specifically for Step 1
- **File**: `src/components/onboarding/OnboardingFlow.tsx` (CardFooter section)
- **Changes**:
  - Change button text from "Continue" to "Begin" for Step 1 only
  - Switch to light variant button (white background, dark text)
  - Keep other steps using current button styling
  - May need to add new button variant to `Button.tsx` if light variant doesn't exist

### Group C: Step 2 Hotkey Screen (Can run in parallel with A & B)

#### Task C1: Fix Step 2 Overflow and Verbose Copy - "The second screen is way too tall (overflows the window) and the copy too verbose. We don't need the call out section. we don't need the second copy section. lets just tighten this up quite a bit"
- **Original Feedback**: Screen overflows window and has too much content
- **File**: `src/components/onboarding/steps/HotkeyStep.tsx`
- **Changes**:
  - Remove the green recommendation callout box (`bg-surface-700` section with "We recommend keeping ⌘ + Space...")
  - Remove secondary copy section at bottom (the detailed explanation with bullet points)
  - Reduce vertical spacing to prevent window overflow
  - Keep only: title, hotkey recorder, and minimal essential instruction
  - Ensure content fits within viewport height

#### Task C2: Fix Hotkey Picker Active Color - "Also the 'active' color for the keyboard picker background blends in with the buttons, its too dark, can we pick a different color that is not the same as the key colors?"
- **Original Feedback**: Active state color conflicts with keyboard key colors
- **File**: `src/components/onboarding/HotkeyRecorder.tsx`
- **Changes**:
  - Change active/recording background color to contrast better with key button colors
  - Current problem: `state === "recording" && "border-accent-500 bg-accent-900/20"` blends with key colors
  - Solution: Use a different color family (blue, green, purple) that clearly distinguishes from key backgrounds
  - Update: `bg-accent-900/20` to `bg-blue-900/20` or `bg-green-900/20`
  - Update: `border-accent-500` to `border-blue-500` or `border-green-500`

### Group D: Step 4 Repository Screen (Can run in parallel with others)

#### Task D1: Fix Repository Step Copy - "The repository page copy is off, it should say something like, this helps mort understand where to write code, we don't need the secondary copy at the bottom"
- **Original Feedback**: Replace current copy with simpler, more focused message
- **File**: `src/components/onboarding/steps/RepositoryStep.tsx`
- **Changes**:
  - Change main descriptive copy to: "This helps Mort understand where to write code"
  - Remove the secondary copy section at bottom (the "We'll look for:" bullet point section)
  - Keep the repository selection functionality unchanged
  - Maintain the title "Select Your First Repository"

### Group E: Button Component Enhancement (Can run in parallel)

#### Task E1: Add Light Button Variant - Supporting "The continue button should be the light variant white background dark text"
- **Original Feedback**: Need light variant button for Step 1 "Begin" button
- **File**: `src/components/reusable/Button.tsx`
- **Changes**:
  - Check if `light` variant exists in current Button component
  - If not, add new variant with white background and dark text
  - Example implementation: `light: "bg-white text-surface-900 hover:bg-surface-100 border border-surface-300"`
  - Ensure proper hover states and accessibility contrast

## Execution Strategy

### Phase 1: Parallel Development (All groups can start simultaneously)
- **Team Member 1**: Group A (Layout fixes) + Group E (Button variant)
- **Team Member 2**: Group B (Step 1 improvements)
- **Team Member 3**: Group C (Step 2 improvements)
- **Team Member 4**: Group D (Repository step copy)

### Phase 2: Integration & Testing
- Test each step individually
- Test full flow end-to-end
- Verify no overflow issues on different screen sizes
- Test button functionality and styling

### Dependencies
- **Logo Asset**: Task A2 requires Mort logo file from user
- **Button Variant**: Task B2 depends on Task E1 if light variant doesn't exist

### Files Modified
1. `src/components/onboarding/OnboardingFlow.tsx` - Layout and button logic
2. `src/components/onboarding/steps/WelcomeStep.tsx` - Step 1 content
3. `src/components/onboarding/steps/HotkeyStep.tsx` - Step 2 simplification
4. `src/components/onboarding/HotkeyRecorder.tsx` - Color fixes
5. `src/components/onboarding/steps/RepositoryStep.tsx` - Copy updates
6. `src/components/reusable/Button.tsx` - Light variant (if needed)
7. `src/assets/` - Logo asset (requires user input)

### Testing Checklist
- [ ] Card fills entire window with no white borders
- [ ] Step 1 shows Mort logo and correct welcome message
- [ ] "Begin" button has light styling on Step 1
- [ ] Step 2 doesn't overflow window height
- [ ] Hotkey picker active state uses different color than keys
- [ ] Repository step has simplified, focused copy
- [ ] Full onboarding flow works end-to-end
- [ ] Responsive behavior works on different screen sizes

## Notes
- All color changes should maintain accessibility contrast ratios
- Test on various screen sizes to ensure no overflow
- Preserve existing functionality while improving UI/UX
- Logo asset will need to be provided by user for Task A2