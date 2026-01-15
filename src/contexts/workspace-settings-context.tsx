import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  ReactNode,
} from "react";
import {
  WorkspaceSettings,
  DEFAULT_WORKSPACE_SETTINGS,
  getWorkspaceSettings,
  saveWorkspaceSettings,
} from "../lib/workspace-settings-service";
import { logger } from "../lib/logger-client";

interface WorkspaceSettingsContextValue {
  /** Current workspace settings */
  settings: WorkspaceSettings;
  /** Whether settings are currently loading */
  isLoading: boolean;
  /** Error message if settings failed to load */
  error: string | null;
  /** Updates a single setting and persists to disk */
  updateSetting: <K extends keyof WorkspaceSettings>(
    key: K,
    value: WorkspaceSettings[K]
  ) => Promise<void>;
  /** Updates multiple settings at once and persists to disk */
  updateSettings: (partial: Partial<WorkspaceSettings>) => Promise<void>;
  /** Reloads settings from disk */
  reload: () => Promise<void>;
}

const WorkspaceSettingsContext =
  createContext<WorkspaceSettingsContextValue | null>(null);

interface WorkspaceSettingsProviderProps {
  children: ReactNode;
}

/**
 * Provider component for workspace settings context.
 * Loads settings on mount and provides methods to update them.
 */
export function WorkspaceSettingsProvider({
  children,
}: WorkspaceSettingsProviderProps) {
  const [settings, setSettings] = useState<WorkspaceSettings>(
    DEFAULT_WORKSPACE_SETTINGS
  );
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadSettings = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const loaded = await getWorkspaceSettings();
      setSettings(loaded);
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : "Failed to load workspace settings";
      setError(message);
      logger.error("Failed to load workspace settings:", err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  const updateSetting = useCallback(
    async <K extends keyof WorkspaceSettings>(
      key: K,
      value: WorkspaceSettings[K]
    ) => {
      const newSettings = { ...settings, [key]: value };
      setSettings(newSettings);

      try {
        await saveWorkspaceSettings(newSettings);
      } catch (err) {
        logger.error(`Failed to save setting ${key}:`, err);
        // Revert on failure
        setSettings(settings);
        throw err;
      }
    },
    [settings]
  );

  const updateSettings = useCallback(
    async (partial: Partial<WorkspaceSettings>) => {
      const newSettings = { ...settings, ...partial };
      setSettings(newSettings);

      try {
        await saveWorkspaceSettings(newSettings);
      } catch (err) {
        logger.error("Failed to save settings:", err);
        // Revert on failure
        setSettings(settings);
        throw err;
      }
    },
    [settings]
  );

  const value: WorkspaceSettingsContextValue = {
    settings,
    isLoading,
    error,
    updateSetting,
    updateSettings,
    reload: loadSettings,
  };

  return (
    <WorkspaceSettingsContext.Provider value={value}>
      {children}
    </WorkspaceSettingsContext.Provider>
  );
}

/**
 * Hook to access workspace settings context.
 * Must be used within a WorkspaceSettingsProvider.
 */
export function useWorkspaceSettings(): WorkspaceSettingsContextValue {
  const context = useContext(WorkspaceSettingsContext);

  if (!context) {
    throw new Error(
      "useWorkspaceSettings must be used within a WorkspaceSettingsProvider"
    );
  }

  return context;
}
