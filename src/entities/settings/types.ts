import { z } from "zod";
import {
  PermissionModeSchema,
  PermissionDisplayModeSchema,
} from "@core/types/permissions.js";
import { DiagnosticLoggingConfigSchema } from "@core/types/diagnostic-logging.js";

// WorkflowMode stays as simple type alias (used by schema)
export type WorkflowMode = "solo" | "team";

// Schema is source of truth - type is derived
export const WorkspaceSettingsSchema = z.object({
  /**
   * The working repository - either a local path or a git URL.
   * This is the primary repository that threads will operate on.
   * null when no repository has been configured.
   */
  repository: z.string().nullable(),

  /**
   * Anthropic API key for LLM features (thread naming, etc.)
   * null when not configured.
   */
  anthropicApiKey: z.string().nullable(),

  /**
   * Authentication method for agent processes.
   * "api-key" — use anthropicApiKey from settings (BYOK)
   * "claude-login" — don't pass API key, let CLI use keychain credentials
   * "default" / undefined — current behavior (use built-in key from env)
   */
  authMethod: z.enum(["api-key", "claude-login", "default"]).optional(),

  /**
   * Workflow mode for handling completed threads.
   * "solo" - Rebase onto local main and fast-forward merge (for solo devs)
   * "team" - Rebase onto origin/main and create a PR (for teams)
   */
  workflowMode: z.enum(["solo", "team"]),

  /**
   * Permission mode - when to prompt for tool execution.
   * "ask-always" - Ask for every tool
   * "ask-writes" - Ask for file/git writes only
   * "allow-all" - No prompts (bypass)
   */
  permissionMode: PermissionModeSchema,

  /**
   * Permission display mode - how to show permission prompts.
   * "modal" - Centered dialog with backdrop
   * "inline" - Embedded in thread view
   */
  permissionDisplayMode: PermissionDisplayModeSchema,

  /**
   * Whether the quick actions panel is collapsed.
   * Persists across windows and sessions.
   */
  quickActionsCollapsed: z.boolean(),

  /**
   * Diagnostic logging configuration — per-module toggles for verbose diagnostics.
   * Optional for backwards compatibility with existing settings files.
   * When absent, all diagnostic modules are disabled.
   */
  diagnosticLogging: DiagnosticLoggingConfigSchema.optional(),

  /**
   * Whether the MITM network debug proxy is enabled for agent processes.
   * Optional for backwards compatibility — defaults to off (no proxy).
   * Controlled by the Record button in the debug panel's Network tab.
   */
  networkDebugEnabled: z.boolean().optional(),

  /**
   * Whether to hide worktrees not created by Mort from the sidebar.
   * Optional for backwards compatibility — defaults to true (hide external).
   */
  hideExternalWorktrees: z.boolean().optional(),

  /**
   * Path to a .env file whose variables are injected into agent processes.
   * Optional — defaults to `{mortDir}/.env` in the UI when not set.
   */
  envFilePath: z.string().optional(),

  /**
   * Whether the custom env file is active. When false, the file is ignored even if a path is set.
   * Optional — defaults to false (disabled).
   */
  envFileEnabled: z.boolean().optional(),

  /**
   * When true, new threads open Claude's terminal UI instead of the managed conversation view.
   * Optional — defaults to false (managed threads).
   */
  preferTerminalInterface: z.boolean().optional(),

  /**
   * Whether TUI sessions launch with --permission-mode bypassPermissions.
   * Optional — defaults to true for backwards compatibility.
   */
  tuiBypassPermissions: z.boolean().optional(),
});
export type WorkspaceSettings = z.infer<typeof WorkspaceSettingsSchema>;

/** Default workspace settings */
export const DEFAULT_WORKSPACE_SETTINGS: WorkspaceSettings = {
  repository: null,
  anthropicApiKey: null,
  workflowMode: "solo",
  permissionMode: "allow-all",
  permissionDisplayMode: "modal",
  quickActionsCollapsed: false,
};
