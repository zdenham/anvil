/**
 * Utilities for extracting and generating diffs from tool results.
 * Used by InlineDiffBlock to display file changes inline in the thread.
 */

import type { AnnotatedLine } from "@/components/diff-viewer/types";

// ============================================================================
// Types
// ============================================================================

export interface ExtractedDiff {
  filePath: string;
  diff: string;
  operation: "create" | "modify" | "delete";
}

export interface EditToolInput {
  file_path: string;
  old_string: string;
  new_string: string;
}

export interface WriteToolInput {
  file_path: string;
  content: string;
}

export interface GeneratedDiff {
  filePath: string;
  lines: AnnotatedLine[];
  stats: { additions: number; deletions: number };
}

// ============================================================================
// Diff Extraction
// ============================================================================

/**
 * Extract diff from tool result JSON.
 * Used when the agent has already computed and returned a diff.
 */
export function extractDiffFromToolResult(
  toolName: string,
  result: string | undefined
): ExtractedDiff | null {
  if (!result) return null;
  if (toolName !== "Edit" && toolName !== "Write") return null;

  try {
    const parsed = JSON.parse(result);
    // Defensive field checking - data comes from agent process
    if (typeof parsed.diff !== "string" || typeof parsed.filePath !== "string") {
      return null;
    }
    return {
      filePath: parsed.filePath,
      diff: parsed.diff,
      operation: parsed.operation ?? "modify",
    };
  } catch {
    return null;
  }
}

// ============================================================================
// Diff Generation
// ============================================================================

/**
 * Generate annotated lines from Edit tool input.
 * Compares old_string and new_string to produce a minimal diff.
 */
export function generateEditDiff(input: EditToolInput): GeneratedDiff {
  const { file_path, old_string, new_string } = input;

  if (old_string === new_string) {
    return { filePath: file_path, lines: [], stats: { additions: 0, deletions: 0 } };
  }

  const oldLines = splitLines(old_string);
  const newLines = splitLines(new_string);

  const lines: AnnotatedLine[] = [];
  let additions = 0;
  let deletions = 0;

  // Simple line-by-line diff using LCS-like approach
  const { result, addCount, delCount } = computeLineDiff(oldLines, newLines);
  lines.push(...result);
  additions = addCount;
  deletions = delCount;

  return { filePath: file_path, lines, stats: { additions, deletions } };
}

/**
 * Generate annotated lines from Write tool input.
 * For new files, all lines are additions. For overwrites, shows full content.
 */
export function generateWriteDiff(
  input: WriteToolInput,
  existingContent?: string
): GeneratedDiff {
  const { file_path, content } = input;
  const newLines = splitLines(content);

  if (existingContent === undefined) {
    // New file - all lines are additions
    const lines: AnnotatedLine[] = newLines.map((line, index) => ({
      type: "addition" as const,
      content: line,
      oldLineNumber: null,
      newLineNumber: index + 1,
    }));
    return {
      filePath: file_path,
      lines,
      stats: { additions: newLines.length, deletions: 0 },
    };
  }

  // Overwrite - compute diff with existing content
  const oldLines = splitLines(existingContent);
  const { result, addCount, delCount } = computeLineDiff(oldLines, newLines);

  return {
    filePath: file_path,
    lines: result,
    stats: { additions: addCount, deletions: delCount },
  };
}

// ============================================================================
// Internal Helpers
// ============================================================================

/**
 * Split string into lines, treating empty string as no lines (not one empty line).
 */
function splitLines(str: string): string[] {
  if (str === "") return [];
  return str.split("\n");
}

interface LineDiffResult {
  result: AnnotatedLine[];
  addCount: number;
  delCount: number;
}

/**
 * Compute line-by-line diff between old and new content.
 * Uses a simple O(n*m) LCS algorithm suitable for small diffs.
 */
function computeLineDiff(oldLines: string[], newLines: string[]): LineDiffResult {
  const result: AnnotatedLine[] = [];
  let addCount = 0;
  let delCount = 0;

  // Compute LCS table
  const m = oldLines.length;
  const n = newLines.length;
  const dp: number[][] = Array(m + 1)
    .fill(null)
    .map(() => Array(n + 1).fill(0));

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (oldLines[i - 1] === newLines[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  // Backtrack to build diff
  const diffItems: Array<{ type: "unchanged" | "addition" | "deletion"; line: string; oldIdx: number | null; newIdx: number | null }> = [];
  let i = m;
  let j = n;

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
      diffItems.unshift({ type: "unchanged", line: oldLines[i - 1], oldIdx: i, newIdx: j });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      diffItems.unshift({ type: "addition", line: newLines[j - 1], oldIdx: null, newIdx: j });
      addCount++;
      j--;
    } else {
      diffItems.unshift({ type: "deletion", line: oldLines[i - 1], oldIdx: i, newIdx: null });
      delCount++;
      i--;
    }
  }

  // Convert to AnnotatedLine format
  for (const item of diffItems) {
    result.push({
      type: item.type,
      content: item.line,
      oldLineNumber: item.oldIdx,
      newLineNumber: item.newIdx,
    });
  }

  return { result, addCount, delCount };
}
