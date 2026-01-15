import type { FileChange } from "@/lib/types/agent-messages";

/**
 * Build a Map of file changes from an array of FileChange.
 * Later entries for the same path overwrite earlier ones (last write wins).
 */
export function buildFileChangesMap(
  changes: FileChange[]
): Map<string, FileChange> {
  const map = new Map<string, FileChange>();
  for (const change of changes) {
    map.set(change.path, change);
  }
  return map;
}

/**
 * Get operation icon for file change.
 */
export function getFileOperationIcon(
  operation: FileChange["operation"]
): string {
  switch (operation) {
    case "create":
      return "file-plus";
    case "modify":
      return "file-edit";
    case "delete":
      return "file-minus";
    case "rename":
      return "file-symlink";
    default:
      return "file";
  }
}

/**
 * Get human-readable operation label.
 */
export function getFileOperationLabel(
  operation: FileChange["operation"]
): string {
  switch (operation) {
    case "create":
      return "Created";
    case "modify":
      return "Modified";
    case "delete":
      return "Deleted";
    case "rename":
      return "Renamed";
    default:
      return "Changed";
  }
}
