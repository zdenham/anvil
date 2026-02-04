import { HotkeySettings } from "./settings/hotkey-settings";
import { ClipboardHotkeySettings } from "./settings/clipboard-hotkey-settings";
import { RepositorySettings } from "./settings/repository-settings";
import { AboutSettings } from "./settings/about-settings";
import { QuickActionsSettings } from "@/components/settings/quick-actions-settings";

export function SettingsPage() {
  return (
    <div className="h-full overflow-y-auto">
      <div className="p-6 space-y-6 max-w-2xl">
        <HotkeySettings />
        <ClipboardHotkeySettings />
        <QuickActionsSettings />
        <RepositorySettings />
        <AboutSettings />
      </div>
    </div>
  );
}
