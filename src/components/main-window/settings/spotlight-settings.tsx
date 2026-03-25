import { useState, useEffect } from "react";
import { SettingsSection } from "../settings-section";
import { getSpotlightEnabled, setSpotlightEnabled, getSavedHotkey } from "@/lib/hotkey-service";
import { formatHotkeyDisplay } from "@/utils/hotkey-formatting";

export function SpotlightSettings() {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [currentHotkey, setCurrentHotkey] = useState<string | null>(null);

  useEffect(() => {
    getSpotlightEnabled().then(setEnabled);
    getSavedHotkey().then(setCurrentHotkey);
  }, []);

  if (enabled === null) return null;

  return (
    <SettingsSection
      title="Global Spotlight"
      description="Open Anvil from anywhere on your desktop"
    >
      <div className="space-y-3">
        <label className="flex items-center justify-between cursor-pointer">
          <div>
            <div className="text-sm text-surface-200">
              Enable global spotlight
            </div>
            <div className="text-xs text-surface-500 max-w-sm">
              When enabled, pressing the global hotkey opens Anvil's spotlight
              from anywhere — even when Anvil isn't focused. Quickly start a new
              thread, search projects, or run quick actions.
            </div>
          </div>
          <input
            type="checkbox"
            checked={enabled}
            onChange={async (e) => {
              const val = e.target.checked;
              setEnabled(val);
              await setSpotlightEnabled(val);
            }}
            className="accent-accent-500"
          />
        </label>
        {enabled && currentHotkey && (
          <p className="text-xs text-surface-500">
            Current hotkey: <span className="text-surface-300">{formatHotkeyDisplay(currentHotkey)}</span>
            {" · "}Change it in the Global Hotkey section above.
            {currentHotkey.includes("Space") && (
              <span className="block mt-1 text-surface-500">
                You may need to disable macOS Spotlight first to free up ⌘+Space.
              </span>
            )}
          </p>
        )}
      </div>
    </SettingsSection>
  );
}
