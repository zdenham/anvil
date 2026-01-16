import { Keyboard } from "lucide-react";
import { useEffect, useState } from "react";
import { SettingsSection } from "../settings-section";
import { HotkeyRecorder } from "@/components/onboarding/HotkeyRecorder";
import { getSavedHotkey, saveHotkey } from "@/lib/hotkey-service";
import { formatHotkeyDisplay } from "@/utils/hotkey-formatting";

export function HotkeySettings() {
  const [currentHotkey, setCurrentHotkey] = useState<string>("Command+Space");
  const [isEditing, setIsEditing] = useState(false);
  const [pendingHotkey, setPendingHotkey] = useState<string>("");

  useEffect(() => {
    getSavedHotkey().then(setCurrentHotkey).catch(console.error);
  }, []);

  const handleSave = async () => {
    if (pendingHotkey) {
      await saveHotkey(pendingHotkey);
      setCurrentHotkey(pendingHotkey);
    }
    setIsEditing(false);
    setPendingHotkey("");
  };

  const handleCancel = () => {
    setIsEditing(false);
    setPendingHotkey("");
  };

  return (
    <SettingsSection
      title="Global Hotkey"
      description="Keyboard shortcut to open the spotlight"
    >
      {isEditing ? (
        <div className="space-y-4">
          <HotkeyRecorder
            defaultHotkey={currentHotkey}
            onHotkeyChanged={setPendingHotkey}
            autoFocus
          />
          <div className="flex gap-2 justify-end">
            <button
              onClick={handleCancel}
              className="px-3 py-1.5 text-sm text-surface-400 hover:text-surface-300"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={!pendingHotkey}
              className="px-3 py-1.5 text-sm bg-accent-600 text-white rounded hover:bg-accent-500 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Save
            </button>
          </div>
        </div>
      ) : (
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-surface-300">
            <Keyboard size={16} />
            <kbd className="px-2 py-1 bg-surface-700 rounded text-sm">{formatHotkeyDisplay(currentHotkey)}</kbd>
          </div>
          <button
            onClick={() => setIsEditing(true)}
            className="text-sm text-accent-400 hover:text-accent-300"
          >
            Change
          </button>
        </div>
      )}
    </SettingsSection>
  );
}
