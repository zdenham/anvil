import type { DirEntry } from "@/lib/filesystem-client";

/**
 * Given a flat set of changed file paths (absolute) and a list of DirEntry items,
 * returns only entries that are either:
 * - Files that match a changed path
 * - Directories that contain (recursively) at least one changed file
 *
 * Also computes the set of directory absolute paths that should be auto-expanded.
 */
export function filterChangedEntries(
  entries: DirEntry[],
  changedAbsolutePaths: Set<string>,
): { filtered: DirEntry[]; expandPaths: Set<string> } {
  const filtered: DirEntry[] = [];
  const expandPaths = new Set<string>();

  for (const entry of entries) {
    if (entry.isFile) {
      if (changedAbsolutePaths.has(entry.path)) {
        filtered.push(entry);
      }
    } else if (entry.isDirectory) {
      if (directoryContainsChangedFile(entry.path, changedAbsolutePaths)) {
        filtered.push(entry);
        expandPaths.add(entry.path);
      }
    }
  }

  return { filtered, expandPaths };
}

/**
 * Check if a directory contains any changed files using path prefix matching.
 */
function directoryContainsChangedFile(
  dirPath: string,
  changedAbsolutePaths: Set<string>,
): boolean {
  const dirPrefix = dirPath.endsWith("/") ? dirPath : dirPath + "/";
  for (const changedPath of changedAbsolutePaths) {
    if (changedPath.startsWith(dirPrefix)) {
      return true;
    }
  }
  return false;
}
