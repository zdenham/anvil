import { useState, useEffect } from "react";
import { AlertCircle, Loader2, ExternalLink } from "lucide-react";
import { Button } from "../../reusable/Button";
import { openUrl } from "@tauri-apps/plugin-opener";
import { invoke } from "@tauri-apps/api/core";
import { logger } from "@/lib/logger-client";

interface SpotlightStepProps {}

type DisableStatus = "idle" | "checking" | "disabling" | "success" | "error";

const DISABLE_TIMEOUT_MS = 5000;

export const SpotlightStep = ({}: SpotlightStepProps) => {
  const [hasAccessibilityPermission, setHasAccessibilityPermission] = useState<
    boolean | null
  >(null);
  const [status, setStatus] = useState<DisableStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  const [showManualSteps, setShowManualSteps] = useState(false);

  // Check accessibility permission on mount
  useEffect(() => {
    checkPermission();
  }, []);

  const checkPermission = async () => {
    try {
      const hasPermission = await invoke<boolean>(
        "check_accessibility_permission"
      );
      setHasAccessibilityPermission(hasPermission);
      // If no permission, default to showing manual steps
      if (!hasPermission) {
        setShowManualSteps(true);
      }
    } catch (err) {
      console.error("Failed to check accessibility permission:", err);
      setHasAccessibilityPermission(false);
      setShowManualSteps(true);
    }
  };

  const handleAutoDisable = async () => {
    setStatus("disabling");
    setError(null);

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error("timeout")), DISABLE_TIMEOUT_MS);
    });

    try {
      await Promise.race([
        invoke("disable_system_spotlight_shortcut"),
        timeoutPromise,
      ]);

      // Cleanup: kill System Settings and refocus Mort window
      try {
        await invoke("kill_system_settings");
        await invoke("show_main_window");
      } catch (cleanupErr) {
        logger.warn("Cleanup after disable failed", { error: cleanupErr });
      }

      setStatus("success");
    } catch (err) {
      setStatus("error");
      setShowManualSteps(true);
      const errorMessage = err instanceof Error ? err.message : String(err);

      // Provide more helpful error messages
      if (
        errorMessage.includes("permission") ||
        errorMessage.includes("Permission")
      ) {
        setError(
          "Accessibility permission was revoked. Please grant it again."
        );
        setHasAccessibilityPermission(false);
      } else if (
        errorMessage.includes("not found") ||
        errorMessage.includes("NotFound")
      ) {
        setError(
          "Could not find the Spotlight settings. " +
            "This might be due to a different macOS version."
        );
      } else if (
        errorMessage === "timeout" ||
        errorMessage.includes("Timeout")
      ) {
        setError(
          "Operation timed out. Please close any open System Settings windows and try again."
        );
      } else {
        setError(errorMessage);
      }
      setRetryCount((prev) => prev + 1);
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

    // Permission granted - show action button
    switch (status) {
      case "idle":
      case "checking":
        return (
          <div className="space-y-3">
            <Button onClick={handleAutoDisable} variant="default">
              Auto-disable Spotlight Shortcut
            </Button>
            <p className="text-xs text-surface-500">
              Uses accessibility APIs to change settings automatically.
            </p>
          </div>
        );

      case "disabling":
        return (
          <Button
            disabled
            variant="default"
            className="flex items-center gap-2"
          >
            <Loader2 className="w-4 h-4 animate-spin" />
            Disabling...
          </Button>
        );

      case "success":
        return (
          <Button variant="default" disabled>
            Successfully disabled
          </Button>
        );

      case "error":
        return (
          <div className="space-y-3">
            <Button onClick={handleAutoDisable} variant="default">
              Try Again
            </Button>
            {retryCount >= 2 && (
              <p className="text-xs text-surface-500">
                Having trouble? Try the manual steps below or restart your Mac.
              </p>
            )}
          </div>
        );
    }
  };

  const renderManualSteps = () => (
    <div className="space-y-2 text-sm text-surface-300">
      <div className="flex items-center gap-2">
        <span>1.</span>
        <button
          onClick={async () => {
            try {
              await openUrl(
                "x-apple.systempreferences:com.apple.preference.keyboard"
              );
            } catch (error) {
              logger.error("Failed to open system preferences", { error });
            }
          }}
          className="text-surface-300 hover:text-surface-100 underline decoration-dotted underline-offset-4 inline-flex items-center gap-1 transition-colors"
        >
          Open Keyboard Settings
          <ExternalLink className="w-3 h-3" />
        </button>
      </div>
      <p>
        2. Click <strong>Keyboard Shortcuts</strong> →{" "}
        <strong>Spotlight</strong>
      </p>
      <p>
        3. Uncheck <strong>"Show Spotlight search"</strong>
      </p>
    </div>
  );

  return (
    <div className="space-y-2">
      <div className="space-y-2">
        <h2 className="text-2xl font-bold text-surface-100 font-mono">
          Disable MacOS Spotlight
        </h2>
        <p className="text-surface-300">
          ⌘ + Space conflicts with macOS Spotlight. We recommend disabling
          Spotlight's shortcut — it's worth it.
        </p>
      </div>

      {/* Error message - shown outside conditional UI */}
      {status === "error" && error && (
        <div className="flex items-start gap-2 text-red-400 bg-red-900/20 p-3 rounded-lg !mt-4">
          <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
          <div className="space-y-1">
            <span className="font-medium">Failed to disable shortcut</span>
            <p className="text-sm text-red-300">{error}</p>
          </div>
        </div>
      )}

      {/* Card with either quick option or manual steps */}
      <div className="bg-surface-700 border border-surface-600 rounded-lg p-5 min-h-[120px] !mt-4">
        {showManualSteps ? renderManualSteps() : renderAutoDisableSection()}
      </div>

      {/* Toggle link below card - only show if accessibility permission is granted */}
      {status !== "success" && hasAccessibilityPermission && (
        <button
          onClick={() => setShowManualSteps(!showManualSteps)}
          className="text-xs text-surface-500 hover:text-surface-400 underline decoration-dotted underline-offset-4 transition-colors"
        >
          {showManualSteps ? "Hide manual steps" : "Show manual steps"}
        </button>
      )}
    </div>
  );
};
