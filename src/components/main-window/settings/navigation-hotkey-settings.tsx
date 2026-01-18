import { ArrowUpDown } from "lucide-react";
import { useEffect, useState } from "react";
import { SettingsSection } from "../settings-section";
import { HotkeyRecorder } from "@/components/onboarding/HotkeyRecorder";
import {
  getSavedTaskNavigationDownHotkey,
  getSavedTaskNavigationUpHotkey,
  saveTaskNavigationDownHotkey,
  saveTaskNavigationUpHotkey,
} from "@/lib/hotkey-service";
import { formatHotkeyDisplay } from "@/utils/hotkey-formatting";

export function TaskNavigationHotkeySettings() {
  const [downHotkey, setDownHotkey] = useState<string>("Shift+Down");
  const [upHotkey, setUpHotkey] = useState<string>("Shift+Up");
  const [editingDown, setEditingDown] = useState(false);
  const [editingUp, setEditingUp] = useState(false);
  const [pendingDown, setPendingDown] = useState<string>("");
  const [pendingUp, setPendingUp] = useState<string>("");

  useEffect(() => {
    getSavedTaskNavigationDownHotkey().then(setDownHotkey).catch(console.error);
    getSavedTaskNavigationUpHotkey().then(setUpHotkey).catch(console.error);
  }, []);

  const handleSaveDown = async () => {
    if (pendingDown) {
      await saveTaskNavigationDownHotkey(pendingDown);
      setDownHotkey(pendingDown);
    }
    setEditingDown(false);
    setPendingDown("");
  };

  const handleCancelDown = () => {
    setEditingDown(false);
    setPendingDown("");
  };

  const handleSaveUp = async () => {
    if (pendingUp) {
      await saveTaskNavigationUpHotkey(pendingUp);
      setUpHotkey(pendingUp);
    }
    setEditingUp(false);
    setPendingUp("");
  };

  const handleCancelUp = () => {
    setEditingUp(false);
    setPendingUp("");
  };

  return (
    <SettingsSection
      title="Task Navigation Hotkeys"
      description="Command+Tab style navigation through tasks. Hold modifier(s) and press key to navigate, release modifier(s) to open the selected task."
    >
      <div className="space-y-3">
        {/* Navigate Down Hotkey */}
        <div className="flex items-center justify-between py-2">
          <div className="flex items-center gap-2 text-surface-400">
            <ArrowUpDown size={16} />
            <span className="text-sm">Navigate Down</span>
          </div>
          {editingDown ? (
            <div className="flex items-center gap-2">
              <HotkeyRecorder
                defaultHotkey={downHotkey}
                onHotkeyChanged={setPendingDown}
                autoFocus
              />
              <button
                onClick={handleCancelDown}
                className="px-3 py-1.5 text-sm text-surface-400 hover:text-surface-300"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveDown}
                disabled={!pendingDown}
                className="px-3 py-1.5 text-sm bg-accent-600 text-accent-900 rounded hover:bg-accent-500 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Save
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <kbd className="px-2 py-1 bg-surface-700 rounded text-sm text-surface-300">
                {formatHotkeyDisplay(downHotkey)}
              </kbd>
              <button
                onClick={() => setEditingDown(true)}
                className="text-sm text-accent-400 hover:text-accent-300"
              >
                Change
              </button>
            </div>
          )}
        </div>

        {/* Navigate Up Hotkey */}
        <div className="flex items-center justify-between py-2">
          <div className="flex items-center gap-2 text-surface-400">
            <ArrowUpDown size={16} />
            <span className="text-sm">Navigate Up</span>
          </div>
          {editingUp ? (
            <div className="flex items-center gap-2">
              <HotkeyRecorder
                defaultHotkey={upHotkey}
                onHotkeyChanged={setPendingUp}
                autoFocus
              />
              <button
                onClick={handleCancelUp}
                className="px-3 py-1.5 text-sm text-surface-400 hover:text-surface-300"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveUp}
                disabled={!pendingUp}
                className="px-3 py-1.5 text-sm bg-accent-600 text-accent-900 rounded hover:bg-accent-500 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Save
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <kbd className="px-2 py-1 bg-surface-700 rounded text-sm text-surface-300">
                {formatHotkeyDisplay(upHotkey)}
              </kbd>
              <button
                onClick={() => setEditingUp(true)}
                className="text-sm text-accent-400 hover:text-accent-300"
              >
                Change
              </button>
            </div>
          )}
        </div>
      </div>
    </SettingsSection>
  );
}
