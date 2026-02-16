import { z } from "zod";

// Permission mode - when to prompt
export const PermissionModeSchema = z.enum([
  "ask-always", // Ask for every tool
  "ask-writes", // Ask for file/git writes only
  "allow-all", // No prompts (bypass)
]);
export type PermissionMode = z.infer<typeof PermissionModeSchema>;

// Display mode - how to show the prompt
export const PermissionDisplayModeSchema = z.enum([
  "modal", // Centered dialog with backdrop
  "inline", // Embedded in thread view
]);
export type PermissionDisplayMode = z.infer<typeof PermissionDisplayModeSchema>;

// Schema for validating permission requests from agent IPC (trust boundary)
export const PermissionRequestSchema = z.object({
  requestId: z.string(),
  threadId: z.string(),
  toolName: z.string(),
  toolInput: z.record(z.string(), z.unknown()),
  timestamp: z.number(),
});

export type PermissionRequest = z.infer<typeof PermissionRequestSchema>;

// Plain TypeScript types for internal use (no validation needed)
export type PermissionDecision = "approve" | "deny";

export type PermissionStatus = "pending" | "approved" | "denied";

export interface PermissionResponse {
  requestId: string;
  threadId: string;
  decision: PermissionDecision;
  reason?: string;
}

// Tools that modify files or git state (show warning styling)
export const DANGEROUS_TOOLS = ["Bash", "Write", "Edit", "NotebookEdit"] as const;

export function isDangerousTool(toolName: string): boolean {
  return (DANGEROUS_TOOLS as readonly string[]).includes(toolName);
}

// Alias for backward compatibility
export const WRITE_TOOLS = DANGEROUS_TOOLS;

export function isWriteTool(toolName: string): boolean {
  return isDangerousTool(toolName);
}

// ── Rules Engine Types ──────────────────────────────────────────────

/** Decision the evaluator can return (superset of user-facing PermissionDecision) */
export type EvaluatorDecision = "allow" | "deny" | "ask";

/** A single permission rule — first match wins */
export interface PermissionRule {
  toolPattern: string;        // regex on tool name (e.g. "^(Write|Edit)$")
  pathPattern?: string;       // regex on relative file path (e.g. "^plans/")
  commandPattern?: string;    // regex on Bash command argument
  decision: EvaluatorDecision;
  reason?: string;            // surfaced to agent on deny
}

/** The three built-in permission mode IDs */
export type PermissionModeId = "plan" | "implement" | "supervise";

/** A permission mode definition with ordered rules */
export interface PermissionModeDefinition {
  id: PermissionModeId;
  name: string;               // Display name: "Plan", "Implement", "Supervise"
  description: string;
  rules: PermissionRule[];    // evaluated in order, first match wins
  defaultDecision: EvaluatorDecision; // if no rules match
}

/** Full config passed to the evaluator */
export interface PermissionConfig {
  mode: PermissionModeDefinition;
  overrides: PermissionRule[];  // evaluated FIRST, before mode rules — can't be bypassed
  workingDirectory: string;
}

/** Cycle order for Shift+Tab */
export const PERMISSION_MODE_CYCLE: PermissionModeId[] = ["plan", "implement", "supervise"];

// ── Built-in Mode Definitions ───────────────────────────────────────

export const PLAN_MODE: PermissionModeDefinition = {
  id: "plan",
  name: "Plan",
  description: "Can read everything, write only to plans/, Bash allowed",
  rules: [
    { toolPattern: "^(Read|Glob|Grep|WebFetch|WebSearch)$", decision: "allow" },
    { toolPattern: "^Bash$", decision: "allow" },
    { toolPattern: "^Task$", decision: "allow" },
    { toolPattern: "^(Write|Edit|NotebookEdit)$", pathPattern: "^plans/", decision: "allow" },
    { toolPattern: "^(Write|Edit|NotebookEdit)$", decision: "deny", reason: "Plan mode: writes are restricted to the plans/ directory" },
  ],
  defaultDecision: "deny",
};

export const IMPLEMENT_MODE: PermissionModeDefinition = {
  id: "implement",
  name: "Implement",
  description: "All tools auto-approved",
  rules: [],
  defaultDecision: "allow",
};

export const SUPERVISE_MODE: PermissionModeDefinition = {
  id: "supervise",
  name: "Supervise",
  description: "Read/Bash auto-approved, file edits require approval with diff preview",
  rules: [
    { toolPattern: "^(Read|Glob|Grep|WebFetch|WebSearch)$", decision: "allow" },
    { toolPattern: "^Bash$", decision: "allow" },
    { toolPattern: "^Task$", decision: "allow" },
    { toolPattern: "^(Write|Edit|NotebookEdit)$", decision: "ask" },
  ],
  defaultDecision: "ask",
};

export const BUILTIN_MODES: Record<PermissionModeId, PermissionModeDefinition> = {
  plan: PLAN_MODE,
  implement: IMPLEMENT_MODE,
  supervise: SUPERVISE_MODE,
};
