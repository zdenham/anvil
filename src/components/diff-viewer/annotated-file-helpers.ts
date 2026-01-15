/**
 * Helper functions for building annotated files for special cases:
 * deleted files, new files, and renamed files.
 *
 * See plans/diff-viewer/05-collapsed-regions.md for details.
 */

import type { AnnotatedLine, ParsedDiffFile } from "./types";

/**
 * Build annotated lines for a deleted file.
 * All lines are marked as deletions.
 *
 * @param oldFileContent - The content of the file before deletion (from git show HEAD:path)
 * @returns Array of AnnotatedLine with type "deletion"
 */
export function buildAnnotatedDeletedFile(
  oldFileContent: string[]
): AnnotatedLine[] {
  return oldFileContent.map((content, index) => ({
    type: "deletion" as const,
    content,
    oldLineNumber: index + 1,
    newLineNumber: null,
  }));
}

/**
 * Build annotated lines for a new file.
 * All lines are marked as additions.
 *
 * @param newFileContent - The content of the new file (from disk)
 * @returns Array of AnnotatedLine with type "addition"
 */
export function buildAnnotatedNewFile(
  newFileContent: string[]
): AnnotatedLine[] {
  return newFileContent.map((content, index) => ({
    type: "addition" as const,
    content,
    oldLineNumber: null,
    newLineNumber: index + 1,
  }));
}

/**
 * Build annotated lines for a renamed file with no content changes.
 * All lines are marked as unchanged.
 *
 * @param fileContent - The content of the file (from disk at new path)
 * @returns Array of AnnotatedLine with type "unchanged"
 */
export function buildAnnotatedRenamedFileNoChanges(
  fileContent: string[]
): AnnotatedLine[] {
  return fileContent.map((content, index) => ({
    type: "unchanged" as const,
    content,
    oldLineNumber: index + 1,
    newLineNumber: index + 1,
  }));
}

/**
 * Check if a renamed file has no content changes.
 * This is true when similarity is 100% or when there are no hunks.
 */
export function isRenamedWithNoChanges(file: ParsedDiffFile): boolean {
  return (
    file.type === "renamed" &&
    (file.similarity === 100 || file.hunks.length === 0)
  );
}

/**
 * Get display info for a file based on its type.
 * Returns badge text, color class, and stats format.
 */
export function getFileDisplayInfo(file: ParsedDiffFile): {
  badge: string;
  badgeClass: string;
  statsText: string;
} {
  switch (file.type) {
    case "added":
      return {
        badge: "New",
        badgeClass: "bg-emerald-500/20 text-emerald-400",
        statsText: `+${file.stats.additions}`,
      };
    case "deleted":
      return {
        badge: "Deleted",
        badgeClass: "bg-red-500/20 text-red-400",
        statsText: `-${file.stats.deletions}`,
      };
    case "renamed":
      if (isRenamedWithNoChanges(file)) {
        return {
          badge: "Renamed",
          badgeClass: "bg-accent-500/20 text-accent-400",
          statsText: "no changes",
        };
      }
      return {
        badge: "Renamed",
        badgeClass: "bg-accent-500/20 text-accent-400",
        statsText: `+${file.stats.additions} -${file.stats.deletions}`,
      };
    case "binary":
      return {
        badge: "Binary",
        badgeClass: "bg-surface-500/20 text-surface-400",
        statsText: "binary file",
      };
    default:
      return {
        badge: "Modified",
        badgeClass: "bg-amber-500/20 text-amber-400",
        statsText: `+${file.stats.additions} -${file.stats.deletions}`,
      };
  }
}

/**
 * Format file path display for renamed files.
 * Returns "old/path.ts -> new/path.ts" for renames, otherwise just the path.
 */
export function formatFilePath(file: ParsedDiffFile): string {
  if (file.type === "renamed" && file.oldPath && file.newPath) {
    return `${file.oldPath} \u2192 ${file.newPath}`;
  }
  return file.newPath ?? file.oldPath ?? "unknown";
}
