import { SettingsSection } from "../settings-section";
import { useSettingsStore } from "@/entities/settings/store";
import { settingsService } from "@/entities/settings/service";

export function TerminalInterfaceSettings() {
  const preferTerminal = useSettingsStore(
    (s) => s.workspace.preferTerminalInterface ?? false,
  );
  const bypassPermissions = useSettingsStore(
    (s) => s.workspace.tuiBypassPermissions ?? true,
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
      {preferTerminal && (
        <label className="flex items-center justify-between cursor-pointer">
          <div>
            <div className="text-sm text-surface-200">Bypass permissions</div>
            <div className="text-xs text-surface-500">
              Skip permission prompts in terminal sessions
            </div>
          </div>
          <input
            type="checkbox"
            checked={bypassPermissions}
            onChange={(e) => settingsService.set("tuiBypassPermissions", e.target.checked)}
            className="accent-accent-500"
          />
        </label>
      )}
    </SettingsSection>
  );
}
