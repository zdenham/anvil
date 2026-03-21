import { SettingsSection } from "../settings-section";
import { useSettingsStore } from "@/entities/settings/store";
import { settingsService } from "@/entities/settings/service";

export function TerminalInterfaceSettings() {
  const preferTerminal = useSettingsStore(
    (s) => s.workspace.preferTerminalInterface ?? false,
  );

  return (
    <SettingsSection
      title="Interface"
      description="Choose how new threads are created"
    >
      <label className="flex items-center justify-between cursor-pointer">
        <div>
          <div className="text-sm text-surface-200">Use terminal interface</div>
          <div className="text-xs text-surface-500">
            New threads open Claude's terminal UI instead of the managed conversation view
          </div>
        </div>
        <input
          type="checkbox"
          checked={preferTerminal}
          onChange={(e) => settingsService.set("preferTerminalInterface", e.target.checked)}
          className="accent-accent-500"
        />
      </label>
    </SettingsSection>
  );
}
