/**
 * Shared type definitions used across frontend and agents.
 */

// Identifiers
export type ThreadId = string;
export type RepoPath = string;

// Constants - subdirectories within the data directory
// NOTE: The data directory itself is not hardcoded here.
// - Frontend: Use fs.getDataDir() from filesystem-client.ts
// - Agents: Use MORT_DATA_DIR env var or ~/.mort default
export const THREADS_DIR = "threads";
export const STATE_FILE = "state.json";

// Thread types - single source of truth
export * from "./threads.js";

// Resolution types
export * from "./resolution.js";

// Event types - shared between Node agent and Tauri frontend
export * from "./events.js";

// Repository types - shared between Node agent and Tauri frontend
export * from "./repositories.js";

// Permission types - shared between Node agent and Tauri frontend
export * from "./permissions.js";

// AskUserQuestion types - shared between Node agent and Tauri frontend
export * from "./ask-user-question.js";

// Plan types - shared between Node agent and Tauri frontend
export * from "./plans.js";

// Relation types - shared between Node agent and Tauri frontend
export * from "./relations.js";

// Log types - shared between Tauri client and Node server
export * from "./logs.js";

// Quick action types - shared between Tauri client and Node server
export * from "./quick-actions.js";

// Skills types - shared between Tauri client and Node server
export * from "./skills.js";

// Drain event types - shared between Node agent (emission) and Rust (consumption)
export * from "./drain-events.js";

// Pipeline types - event delivery pipeline stage tracking
export * from "./pipeline.js";

// Diagnostic logging types - per-module diagnostic toggle config
export * from "./diagnostic-logging.js";

// Identity types - device-to-person mapping
export * from "./identity.js";

// Gateway event types - shared between server and SSE client
export * from "./gateway-events.js";
