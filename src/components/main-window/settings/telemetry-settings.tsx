import { SettingsSection } from "../settings-section";
import { useSettingsStore } from "@/entities/settings/store";
import { settingsService } from "@/entities/settings/service";

export function TelemetrySettings() {
  const enabled = useSettingsStore(
    (s) => s.workspace.telemetryEnabled ?? true,
  );

  return (
    <SettingsSection
      title="Privacy"
      description="Control what data is sent from your device"
    >
      <label className="flex items-center justify-between cursor-pointer">
        <div>
          <div className="text-sm text-surface-200">
            Send anonymous usage data
          </div>
          <div className="text-xs text-surface-500">
            Helps improve Anvil. No code or conversation content is sent.
            Requires restart.
          </div>
        </div>
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) =>
            settingsService.set("telemetryEnabled", e.target.checked)
          }
          className="accent-accent-500"
        />
      </label>
    </SettingsSection>
  );
}
