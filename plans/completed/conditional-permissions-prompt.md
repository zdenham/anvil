# Conditional Permissions Prompt for Onboarded Users

## Overview

Show a standalone permissions screen to already onboarded users who haven't granted document or accessibility permissions. This screen displays instead of the main app and can be skipped.

## Problem

Users who completed onboarding may not have granted all permissions (especially accessibility, which is optional during onboarding). Currently, there's no way to prompt them again without going through the full onboarding flow.

## Solution

Add a permissions gate in `App.tsx` that checks permissions after confirming the user is onboarded, but before rendering the main app. If either document or accessibility permissions are missing, display a standalone permissions prompt that reuses components from onboarding.

## User Flow

```
App Start
    ↓
Check onboarded? → No → OnboardingFlow
    ↓ Yes
Check permissions (documents + accessibility)
    ↓
Both granted? → Yes → Bootstrap → MainWindowLayout
    ↓ No
Show PermissionsPrompt (skippable)
    ↓
User grants perms OR clicks "Skip"
    ↓
Bootstrap → MainWindowLayout
```

**Critical**: The permissions prompt must display BEFORE any bootstrap attempt. Bootstrap (hydrating entities, setting up listeners, resizing window) should only occur after the user either grants permissions or skips the prompt. This prevents unnecessary initialization if the user needs to grant permissions first.

## Component Architecture

### Option A: Extract Shared Permission UI Components (Recommended)

Refactor `PermissionsStep.tsx` to separate the permission item UI from the onboarding step wrapper:

```
src/components/permissions/
├── permission-item.tsx          # Single permission row (checkmark, button, status)
├── permission-list.tsx          # List of permissions with shared logic
└── use-permission-status.ts     # Hook for checking/polling permission status

src/components/onboarding/steps/
└── PermissionsStep.tsx          # Uses permission-list, adds onboarding-specific wrapper

src/components/
└── PermissionsPrompt.tsx        # Standalone prompt using permission-list
```

### Option B: Minimal Changes

Create a new `PermissionsPrompt` component that duplicates some UI from `PermissionsStep` but with:
- Skip button
- Different copy/layout for returning users
- Standalone fullscreen styling

**Recommendation**: Option A is cleaner for maintenance but Option B is faster to implement. Given the permission UI is relatively simple, Option B may be acceptable.

## Files to Modify

| File | Action |
|------|--------|
| `src/App.tsx` | Add permissions check state and conditional rendering |
| `src/components/PermissionsPrompt.tsx` | **New**: Standalone permissions prompt component |
| `src/lib/tauri-commands.ts` | Already has required permission commands |

If going with Option A (refactor):

| File | Action |
|------|--------|
| `src/components/permissions/permission-item.tsx` | **New**: Reusable permission row |
| `src/components/permissions/permission-list.tsx` | **New**: Reusable permission list |
| `src/components/permissions/use-permission-status.ts` | **New**: Permission status hook |
| `src/components/onboarding/steps/PermissionsStep.tsx` | Refactor to use shared components |

## Implementation Steps

### Step 1: Create PermissionsPrompt Component

Create `src/components/PermissionsPrompt.tsx`:

```typescript
import { useState, useEffect, useCallback } from "react";
import { ExternalLink } from "lucide-react";
import { Button } from "./reusable/Button";
import { permissionCommands, spotlightShortcutCommands } from "@/lib/tauri-commands";

interface PermissionsPromptProps {
  onComplete: () => void;
  missingDocuments: boolean;
  missingAccessibility: boolean;
}

export const PermissionsPrompt = ({
  onComplete,
  missingDocuments,
  missingAccessibility,
}: PermissionsPromptProps) => {
  const [documentsGranted, setDocumentsGranted] = useState(!missingDocuments);
  const [accessibilityGranted, setAccessibilityGranted] = useState(!missingAccessibility);
  const [isCheckingDocuments, setIsCheckingDocuments] = useState(false);
  const [isCheckingAccessibility, setIsCheckingAccessibility] = useState(false);

  // Handlers similar to PermissionsStep.tsx
  const handleRequestDocuments = useCallback(async () => {
    setIsCheckingDocuments(true);
    try {
      const granted = await permissionCommands.requestDocumentsAccess();
      if (granted) setDocumentsGranted(true);
    } finally {
      setIsCheckingDocuments(false);
    }
  }, []);

  const handleRequestAccessibility = useCallback(async () => {
    setIsCheckingAccessibility(true);
    try {
      await spotlightShortcutCommands.requestAccessibilityPermission();
      // Poll for permission status
      const pollInterval = setInterval(async () => {
        const granted = await spotlightShortcutCommands.checkAccessibilityPermission();
        if (granted) {
          setAccessibilityGranted(true);
          clearInterval(pollInterval);
        }
      }, 1000);
      setTimeout(() => clearInterval(pollInterval), 30000);
    } finally {
      setIsCheckingAccessibility(false);
    }
  }, []);

  const allGranted = documentsGranted && accessibilityGranted;

  return (
    <div className="min-h-screen w-full bg-surface-900 p-6 flex flex-col">
      <div className="flex-1">
        <h2 className="text-2xl font-bold text-surface-100 font-mono mb-2">
          Permissions Needed
        </h2>
        <p className="text-surface-300 mb-6">
          Anvil needs some permissions to work properly. You can grant them now or skip for later.
        </p>

        <div className="space-y-4">
          {/* Documents permission - same UI as PermissionsStep */}
          {missingDocuments && (
            <PermissionRow
              label="Documents access"
              description="Required to store task data"
              granted={documentsGranted}
              onRequest={handleRequestDocuments}
              isChecking={isCheckingDocuments}
              buttonLabel="Open Documents folder"
            />
          )}

          {/* Accessibility permission */}
          {missingAccessibility && (
            <PermissionRow
              label="Accessibility access"
              description="Enables global hotkey features"
              granted={accessibilityGranted}
              onRequest={handleRequestAccessibility}
              isChecking={isCheckingAccessibility}
              buttonLabel="Open Accessibility settings"
            />
          )}
        </div>
      </div>

      {/* Bottom buttons */}
      <div className="flex justify-between pt-6">
        <Button variant="ghost" onClick={onComplete}>
          Skip for now
        </Button>
        <Button
          variant="light"
          onClick={onComplete}
          disabled={!allGranted && missingDocuments && !documentsGranted}
        >
          {allGranted ? "Continue" : "Continue anyway"}
        </Button>
      </div>
    </div>
  );
};

// Helper component for permission rows (could be extracted)
interface PermissionRowProps {
  label: string;
  description: string;
  granted: boolean;
  onRequest: () => void;
  isChecking: boolean;
  buttonLabel: string;
}

const PermissionRow = ({
  label,
  description,
  granted,
  onRequest,
  isChecking,
  buttonLabel,
}: PermissionRowProps) => (
  <div className="flex items-start gap-3">
    {granted ? (
      <span className="text-green-400 font-mono">✓</span>
    ) : (
      <span className="text-surface-400 font-mono">○</span>
    )}
    <div>
      {granted ? (
        <span className="text-surface-200 font-medium">{label} granted</span>
      ) : (
        <>
          <span className="text-surface-200 font-medium">{label}</span>
          <p className="text-sm text-surface-500">{description}</p>
          <button
            onClick={onRequest}
            disabled={isChecking}
            className="mt-1 text-surface-300 hover:text-surface-100 underline decoration-dotted underline-offset-4 inline-flex items-center gap-1 transition-colors text-sm disabled:opacity-50"
          >
            {isChecking ? "Requesting..." : buttonLabel}
            <ExternalLink className="w-3 h-3" />
          </button>
        </>
      )}
    </div>
  </div>
);
```

### Step 2: Update App.tsx

Modify `src/App.tsx` to add the permissions check:

```typescript
import { useState, useEffect } from "react";
import { getCurrentWindow, LogicalSize } from "@tauri-apps/api/window";
import { OnboardingFlow } from "./components/onboarding/OnboardingFlow";
import { PermissionsPrompt } from "./components/PermissionsPrompt";
import { MainWindowLayout } from "./components/main-window/main-window-layout";
import { hydrateEntities, setupEntityListeners } from "./entities";
import { isOnboarded, completeOnboarding } from "./lib/hotkey-service";
import { permissionCommands, spotlightShortcutCommands } from "./lib/tauri-commands";
import { initializeTriggers } from "./lib/triggers";

initializeTriggers();

type AppState =
  | { status: 'loading' }
  | { status: 'onboarding' }
  | { status: 'permissions-prompt'; missingDocuments: boolean; missingAccessibility: boolean }
  | { status: 'ready' };

function App() {
  const [appState, setAppState] = useState<AppState>({ status: 'loading' });
  const [isHydrated, setIsHydrated] = useState(false);

  useEffect(() => {
    async function checkInitialState() {
      const onboarded = await isOnboarded();

      if (!onboarded) {
        setAppState({ status: 'onboarding' });
        return;
      }

      // Check permissions for onboarded users
      const [hasDocuments, hasAccessibility] = await Promise.all([
        permissionCommands.checkDocumentsAccess().catch(() => false),
        spotlightShortcutCommands.checkAccessibilityPermission().catch(() => false),
      ]);

      const missingDocuments = !hasDocuments;
      const missingAccessibility = !hasAccessibility;

      if (missingDocuments || missingAccessibility) {
        setAppState({
          status: 'permissions-prompt',
          missingDocuments,
          missingAccessibility
        });
      } else {
        setAppState({ status: 'ready' });
      }
    }

    checkInitialState().catch(console.error);
  }, []);

  // IMPORTANT: Bootstrap only runs when status is 'ready'
  // This ensures permissions prompt is shown BEFORE any bootstrap attempt
  // (no entity hydration, no listeners, no window resize until after permissions)
  useEffect(() => {
    if (appState.status !== 'ready') return;

    async function bootstrap() {
      const window = getCurrentWindow();
      await window.setSize(new LogicalSize(900, 600));
      await hydrateEntities();
      setupEntityListeners();
      setIsHydrated(true);
    }

    bootstrap();
  }, [appState.status]);

  const handleOnboardingComplete = async () => {
    await completeOnboarding();
    const window = getCurrentWindow();
    await window.setSize(new LogicalSize(900, 600));
    setAppState({ status: 'ready' });
  };

  const handlePermissionsComplete = () => {
    setAppState({ status: 'ready' });
  };

  // Render based on state
  switch (appState.status) {
    case 'loading':
      return <LoadingScreen />;

    case 'onboarding':
      return <OnboardingFlow onComplete={handleOnboardingComplete} />;

    case 'permissions-prompt':
      return (
        <PermissionsPrompt
          onComplete={handlePermissionsComplete}
          missingDocuments={appState.missingDocuments}
          missingAccessibility={appState.missingAccessibility}
        />
      );

    case 'ready':
      return isHydrated ? <MainWindowLayout /> : <LoadingScreen />;
  }
}
```

### Step 3 (Optional): Extract Shared Components

If code sharing is desired, create `src/components/permissions/permission-item.tsx`:

```typescript
import { ExternalLink } from "lucide-react";

interface PermissionItemProps {
  label: string;
  description?: string;
  granted: boolean;
  required?: boolean;
  onRequest: () => void;
  isRequesting: boolean;
  buttonLabel: string;
}

export const PermissionItem = ({
  label,
  description,
  granted,
  required,
  onRequest,
  isRequesting,
  buttonLabel,
}: PermissionItemProps) => (
  <li className="flex items-start gap-3">
    {granted ? (
      <span className="text-green-400 font-mono">✓</span>
    ) : (
      <span className="text-surface-400 font-mono">○</span>
    )}
    <div>
      {granted ? (
        <span className="text-surface-200 font-medium">{label} granted</span>
      ) : (
        <>
          <span className="text-surface-200 font-medium">{label}</span>
          {required !== undefined && (
            <span className="text-surface-500 ml-2">
              ({required ? "required" : "recommended"})
            </span>
          )}
          {description && (
            <p className="text-sm text-surface-500 mt-1">{description}</p>
          )}
          <div className="mt-2">
            <button
              onClick={onRequest}
              disabled={isRequesting}
              className="text-surface-300 hover:text-surface-100 underline decoration-dotted underline-offset-4 inline-flex items-center gap-1 transition-colors text-sm disabled:opacity-50"
            >
              {isRequesting ? "Requesting..." : buttonLabel}
              <ExternalLink className="w-3 h-3" />
            </button>
          </div>
        </>
      )}
    </div>
  </li>
);
```

Then update both `PermissionsStep.tsx` and `PermissionsPrompt.tsx` to use this shared component.

## Persistence Considerations

**Question**: Should the "skip" persist so users aren't prompted repeatedly?

Options:
1. **No persistence** - Prompt every app launch until permissions granted
2. **Session-based** - Only prompt once per session
3. **Persistent skip** - Store a flag in settings (e.g., `permissions_prompt_dismissed`)
4. **Time-based** - Re-prompt after X days

**Recommendation**: Start with option 1 (no persistence). If users find it annoying, add option 3 with a settings toggle to re-enable the prompt.

## Testing

1. **Fresh onboarded user missing accessibility**
   - Complete onboarding, deny accessibility permission
   - Restart app → permissions prompt shows with only accessibility
   - Grant permission → prompt disappears, main app loads

2. **Skip functionality**
   - Click "Skip for now" → main app loads
   - Restart app → prompt shows again (no persistence)

3. **All permissions granted**
   - User with all permissions granted
   - Restart app → goes directly to main app (no prompt)

4. **Missing documents permission** (edge case)
   - Somehow documents permission was revoked
   - Prompt shows with documents permission request

## Notes

- Document permission is more critical than accessibility - consider different handling if documents is missing vs just accessibility
- The window size should remain the onboarding size during the permissions prompt
- Consider adding a "Don't ask again" checkbox if users find the prompt disruptive
