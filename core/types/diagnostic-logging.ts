import { z } from "zod";

// ============================================================================
// Diagnostic Logging Config — per-module toggle for verbose diagnostics
// ============================================================================

/**
 * Zod schema for diagnostic logging configuration.
 *
 * Each module can be independently toggled. Parsed from:
 * - MORT_DIAGNOSTIC_LOGGING env var (JSON string) in agent processes
 * - SettingsStoreClient in the frontend
 *
 * Status transitions, gap summaries, and errors always log regardless
 * of these toggles. These control verbose per-event diagnostic output.
 */
export const DiagnosticLoggingConfigSchema = z.object({
  /** Per-message pipeline stage stamps at every hop */
  pipeline: z.boolean(),
  /** Heartbeat timing details: jitter, latency */
  heartbeat: z.boolean(),
  /** Detailed sequence gap context */
  sequenceGaps: z.boolean(),
  /** Write failures, backpressure stats, connection state */
  socketHealth: z.boolean(),
});
export type DiagnosticLoggingConfig = z.infer<typeof DiagnosticLoggingConfigSchema>;

/**
 * Default config with all diagnostic modules disabled.
 * Verbose diagnostics are opt-in; critical events (transitions,
 * gap summaries, errors) always log regardless.
 */
export const DEFAULT_DIAGNOSTIC_LOGGING: DiagnosticLoggingConfig = {
  pipeline: false,
  heartbeat: false,
  sequenceGaps: false,
  socketHealth: false,
};

/** Returns true if any diagnostic module is enabled */
export function isDiagnosticEnabled(config: DiagnosticLoggingConfig): boolean {
  return Object.values(config).some(Boolean);
}
