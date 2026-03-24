/**
 * Parse diagnostic logging config from environment variable.
 *
 * Uses Zod for safe parsing at the boundary. If env var is absent
 * or contains invalid JSON, all modules default to false.
 */
import {
  DiagnosticLoggingConfigSchema,
  DEFAULT_DIAGNOSTIC_LOGGING,
  type DiagnosticLoggingConfig,
} from "@core/types/diagnostic-logging.js";

const ENV_KEY = "ANVIL_DIAGNOSTIC_LOGGING";

/** Parse diagnostic config from ANVIL_DIAGNOSTIC_LOGGING env var. */
export function parseDiagnosticConfig(): DiagnosticLoggingConfig {
  const raw = process.env[ENV_KEY];
  if (!raw) return { ...DEFAULT_DIAGNOSTIC_LOGGING };

  try {
    const parsed = JSON.parse(raw);
    const result = DiagnosticLoggingConfigSchema.safeParse(parsed);
    if (result.success) return result.data;
  } catch {
    // Invalid JSON — fall through to default
  }

  return { ...DEFAULT_DIAGNOSTIC_LOGGING };
}
