import { relative, isAbsolute } from "path";
import { realpathSync } from "fs";
import type { PhaseInfo } from "@core/types/plans.js";

const FILE_MOD_TOOLS = ["Edit", "Write", "NotebookEdit"];

/**
 * Check if a file path is a plan path (plans/*.md).
 */
function isPlanFilePath(filePath: string, workingDir: string): boolean {
  let relativePath = filePath;
  if (isAbsolute(filePath)) {
    try {
      const realFilePath = realpathSync(filePath);
      const realWorkingDir = realpathSync(workingDir);
      relativePath = relative(realWorkingDir, realFilePath);
    } catch {
      relativePath = relative(workingDir, filePath);
    }
  }
  relativePath = relativePath.replace(/\\/g, "/");
  return relativePath.startsWith("plans/") && relativePath.endsWith(".md");
}

/**
 * Determine if a phase-update reminder should fire.
 * Returns true when:
 * - Permission mode is "implement"
 * - Tool is a file-modifying tool on a non-plan file
 * - Phase info has incomplete phases
 * - Throttle threshold (5 file-mod tools) is met
 */
export function shouldFirePhaseReminder(opts: {
  toolName: string;
  filePath: string | undefined;
  workingDir: string;
  permissionModeId: string | undefined;
  phaseInfo: PhaseInfo | null;
  fileModCount: number;
}): boolean {
  if (!FILE_MOD_TOOLS.includes(opts.toolName)) return false;
  if (opts.permissionModeId !== "implement") return false;
  if (!opts.filePath) return false;
  if (isPlanFilePath(opts.filePath, opts.workingDir)) return false;
  if (!opts.phaseInfo || opts.phaseInfo.completed >= opts.phaseInfo.total) return false;
  if (opts.fileModCount < 5) return false;
  return true;
}

/**
 * Check if a file-modifying tool on a non-plan file should increment the counter.
 */
export function shouldIncrementFileModCount(
  toolName: string,
  filePath: string | undefined,
  workingDir: string,
): boolean {
  if (!FILE_MOD_TOOLS.includes(toolName)) return false;
  if (!filePath) return false;
  return !isPlanFilePath(filePath, workingDir);
}

export const PHASE_REMINDER_TEXT =
  "Reminder: mark completed plan phases [x] now before continuing.";
