import { useState, useCallback, useEffect, useRef } from "react";
import { Button } from "./reusable/Button";
import { spotlightShortcutCommands, checkAccessibilityWithPrompt, shellEnvironmentCommands } from "@/lib/tauri-commands";
import { PermissionsContent } from "@/components/permissions/PermissionsContent";

interface PermissionsPromptProps {
  onComplete: () => void;
}

export const PermissionsPrompt = ({
  onComplete,
}: PermissionsPromptProps) => {
  const [accessibilityGranted, setAccessibilityGranted] = useState(false);
  const [isCheckingAccessibility, setIsCheckingAccessibility] = useState(false);
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Shell initialization state
  const [shellInitialized, setShellInitialized] = useState(false);
  const [isInitializingShell, setIsInitializingShell] = useState(false);

  // Check shell init status on mount
  // Note: We only check isShellInitialized() here, NOT checkDocumentsAccess(),
  // because checkDocumentsAccess() will trigger the macOS permission prompt.
  // The prompt should only appear when the user clicks "Grant Documents Access".
  useEffect(() => {
    shellEnvironmentCommands
      .isShellInitialized()
      .then((initialized) => setShellInitialized(initialized))
      .catch(() => setShellInitialized(false));
  }, []);

  // Poll for accessibility permission status
  useEffect(() => {
    const checkPermission = async () => {
      try {
        const granted = await spotlightShortcutCommands.checkAccessibilityPermission();
        if (granted) {
          setAccessibilityGranted(true);
          if (pollIntervalRef.current) {
            clearInterval(pollIntervalRef.current);
            pollIntervalRef.current = null;
          }
        }
      } catch {
        // Ignore errors, keep polling
      }
    };

    // Check immediately
    checkPermission();

    // Then poll every second
    pollIntervalRef.current = setInterval(checkPermission, 1000);

    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
      }
    };
  }, []);

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
      await checkAccessibilityWithPrompt(true);
    } finally {
      setIsCheckingAccessibility(false);
    }
  }, []);

  return (
    <div className="min-h-screen w-full bg-surface-900 p-6 flex flex-col">
      <div className="flex-1">
        <PermissionsContent
          shellInitialized={shellInitialized}
          isInitializingShell={isInitializingShell}
          onRequestShellInit={handleRequestShellInit}
          accessibilityGranted={accessibilityGranted}
          isCheckingAccessibility={isCheckingAccessibility}
          onRequestAccessibility={handleRequestAccessibility}
          onSkip={onComplete}
        />
      </div>

      <div className="flex justify-end pt-6">
        <Button variant="light" onClick={onComplete} disabled={!accessibilityGranted}>
          Continue
        </Button>
      </div>
    </div>
  );
};
