import type { DirEntry } from "@/lib/filesystem-client";

/**
 * Sort directory entries: directories first (alphabetical), then files (alphabetical).
 * Case-insensitive comparison via localeCompare.
 */
export function sortDirEntries(entries: DirEntry[]): DirEntry[] {
  return [...entries].sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}
