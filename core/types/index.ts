/**
 * Shared type definitions used across frontend and agents.
 */

// Identifiers
export type TaskId = string;
export type ThreadId = string;
export type RepoPath = string;

// Constants - subdirectories within the data directory
// NOTE: The data directory itself is not hardcoded here.
// - Frontend: Use fs.getDataDir() from filesystem-client.ts
// - Agents: Use MORT_DATA_DIR env var or ~/.mort default
export const THREADS_DIR = "threads";
export const TASKS_DIR = "tasks";
export const STATE_FILE = "state.json";

// Task types - single source of truth
export * from "./tasks.js";

// Thread types - single source of truth
export * from "./threads.js";

// Resolution types
export * from "./resolution.js";

// Event types - shared between Node agent and Tauri frontend
export * from "./events.js";

// Repository types - shared between Node agent and Tauri frontend
export * from "./repositories.js";

// Agent mode - controls how agents handle file edits
export type { AgentMode } from "./agent-mode.js";

// Permission types - shared between Node agent and Tauri frontend
export * from "./permissions.js";

// AskUserQuestion types - shared between Node agent and Tauri frontend
export * from "./ask-user-question.js";

// Plan types - shared between Node agent and Tauri frontend
export * from "./plans.js";
