import { useState } from "react";
import { Key, Eye, EyeOff, Check, X } from "lucide-react";
import { SettingsSection } from "../settings-section";
import { useSettingsStore } from "@/entities/settings/store";
import { settingsService } from "@/entities/settings";
import { logger } from "@/lib/logger-client";

function maskKey(key: string): string {
  if (key.length <= 12) return "••••••••";
  return `${key.slice(0, 7)}...${key.slice(-4)}`;
}

function isValidKeyFormat(key: string): boolean {
  return key.startsWith("sk-ant-");
}

/** Inner API key input UI — can be embedded in other components */
export function ApiKeyInput() {
  const storedKey = useSettingsStore((s) => s.workspace.anthropicApiKey);
  const [editing, setEditing] = useState(false);
  const [inputValue, setInputValue] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSave = async () => {
    const trimmed = inputValue.trim();
    if (!trimmed) return;

    if (!isValidKeyFormat(trimmed)) {
      setError("Key must start with sk-ant-");
      return;
    }

    try {
      await settingsService.set("anthropicApiKey", trimmed);
      setEditing(false);
      setInputValue("");
      setShowKey(false);
      setError(null);
    } catch (err) {
      logger.error("[ApiKeySettings] Failed to save API key:", err);
      setError("Failed to save key");
    }
  };

  const handleClear = async () => {
    try {
      await settingsService.set("anthropicApiKey", null);
      setEditing(false);
      setInputValue("");
      setError(null);
    } catch (err) {
      logger.error("[ApiKeySettings] Failed to clear API key:", err);
    }
  };

  const handleCancel = () => {
    setEditing(false);
    setInputValue("");
    setShowKey(false);
    setError(null);
  };

  return (
    <div className="space-y-3">
      {/* Status indicator */}
      <div className="flex items-center gap-2 text-sm">
        <Key size={14} className="text-surface-400" />
        {storedKey ? (
          <span className="text-accent-400">Custom key configured</span>
        ) : (
          <span className="text-surface-500">No custom key set</span>
        )}
      </div>

      {editing ? (
        /* Edit mode */
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <input
                type={showKey ? "text" : "password"}
                value={inputValue}
                onChange={(e) => {
                  setInputValue(e.target.value);
                  setError(null);
                }}
                placeholder="sk-ant-..."
                className="w-full bg-surface-900 border border-surface-700 rounded px-3 py-1.5 text-sm text-surface-200 placeholder-surface-600 focus:outline-none focus:border-accent-500 pr-8"
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck={false}
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleSave();
                  if (e.key === "Escape") handleCancel();
                }}
              />
              <button
                onClick={() => setShowKey(!showKey)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-surface-500 hover:text-surface-300"
                type="button"
              >
                {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
            <button
              onClick={handleSave}
              className="px-3 py-1.5 bg-accent-500 hover:bg-accent-400 text-accent-900 rounded text-sm flex items-center gap-1"
            >
              <Check size={14} />
              Save
            </button>
            <button
              onClick={handleCancel}
              className="px-3 py-1.5 bg-surface-700 hover:bg-surface-600 text-surface-300 rounded text-sm flex items-center gap-1"
            >
              <X size={14} />
              Cancel
            </button>
          </div>
          {error && (
            <p className="text-xs text-red-400">{error}</p>
          )}
        </div>
      ) : (
        /* Display mode */
        <div className="flex items-center gap-2">
          {storedKey && (
            <span className="text-sm text-surface-400 font-mono">
              {maskKey(storedKey)}
            </span>
          )}
          <button
            onClick={() => {
              setEditing(true);
              setInputValue(storedKey ?? "");
            }}
            className="px-3 py-1.5 bg-surface-700 hover:bg-surface-600 text-surface-300 rounded text-sm"
          >
            {storedKey ? "Change" : "Set custom key"}
          </button>
          {storedKey && (
            <button
              onClick={handleClear}
              className="px-3 py-1.5 bg-surface-700 hover:bg-surface-600 text-surface-300 rounded text-sm"
            >
              Clear
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** Standalone API key settings section (for use outside AuthSettings) */
export function ApiKeySettings() {
  return (
    <SettingsSection
      title="API Key"
      description="Optionally use your own Anthropic API key"
    >
      <ApiKeyInput />
    </SettingsSection>
  );
}
