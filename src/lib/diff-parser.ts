/**
 * Git diff parser - converts raw git diff output to structured data.
 */

import { detectLanguage } from "./language-detector";

// ============================================================================
// Types
// ============================================================================

export interface ParsedDiff {
  files: ParsedDiffFile[];
}

export interface ParsedDiffFile {
  /** Original file path (null for new files) */
  oldPath: string | null;
  /** New file path (null for deleted files) */
  newPath: string | null;
  /** File operation type */
  type: "added" | "deleted" | "modified" | "renamed" | "binary";
  /** For renamed files, similarity percentage */
  similarity?: number;
  /** Hunks from the diff (parser only outputs hunks, not collapsed regions) */
  hunks: DiffHunk[];
  /** Summary statistics */
  stats: {
    additions: number;
    deletions: number;
  };
  /** Detected language for syntax highlighting */
  language: string;
  /** Whether this is a binary file */
  isBinary: boolean;
}

export interface DiffHunk {
  /** Starting line number in old file */
  oldStart: number;
  /** Number of lines in old file */
  oldLines: number;
  /** Starting line number in new file */
  newStart: number;
  /** Number of lines in new file */
  newLines: number;
  /** Optional section header from hunk (e.g., function name) */
  sectionHeader?: string;
  /** Individual line changes (includes context lines from diff) */
  lines: DiffLine[];
}

export interface DiffLine {
  /** Line type: context lines are unchanged lines IN the diff output */
  type: "context" | "addition" | "deletion";
  /** Line content (without +/- prefix) */
  content: string;
  /** Line number in old file (null for additions) */
  oldLineNumber: number | null;
  /** Line number in new file (null for deletions) */
  newLineNumber: number | null;
}

// ============================================================================
// Parser
// ============================================================================

/**
 * Parses raw git diff output into structured data.
 */
export function parseDiff(diffText: string): ParsedDiff {
  if (!diffText || !diffText.trim()) {
    return { files: [] };
  }

  const files: ParsedDiffFile[] = [];

  // Split by file headers
  // Each file section starts with "diff --git a/... b/..."
  const fileChunks = splitByFileHeaders(diffText);

  for (const chunk of fileChunks) {
    const file = parseFileChunk(chunk);
    if (file) {
      files.push(file);
    }
  }

  return { files };
}

/**
 * Splits diff text into chunks, one per file.
 */
function splitByFileHeaders(diffText: string): string[] {
  const chunks: string[] = [];
  const lines = diffText.split("\n");

  let currentChunk: string[] = [];

  for (const line of lines) {
    if (line.startsWith("diff --git ")) {
      if (currentChunk.length > 0) {
        chunks.push(currentChunk.join("\n"));
      }
      currentChunk = [line];
    } else {
      currentChunk.push(line);
    }
  }

  // Don't forget the last chunk
  if (currentChunk.length > 0) {
    chunks.push(currentChunk.join("\n"));
  }

  return chunks;
}

/**
 * Parses a single file's diff chunk.
 */
function parseFileChunk(chunk: string): ParsedDiffFile | null {
  const lines = chunk.split("\n");

  if (lines.length === 0) {
    return null;
  }

  // Parse the header line: "diff --git a/path b/path"
  const headerMatch = lines[0].match(/^diff --git a\/(.+?) b\/(.+)$/);
  if (!headerMatch) {
    return null;
  }

  let oldPath: string | null = headerMatch[1];
  let newPath: string | null = headerMatch[2];
  let type: ParsedDiffFile["type"] = "modified";
  let similarity: number | undefined;
  const hunks: DiffHunk[] = [];
  let additions = 0;
  let deletions = 0;

  let i = 1;

  // Parse extended headers (before --- and +++)
  while (i < lines.length) {
    const line = lines[i];

    if (line.startsWith("similarity index ")) {
      const match = line.match(/similarity index (\d+)%/);
      if (match) {
        similarity = parseInt(match[1], 10);
      }
      i++;
    } else if (line.startsWith("rename from ")) {
      type = "renamed";
      i++;
    } else if (line.startsWith("rename to ")) {
      i++;
    } else if (line.startsWith("new file mode")) {
      type = "added";
      i++;
    } else if (line.startsWith("deleted file mode")) {
      type = "deleted";
      i++;
    } else if (line.startsWith("index ")) {
      i++;
    } else if (line.startsWith("Binary files")) {
      type = "binary";
      i++;
    } else if (line.startsWith("---") || line.startsWith("@@")) {
      // Reached the actual diff content
      break;
    } else {
      // Skip other extended header lines (old mode, new mode, etc.)
      i++;
    }
  }

  // Parse --- and +++ lines
  while (i < lines.length) {
    const line = lines[i];

    if (line.startsWith("--- ")) {
      const path = line.slice(4);
      if (path === "/dev/null") {
        oldPath = null;
        type = "added";
      } else if (path.startsWith("a/")) {
        oldPath = path.slice(2);
      }
      i++;
    } else if (line.startsWith("+++ ")) {
      const path = line.slice(4);
      if (path === "/dev/null") {
        newPath = null;
        type = "deleted";
      } else if (path.startsWith("b/")) {
        newPath = path.slice(2);
      }
      i++;
    } else if (line.startsWith("@@")) {
      // Start of hunks
      break;
    } else {
      i++;
    }
  }

  // Parse hunks
  while (i < lines.length) {
    const line = lines[i];

    if (line.startsWith("@@")) {
      const hunkResult = parseHunk(lines, i);
      if (hunkResult) {
        hunks.push(hunkResult.hunk);
        additions += hunkResult.additions;
        deletions += hunkResult.deletions;
        i = hunkResult.nextIndex;
      } else {
        i++;
      }
    } else {
      i++;
    }
  }

  // Determine language from the file path
  const filePath = newPath || oldPath || "";
  const language = detectLanguage(filePath);

  return {
    oldPath,
    newPath,
    type,
    similarity,
    hunks,
    stats: {
      additions,
      deletions,
    },
    language,
    isBinary: type === "binary",
  };
}

/**
 * Parses a single hunk starting at the given index.
 * Returns the parsed hunk, stats, and the next line index.
 */
function parseHunk(
  lines: string[],
  startIndex: number
): { hunk: DiffHunk; additions: number; deletions: number; nextIndex: number } | null {
  const headerLine = lines[startIndex];

  // Parse hunk header: @@ -oldStart,oldLines +newStart,newLines @@ optional section header
  // Note: count can be omitted if it's 1 (e.g., @@ -1 +1,2 @@)
  const hunkMatch = headerLine.match(
    /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/
  );
  if (!hunkMatch) {
    return null;
  }

  const oldStart = parseInt(hunkMatch[1], 10);
  const oldLines = hunkMatch[2] !== undefined ? parseInt(hunkMatch[2], 10) : 1;
  const newStart = parseInt(hunkMatch[3], 10);
  const newLines = hunkMatch[4] !== undefined ? parseInt(hunkMatch[4], 10) : 1;
  const sectionHeader = hunkMatch[5].trim() || undefined;

  const diffLines: DiffLine[] = [];
  let oldLineNum = oldStart;
  let newLineNum = newStart;
  let additions = 0;
  let deletions = 0;

  let i = startIndex + 1;
  let consumedOld = 0;
  let consumedNew = 0;

  while (i < lines.length && (consumedOld < oldLines || consumedNew < newLines)) {
    const line = lines[i];

    // Stop at next hunk or next file (safety guard)
    if (line.startsWith("@@") || line.startsWith("diff --git ")) {
      break;
    }

    // Handle "\ No newline at end of file" marker
    // This line starts with a backslash and is not a diff content line
    if (line.startsWith("\\")) {
      i++;
      continue;
    }

    if (line.startsWith("+")) {
      // Addition line
      diffLines.push({
        type: "addition",
        content: line.slice(1),
        oldLineNumber: null,
        newLineNumber: newLineNum,
      });
      newLineNum++;
      consumedNew++;
      additions++;
      i++;
    } else if (line.startsWith("-")) {
      // Deletion line
      diffLines.push({
        type: "deletion",
        content: line.slice(1),
        oldLineNumber: oldLineNum,
        newLineNumber: null,
      });
      oldLineNum++;
      consumedOld++;
      deletions++;
      i++;
    } else {
      // Context line (starts with space) or empty line (stripped space prefix
      // from diff.suppressBlankEmpty). Both count toward old AND new side.
      const content = line.startsWith(" ") ? line.slice(1) : line;
      diffLines.push({
        type: "context",
        content,
        oldLineNumber: oldLineNum,
        newLineNumber: newLineNum,
      });
      oldLineNum++;
      newLineNum++;
      consumedOld++;
      consumedNew++;
      i++;
    }
  }

  return {
    hunk: {
      oldStart,
      oldLines,
      newStart,
      newLines,
      sectionHeader,
      lines: diffLines,
    },
    additions,
    deletions,
    nextIndex: i,
  };
}
