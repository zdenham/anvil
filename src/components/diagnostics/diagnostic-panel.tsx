import { useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useHeartbeatStore, type HeartbeatStatus } from "@/stores/heartbeat-store";
import { useSettingsStore } from "@/entities/settings/store";
import { settingsService } from "@/entities/settings/service";
import { logger } from "@/lib/logger-client";
import { cn } from "@/lib/utils";
import type { DiagnosticLoggingConfig } from "@core/types/diagnostic-logging.js";
import { DEFAULT_DIAGNOSTIC_LOGGING } from "@core/types/diagnostic-logging.js";
import { MemorySection } from "./memory-section";

// ============================================================================
// Constants
// ============================================================================

const STATUS_COLORS: Record<HeartbeatStatus, string> = {
  healthy: "text-green-400",
  degraded: "text-amber-400",
  stale: "text-red-400",
};

const STATUS_DOTS: Record<HeartbeatStatus, string> = {
  healthy: "bg-green-500",
  degraded: "bg-amber-400",
  stale: "bg-red-500",
};

const MODULE_LABELS: Record<keyof DiagnosticLoggingConfig, string> = {
  pipeline: "Pipeline Stamps",
  heartbeat: "Heartbeat Timing",
  sequenceGaps: "Sequence Gaps",
  socketHealth: "Socket Health",
};

// ============================================================================
// Component
// ============================================================================

/**
 * Diagnostic debug panel for monitoring event pipeline health.
 * Shows per-thread heartbeat status, sequence gaps, and per-module
 * diagnostic logging toggles.
 *
 * Dev-only or behind a setting — not shown in production by default.
 */
export function DiagnosticPanel() {
  const heartbeats = useHeartbeatStore((s) => s.heartbeats);
  const gapRecords = useHeartbeatStore((s) => s.gapRecords);
  const gapStats = useHeartbeatStore((s) => s.gapStats);
  const diagnosticConfig = useSettingsStore(
    (s) => s.workspace.diagnosticLogging ?? DEFAULT_DIAGNOSTIC_LOGGING
  );
  const [connectedAgents, setConnectedAgents] = useState<string[]>([]);
  const [isLoadingAgents, setIsLoadingAgents] = useState(false);

  const threadIds = Object.keys(heartbeats);

  // Fetch connected agents list
  const refreshAgents = useCallback(async () => {
    setIsLoadingAgents(true);
    try {
      const agents = await invoke<string[]>("list_connected_agents");
      setConnectedAgents(agents);
    } catch (err) {
      logger.error("[DiagnosticPanel] Failed to fetch connected agents:", err);
    } finally {
      setIsLoadingAgents(false);
    }
  }, []);

  // Toggle a single diagnostic module
  const toggleModule = useCallback(
    async (module: keyof DiagnosticLoggingConfig) => {
      const updated = { ...diagnosticConfig, [module]: !diagnosticConfig[module] };
      await settingsService.set("diagnosticLogging", updated);
      // Update Rust hub diagnostic state
      await invoke("update_diagnostic_config", { config: updated });
    },
    [diagnosticConfig]
  );

  // Enable all diagnostic modules
  const enableAll = useCallback(async () => {
    const allEnabled: DiagnosticLoggingConfig = {
      pipeline: true,
      heartbeat: true,
      sequenceGaps: true,
      socketHealth: true,
    };
    await settingsService.set("diagnosticLogging", allEnabled);
    await invoke("update_diagnostic_config", { config: allEnabled });
  }, []);

  // Disable all diagnostic modules
  const disableAll = useCallback(async () => {
    await settingsService.set("diagnosticLogging", DEFAULT_DIAGNOSTIC_LOGGING);
    await invoke("update_diagnostic_config", { config: DEFAULT_DIAGNOSTIC_LOGGING });
  }, []);

  const anyEnabled = Object.values(diagnosticConfig).some(Boolean);

  return (
    <div className="p-4 space-y-4 text-sm text-surface-300 bg-surface-900 rounded-lg border border-surface-700">
      <div className="flex items-center justify-between">
        <h3 className="text-base font-medium text-surface-100">
          Event Pipeline Diagnostics
        </h3>
        {anyEnabled && (
          <span className="text-xs px-2 py-0.5 bg-amber-500/20 text-amber-400 rounded">
            Diagnostics Active
          </span>
        )}
      </div>

      {/* Per-Thread Heartbeat Status */}
      <section>
        <h4 className="text-xs font-semibold text-surface-400 uppercase tracking-wider mb-2">
          Thread Heartbeats
        </h4>
        {threadIds.length === 0 ? (
          <p className="text-xs text-surface-500 italic">No active heartbeats</p>
        ) : (
          <div className="space-y-1">
            {threadIds.map((threadId) => {
              const entry = heartbeats[threadId];
              const stats = gapStats[threadId];
              return (
                <div
                  key={threadId}
                  className="flex items-center gap-2 text-xs font-mono"
                >
                  <span
                    className={cn(
                      "inline-block w-2 h-2 rounded-full flex-shrink-0",
                      STATUS_DOTS[entry.status]
                    )}
                  />
                  <span className={cn("flex-shrink-0", STATUS_COLORS[entry.status])}>
                    {entry.status}
                  </span>
                  <span className="text-surface-500 truncate" title={threadId}>
                    {threadId.slice(0, 8)}...
                  </span>
                  <span className="text-surface-500">
                    seq={entry.lastSeq}
                  </span>
                  <span className="text-surface-500">
                    missed={entry.missedCount}
                  </span>
                  {stats && stats.totalGaps > 0 && (
                    <span className="text-amber-400">
                      gaps={stats.totalGaps} dropped={stats.totalDropped}
                    </span>
                  )}
                  {stats && stats.recoveryCount > 0 && (
                    <span className="text-blue-400">
                      recovered={stats.recoveryCount}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Connected Agents */}
      <section>
        <div className="flex items-center gap-2 mb-2">
          <h4 className="text-xs font-semibold text-surface-400 uppercase tracking-wider">
            Connected Agents
          </h4>
          <button
            onClick={refreshAgents}
            disabled={isLoadingAgents}
            className="text-xs text-surface-400 hover:text-surface-200 transition-colors"
          >
            {isLoadingAgents ? "..." : "Refresh"}
          </button>
        </div>
        {connectedAgents.length === 0 ? (
          <p className="text-xs text-surface-500 italic">
            {isLoadingAgents ? "Loading..." : "Click refresh to load"}
          </p>
        ) : (
          <div className="space-y-0.5">
            {connectedAgents.map((agentId) => (
              <div key={agentId} className="text-xs font-mono text-surface-400">
                {agentId.slice(0, 8)}...
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Recent Sequence Gaps */}
      <section>
        <h4 className="text-xs font-semibold text-surface-400 uppercase tracking-wider mb-2">
          Recent Sequence Gaps ({gapRecords.length})
        </h4>
        {gapRecords.length === 0 ? (
          <p className="text-xs text-surface-500 italic">No gaps detected</p>
        ) : (
          <div className="space-y-0.5 max-h-32 overflow-y-auto">
            {gapRecords.slice(-10).reverse().map((gap, i) => (
              <div key={i} className="text-xs font-mono text-surface-400">
                <span className="text-amber-400">
                  {gap.threadId.slice(0, 8)}
                </span>
                {" "}expected={gap.expectedSeq} got={gap.receivedSeq}
                {" "}({gap.gapSize} dropped)
                {" "}
                <span className="text-surface-500">
                  {new Date(gap.timestamp).toLocaleTimeString()}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Memory */}
      <MemorySection />

      {/* Diagnostic Module Toggles */}
      <section>
        <div className="flex items-center justify-between mb-2">
          <h4 className="text-xs font-semibold text-surface-400 uppercase tracking-wider">
            Diagnostic Modules
          </h4>
          <div className="flex gap-2">
            <button
              onClick={enableAll}
              className="text-xs text-surface-400 hover:text-surface-200 transition-colors"
            >
              Enable All
            </button>
            <span className="text-surface-600">|</span>
            <button
              onClick={disableAll}
              className="text-xs text-surface-400 hover:text-surface-200 transition-colors"
            >
              Disable All
            </button>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          {(Object.keys(MODULE_LABELS) as Array<keyof DiagnosticLoggingConfig>).map(
            (module) => (
              <button
                key={module}
                onClick={() => toggleModule(module)}
                className={cn(
                  "flex items-center gap-2 px-2 py-1.5 rounded text-xs transition-colors",
                  diagnosticConfig[module]
                    ? "bg-green-500/10 text-green-400 hover:bg-green-500/20"
                    : "bg-surface-800 text-surface-400 hover:bg-surface-700"
                )}
              >
                <span
                  className={cn(
                    "inline-block w-1.5 h-1.5 rounded-full",
                    diagnosticConfig[module] ? "bg-green-500" : "bg-surface-600"
                  )}
                />
                {MODULE_LABELS[module]}
              </button>
            )
          )}
        </div>
      </section>
    </div>
  );
}
