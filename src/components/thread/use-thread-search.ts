/**
 * useThreadSearch
 *
 * Find-in-page hook for virtualized thread views.
 * Searches message data directly (not DOM) since virtualized content
 * isn't fully rendered. Uses Virtuoso's scrollToIndex for navigation
 * and CSS Highlight API for visible-DOM highlighting.
 */

import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import type { RefObject } from "react";
import type { MessageParam } from "@anthropic-ai/sdk/resources/messages";
import type { UseContentSearchReturn } from "@/components/content-pane/use-content-search";
import type { MessageListRef } from "./message-list";

const HIGHLIGHT_ALL = "search-results";
const HIGHLIGHT_CURRENT = "search-current";
const MAX_MATCHES = 1000;
const DEBOUNCE_MS = 150;

interface SearchableSegment {
  turnIndex: number;
  text: string;
}

interface SearchMatch {
  segmentIndex: number;
  turnIndex: number;
  offsetInText: number;
}

/** Extract searchable text segments from messages. */
function buildSegments(messages: MessageParam[]): SearchableSegment[] {
  const segments: SearchableSegment[] = [];

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    const content = msg.content;

    if (msg.role === "user") {
      if (typeof content === "string") {
        segments.push({ turnIndex: i, text: content });
      } else if (Array.isArray(content)) {
        for (const block of content) {
          if (block.type === "text") {
            segments.push({ turnIndex: i, text: block.text });
          }
          // Skip tool_result blocks — rendered with tool_use in assistant turn
        }
      }
    } else if (msg.role === "assistant") {
      if (typeof content === "string") {
        segments.push({ turnIndex: i, text: content });
      } else if (Array.isArray(content)) {
        for (const block of content) {
          if (block.type === "text") {
            segments.push({ turnIndex: i, text: block.text });
          } else if (block.type === "tool_use") {
            segments.push({ turnIndex: i, text: JSON.stringify(block.input) });
          } else if ("thinking" in block && typeof block.thinking === "string") {
            segments.push({ turnIndex: i, text: block.thinking });
          }
        }
      }
    }
  }

  return segments;
}

/** Find all matches of query in segments. */
function findMatches(
  segments: SearchableSegment[],
  query: string,
): SearchMatch[] {
  const q = query.toLowerCase();
  const matches: SearchMatch[] = [];

  for (let si = 0; si < segments.length; si++) {
    const seg = segments[si];
    const text = seg.text.toLowerCase();
    let pos = 0;

    while (pos < text.length && matches.length < MAX_MATCHES) {
      const idx = text.indexOf(q, pos);
      if (idx === -1) break;
      matches.push({
        segmentIndex: si,
        turnIndex: seg.turnIndex,
        offsetInText: idx,
      });
      pos = idx + q.length;
    }

    if (matches.length >= MAX_MATCHES) break;
  }

  return matches;
}

/**
 * Find the frontend match whose surrounding text contains the backend snippet.
 * The backend snippet is a cleaned ~200-char window from state.json grep.
 * We normalize both sides (collapse whitespace, strip leading "..." ) and
 * check direct substring containment against each match's segment text.
 */
function resolveMatchIndex(
  matches: SearchMatch[],
  segments: SearchableSegment[],
  snippet: string,
): number {
  if (matches.length === 0) return 0;

  const norm = (s: string) =>
    s.replace(/\\.n/g, "\n").replace(/\\"/g, '"').replace(/\s+/g, " ").toLowerCase().trim();
  const normSnippet = norm(snippet.replace(/^\.\.\./, "").replace(/\.\.\.$/, ""));

  for (let i = 0; i < matches.length; i++) {
    const seg = segments[matches[i].segmentIndex];
    if (norm(seg.text).includes(normSnippet)) return i;
  }

  // Snippet may be truncated — try matching a shorter prefix (first 60 chars)
  const shortSnippet = normSnippet.slice(0, 60);
  if (shortSnippet.length >= 10) {
    for (let i = 0; i < matches.length; i++) {
      const seg = segments[matches[i].segmentIndex];
      if (norm(seg.text).includes(shortSnippet)) return i;
    }
  }

  return 0;
}

export interface UseThreadSearchReturn extends UseContentSearchReturn {
  /** Set query and auto-navigate to a specific match once results are found */
  setQueryAndNavigate: (query: string, matchIndex: number, snippet?: string) => void;
}

export function useThreadSearch(
  messages: MessageParam[],
  messageListRef: RefObject<MessageListRef | null>,
  scrollerRef: RefObject<HTMLElement | null>,
): UseThreadSearchReturn {
  const [query, setQuery] = useState("");
  const [matchCount, setMatchCount] = useState(0);
  const [currentMatch, setCurrentMatch] = useState(0);

  const matchesRef = useRef<SearchMatch[]>([]);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();
  const queryRef = useRef(query);
  queryRef.current = query;

  // Track pending navigation from global search (cleared after first navigation)
  const initialNavRef = useRef<number | null>(null);
  const snippetRef = useRef<string | null>(null);
  const navigateToMatchRef = useRef<(matchIdx: number) => void>(() => {});

  // Memoize segments from message data
  const segments = useMemo(() => buildSegments(messages), [messages]);

  // --- Highlight helpers (CSS Highlight API on visible DOM) ---

  const clearHighlights = useCallback(() => {
    if (typeof CSS !== "undefined" && CSS.highlights) {
      CSS.highlights.delete(HIGHLIGHT_ALL);
      CSS.highlights.delete(HIGHLIGHT_CURRENT);
    }
  }, []);

  const applyHighlights = useCallback(
    (currentIdx: number) => {
      const container = scrollerRef.current;
      const q = queryRef.current.toLowerCase();
      if (!container || !q || typeof CSS === "undefined" || !CSS.highlights) return;

      const ranges: Range[] = [];
      let currentRange: Range | null = null;

      // Walk visible DOM text nodes
      const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);

      while (walker.nextNode()) {
        const node = walker.currentNode as Text;
        const text = node.textContent?.toLowerCase();
        if (!text) continue;

        let pos = 0;
        while (pos < text.length) {
          const idx = text.indexOf(q, pos);
          if (idx === -1) break;

          const range = document.createRange();
          range.setStart(node, idx);
          range.setEnd(node, idx + q.length);
          ranges.push(range);
          pos = idx + q.length;
        }
      }

      if (ranges.length > 0) {
        CSS.highlights.set(HIGHLIGHT_ALL, new Highlight(...ranges));
      } else {
        CSS.highlights.delete(HIGHLIGHT_ALL);
      }

      // Determine which visible range corresponds to the current match
      if (currentIdx >= 0 && currentIdx < matchesRef.current.length) {
        const match = matchesRef.current[currentIdx];
        for (const range of ranges) {
          const el = range.startContainer.parentElement;
          if (!el) continue;
          const turnEl = el.closest("[data-turn-index]");
          if (
            turnEl &&
            Number(turnEl.getAttribute("data-turn-index")) === match.turnIndex &&
            range.startOffset === match.offsetInText % (range.startContainer.textContent?.length ?? 1)
          ) {
            currentRange = range;
            break;
          }
        }
        if (currentRange) {
          CSS.highlights.set(HIGHLIGHT_CURRENT, new Highlight(currentRange));
        } else {
          CSS.highlights.delete(HIGHLIGHT_CURRENT);
        }
      } else {
        CSS.highlights.delete(HIGHLIGHT_CURRENT);
      }
    },
    [scrollerRef],
  );

  /** Scroll Virtuoso scroller so the current match element is visible. */
  const scrollToCurrentMatch = useCallback(
    (matchIdx: number) => {
      const container = scrollerRef.current;
      const matches = matchesRef.current;
      if (!container || matchIdx < 0 || matchIdx >= matches.length) return;

      // Wait for Virtuoso to finish rendering after scrollToIndex
      setTimeout(() => {
        // Re-apply highlights first so the DOM ranges are fresh
        applyHighlights(matchIdx);

        // Now find the current-highlight range's element
        const q = queryRef.current.toLowerCase();
        if (!q) return;

        const match = matches[matchIdx];
        const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
        let targetEl: HTMLElement | null = null;

        while (walker.nextNode()) {
          const node = walker.currentNode as Text;
          const text = node.textContent?.toLowerCase();
          if (!text) continue;

          const idx = text.indexOf(q);
          if (idx === -1) continue;

          const el = node.parentElement;
          if (!el) continue;
          const turnEl = el.closest("[data-turn-index]");
          if (
            turnEl &&
            Number(turnEl.getAttribute("data-turn-index")) === match.turnIndex
          ) {
            targetEl = el;
            break;
          }
        }

        if (targetEl) {
          const elRect = targetEl.getBoundingClientRect();
          const containerRect = container.getBoundingClientRect();
          const isVisible =
            elRect.top >= containerRect.top && elRect.bottom <= containerRect.bottom;
          if (!isVisible) {
            const offsetInContainer = elRect.top - containerRect.top;
            const desiredScroll =
              container.scrollTop + offsetInContainer - containerRect.height / 2 + elRect.height / 2;
            container.scrollTo({ top: desiredScroll, behavior: "auto" });
          }
        }
      }, 100);
    },
    [scrollerRef, applyHighlights],
  );

  // --- Search execution ---

  const runSearch = useCallback(() => {
    const q = queryRef.current;
    clearHighlights();

    if (!q) {
      matchesRef.current = [];
      setMatchCount(0);
      setCurrentMatch(0);
      return;
    }

    const results = findMatches(segments, q);
    matchesRef.current = results;
    setMatchCount(results.length);

    if (results.length > 0) {
      // If global search requested navigation to a specific match, do it
      if (initialNavRef.current !== null) {
        let targetIdx: number;
        if (snippetRef.current) {
          targetIdx = resolveMatchIndex(results, segments, snippetRef.current);
          snippetRef.current = null;
        } else {
          targetIdx = Math.min(initialNavRef.current, results.length - 1);
        }
        initialNavRef.current = null;
        setCurrentMatch(targetIdx + 1);
        navigateToMatchRef.current(targetIdx);
      } else {
        setCurrentMatch(1);
        // Only highlight visible matches — no scrolling on typing
        requestAnimationFrame(() => {
          applyHighlights(0);
        });
      }
    } else {
      setCurrentMatch(0);
    }
  }, [segments, clearHighlights, applyHighlights]);

  // Debounced search on query change
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (!query) {
      clearHighlights();
      matchesRef.current = [];
      setMatchCount(0);
      setCurrentMatch(0);
      return;
    }

    debounceRef.current = setTimeout(runSearch, DEBOUNCE_MS);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, runSearch, clearHighlights]);

  // MutationObserver: re-highlight when visible DOM changes (Virtuoso item swaps)
  useEffect(() => {
    const container = scrollerRef.current;
    if (!container || !query) return;

    const observer = new MutationObserver(() => {
      if (queryRef.current && matchesRef.current.length > 0) {
        const idx = (currentMatch || 1) - 1;
        applyHighlights(idx);
      }
    });

    observer.observe(container, {
      childList: true,
      subtree: true,
      characterData: true,
    });

    return () => observer.disconnect();
  }, [scrollerRef, query, applyHighlights, currentMatch]);

  // Cleanup on unmount
  useEffect(() => clearHighlights, [clearHighlights]);

  // --- Navigation ---

  const navigateToMatch = useCallback(
    (matchIdx: number) => {
      const matches = matchesRef.current;
      if (matchIdx < 0 || matchIdx >= matches.length) return;

      const match = matches[matchIdx];
      // Always scrollToIndex first to ensure Virtuoso renders the turn
      messageListRef.current?.scrollToIndex(match.turnIndex);
      // Then fine-tune scroll to the specific element after Virtuoso settles
      scrollToCurrentMatch(matchIdx);
    },
    [messageListRef, scrollToCurrentMatch],
  );
  navigateToMatchRef.current = navigateToMatch;

  const goToNext = useCallback(() => {
    const matches = matchesRef.current;
    if (matches.length === 0) return;

    setCurrentMatch((prev) => {
      const next = prev >= matches.length ? 1 : prev + 1;
      navigateToMatch(next - 1);
      return next;
    });
  }, [navigateToMatch]);

  const goToPrevious = useCallback(() => {
    const matches = matchesRef.current;
    if (matches.length === 0) return;

    setCurrentMatch((prev) => {
      const next = prev <= 1 ? matches.length : prev - 1;
      navigateToMatch(next - 1);
      return next;
    });
  }, [navigateToMatch]);

  const clear = useCallback(() => {
    setQuery("");
    setMatchCount(0);
    setCurrentMatch(0);
    matchesRef.current = [];
    clearHighlights();
  }, [clearHighlights]);

  const setQueryAndNavigate = useCallback((q: string, matchIdx: number, snippet?: string) => {
    initialNavRef.current = matchIdx;
    snippetRef.current = snippet ?? null;
    setQuery(q);
  }, []);

  return { query, setQuery, matchCount, currentMatch, goToNext, goToPrevious, clear, setQueryAndNavigate };
}
