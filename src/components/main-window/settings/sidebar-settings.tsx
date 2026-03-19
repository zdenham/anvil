import { SettingsSection } from "../settings-section";
import { useSettingsStore } from "@/entities/settings/store";
import { settingsService } from "@/entities/settings/service";

export function SidebarSettings() {
  const hideExternal = useSettingsStore(
    (s) => s.workspace.hideExternalWorktrees ?? true,
  );

  return (
    <SettingsSection
      title="Sidebar"
      description="Control what appears in the sidebar tree"
    >
      <label className="flex items-center justify-between cursor-pointer">
        <div>
          <div className="text-sm text-surface-200">Hide external workspaces</div>
          <div className="text-xs text-surface-500">
            Hide workspaces not created by Mort from the sidebar
          </div>
        </div>
        <input
          type="checkbox"
          checked={hideExternal}
          onChange={(e) => settingsService.set("hideExternalWorktrees", e.target.checked)}
          className="accent-accent-500"
        />
      </label>
    </SettingsSection>
  );
}
