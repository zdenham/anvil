/**
 * Types for the diff viewer component.
 * See plans/diff-viewer/readme.md for full architecture.
 */

import type { ThemedToken } from "shiki";

// ============================================================================
// Parser Types (from Phase 1)
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
  /** Hunks from the diff */
  hunks: DiffHunk[];
  /** Summary statistics */
  stats: {
    additions: number;
    deletions: number;
  };
  /** Detected language for syntax highlighting */
  language: string;
  /** Whether file is binary */
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
  /** Individual line changes */
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
// Annotated File Types (from Phase 2)
// ============================================================================

export interface AnnotatedFile {
  /** Original parsed file metadata */
  file: ParsedDiffFile;
  /** Priority score (higher = more important) */
  priority: number;
  /** All lines in display order: full file content + deleted lines inserted at positions */
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
  /** Syntax highlighting tokens (optional, populated async) */
  tokens?: ThemedToken[];
}

// ============================================================================
// Collapsed Region Types (from Phase 5)
// ============================================================================

export interface CollapsedRegion {
  /** Index of first line in this region (into AnnotatedLine[]) */
  startIndex: number;
  /** Index of last line in this region (inclusive) */
  endIndex: number;
  /** Number of lines in this region */
  lineCount: number;
  /** What type of lines this region contains */
  kind: "unchanged" | "added" | "deleted";
}

