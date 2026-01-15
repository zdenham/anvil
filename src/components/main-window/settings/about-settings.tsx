import { Info, Download, Loader2 } from "lucide-react";
import { useEffect, useState, useCallback } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { SettingsSection } from "../settings-section";
import { updateCommands } from "@/lib/tauri-commands";
import { logger } from "@/lib/logger-client";

export function AboutSettings() {
  const [version, setVersion] = useState<string>("0.1.0");
  const [isUpdating, setIsUpdating] = useState(false);

  useEffect(() => {
    getVersion().then(setVersion).catch(logger.error);
  }, []);

  const handleUpdate = useCallback(async () => {
    logger.info("handleUpdate: Update button clicked, starting update process");
    logger.info(`handleUpdate: Current version is ${version}`);
    setIsUpdating(true);
    try {
      logger.info("handleUpdate: Calling runInternalUpdate command");
      await updateCommands.runInternalUpdate();
      logger.info("handleUpdate: runInternalUpdate command returned successfully");
      logger.info("handleUpdate: Script runs in background - app should restart shortly");
      // Script runs in background and will restart the app
      // Keep the loading state since we expect the app to quit
    } catch (error) {
      logger.error("handleUpdate: Update command failed with error:", error);
      setIsUpdating(false);
    }
  }, [version]);

  return (
    <SettingsSection title="About">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-surface-400">
          <Info size={16} />
          <span>Mortician v{version}</span>
        </div>
        <button
          onClick={handleUpdate}
          disabled={isUpdating}
          className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-surface-100 bg-surface-700 hover:bg-surface-600 disabled:opacity-50 disabled:cursor-not-allowed rounded-md transition-colors"
        >
          {isUpdating ? (
            <>
              <Loader2 size={14} className="animate-spin" />
              <span>Updating...</span>
            </>
          ) : (
            <>
              <Download size={14} />
              <span>Update</span>
            </>
          )}
        </button>
      </div>
    </SettingsSection>
  );
}
