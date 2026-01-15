import type { ThemedToken } from "shiki";
import { highlightCode, initHighlighter } from "./syntax-highlighter";

/**
 * Type representing a line from parsed diff output.
 * This matches the DiffLine interface that will be defined in diff-parser.ts
 */
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

/**
 * A diff line with syntax highlighting tokens applied.
 */
export interface HighlightedDiffLine {
  /** Syntax-highlighted tokens for rendering */
  tokens: ThemedToken[];
  /** Type of diff line */
  lineType: "context" | "addition" | "deletion";
  /** Line number in old file (null for additions) */
  oldLineNumber: number | null;
  /** Line number in new file (null for deletions) */
  newLineNumber: number | null;
}

/**
 * Highlight a diff by applying syntax highlighting to both old and new content,
 * then mapping the appropriate tokens to each diff line.
 *
 * This function:
 * 1. Highlights the full old content to get tokens for deletions/context
 * 2. Highlights the full new content to get tokens for additions/context
 * 3. Maps each diff line to its corresponding highlighted tokens
 *
 * Highlighting full files preserves multi-line syntax constructs like
 * strings, comments, and template literals.
 *
 * @param oldContent - The original file content (can be empty for new files)
 * @param newContent - The new file content (can be empty for deleted files)
 * @param diffLines - Parsed diff lines from the diff parser
 * @param language - Shiki language identifier for syntax highlighting
 * @returns Array of diff lines with syntax highlighting tokens
 */
export async function highlightDiff(
  oldContent: string,
  newContent: string,
  diffLines: DiffLine[],
  language: string
): Promise<HighlightedDiffLine[]> {
  // Ensure highlighter is initialized
  await initHighlighter();

  // Highlight both versions of the file
  const [oldTokens, newTokens] = await Promise.all([
    oldContent ? highlightCode(oldContent, language) : Promise.resolve([]),
    newContent ? highlightCode(newContent, language) : Promise.resolve([]),
  ]);

  // Map diff lines to their highlighted tokens
  return diffLines.map((line): HighlightedDiffLine => {
    let tokens: ThemedToken[];

    switch (line.type) {
      case "deletion":
        // Deletions come from old file - use oldLineNumber (1-indexed)
        tokens = getTokensForLine(oldTokens, line.oldLineNumber);
        break;

      case "addition":
        // Additions come from new file - use newLineNumber (1-indexed)
        tokens = getTokensForLine(newTokens, line.newLineNumber);
        break;

      case "context":
        // Context lines exist in both files, use new file version
        // (they should be identical, but new file is the "current" state)
        tokens = getTokensForLine(newTokens, line.newLineNumber);
        break;
    }

    return {
      tokens,
      lineType: line.type,
      oldLineNumber: line.oldLineNumber,
      newLineNumber: line.newLineNumber,
    };
  });
}

/**
 * Get tokens for a specific line number from highlighted content.
 * Line numbers are 1-indexed (matching git diff output).
 *
 * @param tokenLines - Array of token arrays from highlightCode
 * @param lineNumber - 1-indexed line number (or null)
 * @returns Tokens for that line, or a single plain token if not found
 */
function getTokensForLine(
  tokenLines: ThemedToken[][],
  lineNumber: number | null
): ThemedToken[] {
  if (lineNumber === null) {
    return [{ content: "", color: undefined, offset: 0 }];
  }

  // Convert 1-indexed line number to 0-indexed array index
  const index = lineNumber - 1;

  if (index >= 0 && index < tokenLines.length) {
    return tokenLines[index];
  }

  // Fallback for out-of-bounds (shouldn't happen with correct parsing)
  return [{ content: "", color: undefined, offset: 0 }];
}

/**
 * Highlight a single code block without diff context.
 * Useful for displaying file content outside of diff view.
 *
 * @param content - The code content to highlight
 * @param language - Shiki language identifier
 * @returns Array of token arrays (one per line)
 */
export async function highlightCodeBlock(
  content: string,
  language: string
): Promise<ThemedToken[][]> {
  await initHighlighter();
  return highlightCode(content, language);
}
