import type { FileChange } from "@core/types/events";

const PLANS_DIRECTORY = "plans";
const PLAN_FILE_EXTENSION = ".md";

// Regex to match plan paths in user messages (case-sensitive)
const PLAN_PATH_REGEX = /plans\/[^\s]+\.md/g;

interface DetectionResult {
  detected: boolean;
  path: string | null;
}

/**
 * Detect if a tool call creates/edits a plan file
 * NOTE: Only Write and Edit tools trigger detection, NOT Read
 */
export function detectPlanFromToolCall(
  toolName: string,
  toolInput: Record<string, unknown>,
  workingDirectory: string
): DetectionResult {
  // Only check Write and Edit tools - Reading does NOT trigger association
  if (toolName !== "Write" && toolName !== "Edit") {
    return { detected: false, path: null };
  }

  const filePath = toolInput.file_path as string | undefined;
  if (!filePath) {
    return { detected: false, path: null };
  }

  // Normalize path to be relative to working directory
  const relativePath = normalizeToRelativePath(filePath, workingDirectory);

  if (isPlanPath(relativePath)) {
    return { detected: true, path: relativePath };
  }

  return { detected: false, path: null };
}

/**
 * Detect plan paths mentioned in user message content
 * This DOES trigger association (per design decision)
 */
export function detectPlanFromMessage(messageContent: string): DetectionResult {
  const matches = messageContent.match(PLAN_PATH_REGEX);

  if (matches && matches.length > 0) {
    // Return the first match (one plan per thread for now)
    return { detected: true, path: matches[0] };
  }

  return { detected: false, path: null };
}

/**
 * Detect plans from file changes array (from AGENT_STATE events)
 * Uses FileChange[] structure with path, operation, etc.
 */
export function detectPlanFromFileChanges(
  fileChanges: FileChange[],
  workingDirectory: string
): DetectionResult {
  for (const change of fileChanges) {
    // Only detect creates and modifies, not deletes
    if (change.operation === "delete") {
      continue;
    }

    const relativePath = normalizeToRelativePath(change.path, workingDirectory);

    if (isPlanPath(relativePath)) {
      return { detected: true, path: relativePath };
    }
  }

  return { detected: false, path: null };
}

/**
 * Check if a path is a plan file (case-sensitive)
 * Only matches plans/*.md
 */
function isPlanPath(relativePath: string): boolean {
  // Must be in plans/ directory (case-sensitive)
  if (!relativePath.startsWith(`${PLANS_DIRECTORY}/`)) {
    return false;
  }

  // Must be a markdown file
  if (!relativePath.endsWith(PLAN_FILE_EXTENSION)) {
    return false;
  }

  return true;
}

/**
 * Normalize an absolute or relative path to be relative to working directory
 */
function normalizeToRelativePath(
  filePath: string,
  workingDirectory: string
): string {
  // If already relative, return as-is
  if (!filePath.startsWith("/")) {
    return filePath;
  }

  // Remove working directory prefix
  const normalizedWorkDir = workingDirectory.endsWith("/")
    ? workingDirectory
    : `${workingDirectory}/`;

  if (filePath.startsWith(normalizedWorkDir)) {
    return filePath.slice(normalizedWorkDir.length);
  }

  // If path doesn't start with working directory, return the basename portion
  // This handles edge cases where the path is absolute but in a different location
  return filePath;
}
