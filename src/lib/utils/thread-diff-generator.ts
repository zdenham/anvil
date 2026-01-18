/**
 * Thread Diff Generator
 *
 * Generates diffs for files changed during a thread's execution.
 * Uses the initial commit hash captured at thread start to show
 * what changed relative to that point in time.
 */

import { gitCommands } from "../tauri-commands";
import { parseDiff, type ParsedDiff } from "../diff-parser";

export interface ThreadDiffResult {
  /** Parsed diff data for all changed files */
  diff: ParsedDiff;
  /** The initial commit hash used as base for the diff */
  initialCommit: string;
  /** Error message if diff generation failed */
  error?: string;
}

/**
 * Generate diffs for changed files from the initial commit.
 *
 * @param initialCommitHash - The commit hash captured when the thread started
 * @param changedFilePaths - Array of file paths that were modified during the thread
 * @param workingDirectory - The directory where the files are located
 * @returns Parsed diff result with file changes
 */
export async function generateThreadDiff(
  initialCommitHash: string,
  changedFilePaths: string[],
  workingDirectory: string
): Promise<ThreadDiffResult> {
  // No files to diff
  if (changedFilePaths.length === 0) {
    return {
      diff: { files: [] },
      initialCommit: initialCommitHash,
    };
  }

  try {
    // Generate diff using git command
    const rawDiff = await gitCommands.diffFiles(
      workingDirectory,
      initialCommitHash,
      changedFilePaths
    );

    // Parse the raw diff output
    const parsedDiff = parseDiff(rawDiff);

    return {
      diff: parsedDiff,
      initialCommit: initialCommitHash,
    };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    return {
      diff: { files: [] },
      initialCommit: initialCommitHash,
      error: `Failed to generate diff: ${errorMessage}`,
    };
  }
}

/**
 * Extract unique file paths from a ThreadState's fileChanges array.
 *
 * @param fileChanges - Array of FileChange objects from ThreadState
 * @returns Array of unique file paths
 */
export function extractChangedFilePaths(
  fileChanges: Array<{ path: string }> | undefined
): string[] {
  if (!fileChanges || fileChanges.length === 0) {
    return [];
  }

  // Use Set to deduplicate paths
  const paths = new Set<string>();
  for (const change of fileChanges) {
    if (change.path) {
      paths.add(change.path);
    }
  }

  return Array.from(paths);
}
