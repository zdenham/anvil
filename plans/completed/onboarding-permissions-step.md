# Onboarding Permissions Step

## Overview

Add a new permissions step to the onboarding flow that appears after the "Begin" welcome step. This step requests document permissions before bootstrapping the `.anvil` directory, providing a better first-time user experience by explaining why permissions are needed before showing the system popup.

## Problem

Currently, `bootstrapAnvilDirectory()` is called in `main.tsx` immediately on app startup, which triggers a "open Documents" system permission popup. For first-time users, this is jarring because they haven't been informed about what the app needs or why.

## Solution

1. Delay the `.anvil` directory bootstrap until after the user grants document permissions during onboarding
2. Add a new "Permissions" step after "Welcome" with two numbered link-style buttons
3. Keep automatic bootstrap for already-onboarded users (existing behavior)

## UI Design

The permissions step displays:

```
Permissions

Anvil needs access to your Documents folder to store task data and configurations.

1. Grant Documents access (required)
   [link button: "Open Documents folder"]

2. Grant Accessibility access (recommended)
   [link button: "Open Accessibility settings"]
   Enables features like disabling system Spotlight

[Permissions granted] <- disabled until document permission confirmed
```

## Files to Modify

| File | Action |
|------|--------|
| `src/main.tsx` | Conditionally call bootstrap based on onboarding state |
| `src/components/onboarding/OnboardingFlow.tsx` | Add 'permissions' step to flow |
| `src/components/onboarding/steps/PermissionsStep.tsx` | **New**: Permissions step component |
| `src/lib/tauri-commands.ts` | Add command for checking Documents access |
| `src-tauri/src/filesystem.rs` | Add command to test Documents access |

## Implementation Steps

### Step 1: Add Documents Access Check Command (Rust)

Add to `src-tauri/src/filesystem.rs`:

```rust
/// Check if we have access to the Documents directory by attempting to read it
#[tauri::command]
pub fn fs_check_documents_access() -> Result<bool, String> {
    let documents_dir = dirs::document_dir()
        .ok_or_else(|| "Could not find Documents directory".to_string())?;

    // Try to read the directory - this will trigger permission prompt if needed
    match std::fs::read_dir(&documents_dir) {
        Ok(_) => Ok(true),
        Err(e) if e.kind() == std::io::ErrorKind::PermissionDenied => Ok(false),
        Err(e) => Err(e.to_string()),
    }
}

/// Request access to Documents by opening the .anvil directory (triggers permission prompt)
#[tauri::command]
pub fn fs_request_documents_access() -> Result<bool, String> {
    let documents_dir = dirs::document_dir()
        .ok_or_else(|| "Could not find Documents directory".to_string())?;

    let anvil_dir = documents_dir.join(".anvil");

    // Creating the directory will trigger the permission prompt
    match std::fs::create_dir_all(&anvil_dir) {
        Ok(_) => Ok(true),
        Err(e) if e.kind() == std::io::ErrorKind::PermissionDenied => Ok(false),
        Err(e) => Err(e.to_string()),
    }
}
```

Register commands in `src-tauri/src/lib.rs`:
```rust
filesystem::fs_check_documents_access,
filesystem::fs_request_documents_access,
```

### Step 2: Add TypeScript Command Wrappers

Add to `src/lib/tauri-commands.ts`:

```typescript
export const permissionCommands = {
  /**
   * Check if we have access to Documents folder
   */
  checkDocumentsAccess: () => invoke<boolean>("fs_check_documents_access"),

  /**
   * Request Documents folder access (triggers permission prompt)
   */
  requestDocumentsAccess: () => invoke<boolean>("fs_request_documents_access"),
};
```

### Step 3: Create PermissionsStep Component

Create `src/components/onboarding/steps/PermissionsStep.tsx`:

```typescript
import { useState, useEffect, useCallback } from "react";
import { permissionCommands } from "@/lib/tauri-commands";
import { spotlightShortcutCommands } from "@/lib/tauri-commands";

interface PermissionsStepProps {
  onDocumentsGranted: () => void;
  documentsGranted: boolean;
}

export const PermissionsStep = ({
  onDocumentsGranted,
  documentsGranted
}: PermissionsStepProps) => {
  const [accessibilityGranted, setAccessibilityGranted] = useState(false);
  const [isCheckingDocuments, setIsCheckingDocuments] = useState(false);
  const [isCheckingAccessibility, setIsCheckingAccessibility] = useState(false);

  // Check accessibility status on mount
  useEffect(() => {
    spotlightShortcutCommands.checkAccessibilityPermission()
      .then(setAccessibilityGranted)
      .catch(() => setAccessibilityGranted(false));
  }, []);

  const handleRequestDocuments = useCallback(async () => {
    setIsCheckingDocuments(true);
    try {
      const granted = await permissionCommands.requestDocumentsAccess();
      if (granted) {
        onDocumentsGranted();
      }
    } finally {
      setIsCheckingDocuments(false);
    }
  }, [onDocumentsGranted]);

  const handleRequestAccessibility = useCallback(async () => {
    setIsCheckingAccessibility(true);
    try {
      await spotlightShortcutCommands.requestAccessibilityPermission();
      // Poll for permission status since user grants in System Settings
      const pollInterval = setInterval(async () => {
        const granted = await spotlightShortcutCommands.checkAccessibilityPermission();
        if (granted) {
          setAccessibilityGranted(true);
          clearInterval(pollInterval);
        }
      }, 1000);
      // Stop polling after 30 seconds
      setTimeout(() => clearInterval(pollInterval), 30000);
    } finally {
      setIsCheckingAccessibility(false);
    }
  }, []);

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold text-surface-100 font-mono">
        Permissions
      </h2>
      <p className="text-lg text-surface-300">
        Anvil needs access to your Documents folder to store task data and configurations.
      </p>

      <ol className="space-y-4 list-decimal list-inside">
        <li className="text-surface-200">
          <span className="font-medium">Grant Documents access</span>
          <span className="text-surface-400 ml-2">(required)</span>
          <div className="ml-6 mt-2">
            {documentsGranted ? (
              <span className="text-green-400">✓ Access granted</span>
            ) : (
              <button
                onClick={handleRequestDocuments}
                disabled={isCheckingDocuments}
                className="text-accent-400 hover:text-accent-300 underline"
              >
                {isCheckingDocuments ? "Requesting..." : "Open Documents folder"}
              </button>
            )}
          </div>
        </li>

        <li className="text-surface-200">
          <span className="font-medium">Grant Accessibility access</span>
          <span className="text-surface-400 ml-2">(recommended)</span>
          <div className="ml-6 mt-2">
            {accessibilityGranted ? (
              <span className="text-green-400">✓ Access granted</span>
            ) : (
              <button
                onClick={handleRequestAccessibility}
                disabled={isCheckingAccessibility}
                className="text-accent-400 hover:text-accent-300 underline"
              >
                {isCheckingAccessibility ? "Opening..." : "Open Accessibility settings"}
              </button>
            )}
            <p className="text-sm text-surface-500 mt-1">
              Enables features like disabling system Spotlight
            </p>
          </div>
        </li>
      </ol>
    </div>
  );
};
```

### Step 4: Update OnboardingFlow

Modify `src/components/onboarding/OnboardingFlow.tsx`:

1. Add 'permissions' to `OnboardingStepName` type
2. Import and use `PermissionsStep`
3. Add state for `documentsGranted`
4. Update step flow: welcome -> permissions -> hotkey -> ...
5. Call `bootstrapAnvilDirectory()` after documents permission granted
6. Update `canProceed()` to check `documentsGranted` for permissions step
7. Update `getButtonText()` to return "Permissions granted ↵" for permissions step

Key changes:

```typescript
import { PermissionsStep } from "./steps/PermissionsStep";
import { bootstrapAnvilDirectory } from "@/lib/anvil-bootstrap";

type OnboardingStepName = 'welcome' | 'permissions' | 'hotkey' | 'spotlight' | 'repository';

// Add state
const [documentsGranted, setDocumentsGranted] = useState(false);

// Handler for when documents access is granted
const handleDocumentsGranted = useCallback(async () => {
  setDocumentsGranted(true);
  // Bootstrap the .anvil directory now that we have permission
  await bootstrapAnvilDirectory();
}, []);

// Update step navigation
const getNextStep = (): OnboardingStepName | null => {
  if (currentStep === 'welcome') return 'permissions';
  if (currentStep === 'permissions') return 'hotkey';
  // ... rest unchanged
};

const getPreviousStep = (): OnboardingStepName | null => {
  if (currentStep === 'permissions') return 'welcome';
  if (currentStep === 'hotkey') return 'permissions';
  // ... rest unchanged
};

// Update canProceed
case 'permissions':
  return documentsGranted;

// Update getButtonText
if (currentStep === 'permissions') return "Permissions granted ↵";

// Update renderStepContent
case 'permissions':
  return (
    <PermissionsStep
      onDocumentsGranted={handleDocumentsGranted}
      documentsGranted={documentsGranted}
    />
  );
```

### Step 5: Conditionally Bootstrap in main.tsx

Modify `src/main.tsx`:

```typescript
import { invoke } from "@tauri-apps/api/core";
import { bootstrapAnvilDirectory } from "./lib/anvil-bootstrap";

// Only bootstrap if already onboarded (permission already granted)
invoke<boolean>("is_onboarded").then((onboarded) => {
  if (onboarded) {
    bootstrapAnvilDirectory().catch((error) => {
      logger.error("Failed to bootstrap .anvil directory:", error);
    });
  }
  // If not onboarded, the OnboardingFlow will call bootstrapAnvilDirectory
  // after the user grants Documents permission in the permissions step
}).catch((error) => {
  logger.error("Failed to check onboarding status:", error);
});
```

### Step 6: Update Progress Indicator

The progress indicator needs to account for the new step. Update `getStepProgress()`:

```typescript
const getStepProgress = () => {
  const totalSteps = shouldShowSpotlightStep ? 5 : 4; // +1 for permissions
  let currentStepNumber = 1;

  switch (currentStep) {
    case 'welcome':
      currentStepNumber = 1;
      break;
    case 'permissions':
      currentStepNumber = 2;
      break;
    case 'hotkey':
      currentStepNumber = 3;
      break;
    case 'spotlight':
      currentStepNumber = 4;
      break;
    case 'repository':
      currentStepNumber = shouldShowSpotlightStep ? 5 : 4;
      break;
  }

  return { current: currentStepNumber, total: totalSteps };
};
```

## Testing

1. **Fresh install test**: Unset onboarding flag, launch app
   - Verify no Documents permission popup on launch
   - Click through to permissions step
   - Click "Open Documents folder" → permission popup appears
   - After granting, button changes to checkmark
   - "Permissions granted" button becomes enabled

2. **Already onboarded test**: With onboarding flag set
   - Verify Documents bootstrap happens automatically on launch
   - No permissions step shown

3. **Accessibility flow test**:
   - Click "Open Accessibility settings"
   - System Settings opens to correct pane
   - After granting in System Settings, checkmark appears

## Edge Cases

- User denies Documents permission: Button stays clickable, can retry
- User closes System Settings without granting accessibility: Optional, can proceed anyway
- Bootstrap fails after permission granted: Show error, allow retry

## Notes

- The accessibility permission is optional and doesn't block progression
- Document permission is required because the app cannot function without it
- The `.anvil` directory is created in Documents, which requires explicit permission on macOS
