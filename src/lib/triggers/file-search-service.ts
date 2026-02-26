import { logger } from "@/lib/logger-client";
import { gitCommands } from "@/lib/tauri-commands";

export interface FileSearchResult {
  path: string; // Relative path from root
  filename: string;
  extension: string;
  score: number; // Match score (0-1)
  tracked: boolean; // Whether file is tracked by git
}

export interface FileSearchOptions {
  maxResults?: number; // Default: 20
}

interface CacheEntry {
  files: Array<{ path: string; tracked: boolean }>;
  loadedAt: number;
}

export class FileSearchService {
  private cache = new Map<string, CacheEntry>();

  async load(rootPath: string): Promise<void> {
    if (this.cache.has(rootPath)) {
      return;
    }

    const [trackedFiles, untrackedFiles] = await Promise.all([
      gitCommands.lsFiles(rootPath),
      gitCommands.lsFilesUntracked(rootPath).catch(() => []),
    ]);

    this.cache.set(rootPath, {
      files: [
        ...trackedFiles.map((f) => ({ path: f, tracked: true })),
        ...untrackedFiles.map((f) => ({ path: f, tracked: false })),
      ],
      loadedAt: Date.now(),
    });
  }

  invalidate(rootPath?: string): void {
    if (rootPath) {
      this.cache.delete(rootPath);
    } else {
      this.cache.clear();
    }
  }

  async search(
    rootPath: string,
    query: string,
    options: FileSearchOptions = {}
  ): Promise<FileSearchResult[]> {
    const { maxResults = 20 } = options;

    if (!rootPath) {
      return [];
    }

    try {
      await this.load(rootPath);
      const allFiles = this.cache.get(rootPath)!.files;

      // Early return for empty query - show first N files (prioritize tracked)
      if (!query.trim()) {
        const sortedFiles = this.prioritizeTrackedFiles([...allFiles]);
        return sortedFiles
          .slice(0, maxResults)
          .map((f) => this.toResult(f.path, 0, f.tracked));
      }

      return this.scoreAndSort(allFiles, query, maxResults);
    } catch (error) {
      // Not a git repo or git not available
      logger.warn(`git ls-files failed in ${rootPath}:`, error);
      return [];
    }
  }

  private scoreAndSort(
    allFiles: Array<{ path: string; tracked: boolean }>,
    query: string,
    maxResults: number
  ): FileSearchResult[] {
    // Score and sort by match quality (fuzzy subsequence matching)
    const scoredFiles = allFiles
      .map((f) => ({
        path: f.path,
        tracked: f.tracked,
        score: this.score(f.path, query),
      }))
      .filter((f) => f.score > 0)
      .sort((a, b) => {
        // First sort by score, then prioritize tracked files for ties
        if (a.score === b.score) {
          return a.tracked === b.tracked ? 0 : a.tracked ? -1 : 1;
        }
        return b.score - a.score;
      })
      .slice(0, maxResults);

    return scoredFiles.map((f) => this.toResult(f.path, f.score, f.tracked));
  }

  private prioritizeTrackedFiles(files: { path: string; tracked: boolean }[]): { path: string; tracked: boolean }[] {
    // Sort to prioritize tracked files, maintaining relative order within each group
    return files.sort((a, b) => {
      if (a.tracked === b.tracked) return 0;
      return a.tracked ? -1 : 1;
    });
  }

  private toResult(path: string, score: number, tracked: boolean): FileSearchResult {
    const filename = path.split("/").pop() || path;
    return {
      path,
      filename,
      extension: filename.split(".").pop() || "",
      score,
      tracked,
    };
  }

  /**
   * Subsequence match: all query chars appear in order in target
   * Returns match score (higher = better) or 0 for no match
   *
   * Examples:
   *   "fts" matches "file-search-service.ts" (f...i...l...e...)
   *   "abc" does NOT match "cab" (chars not in order)
   */
  private fuzzyScore(target: string, query: string): number {
    const lowerTarget = target.toLowerCase();
    const lowerQuery = query.toLowerCase();

    let targetIdx = 0;
    let queryIdx = 0;
    let score = 0;
    let consecutiveBonus = 0;

    while (targetIdx < lowerTarget.length && queryIdx < lowerQuery.length) {
      if (lowerTarget[targetIdx] === lowerQuery[queryIdx]) {
        // Base score for each matched character
        score += 1;
        // Bonus for consecutive matches
        score += consecutiveBonus;
        consecutiveBonus += 0.5;
        queryIdx++;
      } else {
        consecutiveBonus = 0;
      }
      targetIdx++;
    }

    // All query chars must be matched
    if (queryIdx < lowerQuery.length) return 0;

    // Bonus for shorter paths (more specific matches)
    score += Math.max(0, 10 - target.length / 10);

    return score;
  }

  private score(path: string, query: string): number {
    // Use filename for primary scoring, path as tiebreaker
    const filename = path.split("/").pop() || path;

    const filenameScore = this.fuzzyScore(filename, query);
    const pathScore = this.fuzzyScore(path, query);

    // Prefer filename matches over path-only matches
    if (filenameScore > 0) return filenameScore + 10;
    return pathScore;
  }
}

// Singleton instance
let instance: FileSearchService | null = null;

export function getFileSearchService(): FileSearchService {
  if (!instance) {
    instance = new FileSearchService();
  }
  return instance;
}

export function resetFileSearchService(): void {
  instance = null;
}
