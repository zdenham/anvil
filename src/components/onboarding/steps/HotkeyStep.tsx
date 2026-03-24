import { HotkeyRecorder } from "../HotkeyRecorder";

interface HotkeyStepProps {
  hotkey: string;
  onHotkeyChanged: (hotkey: string) => void;
}

export const HotkeyStep = ({ hotkey, onHotkeyChanged }: HotkeyStepProps) => {
  return (
    <div data-testid="onboarding-step-hotkey" className="space-y-3">
      <div className="space-y-2">
        <h2 className="text-2xl font-bold text-surface-100 font-mono">Set Your Global Hotkey</h2>
        <p className="text-surface-300">
          Choose a keyboard shortcut to quickly access Anvil from anywhere on your system.
        </p>
      </div>

      <HotkeyRecorder defaultHotkey={hotkey} onHotkeyChanged={onHotkeyChanged} />

      <p className="text-sm text-surface-400">
        <span className="text-green-500">Recommended:</span> Keep default (⌘ + Space)
      </p>
    </div>
  );
};