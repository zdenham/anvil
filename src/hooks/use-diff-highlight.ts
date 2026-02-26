import { useState, useEffect, useMemo } from "react";
import type { ThemedToken } from "shiki";
import type { AnnotatedLine } from "@/components/diff-viewer/types";
import { getLanguageFromPath } from "@/lib/language-detection";
import { highlightCode, getCachedTokens } from "@/lib/syntax-highlighter";

/**
 * Reconstruct full old and new file text from annotated lines.
 *
 * When lines have contiguous line numbers (from buildAnnotatedFiles with full
 * content), we place each line at its correct position to reconstruct the
 * complete files. This gives Shiki full file context for correct tokenization.
 *
 * Returns null when lines have gaps between hunks (count < max line number),
 * since filling gaps with empty strings corrupts Shiki's lexer state.
 */
function reconstructFullFiles(lines: AnnotatedLine[]): { oldText: string; newText: string } | null {
  let maxOld = 0;
  let maxNew = 0;
  let oldCount = 0;
  let newCount = 0;

  for (const line of lines) {
    if (line.oldLineNumber != null) {
      oldCount++;
      if (line.oldLineNumber > maxOld) maxOld = line.oldLineNumber;
    }
    if (line.newLineNumber != null) {
      newCount++;
      if (line.newLineNumber > maxNew) maxNew = line.newLineNumber;
    }
  }

  if (oldCount === 0 && newCount === 0) return null;
  if (oldCount !== maxOld || newCount !== maxNew) return null;

  const oldLines: string[] = new Array(maxOld).fill("");
  const newLines: string[] = new Array(maxNew).fill("");

  for (const line of lines) {
    if (line.oldLineNumber != null) {
      oldLines[line.oldLineNumber - 1] = line.content;
    }
    if (line.newLineNumber != null) {
      newLines[line.newLineNumber - 1] = line.content;
    }
  }

  return {
    oldText: oldLines.join("\n"),
    newText: newLines.join("\n"),
  };
}

/**
 * Apply highlighted tokens onto AnnotatedLines using their original line numbers.
 * Deletions map to oldTokens via oldLineNumber, additions and unchanged to newTokens via newLineNumber.
 */
function applyTokensByLineNumber(
  lines: AnnotatedLine[],
  oldTokens: ThemedToken[][],
  newTokens: ThemedToken[][],
): AnnotatedLine[] {
  return lines.map((line) => {
    let tokens: ThemedToken[] | undefined;

    if (line.type === "deletion" && line.oldLineNumber != null) {
      tokens = oldTokens[line.oldLineNumber - 1];
    } else if (line.newLineNumber != null) {
      tokens = newTokens[line.newLineNumber - 1];
    }

    if (!tokens) return line;
    return { ...line, tokens };
  });
}

/** Per-hunk mapping entry: which annotated line maps to which side/index */
interface HunkMapping {
  lineIdx: number;
  side: "old" | "new";
  sideIdx: number;
}

/** A single hunk's text and mapping info for independent highlighting */
interface HunkHighlightData {
  oldText: string;
  newText: string;
  mappings: HunkMapping[];
}

/**
 * Split annotated lines into hunks by detecting gaps in line numbers,
 * then build per-hunk old/new text for independent highlighting.
 */
function buildPerHunkFiles(lines: AnnotatedLine[]): HunkHighlightData[] {
  if (lines.length === 0) return [];

  // Detect hunk boundaries by gaps in line numbers
  const hunkBounds: { startIdx: number; endIdx: number }[] = [];
  let hunkStart = 0;

  for (let i = 1; i < lines.length; i++) {
    const prev = lines[i - 1];
    const curr = lines[i];
    const prevNew = prev.newLineNumber ?? prev.oldLineNumber ?? 0;
    const currNew = curr.newLineNumber ?? curr.oldLineNumber ?? 0;
    const prevOld = prev.oldLineNumber ?? prev.newLineNumber ?? 0;
    const currOld = curr.oldLineNumber ?? curr.newLineNumber ?? 0;

    const newGap = curr.newLineNumber != null && prev.newLineNumber != null && currNew - prevNew > 1;
    const oldGap = curr.oldLineNumber != null && prev.oldLineNumber != null && currOld - prevOld > 1;

    if (newGap || oldGap) {
      hunkBounds.push({ startIdx: hunkStart, endIdx: i });
      hunkStart = i;
    }
  }
  hunkBounds.push({ startIdx: hunkStart, endIdx: lines.length });

  return hunkBounds.map(({ startIdx, endIdx }) => {
    const hunkLines = lines.slice(startIdx, endIdx);
    const oldLines: string[] = [];
    const newLines: string[] = [];
    const mappings: HunkMapping[] = [];

    for (let i = 0; i < hunkLines.length; i++) {
      const line = hunkLines[i];
      const globalIdx = startIdx + i;

      if (line.type === "deletion") {
        mappings.push({ lineIdx: globalIdx, side: "old", sideIdx: oldLines.length });
        oldLines.push(line.content);
      } else if (line.type === "addition") {
        mappings.push({ lineIdx: globalIdx, side: "new", sideIdx: newLines.length });
        newLines.push(line.content);
      } else {
        // unchanged: appears in both sides, map to new side for tokens
        oldLines.push(line.content);
        mappings.push({ lineIdx: globalIdx, side: "new", sideIdx: newLines.length });
        newLines.push(line.content);
      }
    }

    return {
      oldText: oldLines.join("\n"),
      newText: newLines.join("\n"),
      mappings,
    };
  });
}

/**
 * Apply per-hunk highlighted tokens back onto the annotated lines array.
 */
function applyPerHunkTokens(
  lines: AnnotatedLine[],
  hunks: HunkHighlightData[],
  hunkTokenPairs: { oldTokens: ThemedToken[][]; newTokens: ThemedToken[][] }[],
): AnnotatedLine[] {
  const result = [...lines];

  for (let h = 0; h < hunks.length; h++) {
    const { mappings } = hunks[h];
    const { oldTokens, newTokens } = hunkTokenPairs[h];

    for (const { lineIdx, side, sideIdx } of mappings) {
      const tokens = side === "old" ? oldTokens[sideIdx] : newTokens[sideIdx];
      if (tokens) {
        result[lineIdx] = { ...result[lineIdx], tokens };
      }
    }
  }

  return result;
}

/**
 * Try to resolve tokens synchronously from cache using full-file line numbers.
 */
function trySyncHighlight(
  lines: AnnotatedLine[],
  oldText: string,
  newText: string,
  language: string,
): AnnotatedLine[] | null {
  const cachedOld = oldText ? getCachedTokens(oldText, language) : [];
  const cachedNew = newText ? getCachedTokens(newText, language) : [];

  if (!cachedOld || !cachedNew) return null;

  return applyTokensByLineNumber(lines, cachedOld, cachedNew);
}

/**
 * Try to resolve per-hunk tokens synchronously from cache.
 */
function trySyncHunkHighlight(
  lines: AnnotatedLine[],
  hunks: HunkHighlightData[],
  language: string,
): AnnotatedLine[] | null {
  const hunkTokenPairs: { oldTokens: ThemedToken[][]; newTokens: ThemedToken[][] }[] = [];

  for (const hunk of hunks) {
    const cachedOld = hunk.oldText ? getCachedTokens(hunk.oldText, language) : [];
    const cachedNew = hunk.newText ? getCachedTokens(hunk.newText, language) : [];
    if (!cachedOld || !cachedNew) return null;
    hunkTokenPairs.push({ oldTokens: cachedOld, newTokens: cachedNew });
  }

  return applyPerHunkTokens(lines, hunks, hunkTokenPairs);
}

/** Resolved source of full-file text for highlighting */
interface FullFileSource {
  mode: "full";
  oldText: string;
  newText: string;
}

/** Resolved source of per-hunk text for highlighting */
interface PerHunkSource {
  mode: "per-hunk";
  hunks: HunkHighlightData[];
}

type HighlightSource = FullFileSource | PerHunkSource;

/**
 * Hook that adds syntax highlighting tokens to AnnotatedLine arrays.
 *
 * When full old/new file content is provided, highlights the complete files
 * with Shiki and maps tokens by line number. This preserves multi-line syntax
 * constructs (comments, strings, template literals) across hunk boundaries.
 *
 * When full content is not provided, attempts to reconstruct from annotated
 * lines (works for full annotated files). Falls back to per-hunk highlighting
 * for hunk-only diffs, where each hunk is highlighted independently.
 *
 * Returns unhighlighted lines immediately, upgrades to highlighted on async completion.
 * Uses cache for instant display on remount.
 */
export function useDiffHighlight(
  lines: AnnotatedLine[],
  filePath: string,
  oldContent?: string,
  newContent?: string,
): AnnotatedLine[] {
  const language = useMemo(() => getLanguageFromPath(filePath), [filePath]);

  // Determine highlight source: full file or per-hunk
  const source: HighlightSource = useMemo(() => {
    // 1. Caller-provided full content takes priority
    if (oldContent != null || newContent != null) {
      return { mode: "full", oldText: oldContent ?? "", newText: newContent ?? "" };
    }

    // 2. Try reconstructing from contiguous annotated lines
    const reconstructed = reconstructFullFiles(lines);
    if (reconstructed) {
      return { mode: "full", ...reconstructed };
    }

    // 3. Fallback: highlight each hunk independently
    return { mode: "per-hunk", hunks: buildPerHunkFiles(lines) };
  }, [lines, oldContent, newContent]);

  // Try sync cache hit for instant display
  const syncResult = useMemo(() => {
    if (language === "plaintext" || lines.length === 0) return null;

    if (source.mode === "full") {
      return trySyncHighlight(lines, source.oldText, source.newText, language);
    }
    return trySyncHunkHighlight(lines, source.hunks, language);
  }, [lines, source, language]);

  const [highlighted, setHighlighted] = useState<AnnotatedLine[] | null>(
    syncResult,
  );

  useEffect(() => {
    if (language === "plaintext" || lines.length === 0) {
      setHighlighted(null);
      return;
    }

    // If sync cache hit already resolved, skip async
    if (syncResult) {
      setHighlighted(syncResult);
      return;
    }

    let cancelled = false;

    async function runFullFile(oldText: string, newText: string) {
      const [oldTokens, newTokens] = await Promise.all([
        oldText ? highlightCode(oldText, language) : Promise.resolve([]),
        newText ? highlightCode(newText, language) : Promise.resolve([]),
      ]);
      if (cancelled) return;
      setHighlighted(applyTokensByLineNumber(lines, oldTokens, newTokens));
    }

    async function runPerHunk(hunks: HunkHighlightData[]) {
      const hunkTokenPairs = await Promise.all(
        hunks.map(async (hunk) => {
          const [oldTokens, newTokens] = await Promise.all([
            hunk.oldText ? highlightCode(hunk.oldText, language) : Promise.resolve([]),
            hunk.newText ? highlightCode(hunk.newText, language) : Promise.resolve([]),
          ]);
          return { oldTokens, newTokens };
        }),
      );
      if (cancelled) return;
      setHighlighted(applyPerHunkTokens(lines, hunks, hunkTokenPairs));
    }

    if (source.mode === "full") {
      runFullFile(source.oldText, source.newText);
    } else {
      runPerHunk(source.hunks);
    }

    return () => {
      cancelled = true;
    };
  }, [lines, source, language, syncResult]);

  return highlighted ?? lines;
}
