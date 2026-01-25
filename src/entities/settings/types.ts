import { z } from "zod";
import {
  PermissionModeSchema,
  PermissionDisplayModeSchema,
} from "@core/types/permissions.js";

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
