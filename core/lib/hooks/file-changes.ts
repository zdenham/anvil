/**
 * Shared file change extraction from tool inputs.
 * Importable by both agents/ (PostToolUse hook) and sidecar/ (HTTP hooks).
 */

import type { FileChange } from "@core/types/events.js";

const FILE_MODIFYING_TOOLS = ["Edit", "Write", "NotebookEdit", "MultiEdit"];

/**
 * Extract a file change from a tool invocation, if applicable.
 * Returns null if the tool doesn't modify files or the input lacks a file path.
 */
export function extractFileChange(
  toolName: string,
  toolInput: Record<string, unknown>,
  _workingDir: string,
): FileChange | null {
  if (!FILE_MODIFYING_TOOLS.includes(toolName)) {
    return null;
  }

  const filePath = (toolInput.file_path ?? toolInput.notebook_path) as string | undefined;
  if (!filePath) {
    return null;
  }

  const operation = toolName === "Write" ? "create" : "modify";
  return { path: filePath, operation };
}
