import { useState, useEffect, useMemo } from "react";
import type { ThemedToken } from "shiki";
import type { AnnotatedLine } from "@/components/diff-viewer/types";
import { getLanguageFromPath } from "@/lib/language-detection";
import { highlightCode, getCachedTokens } from "@/lib/syntax-highlighter";

interface SideMapping {
  sideIndex: number;
  side: "old" | "new";
}

/**
 * Build pseudo-files from diff lines for each side (old/new),
 * tracking which pseudo-file line maps to which AnnotatedLine.
 */
function buildPseudoFiles(lines: AnnotatedLine[]) {
  const oldLines: string[] = [];
  const newLines: string[] = [];
  const mappings: (SideMapping | null)[] = [];

  for (const line of lines) {
    switch (line.type) {
      case "deletion":
        mappings.push({ sideIndex: oldLines.length, side: "old" });
        oldLines.push(line.content);
        break;
      case "addition":
        mappings.push({ sideIndex: newLines.length, side: "new" });
        newLines.push(line.content);
        break;
      default:
        // unchanged — appears in both sides, prefer new for tokens
        oldLines.push(line.content);
        mappings.push({ sideIndex: newLines.length, side: "new" });
        newLines.push(line.content);
        break;
    }
  }

  return {
    oldText: oldLines.join("\n"),
    newText: newLines.join("\n"),
    mappings,
  };
}

/**
 * Apply highlighted tokens back onto AnnotatedLine array.
 */
function applyTokens(
  lines: AnnotatedLine[],
  mappings: (SideMapping | null)[],
  oldTokens: ThemedToken[][],
  newTokens: ThemedToken[][],
): AnnotatedLine[] {
  return lines.map((line, i) => {
    const mapping = mappings[i];
    if (!mapping) return line;

    const tokenSource = mapping.side === "old" ? oldTokens : newTokens;
    const tokens = tokenSource[mapping.sideIndex];
    if (!tokens) return line;

    return { ...line, tokens };
  });
}

/**
 * Try to resolve tokens synchronously from cache.
 * Returns highlighted lines if both sides are cached, otherwise null.
 */
function trySyncHighlight(
  lines: AnnotatedLine[],
  oldText: string,
  newText: string,
  mappings: (SideMapping | null)[],
  language: string,
): AnnotatedLine[] | null {
  const cachedOld = oldText ? getCachedTokens(oldText, language) : [];
  const cachedNew = newText ? getCachedTokens(newText, language) : [];

  if (!cachedOld || !cachedNew) return null;

  return applyTokens(lines, mappings, cachedOld, cachedNew);
}

/**
 * Hook that adds syntax highlighting tokens to AnnotatedLine arrays.
 *
 * Detects language from file path, builds pseudo-files from the diff lines
 * (old-side and new-side), highlights both with Shiki, then maps tokens back.
 *
 * Returns unhighlighted lines immediately, upgrades to highlighted on async completion.
 * Uses cache for instant display on remount.
 */
export function useDiffHighlight(
  lines: AnnotatedLine[],
  filePath: string,
): AnnotatedLine[] {
  const language = useMemo(() => getLanguageFromPath(filePath), [filePath]);

  const { oldText, newText, mappings } = useMemo(
    () => buildPseudoFiles(lines),
    [lines],
  );

  // Try sync cache hit for instant display
  const syncResult = useMemo(() => {
    if (language === "plaintext" || lines.length === 0) return null;
    return trySyncHighlight(lines, oldText, newText, mappings, language);
  }, [lines, oldText, newText, mappings, language]);

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

    async function run() {
      const [oldTokens, newTokens] = await Promise.all([
        oldText ? highlightCode(oldText, language) : Promise.resolve([]),
        newText ? highlightCode(newText, language) : Promise.resolve([]),
      ]);

      if (cancelled) return;

      setHighlighted(applyTokens(lines, mappings, oldTokens, newTokens));
    }

    run();

    return () => {
      cancelled = true;
    };
  }, [lines, oldText, newText, mappings, language, syncResult]);

  return highlighted ?? lines;
}
