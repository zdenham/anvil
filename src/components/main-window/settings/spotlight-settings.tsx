import { useState, useEffect } from "react";
import { AlertCircle, Loader2, ExternalLink } from "lucide-react";
import { Button } from "@/components/reusable/Button";
import { SettingsSection } from "../settings-section";
import { invoke } from "@/lib/invoke";
import { openUrl } from "@tauri-apps/plugin-opener";
import { logger } from "@/lib/logger-client";

type DisableStatus = "idle" | "disabling" | "success" | "error";

const DISABLE_TIMEOUT_MS = 5000;

export function SpotlightSettings() {
  const [hasAccessibilityPermission, setHasAccessibilityPermission] = useState<boolean | null>(null);
  const [status, setStatus] = useState<DisableStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [showManualSteps, setShowManualSteps] = useState(false);

  useEffect(() => {
    invoke<boolean>("check_accessibility_permission")
      .then((has) => {
        setHasAccessibilityPermission(has);
        if (!has) setShowManualSteps(true);
      })
      .catch(() => {
        setHasAccessibilityPermission(false);
        setShowManualSteps(true);
      });
  }, []);

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

      if (errorMessage.includes("permission") || errorMessage.includes("Permission")) {
        setError("Accessibility permission required. Grant it in the Permissions section above.");
        setHasAccessibilityPermission(false);
      } else if (errorMessage.includes("not found") || errorMessage.includes("NotFound")) {
        setError("Could not find Spotlight settings. This might be due to a different macOS version.");
      } else if (errorMessage === "timeout" || errorMessage.includes("Timeout")) {
        setError("Operation timed out. Please close any open System Settings windows and try again.");
      } else {
        setError(errorMessage);
      }
    }
  };

  const renderContent = () => {
    if (hasAccessibilityPermission === null) {
      return (
        <div className="flex items-center gap-2 text-surface-400">
          <Loader2 className="w-4 h-4 animate-spin" />
          <span className="text-sm">Checking permissions...</span>
        </div>
      );
    }

    if (status === "success") {
      return <p className="text-sm text-green-400">macOS Spotlight shortcut is disabled.</p>;
    }

    return (
      <div className="space-y-3">
        {status === "error" && error && (
          <div className="flex items-start gap-2 text-red-400 bg-red-900/20 p-3 rounded-lg">
            <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
            <p className="text-sm text-red-300">{error}</p>
          </div>
        )}

        {showManualSteps ? (
          <div className="space-y-2 text-sm text-surface-300">
            <div className="flex items-center gap-2">
              <span>1.</span>
              <button
                onClick={async () => {
                  try {
                    await openUrl("x-apple.systempreferences:com.apple.preference.keyboard");
                  } catch (err) {
                    logger.error("Failed to open system preferences", { error: err });
                  }
                }}
                className="text-surface-300 hover:text-surface-100 underline decoration-dotted underline-offset-4 inline-flex items-center gap-1 transition-colors"
              >
                Open Keyboard Settings
                <ExternalLink className="w-3 h-3" />
              </button>
            </div>
            <p>2. Click <strong>Keyboard Shortcuts</strong> → <strong>Spotlight</strong></p>
            <p>3. Uncheck <strong>"Show Spotlight search"</strong></p>
          </div>
        ) : (
          <div className="space-y-2">
            <Button
              onClick={handleAutoDisable}
              variant="default"
              disabled={status === "disabling"}
            >
              {status === "disabling" ? (
                <span className="flex items-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Disabling...
                </span>
              ) : (
                "Auto-disable ⌘ + Space"
              )}
            </Button>
            <p className="text-xs text-surface-500">
              Uses accessibility APIs to change settings automatically.
            </p>
          </div>
        )}

        {/* Toggle between auto and manual */}
        <div className="flex items-center gap-4 pt-1">
          {hasAccessibilityPermission && (
            <button
              onClick={() => setShowManualSteps(!showManualSteps)}
              className="text-xs text-surface-500 hover:text-surface-400 underline decoration-dotted underline-offset-4 transition-colors"
            >
              {showManualSteps ? "Use auto-disable" : "Show manual steps"}
            </button>
          )}
        </div>
      </div>
    );
  };

  return (
    <SettingsSection
      title="Spotlight Shortcut"
      description="Disable macOS Spotlight shortcut so Anvil can use ⌘ + Space"
    >
      {renderContent()}
    </SettingsSection>
  );
}
