import { z } from "zod";

// Lowercase for internal use (normalize from tracing's uppercase)
export type LogLevel = "trace" | "debug" | "info" | "warn" | "error";

// ═══════════════════════════════════════════════════════════════════════════
// Persisted/IPC Types - Zod schemas with derived types
// RawLogEntry comes from Rust/tracing JSON output via IPC
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Raw format from tracing_subscriber JSON output.
 * Validated when parsing JSON lines from log file/stream.
 */
export const RawLogEntrySchema = z.object({
  timestamp: z.string(), // ISO timestamp
  level: z.string(), // Uppercase: DEBUG, INFO, WARN, ERROR
  target: z.string(), // Module/component name
  message: z.string().optional(), // May be at top level or nested
  fields: z.object({
    message: z.string().optional(), // Message may be here instead
  }).passthrough().optional(),
  thread_id: z.string().optional(), // Snake case in JSON
  spans: z.array(z.object({ name: z.string() })).optional(),
});
export type RawLogEntry = z.infer<typeof RawLogEntrySchema>;

// ═══════════════════════════════════════════════════════════════════════════
// Internal Types - Plain TypeScript interfaces
// These are derived/normalized from RawLogEntry or used for UI state
// ═══════════════════════════════════════════════════════════════════════════

/** Normalized format for frontend use */
export interface LogEntry {
  id: string; // Generated UUID for React keys
  timestamp: string; // ISO timestamp
  level: LogLevel; // Normalized to lowercase
  target: string; // Module/component name
  message: string; // Extracted from fields if needed
  threadId?: string; // Camel case for JS
  spans?: string[]; // Just span names
}

/** Filter state for log viewer */
export interface LogFilter {
  search: string;
  levels: LogLevel[]; // Empty = show all
}

/** Helper to normalize raw log entry */
export function normalizeLogEntry(raw: RawLogEntry, id: string): LogEntry {
  return {
    id,
    timestamp: raw.timestamp,
    level: raw.level.toLowerCase() as LogLevel,
    target: raw.target,
    message: raw.message ?? raw.fields?.message ?? "",
    threadId: raw.thread_id,
    spans: raw.spans?.map((s) => s.name),
  };
}
