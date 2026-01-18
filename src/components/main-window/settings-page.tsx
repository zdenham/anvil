import { HotkeySettings } from "./settings/hotkey-settings";
import { ClipboardHotkeySettings } from "./settings/clipboard-hotkey-settings";
import { TaskNavigationHotkeySettings } from "./settings/navigation-hotkey-settings";
import { RepositorySettings } from "./settings/repository-settings";
import { MergeSettings } from "./settings/merge-settings";
import { AboutSettings } from "./settings/about-settings";

export function SettingsPage() {
  return (
    <div className="h-full overflow-y-auto">
      <header className="px-6 py-4 border-b border-surface-800">
        <h2 className="text-lg font-semibold text-surface-100">Settings</h2>
      </header>
      <div className="p-6 space-y-6 max-w-2xl">
        <HotkeySettings />
        <ClipboardHotkeySettings />
        <TaskNavigationHotkeySettings />
        <RepositorySettings />
        <MergeSettings />
        <AboutSettings />
      </div>
    </div>
  );
}
