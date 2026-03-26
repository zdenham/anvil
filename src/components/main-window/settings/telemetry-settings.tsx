import { SettingsSection } from "../settings-section";
import { useSettingsStore } from "@/entities/settings/store";
import { settingsService } from "@/entities/settings/service";
import { invoke } from "@/lib/invoke";

export function TelemetrySettings() {
  const enabled = useSettingsStore(
    (s) => s.workspace.telemetryEnabled ?? false,
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
            Helps the team debug your issues. Retained for 30 days.
          </div>
        </div>
        <input
          type="checkbox"
          checked={enabled}
          onChange={async (e) => {
            const val = e.target.checked;
            await settingsService.set("telemetryEnabled", val);
            await invoke("set_telemetry_enabled", { enabled: val });
          }}
          className="accent-accent-500"
        />
      </label>
    </SettingsSection>
  );
}
