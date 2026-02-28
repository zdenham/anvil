import type { ParsedDiff, ParsedDiffFile, DiffLine } from "./diff-parser";
import { calculatePriority } from "./diff-prioritizer";

export interface AnnotatedFile {
  /** Original parsed file metadata */
  file: ParsedDiffFile;
  /** Priority score (higher = more important), computed by prioritizer */
  priority: number;
  /**
   * All lines in display order: full file content + deleted lines inserted at positions.
   * This is the "merged view" that shows the complete picture.
   */
  lines: AnnotatedLine[];
}

export interface AnnotatedLine {
  /** Line type determines highlighting */
  type: "unchanged" | "addition" | "deletion";
  /** Line content */
  content: string;
  /** Line number in old file (null for additions) */
  oldLineNumber: number | null;
  /** Line number in new file (null for deletions) */
  newLineNumber: number | null;
}

/**
 * Build annotated lines for a modified/added file.
 * Merges full file content with diff annotations.
 */
function buildAnnotatedFile(
  parsedFile: ParsedDiffFile,
  fullContent: string[]
): AnnotatedLine[] {
  const result: AnnotatedLine[] = [];
  const totalLines = fullContent.length;

  // Build lookup maps from hunk data
  // Key: new line number, Value: line info from diff
  const additionLines = new Map<number, DiffLine>();
  // Deletions grouped by their insertion point (the new line number AFTER which they appear)
  const deletionsByInsertPoint = new Map<number, DiffLine[]>();

  for (const hunk of parsedFile.hunks) {
    let lastNewLineNum = hunk.newStart - 1; // Track position for deletion insertion

    for (const line of hunk.lines) {
      if (line.type === "addition") {
        additionLines.set(line.newLineNumber!, line);
        lastNewLineNum = line.newLineNumber!;
      } else if (line.type === "deletion") {
        // Deletions are inserted AFTER the last seen new line number
        // (which could be a context line or an addition)
        const insertPoint = lastNewLineNum;
        if (!deletionsByInsertPoint.has(insertPoint)) {
          deletionsByInsertPoint.set(insertPoint, []);
        }
        deletionsByInsertPoint.get(insertPoint)!.push(line);
      } else if (line.type === "context") {
        lastNewLineNum = line.newLineNumber!;
      }
    }
  }

  // Pre-compute running counts for O(n) performance instead of O(n²)
  // additionsUpTo[i] = count of additions with newLineNumber <= i
  // deletionsUpTo[i] = count of deletions with insertPoint <= i
  const additionsUpTo = new Array(totalLines + 2).fill(0);
  const deletionsUpTo = new Array(totalLines + 2).fill(0);

  for (let i = 1; i <= totalLines + 1; i++) {
    additionsUpTo[i] = additionsUpTo[i - 1] + (additionLines.has(i) ? 1 : 0);
    deletionsUpTo[i] =
      deletionsUpTo[i - 1] + (deletionsByInsertPoint.get(i - 1)?.length ?? 0);
  }

  // Build the annotated output by walking through new file line numbers
  // Insert deletions at their correct positions
  for (let newLineNum = 1; newLineNum <= totalLines; newLineNum++) {
    // First, insert any deletions that come BEFORE this line
    // (deletions anchored to the previous line number)
    const deletionsHere = deletionsByInsertPoint.get(newLineNum - 1);
    if (deletionsHere) {
      for (const del of deletionsHere) {
        result.push({
          type: "deletion",
          content: del.content,
          oldLineNumber: del.oldLineNumber,
          newLineNumber: null,
        });
      }
    }

    // Now add the current line from the new file
    // NOTE: We use fullContent instead of addition.content because the actual
    // file content is authoritative - diff content may be truncated or have
    // whitespace differences depending on the diff generation tool.
    const addition = additionLines.get(newLineNum);
    if (addition) {
      result.push({
        type: "addition",
        content: fullContent[newLineNum - 1],
        oldLineNumber: null,
        newLineNumber: newLineNum,
      });
    } else {
      // Unchanged line - compute oldLineNumber using pre-computed counts
      // Formula: oldLineNum = newLineNum - additions_before + deletions_before
      // Note: deletions at insert point < newLineNum means deletionsUpTo[newLineNum]
      const additionsBefore = additionsUpTo[newLineNum - 1];
      const deletionsBefore = deletionsUpTo[newLineNum];
      const oldLineNum = newLineNum - additionsBefore + deletionsBefore;

      result.push({
        type: "unchanged",
        content: fullContent[newLineNum - 1],
        oldLineNumber: oldLineNum,
        newLineNumber: newLineNum,
      });
    }
  }

  // Handle trailing deletions (at end of file)
  const trailingDeletions = deletionsByInsertPoint.get(totalLines);
  if (trailingDeletions) {
    for (const del of trailingDeletions) {
      result.push({
        type: "deletion",
        content: del.content,
        oldLineNumber: del.oldLineNumber,
        newLineNumber: null,
      });
    }
  }

  return result;
}

/**
 * Build annotated lines for a deleted file.
 * All lines are marked as deletions.
 */
function buildDeletedFileAnnotation(
  _parsedFile: ParsedDiffFile,
  oldContent: string[]
): AnnotatedLine[] {
  return oldContent.map((content, index) => ({
    type: "deletion" as const,
    content,
    oldLineNumber: index + 1,
    newLineNumber: null,
  }));
}

/**
 * Build annotated files from a parsed diff and full file contents.
 *
 * @param parsedDiff - The parsed diff from Phase 1
 * @param fullFileContents - Map of file path → array of lines.
 *   Key should be `newPath` for modified/added files, `oldPath` for deleted files.
 *   Files not in this map (e.g., binary files) will have empty `lines` array.
 * @param priorityFn - Optional custom priority function (defaults to calculatePriority)
 */
export function buildAnnotatedFiles(
  parsedDiff: ParsedDiff,
  fullFileContents: Record<string, string[]>,
  priorityFn: (file: ParsedDiffFile) => number = calculatePriority
): AnnotatedFile[] {
  const result = parsedDiff.files.map((file) => {
    const priority = priorityFn(file);

    // Skip binary files
    if (file.type === "binary") {
      return { file, priority, lines: [] };
    }

    // Determine which path to use for content lookup
    const contentKey = file.type === "deleted" ? file.oldPath : file.newPath;
    const content = fullFileContents[contentKey ?? ""];

    // Handle missing content
    if (!content) {
      return { file, priority, lines: [] };
    }

    // Build appropriate annotation based on file type
    const lines =
      file.type === "deleted"
        ? buildDeletedFileAnnotation(file, content)
        : buildAnnotatedFile(file, content);

    return { file, priority, lines };
  });

  return result;
}
