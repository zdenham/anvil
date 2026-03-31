/**
 * Shared tool deny list.
 * Importable by both agents/ (SDK disallowedTools) and sidecar/ (HTTP hooks).
 */

export const DISALLOWED_TOOLS = [
  "EnterWorktree",
] as const;

export type DenyResult =
  | { denied: false }
  | { denied: true; reason: string };

/**
 * Check if a tool should be denied based on the disallowed list.
 */
export function shouldDenyTool(toolName: string): DenyResult {
  if ((DISALLOWED_TOOLS as readonly string[]).includes(toolName)) {
    return { denied: true, reason: `Tool "${toolName}" is not allowed` };
  }
  return { denied: false };
}
