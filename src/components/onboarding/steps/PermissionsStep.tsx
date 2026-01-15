import { useState, useEffect, useCallback } from "react";
import { spotlightShortcutCommands, checkAccessibilityWithPrompt, shellEnvironmentCommands } from "@/lib/tauri-commands";
import { PermissionsContent } from "@/components/permissions/PermissionsContent";

interface PermissionsStepProps {
  onAccessibilityGranted: () => void;
  accessibilityGranted: boolean;
  onSkip: () => void;
}

export const PermissionsStep = ({
  onAccessibilityGranted,
  accessibilityGranted: accessibilityGrantedProp,
  onSkip,
}: PermissionsStepProps) => {
  const [accessibilityGranted, setAccessibilityGranted] = useState(accessibilityGrantedProp);
  const [isCheckingAccessibility, setIsCheckingAccessibility] = useState(false);

  // Shell initialization state
  const [shellInitialized, setShellInitialized] = useState(false);
  const [isInitializingShell, setIsInitializingShell] = useState(false);

  // Check shell initialization and accessibility permission on mount
  // Note: We only check isShellInitialized() here, NOT checkDocumentsAccess(),
  // because checkDocumentsAccess() can trigger the macOS permission prompt.
  // The prompt should only appear when the user clicks "Grant Documents Access".
  useEffect(() => {
    shellEnvironmentCommands
      .isShellInitialized()
      .then((initialized) => setShellInitialized(initialized))
      .catch(() => setShellInitialized(false));

    // Check accessibility permission
    spotlightShortcutCommands
      .checkAccessibilityPermission()
      .then((granted) => {
        setAccessibilityGranted(granted);
        if (granted) {
          onAccessibilityGranted();
        }
      })
      .catch(() => setAccessibilityGranted(false));
  }, [onAccessibilityGranted]);

  const handleRequestShellInit = useCallback(async () => {
    setIsInitializingShell(true);
    try {
      // This runs the login shell, which may trigger Documents permission prompt
      await shellEnvironmentCommands.initializeShellEnvironment();
      setShellInitialized(true);
    } catch (error) {
      console.error("Failed to initialize shell environment:", error);
      // Still mark as done - we tried
      setShellInitialized(true);
    } finally {
      setIsInitializingShell(false);
    }
  }, []);

  const handleRequestAccessibility = useCallback(async () => {
    setIsCheckingAccessibility(true);
    try {
      // Show native macOS accessibility prompt
      const granted = await checkAccessibilityWithPrompt(true);
      if (granted) {
        setAccessibilityGranted(true);
        onAccessibilityGranted();
        return;
      }
      // Poll for permission status since user grants in System Settings
      const pollInterval = setInterval(async () => {
        const granted =
          await spotlightShortcutCommands.checkAccessibilityPermission();
        if (granted) {
          setAccessibilityGranted(true);
          onAccessibilityGranted();
          clearInterval(pollInterval);
        }
      }, 1000);
      // Stop polling after 30 seconds
      setTimeout(() => clearInterval(pollInterval), 30000);
    } finally {
      setIsCheckingAccessibility(false);
    }
  }, [onAccessibilityGranted]);

  return (
    <PermissionsContent
      shellInitialized={shellInitialized}
      isInitializingShell={isInitializingShell}
      onRequestShellInit={handleRequestShellInit}
      accessibilityGranted={accessibilityGranted}
      isCheckingAccessibility={isCheckingAccessibility}
      onRequestAccessibility={handleRequestAccessibility}
      onSkip={onSkip}
    />
  );
};
