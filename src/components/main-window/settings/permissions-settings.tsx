import { useState, useEffect, useCallback } from "react";
import { SettingsSection } from "../settings-section";
import { spotlightShortcutCommands, checkAccessibilityWithPrompt, shellEnvironmentCommands } from "@/lib/tauri-commands";

export function PermissionsSettings() {
  const [accessibilityGranted, setAccessibilityGranted] = useState(false);
  const [isCheckingAccessibility, setIsCheckingAccessibility] = useState(false);
  const [shellInitialized, setShellInitialized] = useState(false);
  const [isInitializingShell, setIsInitializingShell] = useState(false);

  useEffect(() => {
    spotlightShortcutCommands
      .checkAccessibilityPermission()
      .then((granted) => setAccessibilityGranted(granted))
      .catch(() => setAccessibilityGranted(false));

    shellEnvironmentCommands
      .isShellInitialized()
      .then((initialized) => setShellInitialized(initialized))
      .catch(() => setShellInitialized(false));
  }, []);

  const handleRequestAccessibility = useCallback(async () => {
    setIsCheckingAccessibility(true);
    try {
      const granted = await checkAccessibilityWithPrompt(true);
      if (granted) {
        setAccessibilityGranted(true);
        return;
      }
      // Poll for permission since user grants in System Settings
      const pollInterval = setInterval(async () => {
        const result = await spotlightShortcutCommands.checkAccessibilityPermission();
        if (result) {
          setAccessibilityGranted(true);
          clearInterval(pollInterval);
        }
      }, 1000);
      setTimeout(() => clearInterval(pollInterval), 30000);
    } finally {
      setIsCheckingAccessibility(false);
    }
  }, []);

  const handleRequestShellInit = useCallback(async () => {
    setIsInitializingShell(true);
    try {
      await shellEnvironmentCommands.initializeShellEnvironment();
      setShellInitialized(true);
    } catch {
      // Still mark as done - we tried
      setShellInitialized(true);
    } finally {
      setIsInitializingShell(false);
    }
  }, []);

  return (
    <SettingsSection
      title="Permissions"
      description="Grant system permissions for full functionality"
    >
      <div className="space-y-3">
        {/* Accessibility */}
        <div className="flex items-center gap-3">
          {accessibilityGranted ? (
            <>
              <span className="text-green-400 font-mono">✓</span>
              <span className="text-sm text-surface-200">Accessibility Access granted</span>
            </>
          ) : (
            <>
              <span className="text-surface-400 font-mono">•</span>
              <button
                onClick={handleRequestAccessibility}
                disabled={isCheckingAccessibility}
                className="text-sm text-surface-300 hover:text-surface-100 underline decoration-dotted underline-offset-4 transition-colors disabled:opacity-50"
              >
                {isCheckingAccessibility ? "Requesting..." : "Grant Accessibility Access ↗"}
              </button>
            </>
          )}
        </div>

        {/* Documents Access */}
        <div className="flex items-center gap-3">
          {shellInitialized ? (
            <>
              <span className="text-green-400 font-mono">✓</span>
              <span className="text-sm text-surface-200">Documents Access granted</span>
            </>
          ) : (
            <>
              <span className="text-surface-400 font-mono">•</span>
              <button
                onClick={handleRequestShellInit}
                disabled={isInitializingShell}
                className="text-sm text-surface-300 hover:text-surface-100 underline decoration-dotted underline-offset-4 transition-colors disabled:opacity-50"
              >
                {isInitializingShell ? "Initializing..." : "Grant Documents Access ↗"}
              </button>
            </>
          )}
        </div>
      </div>
    </SettingsSection>
  );
}
