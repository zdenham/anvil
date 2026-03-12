/**
 * Diff fetching and processing utilities for the Changes content pane.
 *
 * Handles merge base resolution, raw diff fetching (with commit caching),
 * and parsing/splitting raw diffs into per-file chunks.
 */

import { gitCommands, fsCommands } from "@/lib/tauri-commands";
import { parseDiff, type ParsedDiff, type ParsedDiffFile } from "@/lib/diff-parser";
import { logger } from "@/lib/logger-client";
import { updateRangeDiffCache } from "./changes-diff-cache";

export const MAX_DISPLAYED_FILES = 300;

/** Cache for immutable single-commit diffs (includes file contents after first fetch) */
const commitDiffCache = new Map<string, {
  raw: string;
  parsed: ParsedDiff;
  fileContents?: Record<string, FileContentEntry>;
}>();

/** Get cached file contents for a commit (if previously fetched) */
export function getCachedCommitFileContents(
  commitHash: string,
): Record<string, FileContentEntry> | undefined {
  return commitDiffCache.get(commitHash)?.fileContents;
}

/** Store file contents in the commit diff cache */
function cacheCommitFileContents(
  commitHash: string,
  fileContents: Record<string, FileContentEntry>,
): void {
  const entry = commitDiffCache.get(commitHash);
  if (entry) {
    entry.fileContents = fileContents;
  }
}

// ─── Merge base resolution ──────────────────────────────────────────────────

export async function resolveMergeBase(
  worktreePath: string,
  currentBranch: string | null,
  defaultBranch: string
): Promise<string> {
  const remoteRef = `origin/${defaultBranch}`;

  // On default branch: diff against origin/<defaultBranch> directly
  // (shows unpushed work — merge-base would return HEAD itself)
  if (currentBranch === defaultBranch) {
    return getRemoteFallback(worktreePath, defaultBranch);
  }

  // Detached HEAD or feature branch: compute merge-base against remote ref
  try {
    return await gitCommands.getMergeBase(worktreePath, "HEAD", remoteRef);
  } catch {
    logger.warn("[changes] getMergeBase failed, falling back to remote ref");
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

  // All changes mode — use local refs (fast, no network call)
  const mergeBase = await resolveMergeBase(worktreePath, currentBranch, defaultBranch);
  const raw = await gitCommands.diffRange(worktreePath, mergeBase);
  const parsed = parseDiff(raw);
  updateRangeDiffCache(worktreePath, { raw, parsed, mergeBase });
  return { raw, parsed, mergeBase };
}

/**
 * Runs `git fetch origin` in the background, then checks if the merge-base changed.
 * If it changed, recomputes the diff and updates the range cache.
 */
export async function backgroundFetchOrigin(params: {
  worktreePath: string;
  defaultBranch: string;
  currentBranch: string | null;
  previousMergeBase: string;
}): Promise<{ changed: boolean; result?: FetchDiffResult }> {
  const { worktreePath, defaultBranch, currentBranch, previousMergeBase } = params;

  try {
    await gitCommands.fetch(worktreePath, "origin");
  } catch {
    logger.warn("[changes] background fetch failed");
    return { changed: false };
  }

  const newMergeBase = await resolveMergeBase(worktreePath, currentBranch, defaultBranch);
  if (newMergeBase === previousMergeBase) {
    return { changed: false };
  }

  const raw = await gitCommands.diffRange(worktreePath, newMergeBase);
  const parsed = parseDiff(raw);
  updateRangeDiffCache(worktreePath, { raw, parsed, mergeBase: newMergeBase });
  return { changed: true, result: { raw, parsed, mergeBase: newMergeBase } };
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

// ─── File content fetching ───────────────────────────────────────────────────

export interface FileContentEntry {
  oldContent?: string;
  newContent?: string;
}

/**
 * Fetch full file contents (old + new) for syntax highlighting.
 *
 * Modes:
 * - commitHash: old = git show <hash>~1:<path>, new = git show <hash>:<path>
 * - uncommittedOnly: old = git show HEAD:<path>, new = read from disk
 * - default (mergeBase): old = git show <mergeBase>:<path>, new = read from disk
 */
export async function fetchFileContents(params: {
  worktreePath: string;
  files: ParsedDiffFile[];
  mergeBase: string | null;
  commitHash?: string;
  uncommittedOnly?: boolean;
}): Promise<Record<string, FileContentEntry>> {
  const { worktreePath, files, mergeBase, commitHash, uncommittedOnly } = params;

  // Commit mode: use bulk cat-file --batch (2 subprocesses instead of 2*N)
  if (commitHash) {
    return fetchCommitFileContentsBulk(worktreePath, files, commitHash);
  }

  const result: Record<string, FileContentEntry> = {};

  const fetches = files.map(async (file) => {
    const filePath = file.newPath ?? file.oldPath;
    if (!filePath) return;

    const entry: FileContentEntry = {};

    try {
      if (uncommittedOnly) {
        await fetchUncommittedFileContent(worktreePath, filePath, file.type, entry);
      } else if (mergeBase) {
        await fetchRangeFileContent(worktreePath, filePath, file.type, mergeBase, entry);
      }
    } catch (err) {
      logger.warn(`[fetchFileContents] failed for ${filePath}:`, err);
    }

    result[filePath] = entry;
  });

  await Promise.all(fetches);
  return result;
}

/**
 * Bulk-fetch file contents for a commit using git cat-file --batch.
 * Returns a record keyed by file path with old/new content.
 */
async function fetchCommitFileContentsBulk(
  cwd: string,
  files: ParsedDiffFile[],
  commitHash: string,
): Promise<Record<string, FileContentEntry>> {
  const result: Record<string, FileContentEntry> = {};
  const filePaths: string[] = [];
  const oldRefs: string[] = [];
  const newRefs: string[] = [];

  for (const file of files) {
    const path = file.newPath ?? file.oldPath;
    if (!path) continue;
    filePaths.push(path);
    oldRefs.push(file.type !== "added" ? `${commitHash}~1:${path}` : "");
    newRefs.push(file.type !== "deleted" ? `${commitHash}:${path}` : "");
  }

  // Build a single refs array, filtering empties, and track index mapping
  const allRefs: string[] = [];
  const oldIndices: number[] = []; // index into allRefs for each file's old ref (-1 if skipped)
  const newIndices: number[] = [];

  for (let i = 0; i < filePaths.length; i++) {
    if (oldRefs[i]) {
      oldIndices.push(allRefs.length);
      allRefs.push(oldRefs[i]);
    } else {
      oldIndices.push(-1);
    }
  }
  for (let i = 0; i < filePaths.length; i++) {
    if (newRefs[i]) {
      newIndices.push(allRefs.length);
      allRefs.push(newRefs[i]);
    } else {
      newIndices.push(-1);
    }
  }

  if (allRefs.length === 0) return result;

  try {
    const batchResults = await gitCommands.catFileBatch(cwd, allRefs);

    for (let i = 0; i < filePaths.length; i++) {
      const entry: FileContentEntry = {};
      if (oldIndices[i] >= 0) {
        entry.oldContent = batchResults[oldIndices[i]] ?? undefined;
      }
      if (newIndices[i] >= 0) {
        entry.newContent = batchResults[newIndices[i]] ?? undefined;
      }
      result[filePaths[i]] = entry;
    }
  } catch (err) {
    logger.warn("[fetchCommitFileContentsBulk] batch failed, falling back to per-file:", err);
    // Fallback to per-file fetching
    const fetches = files.map(async (file) => {
      const filePath = file.newPath ?? file.oldPath;
      if (!filePath) return;
      const entry: FileContentEntry = {};
      const [oldContent, newContent] = await Promise.all([
        file.type !== "added" ? safeShowFile(cwd, filePath, `${commitHash}~1`) : undefined,
        file.type !== "deleted" ? safeShowFile(cwd, filePath, commitHash) : undefined,
      ]);
      entry.oldContent = oldContent;
      entry.newContent = newContent;
      result[filePath] = entry;
    });
    await Promise.all(fetches);
  }

  // Store in commit diff cache for instant repeat views
  cacheCommitFileContents(commitHash, result);
  return result;
}

async function fetchUncommittedFileContent(
  cwd: string, filePath: string, type: ParsedDiffFile["type"],
  entry: FileContentEntry,
): Promise<void> {
  const [oldContent, newContent] = await Promise.all([
    type !== "added" ? safeShowFile(cwd, filePath, "HEAD") : undefined,
    type !== "deleted" ? safeReadFile(cwd, filePath) : undefined,
  ]);
  entry.oldContent = oldContent;
  entry.newContent = newContent;
}

async function fetchRangeFileContent(
  cwd: string, filePath: string, type: ParsedDiffFile["type"],
  mergeBase: string, entry: FileContentEntry,
): Promise<void> {
  const [oldContent, newContent] = await Promise.all([
    type !== "added" ? safeShowFile(cwd, filePath, mergeBase) : undefined,
    type !== "deleted" ? safeReadFile(cwd, filePath) : undefined,
  ]);
  entry.oldContent = oldContent;
  entry.newContent = newContent;
}

async function safeShowFile(cwd: string, path: string, ref: string): Promise<string | undefined> {
  try {
    return await gitCommands.showFile(cwd, path, ref);
  } catch {
    return undefined;
  }
}

async function safeReadFile(cwd: string, path: string): Promise<string | undefined> {
  try {
    return await fsCommands.readFile(`${cwd}/${path}`);
  } catch {
    return undefined;
  }
}
