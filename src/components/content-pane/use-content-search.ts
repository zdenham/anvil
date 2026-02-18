/**
 * useContentSearch
 *
 * Hook that provides find-in-page search using the CSS Custom Highlight API.
 * Walks the DOM inside a container ref, creates Range objects for matches,
 * and registers them as highlights — zero DOM mutation, no React re-renders.
 */

import { useState, useRef, useCallback, useEffect } from "react";
import type { RefObject } from "react";

const HIGHLIGHT_ALL = "search-results";
const HIGHLIGHT_CURRENT = "search-current";
const MAX_MATCHES = 1000;
const DEBOUNCE_MS = 150;

export interface UseContentSearchReturn {
  query: string;
  setQuery: (q: string) => void;
  matchCount: number;
  currentMatch: number; // 1-indexed, 0 when no matches
  goToNext: () => void;
  goToPrevious: () => void;
  clear: () => void;
}

export function useContentSearch(
  containerRef: RefObject<HTMLElement | null>,
): UseContentSearchReturn {
  const [query, setQuery] = useState("");
  const [matchCount, setMatchCount] = useState(0);
  const [currentMatch, setCurrentMatch] = useState(0);

  const rangesRef = useRef<Range[]>([]);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();
  const queryRef = useRef(query);
  queryRef.current = query;

  const clearHighlights = useCallback(() => {
    if (typeof CSS !== "undefined" && CSS.highlights) {
      CSS.highlights.delete(HIGHLIGHT_ALL);
      CSS.highlights.delete(HIGHLIGHT_CURRENT);
    }
    rangesRef.current = [];
  }, []);

  const updateCurrentHighlight = useCallback((index: number) => {
    if (typeof CSS === "undefined" || !CSS.highlights) return;
    const ranges = rangesRef.current;
    if (index < 0 || index >= ranges.length) {
      CSS.highlights.delete(HIGHLIGHT_CURRENT);
      return;
    }
    CSS.highlights.set(HIGHLIGHT_CURRENT, new Highlight(ranges[index]));
  }, []);

  const scrollToMatch = useCallback((index: number) => {
    const ranges = rangesRef.current;
    if (index < 0 || index >= ranges.length) return;
    const range = ranges[index];
    const el = range.startContainer.parentElement;
    if (el) {
      el.scrollIntoView({ block: "center", behavior: "smooth" });
    }
  }, []);

  const runSearch = useCallback((preservePosition?: boolean) => {
    const container = containerRef.current;
    const q = queryRef.current.toLowerCase();

    clearHighlights();

    if (!container || !q || typeof CSS === "undefined" || !CSS.highlights) {
      setMatchCount(0);
      setCurrentMatch(0);
      return;
    }

    const ranges: Range[] = [];
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);

    while (walker.nextNode()) {
      const node = walker.currentNode as Text;
      const text = node.textContent?.toLowerCase();
      if (!text) continue;

      let startPos = 0;
      while (startPos < text.length && ranges.length < MAX_MATCHES) {
        const index = text.indexOf(q, startPos);
        if (index === -1) break;

        const range = document.createRange();
        range.setStart(node, index);
        range.setEnd(node, index + q.length);
        ranges.push(range);
        startPos = index + q.length;
      }

      if (ranges.length >= MAX_MATCHES) break;
    }

    rangesRef.current = ranges;

    if (ranges.length > 0) {
      CSS.highlights.set(HIGHLIGHT_ALL, new Highlight(...ranges));
      setMatchCount(ranges.length);
      if (preservePosition) {
        setCurrentMatch((prev) => {
          const clamped = Math.min(prev, ranges.length) || 1;
          updateCurrentHighlight(clamped - 1);
          return clamped;
        });
      } else {
        setCurrentMatch(1);
        updateCurrentHighlight(0);
        scrollToMatch(0);
      }
    } else {
      setMatchCount(0);
      setCurrentMatch(0);
    }
  }, [containerRef, clearHighlights, updateCurrentHighlight, scrollToMatch]);

  // Debounced search on query change
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (!query) {
      clearHighlights();
      setMatchCount(0);
      setCurrentMatch(0);
      return;
    }

    debounceRef.current = setTimeout(runSearch, DEBOUNCE_MS);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, runSearch, clearHighlights]);

  // MutationObserver: re-run search when DOM changes (streaming content)
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !query) return;

    const observer = new MutationObserver(() => {
      if (queryRef.current) runSearch(true);
    });

    observer.observe(container, {
      childList: true,
      subtree: true,
      characterData: true,
    });

    return () => observer.disconnect();
  }, [containerRef, query, runSearch]);

  // Cleanup on unmount
  useEffect(() => clearHighlights, [clearHighlights]);

  const goToNext = useCallback(() => {
    const count = rangesRef.current.length;
    if (count === 0) return;
    setCurrentMatch((prev) => {
      const next = prev >= count ? 1 : prev + 1;
      updateCurrentHighlight(next - 1);
      scrollToMatch(next - 1);
      return next;
    });
  }, [updateCurrentHighlight, scrollToMatch]);

  const goToPrevious = useCallback(() => {
    const count = rangesRef.current.length;
    if (count === 0) return;
    setCurrentMatch((prev) => {
      const next = prev <= 1 ? count : prev - 1;
      updateCurrentHighlight(next - 1);
      scrollToMatch(next - 1);
      return next;
    });
  }, [updateCurrentHighlight, scrollToMatch]);

  const clear = useCallback(() => {
    setQuery("");
    setMatchCount(0);
    setCurrentMatch(0);
    clearHighlights();
  }, [clearHighlights]);

  return { query, setQuery, matchCount, currentMatch, goToNext, goToPrevious, clear };
}
