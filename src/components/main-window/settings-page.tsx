import { HotkeySettings } from "./settings/hotkey-settings";
import { ClipboardHotkeySettings } from "./settings/clipboard-hotkey-settings";
import { RepositorySettings } from "./settings/repository-settings";
import { SidebarSettings } from "./settings/sidebar-settings";
import { AboutSettings } from "./settings/about-settings";
import { SkillsSettings } from "./settings/skills-settings";

export function SettingsPage() {
  return (
    <div data-testid="settings-view" className="h-full overflow-y-auto">
      <div className="p-6 space-y-6 max-w-2xl">
        <HotkeySettings />
        <ClipboardHotkeySettings />
        {/* Quick actions hidden for now - low usage
        <QuickActionsSettings />
        */}
        <SkillsSettings />
        <SidebarSettings />
        <RepositorySettings />
        <AboutSettings />
      </div>
    </div>
  );
}
