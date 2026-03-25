import { Info, Download, Loader2, MessageCircle, ExternalLink } from "lucide-react";
import { useEffect, useState, useCallback } from "react";
import { getVersion } from "@/lib/browser-stubs";
import { openUrl } from "@tauri-apps/plugin-opener";
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
      logger.info("handleUpdate: Calling runUpdate command");
      await updateCommands.runUpdate();
      logger.info("handleUpdate: runUpdate command returned successfully");
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
      <div data-testid="about-settings" className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-surface-400">
          <Info size={16} />
          <span>Anvil v{version}</span>
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
      <div className="flex items-center justify-between mt-3 pt-3 border-t border-surface-700/50">
        <div className="flex items-center gap-2 text-surface-400">
          <MessageCircle size={16} />
          <span>Community</span>
        </div>
        <button
          onClick={() => openUrl("https://discord.gg/tbkAetedSd")}
          className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-surface-100 bg-surface-700 hover:bg-surface-600 rounded-md transition-colors"
        >
          <ExternalLink size={14} />
          <span>Discord</span>
        </button>
      </div>
    </SettingsSection>
  );
}
