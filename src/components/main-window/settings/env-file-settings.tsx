import { useState, useEffect } from "react";
import { FileText, FolderOpen } from "lucide-react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { SettingsSection } from "../settings-section";
import { useSettingsStore } from "@/entities/settings/store";
import { settingsService } from "@/entities/settings";
import { FilesystemClient } from "@/lib/filesystem-client";
import { join } from "@/lib/browser-stubs";
import { logger } from "@/lib/logger-client";
import { parseEnvFile } from "@/lib/parse-env-file";
import { navigationService } from "@/stores/navigation-service";

const fs = new FilesystemClient();

/** Resolves the effective env file path, falling back to {mortDir}/.env */
async function resolveEnvPath(customPath?: string): Promise<string> {
  if (customPath) return customPath;
  const mortDir = await fs.getDataDir();
  return join(mortDir, ".env");
}

export function EnvFileSettings() {
  const enabled = useSettingsStore((s) => s.workspace.envFileEnabled ?? false);
  const customPath = useSettingsStore((s) => s.workspace.envFilePath);
  const [resolvedPath, setResolvedPath] = useState<string>("");
  const [varCount, setVarCount] = useState<number | null>(null);
  const [pathInput, setPathInput] = useState(customPath ?? "");

  // Resolve the default path on mount
  useEffect(() => {
    resolveEnvPath(customPath).then(setResolvedPath);
  }, [customPath]);

  // Keep local input in sync with store
  useEffect(() => {
    setPathInput(customPath ?? "");
  }, [customPath]);

  // Count vars when enabled and path is resolved
  useEffect(() => {
    if (!enabled || !resolvedPath) {
      setVarCount(null);
      return;
    }
    fs.readFile(resolvedPath)
      .then((content) => {
        const vars = parseEnvFile(content);
        setVarCount(Object.keys(vars).length);
      })
      .catch(() => setVarCount(null));
  }, [enabled, resolvedPath]);

  const handleToggle = async () => {
    const newEnabled = !enabled;
    // If enabling and no custom path, auto-populate with default
    if (newEnabled && !customPath) {
      const defaultPath = await resolveEnvPath();
      await settingsService.setMany({
        envFileEnabled: true,
        envFilePath: defaultPath,
      });
      setPathInput(defaultPath);
    } else {
      await settingsService.set("envFileEnabled", newEnabled);
    }
  };

  const handlePathBlur = async () => {
    const trimmed = pathInput.trim();
    if (trimmed !== (customPath ?? "")) {
      await settingsService.set("envFilePath", trimmed || undefined);
    }
  };

  const handleBrowse = async () => {
    const selected = await openDialog({
      multiple: false,
      title: "Select .env file",
      filters: [{ name: "Env files", extensions: ["env", "*"] }],
    });
    if (selected && typeof selected === "string") {
      setPathInput(selected);
      await settingsService.set("envFilePath", selected);
    }
  };

  const handleOpen = async () => {
    const path = resolvedPath;
    if (!path) return;
    try {
      // Create file if it doesn't exist
      const exists = await fs.exists(path);
      if (!exists) {
        await fs.writeFile(path, "# Add environment variables here\n# Example: CLOUD_ML_REGION=us-east5\n");
      }
      navigationService.navigateToFile(path);
    } catch (err) {
      logger.error("[EnvFileSettings] Failed to open env file:", err);
    }
  };

  return (
    <SettingsSection
      title="Environment Variables"
      description="Load a .env file into agent processes (e.g. Vertex AI config)"
    >
      <div className="space-y-3">
        {/* Toggle */}
        <label className="flex items-center gap-2 text-sm text-surface-200 cursor-pointer">
          <input
            type="checkbox"
            checked={enabled}
            onChange={handleToggle}
            className="accent-surface-300"
          />
          <span>Load environment file</span>
          {enabled && varCount !== null && (
            <span className="text-xs text-accent-400">
              {varCount} variable{varCount !== 1 ? "s" : ""} loaded
            </span>
          )}
          {!enabled && (
            <span className="text-xs text-surface-500">Disabled</span>
          )}
        </label>

        {/* Path input + browse */}
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <FileText size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-surface-500" />
            <input
              type="text"
              value={pathInput}
              onChange={(e) => setPathInput(e.target.value)}
              onBlur={handlePathBlur}
              onKeyDown={(e) => {
                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              }}
              placeholder={resolvedPath || ".mort/.env"}
              className="w-full bg-surface-900 border border-surface-700 rounded pl-8 pr-3 py-1.5 text-sm text-surface-200 placeholder-surface-600 focus:outline-none focus:border-accent-500"
            />
          </div>
          <button
            onClick={handleBrowse}
            className="px-2.5 py-1.5 bg-surface-700 hover:bg-surface-600 text-surface-300 rounded text-sm flex items-center gap-1"
            title="Browse for .env file"
          >
            <FolderOpen size={14} />
          </button>
          <button
            onClick={handleOpen}
            className="px-2.5 py-1.5 bg-surface-700 hover:bg-surface-600 text-surface-300 rounded text-sm flex items-center gap-1"
            title="Open .env file"
          >
            <FileText size={14} />
            Open
          </button>
        </div>
      </div>
    </SettingsSection>
  );
}
