# Phase 6: SpotlightStep UI Enhancement

## Goal

Add an "Auto-disable Spotlight Shortcut" button to the existing SpotlightStep onboarding component.

## Prerequisites

- Phase 4 complete (Tauri commands available)

## Output

**Modified File:** `src/components/onboarding/steps/SpotlightStep.tsx`

## Implementation

### Update SpotlightStep.tsx

Replace the current implementation with an enhanced version that includes the auto-disable button:

```typescript
import { useState, useEffect } from "react";
import { CheckCircle, AlertCircle, Loader2, ExternalLink, Shield } from "lucide-react";
import { Button } from "../../reusable/Button";
import { openUrl } from "@tauri-apps/plugin-opener";
import { invoke } from "@tauri-apps/api/core";

interface SpotlightStepProps {}

type DisableStatus = 'idle' | 'checking' | 'disabling' | 'success' | 'error';

export const SpotlightStep = ({}: SpotlightStepProps) => {
  const [hasAccessibilityPermission, setHasAccessibilityPermission] = useState<boolean | null>(null);
  const [status, setStatus] = useState<DisableStatus>('idle');
  const [error, setError] = useState<string | null>(null);

  // Check accessibility permission on mount
  useEffect(() => {
    checkPermission();
  }, []);

  const checkPermission = async () => {
    try {
      const hasPermission = await invoke<boolean>('check_accessibility_permission');
      setHasAccessibilityPermission(hasPermission);
    } catch (err) {
      console.error('Failed to check accessibility permission:', err);
      setHasAccessibilityPermission(false);
    }
  };

  const handleRequestPermission = async () => {
    try {
      await invoke('request_accessibility_permission');
      // Poll for permission grant
      const pollInterval = setInterval(async () => {
        const hasPermission = await invoke<boolean>('check_accessibility_permission');
        if (hasPermission) {
          setHasAccessibilityPermission(true);
          clearInterval(pollInterval);
        }
      }, 1000);
      // Stop polling after 60 seconds
      setTimeout(() => clearInterval(pollInterval), 60000);
    } catch (err) {
      console.error('Failed to request accessibility permission:', err);
    }
  };

  const handleAutoDisable = async () => {
    setStatus('disabling');
    setError(null);
    try {
      await invoke('disable_system_spotlight_shortcut');
      setStatus('success');
    } catch (err) {
      setStatus('error');
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const renderAutoDisableSection = () => {
    // Permission not yet checked
    if (hasAccessibilityPermission === null) {
      return (
        <div className="flex items-center gap-2 text-surface-400">
          <Loader2 className="w-4 h-4 animate-spin" />
          <span className="text-sm">Checking permissions...</span>
        </div>
      );
    }

    // Permission not granted
    if (hasAccessibilityPermission === false) {
      return (
        <div className="space-y-3">
          <div className="flex items-start gap-2">
            <Shield className="w-4 h-4 text-amber-400 mt-0.5 flex-shrink-0" />
            <p className="text-sm text-surface-300">
              Anvil needs Accessibility permission to auto-disable Spotlight.
              This is a one-time setup.
            </p>
          </div>
          <Button onClick={handleRequestPermission} variant="secondary">
            Grant Accessibility Permission
          </Button>
          <p className="text-xs text-surface-400">
            After granting, return here and the button will become available.
          </p>
        </div>
      );
    }

    // Permission granted - show action button
    switch (status) {
      case 'idle':
      case 'checking':
        return (
          <Button onClick={handleAutoDisable} variant="primary">
            Auto-disable Spotlight Shortcut
          </Button>
        );

      case 'disabling':
        return (
          <Button disabled variant="primary" className="flex items-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin" />
            Disabling...
          </Button>
        );

      case 'success':
        return (
          <div className="flex items-center gap-2 text-green-400">
            <CheckCircle className="w-5 h-5" />
            <span>Spotlight shortcut disabled successfully!</span>
          </div>
        );

      case 'error':
        return (
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-red-400">
              <AlertCircle className="w-5 h-5" />
              <span>Failed to disable shortcut</span>
            </div>
            {error && (
              <p className="text-sm text-red-300 bg-red-900/20 p-2 rounded">
                {error}
              </p>
            )}
            <Button onClick={handleAutoDisable} variant="secondary" size="sm">
              Try Again
            </Button>
          </div>
        );
    }
  };

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <h2 className="text-2xl font-bold text-surface-100 font-mono">
          Disable macOS Spotlight
        </h2>
        <p className="text-surface-300">
          ⌘ + Space conflicts with macOS Spotlight. We recommend disabling
          Spotlight's shortcut — it's worth it.
        </p>
      </div>

      {/* Auto-disable option */}
      <div className="bg-surface-700 border border-surface-600 rounded-lg p-4">
        <p className="font-medium text-surface-100 mb-3">Quick option:</p>
        {renderAutoDisableSection()}
      </div>

      {/* Manual instructions (fallback) */}
      <div className="bg-surface-800 border border-surface-700 rounded-lg p-4 space-y-4">
        <p className="font-medium text-surface-200">Or disable manually:</p>

        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <span className="text-sm text-surface-300">1.</span>
            <button
              onClick={async () => {
                try {
                  await openUrl(
                    "x-apple.systempreferences:com.apple.preference.keyboard"
                  );
                } catch (error) {
                  console.error("Failed to open system preferences:", error);
                }
              }}
              className="text-sm text-surface-300 hover:text-surface-100 underline decoration-dotted underline-offset-4 flex items-center gap-1 transition-colors"
            >
              Open Keyboard Settings
              <ExternalLink className="w-3 h-3" />
            </button>
          </div>

          <div className="text-sm text-surface-300">
            <span>
              2. Click <strong>Keyboard Shortcuts</strong> →{" "}
              <strong>Spotlight</strong>
            </span>
          </div>

          <div className="text-sm text-surface-300">
            <span>
              3. Uncheck <strong>"Show Spotlight search"</strong>
            </span>
          </div>
        </div>
      </div>

      {status === 'success' && (
        <div className="p-3 bg-green-900/20 border border-green-700/30 rounded-lg">
          <p className="text-sm text-green-300">
            Great! Your hotkey should work perfectly now.
          </p>
        </div>
      )}
    </div>
  );
};
```

## Changes Summary

1. **Added state management** for:
   - `hasAccessibilityPermission`: tracks permission status
   - `status`: tracks disable operation status
   - `error`: stores error messages

2. **Added "Quick option" section** with:
   - Permission check on mount
   - "Grant Accessibility Permission" button when not granted
   - "Auto-disable Spotlight Shortcut" button when granted
   - Loading, success, and error states

3. **Kept manual instructions** as fallback option

4. **Added polling** for permission grant (checks every second after opening Settings)

## Verification

1. Run `pnpm tauri dev`
2. Go through onboarding until the Spotlight step
3. If no permission: click "Grant Accessibility Permission", grant in System Settings
4. Click "Auto-disable Spotlight Shortcut"
5. Verify the shortcut is actually disabled in System Settings

## Success Criteria

- [ ] Permission status is checked on component mount
- [ ] "Grant Accessibility Permission" button works
- [ ] Permission polling detects when granted
- [ ] "Auto-disable" button triggers the Tauri command
- [ ] Success state shows confirmation
- [ ] Error state shows message and retry button
- [ ] Manual instructions still work as fallback

## Notes

- The polling for permission stops after 60 seconds to avoid memory leaks
- Icons from lucide-react provide visual feedback
- The manual instructions are de-emphasized but still available
- All states have appropriate visual feedback
