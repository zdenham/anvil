import type { AnnotatedFile } from "@/components/diff-viewer/types";
import { highlightDiff } from "./highlight-diff";
import { logger } from "./logger-client";

/**
 * Add syntax highlighting tokens to annotated files.
 * Modifies files in-place for efficiency.
 *
 * This function highlights all files in parallel, using the existing
 * Shiki highlighter infrastructure with LRU caching.
 */
export async function highlightAnnotatedFiles(
  files: AnnotatedFile[],
  fullFileContents: Record<string, string[]>
): Promise<void> {
  await Promise.all(
    files.map(async (file) => {
      // Skip binary files
      if (file.file.isBinary || file.file.type === "binary") {
        return;
      }

      const filePath = file.file.newPath ?? file.file.oldPath;
      if (!filePath) return;

      // Get old and new content
      const oldPath = file.file.oldPath;
      const newPath = file.file.newPath;

      const oldContent =
        oldPath && fullFileContents[oldPath]
          ? fullFileContents[oldPath].join("\n")
          : "";
      const newContent =
        newPath && fullFileContents[newPath]
          ? fullFileContents[newPath].join("\n")
          : "";

      // Convert AnnotatedLine[] to DiffLine[] format expected by highlightDiff
      const diffLines = file.lines.map((line) => ({
        type: line.type === "unchanged" ? ("context" as const) : line.type,
        content: line.content,
        oldLineNumber: line.oldLineNumber,
        newLineNumber: line.newLineNumber,
      }));

      try {
        const highlighted = await highlightDiff(
          oldContent,
          newContent,
          diffLines,
          file.file.language
        );

        // Merge tokens back into annotated lines
        for (let i = 0; i < file.lines.length; i++) {
          file.lines[i].tokens = highlighted[i]?.tokens;
        }
      } catch (error) {
        // Graceful degradation: leave tokens undefined, render as plain text
        logger.warn(`Syntax highlighting failed for ${filePath}:`, error);
      }
    })
  );
}
