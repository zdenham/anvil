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
