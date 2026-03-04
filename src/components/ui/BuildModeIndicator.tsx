import { useEffect, useState } from "react";
import { invoke } from "@/lib/invoke";
import { PathsInfoSchema } from "@/lib/types/paths";
import { logger } from "@/lib/logger-client";

/**
 * Shows a visual indicator when running a non-production build.
 * Returns null for production builds (no suffix).
 */
export function BuildModeIndicator() {
  const [suffix, setSuffix] = useState<string>("");

  useEffect(() => {
    invoke<unknown>("get_paths_info")
      .then((raw) => {
        const info = PathsInfoSchema.parse(raw);
        setSuffix(info.app_suffix);
      })
      .catch((error) => {
        logger.error("Failed to get paths info:", error);
      });
  }, []);

  // Don't render anything for production builds
  if (!suffix) return null;

  // Determine badge color based on suffix
  const getBadgeClasses = () => {
    switch (suffix) {
      case "dev":
        return "bg-secondary-500 border-secondary-400";
      case "canary":
        return "bg-orange-500 border-orange-400";
      default:
        return "bg-accent-500 border-accent-400";
    }
  };

  return (
    <div
      data-testid="build-mode-indicator"
      className={`fixed bottom-2 right-2 px-2 py-1 text-accent-900 text-xs font-semibold rounded border opacity-80 hover:opacity-100 transition-opacity ${getBadgeClasses()}`}
    >
      {suffix.toUpperCase()}
    </div>
  );
}
