# Skip Spotlight & Accessibility Onboarding Steps

## Problem

The onboarding flow currently has 4 mandatory steps:
1. Welcome
2. Permissions (accessibility + documents access)
3. Spotlight (disable macOS Spotlight shortcut)
4. Repository

Steps 2 and 3 create friction for new users. The accessibility permission and Spotlight shortcut disabling should be **opt-in** features accessible from Settings, not mandatory onboarding gates.

## Goal

- Remove the "Permissions" and "Spotlight" steps from onboarding (steps 2 and 3)
- Onboarding becomes: **Welcome → Repository → Complete**
- Move accessibility and Spotlight setup to the Settings page as opt-in sections
- Remove the post-onboarding `PermissionsPrompt` gate in `App.tsx` (which currently blocks the app if accessibility isn't granted)

## Phases

- [ ] Simplify onboarding flow to Welcome → Repository → Complete
- [ ] Remove the post-onboarding accessibility gate from App.tsx
- [ ] Add Spotlight and Accessibility settings sections to Settings page

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Design

### Phase 1: Simplify onboarding

**File:** `src/components/onboarding/OnboardingFlow.tsx`

- Remove `'permissions'` and `'spotlight'` from `OnboardingStepName`
- Update step flow: `'welcome'` → `'repository'` (no intermediate steps)
- Remove `accessibilityGranted` state and `handleAccessibilityGranted`
- Remove `isEditingHotkey`, `pendingHotkey`, and hotkey editing UI
- Remove imports of `SpotlightStep`, `PermissionsStep`
- `completeSetup` still saves `hotkey` (keep default "Command+Space") and creates repo
- Step count goes from 4 to 2; update `getStepProgress`
- Update `canProceed` — permissions step check removed
- Update `getButtonText` — no more "It's disabled" variant

**Files to potentially delete or mark unused:**
- `src/components/onboarding/steps/SpotlightStep.tsx` — no longer used in onboarding (but its logic moves to Settings)
- `src/components/onboarding/steps/PermissionsStep.tsx` — same

### Phase 2: Remove accessibility gate from App.tsx

**File:** `src/App.tsx`

Currently after onboarding, `App.tsx` checks accessibility permission and shows `PermissionsPrompt` if not granted. This blocks the entire app.

- Remove the `"permissions-prompt"` state from `AppState`
- Remove the `spotlightShortcutCommands.checkAccessibilityPermission()` check in `checkInitialState`
- Remove the `PermissionsPrompt` render case
- After onboarding, go straight to `"ready"`
- Remove import of `PermissionsPrompt`

**File to potentially remove:** `src/components/PermissionsPrompt.tsx` (check if used elsewhere first)

### Phase 3: Settings page — Spotlight & Accessibility sections

**File:** `src/components/main-window/settings-page.tsx`

Add two new settings sections:

1. **SpotlightSettings** — new file `src/components/main-window/settings/spotlight-settings.tsx`
   - Shows current hotkey
   - "Disable macOS Spotlight shortcut" button (reuse logic from `SpotlightStep`)
   - "Change hotkey" option (reuse `HotkeyRecorder`)

2. **PermissionsSettings** — new file `src/components/main-window/settings/permissions-settings.tsx`
   - Shows accessibility permission status (granted/not granted)
   - "Grant Accessibility Access" button if not granted
   - Shows documents access status
   - Reuse `PermissionsContent` component or its logic

Add both to `SettingsPage` render, between `HotkeySettings` and `SkillsSettings`.

## Key files

| File | Role |
|------|------|
| `src/components/onboarding/OnboardingFlow.tsx` | Main onboarding flow (simplify) |
| `src/components/onboarding/steps/SpotlightStep.tsx` | Spotlight disable UI (move to settings) |
| `src/components/onboarding/steps/PermissionsStep.tsx` | Permissions UI (move to settings) |
| `src/components/permissions/PermissionsContent.tsx` | Shared permissions UI component |
| `src/App.tsx` | App state machine (remove permissions gate) |
| `src/components/PermissionsPrompt.tsx` | Post-onboarding permissions prompt (remove) |
| `src/components/main-window/settings-page.tsx` | Settings page (add new sections) |
| `src/components/main-window/settings/hotkey-settings.tsx` | Existing hotkey settings (reference) |
| `src/components/onboarding/HotkeyRecorder.tsx` | Hotkey recorder (reuse in settings) |
