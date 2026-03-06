/**
 * In-memory cache for range diffs (stale-while-revalidate).
 *
 * Keyed by worktree path. Holds the most recent range diff result
 * including file contents for syntax highlighting, so the Changes
 * tab can render instantly on re-entry.
 */

import type { ParsedDiff } from "@/lib/diff-parser";
import type { FileContentEntry } from "./changes-diff-fetcher";

export interface RangeDiffCacheEntry {
  raw: string;
  parsed: ParsedDiff;
  mergeBase: string;
  fileContents: Record<string, FileContentEntry>;
  timestamp: number;
}

const rangeDiffCache = new Map<string, RangeDiffCacheEntry>();

export function getCachedRangeDiff(worktreePath: string): RangeDiffCacheEntry | undefined {
  return rangeDiffCache.get(worktreePath);
}

export function updateRangeDiffCache(
  worktreePath: string,
  data: { raw: string; parsed: ParsedDiff; mergeBase: string }
): void {
  const existing = rangeDiffCache.get(worktreePath);
  rangeDiffCache.set(worktreePath, {
    raw: data.raw,
    parsed: data.parsed,
    mergeBase: data.mergeBase,
    fileContents: existing?.fileContents ?? {},
    timestamp: Date.now(),
  });
}

export function updateCachedFileContents(
  worktreePath: string,
  fileContents: Record<string, FileContentEntry>
): void {
  const entry = rangeDiffCache.get(worktreePath);
  if (entry) {
    entry.fileContents = fileContents;
  }
}

export function invalidateRangeDiffCache(worktreePath: string): void {
  rangeDiffCache.delete(worktreePath);
}
