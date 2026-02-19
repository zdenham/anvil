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

export function useThreadSearch(
  messages: MessageParam[],
  messageListRef: RefObject<MessageListRef | null>,
  scrollerRef: RefObject<HTMLElement | null>,
): UseContentSearchReturn {
  const [query, setQuery] = useState("");
  const [matchCount, setMatchCount] = useState(0);
  const [currentMatch, setCurrentMatch] = useState(0);

  const matchesRef = useRef<SearchMatch[]>([]);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();
  const queryRef = useRef(query);
  queryRef.current = query;

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
      // Use the match's turnIndex to find the right range
      if (currentIdx >= 0 && currentIdx < matchesRef.current.length) {
        const match = matchesRef.current[currentIdx];
        // Find the range in the visible DOM that best corresponds to this match
        // by checking text offsets within the turn's container
        for (const range of ranges) {
          const el = range.startContainer.parentElement;
          if (!el) continue;
          // Check if this range's turn container matches the match's turnIndex
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
        // Fallback: if we couldn't match precisely, don't highlight current
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
      setCurrentMatch(1);
      // Scroll to the first match's turn
      messageListRef.current?.scrollToIndex(results[0].turnIndex);
      // Highlight after scroll settles
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          applyHighlights(0);
        });
      });
    } else {
      setCurrentMatch(0);
    }
  }, [segments, clearHighlights, applyHighlights, messageListRef]);

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

  const goToNext = useCallback(() => {
    const matches = matchesRef.current;
    if (matches.length === 0) return;

    setCurrentMatch((prev) => {
      const next = prev >= matches.length ? 1 : prev + 1;
      const match = matches[next - 1];
      const prevMatch = matches[(prev || 1) - 1];

      // Scroll if the turn changed
      if (!prevMatch || match.turnIndex !== prevMatch.turnIndex) {
        messageListRef.current?.scrollToIndex(match.turnIndex);
      }

      // Re-highlight after potential scroll
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          applyHighlights(next - 1);
        });
      });

      return next;
    });
  }, [applyHighlights, messageListRef]);

  const goToPrevious = useCallback(() => {
    const matches = matchesRef.current;
    if (matches.length === 0) return;

    setCurrentMatch((prev) => {
      const next = prev <= 1 ? matches.length : prev - 1;
      const match = matches[next - 1];
      const prevMatch = matches[(prev || 1) - 1];

      if (!prevMatch || match.turnIndex !== prevMatch.turnIndex) {
        messageListRef.current?.scrollToIndex(match.turnIndex);
      }

      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          applyHighlights(next - 1);
        });
      });

      return next;
    });
  }, [applyHighlights, messageListRef]);

  const clear = useCallback(() => {
    setQuery("");
    setMatchCount(0);
    setCurrentMatch(0);
    matchesRef.current = [];
    clearHighlights();
  }, [clearHighlights]);

  return { query, setQuery, matchCount, currentMatch, goToNext, goToPrevious, clear };
}
