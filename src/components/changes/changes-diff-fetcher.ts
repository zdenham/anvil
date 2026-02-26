/**
 * Diff fetching and processing utilities for the Changes content pane.
 *
 * Handles merge base resolution, raw diff fetching (with commit caching),
 * and parsing/splitting raw diffs into per-file chunks.
 */

import { gitCommands } from "@/lib/tauri-commands";
import { parseDiff, type ParsedDiff, type ParsedDiffFile } from "@/lib/diff-parser";
import { logger } from "@/lib/logger-client";

export const MAX_DISPLAYED_FILES = 300;

/** Cache for immutable single-commit diffs */
const commitDiffCache = new Map<string, { raw: string; parsed: ParsedDiff }>();

// ─── Merge base resolution ──────────────────────────────────────────────────

export async function resolveMergeBase(
  worktreePath: string,
  currentBranch: string | null,
  defaultBranch: string
): Promise<string> {
  // Detached HEAD or on default branch: diff against origin/<defaultBranch>
  if (!currentBranch || currentBranch === defaultBranch) {
    return getRemoteFallback(worktreePath, defaultBranch);
  }

  // Feature branch: compute merge base
  try {
    return await gitCommands.getMergeBase(worktreePath, currentBranch, defaultBranch);
  } catch {
    logger.warn("[changes] getMergeBase failed, falling back to remote");
    return getRemoteFallback(worktreePath, defaultBranch);
  }
}

async function getRemoteFallback(worktreePath: string, defaultBranch: string): Promise<string> {
  return gitCommands.getRemoteBranchCommit(worktreePath, "origin", defaultBranch);
}

// ─── Raw diff fetching ──────────────────────────────────────────────────────

export interface FetchDiffResult {
  raw: string;
  parsed: ParsedDiff;
  mergeBase: string | null;
}

export async function fetchRawDiff(params: {
  worktreePath: string;
  defaultBranch: string;
  currentBranch: string | null;
  uncommittedOnly?: boolean;
  commitHash?: string;
}): Promise<FetchDiffResult> {
  const { worktreePath, defaultBranch, currentBranch, uncommittedOnly, commitHash } = params;

  // Single commit mode (immutable, cached)
  if (commitHash) {
    const cached = commitDiffCache.get(commitHash);
    if (cached) {
      return { raw: cached.raw, parsed: cached.parsed, mergeBase: null };
    }
    const raw = await gitCommands.diffCommit(worktreePath, commitHash);
    const parsed = parseDiff(raw);
    commitDiffCache.set(commitHash, { raw, parsed });
    return { raw, parsed, mergeBase: null };
  }

  // Uncommitted only mode
  if (uncommittedOnly) {
    const raw = await gitCommands.diffUncommitted(worktreePath);
    return { raw, parsed: parseDiff(raw), mergeBase: null };
  }

  // All changes mode — resolve merge base first
  const mergeBase = await resolveMergeBase(worktreePath, currentBranch, defaultBranch);
  const raw = await gitCommands.diffRange(worktreePath, mergeBase);
  return { raw, parsed: parseDiff(raw), mergeBase };
}

// ─── Diff processing ────────────────────────────────────────────────────────

export interface ProcessedDiff {
  files: ParsedDiffFile[];
  totalFileCount: number;
  rawDiffsByFile: Record<string, string>;
  changedFilePaths: string[];
}

export function processParsedDiff(
  parsedDiff: ParsedDiff | null,
  rawDiffString: string | null
): ProcessedDiff {
  if (!parsedDiff || !rawDiffString) {
    return { files: [], totalFileCount: 0, rawDiffsByFile: {}, changedFilePaths: [] };
  }

  const nonBinaryFiles = parsedDiff.files.filter((f) => !f.isBinary && f.type !== "binary");
  const totalFileCount = nonBinaryFiles.length;
  const files = nonBinaryFiles.slice(0, MAX_DISPLAYED_FILES);
  const rawDiffsByFile = extractPerFileDiffs(rawDiffString, files);

  const changedFilePaths = files
    .map((f) => f.newPath ?? f.oldPath)
    .filter((p): p is string => p !== null);

  return { files, totalFileCount, rawDiffsByFile, changedFilePaths };
}

/**
 * Splits raw diff output into per-file chunks keyed by file path.
 */
function extractPerFileDiffs(
  rawDiff: string,
  files: ParsedDiffFile[]
): Record<string, string> {
  const result: Record<string, string> = {};
  const lines = rawDiff.split("\n");
  const fileChunks: string[] = [];
  let currentChunk: string[] = [];

  for (const line of lines) {
    if (line.startsWith("diff --git ")) {
      if (currentChunk.length > 0) {
        fileChunks.push(currentChunk.join("\n"));
      }
      currentChunk = [line];
    } else {
      currentChunk.push(line);
    }
  }
  if (currentChunk.length > 0) {
    fileChunks.push(currentChunk.join("\n"));
  }

  for (const chunk of fileChunks) {
    const headerMatch = chunk.match(/^diff --git a\/(.+?) b\/(.+)/);
    if (!headerMatch) continue;

    const newPath = headerMatch[2];
    const oldPath = headerMatch[1];
    const matchedFile = files.find((f) => f.newPath === newPath || f.oldPath === oldPath);
    if (matchedFile) {
      const key = matchedFile.newPath ?? matchedFile.oldPath ?? "";
      result[key] = chunk;
    }
  }

  return result;
}
