import { useMemo } from "react";
import {
  extractDiffFromToolResult,
  generateEditDiff,
  generateWriteDiff,
} from "@/lib/utils/diff-extractor";
import type { EditToolInput, WriteToolInput } from "@/lib/utils/diff-extractor";
import type { AnnotatedLine } from "@/components/diff-viewer/types";
import { logger } from "@/lib/logger-client";

/**
 * Result of diff extraction/generation for a tool use.
 */
export interface ToolDiffData {
  filePath: string;
  /** Diff string (from completed result) */
  diff?: string;
  /** Annotated lines (generated from input) */
  lines?: AnnotatedLine[];
  /** Stats (additions/deletions) */
  stats?: { additions: number; deletions: number };
  /** Whether this was extracted from result vs generated from input */
  fromResult: boolean;
}

// Runtime validators for tool input shapes
function isValidEditInput(input: unknown): input is EditToolInput {
  return (
    typeof input === "object" &&
    input !== null &&
    typeof (input as EditToolInput).file_path === "string" &&
    typeof (input as EditToolInput).old_string === "string" &&
    typeof (input as EditToolInput).new_string === "string"
  );
}

function isValidWriteInput(input: unknown): input is WriteToolInput {
  return (
    typeof input === "object" &&
    input !== null &&
    typeof (input as WriteToolInput).file_path === "string" &&
    typeof (input as WriteToolInput).content === "string"
  );
}

/**
 * Hook to extract or generate diff data from tool use.
 * Returns diff data for Edit/Write tools, null for other tools.
 */
export function useToolDiff(
  name: string,
  input: Record<string, unknown>,
  result?: string
): ToolDiffData | null {
  const isEditTool = name.toLowerCase() === "edit";
  const isWriteTool = name.toLowerCase() === "write";

  return useMemo(() => {
    // First try extracting from completed result
    const extracted = extractDiffFromToolResult(name, result);
    if (extracted) {
      return {
        filePath: extracted.filePath,
        diff: extracted.diff,
        lines: undefined,
        stats: undefined,
        fromResult: true,
      };
    }

    // For pending/running, generate from input with runtime validation
    if (isEditTool && input) {
      if (isValidEditInput(input)) {
        const generated = generateEditDiff(input);
        return {
          filePath: generated.filePath,
          diff: undefined,
          lines: generated.lines,
          stats: generated.stats,
          fromResult: false,
        };
      } else {
        logger.warn("Invalid EditToolInput shape", { input });
        return null;
      }
    }

    if (isWriteTool && input) {
      if (isValidWriteInput(input)) {
        const generated = generateWriteDiff(input);
        return {
          filePath: generated.filePath,
          diff: undefined,
          lines: generated.lines,
          stats: generated.stats,
          fromResult: false,
        };
      } else {
        logger.warn("Invalid WriteToolInput shape", { input });
        return null;
      }
    }

    return null;
  }, [name, result, input, isEditTool, isWriteTool]);
}
