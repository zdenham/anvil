import { useState, useEffect, useRef } from "react";

/** Max time (ms) to reveal a chunk. Tuned to ~1x stream interval. */
const MAX_DURATION = 750;
/** Floor on per-char speed (ms). Matches 60fps. */
const MIN_CHAR_INTERVAL = 16;

interface TrickleOptions {
  /** Set false to disable trickle and show content immediately. Default: true */
  enabled?: boolean;
}

/**
 * Find a markdown-safe boundary at or before the raw position.
 * Avoids stopping inside unclosed formatting delimiters, code fences, or links.
 */
export function findSafeBoundary(fullText: string, rawPosition: number): number {
  if (rawPosition <= 0) return 0;
  if (rawPosition >= fullText.length) return fullText.length;

  const candidate = fullText.slice(0, rawPosition);

  // Check for unclosed fenced code blocks (``` on its own line)
  const fenceMatches = candidate.match(/^```/gm);
  const fenceCount = fenceMatches ? fenceMatches.length : 0;
  if (fenceCount % 2 !== 0) {
    const lastFence = candidate.lastIndexOf("```");
    if (lastFence >= 0) return lastFence;
  }

  // Check for unclosed inline code backticks (single `)
  const inlineBackticks = countUnescaped(candidate, "`");
  if (inlineBackticks % 2 !== 0) {
    const lastBacktick = candidate.lastIndexOf("`");
    if (lastBacktick >= 0) return lastBacktick;
  }

  // Check for unclosed bold (**)
  const boldCount = countDelimiters(candidate, "**");
  if (boldCount % 2 !== 0) {
    const lastBold = candidate.lastIndexOf("**");
    if (lastBold >= 0) return lastBold;
  }

  // Check for unclosed italic (single * not part of **)
  const italicCount = countStandaloneAsterisks(candidate);
  if (italicCount % 2 !== 0) {
    const lastStar = findLastStandaloneAsterisk(candidate);
    if (lastStar >= 0) return lastStar;
  }

  // Check for unclosed strikethrough (~~)
  const strikeCount = countDelimiters(candidate, "~~");
  if (strikeCount % 2 !== 0) {
    const lastStrike = candidate.lastIndexOf("~~");
    if (lastStrike >= 0) return lastStrike;
  }

  // Check for unclosed links [text](url)
  const lastOpenBracket = candidate.lastIndexOf("[");
  if (lastOpenBracket >= 0) {
    const afterBracket = candidate.slice(lastOpenBracket);
    if (!afterBracket.match(/\[.*?\]\(.*?\)/)) {
      return lastOpenBracket;
    }
  }

  // Snap forward to word boundary if within 3 chars
  const nextSpace = fullText.indexOf(" ", rawPosition);
  const nextNewline = fullText.indexOf("\n", rawPosition);
  let nearestBoundary = fullText.length;
  if (nextSpace >= 0 && nextSpace < nearestBoundary) nearestBoundary = nextSpace;
  if (nextNewline >= 0 && nextNewline < nearestBoundary) nearestBoundary = nextNewline;

  if (nearestBoundary - rawPosition <= 3 && nearestBoundary <= fullText.length) {
    return Math.min(nearestBoundary + 1, fullText.length);
  }

  return rawPosition;
}

function countDelimiters(text: string, delimiter: string): number {
  let count = 0;
  let pos = 0;
  while (pos < text.length) {
    const idx = text.indexOf(delimiter, pos);
    if (idx === -1) break;
    if (idx === 0 || text[idx - 1] !== "\\") {
      count++;
    }
    pos = idx + delimiter.length;
  }
  return count;
}

function countUnescaped(text: string, char: string): number {
  let count = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === char && (i === 0 || text[i - 1] !== "\\")) {
      if (i + 2 < text.length && text[i + 1] === "`" && text[i + 2] === "`") {
        i += 2;
        continue;
      }
      if (i >= 1 && text[i - 1] === "`") continue;
      if (i >= 2 && text[i - 2] === "`" && text[i - 1] === "`") continue;
      count++;
    }
  }
  return count;
}

function countStandaloneAsterisks(text: string): number {
  let count = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "*") {
      if (i + 1 < text.length && text[i + 1] === "*") {
        i++;
        continue;
      }
      if (i > 0 && text[i - 1] === "*") continue;
      count++;
    }
  }
  return count;
}

function findLastStandaloneAsterisk(text: string): number {
  for (let i = text.length - 1; i >= 0; i--) {
    if (text[i] === "*") {
      if (i + 1 < text.length && text[i + 1] === "*") continue;
      if (i > 0 && text[i - 1] === "*") continue;
      return i;
    }
  }
  return -1;
}

/**
 * Hook that gradually reveals text content using duration-based
 * linear interpolation, creating a smooth typing effect.
 *
 * When new text arrives that extends the current content (startsWith),
 * the hook continues from the current position and linearly interpolates
 * to the new target over a computed duration. If the text doesn't extend
 * (new turn/reset), it resets to 0.
 *
 * Duration = min(MAX_DURATION, charsRemaining * MIN_CHAR_INTERVAL)
 * This means small batches trickle slowly (1 char/frame) and large
 * batches speed up to finish within MAX_DURATION.
 */
export function useTrickleText(
  targetContent: string,
  isStreaming: boolean,
  options: TrickleOptions = {},
): string {
  const { enabled = true } = options;

  const [displayedLength, setDisplayedLength] = useState(0);

  // Animation state refs (survive re-renders without causing them)
  const rafRef = useRef<number | null>(null);
  const displayedLengthRef = useRef(0);
  const animStartRef = useRef<number | null>(null);
  const animStartLenRef = useRef(0);
  const animEndLenRef = useRef(0);
  const animDurationRef = useRef(0);
  const prevTargetRef = useRef("");
  const targetContentRef = useRef(targetContent);
  targetContentRef.current = targetContent;

  // Detect new text and set up interpolation segment
  useEffect(() => {
    if (!enabled || !isStreaming) return;

    const prevTarget = prevTargetRef.current;
    const currentDisplayed = displayedLengthRef.current;
    prevTargetRef.current = targetContent;

    if (targetContent.length <= currentDisplayed) return;

    // Check continuation: does new content extend what we've shown?
    if (targetContent.startsWith(prevTarget.slice(0, currentDisplayed))) {
      // Continue from current position
      animStartLenRef.current = currentDisplayed;
    } else {
      // Content changed entirely — reset
      animStartLenRef.current = 0;
      displayedLengthRef.current = 0;
    }

    const charsRemaining = targetContent.length - animStartLenRef.current;
    const duration = Math.min(MAX_DURATION, charsRemaining * MIN_CHAR_INTERVAL);

    animEndLenRef.current = targetContent.length;
    animDurationRef.current = duration;
    animStartRef.current = null; // will be set on first frame
  }, [targetContent, enabled, isStreaming]);

  // When streaming stops, snap to full content and cancel animation
  useEffect(() => {
    if (!isStreaming) {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      if (displayedLengthRef.current < targetContent.length) {
        displayedLengthRef.current = targetContent.length;
        setDisplayedLength(targetContent.length);
      }
      prevTargetRef.current = targetContent;
    }
  }, [isStreaming, targetContent]);

  // rAF loop: linear interpolation from animStartLen to animEndLen
  useEffect(() => {
    if (!enabled || !isStreaming) return;

    const tick = (timestamp: number) => {
      if (animStartRef.current === null) {
        animStartRef.current = timestamp;
      }

      const elapsed = timestamp - animStartRef.current;
      const duration = animDurationRef.current;
      const startLen = animStartLenRef.current;
      const endLen = animEndLenRef.current;

      let rawPosition: number;
      if (duration <= 0 || elapsed >= duration) {
        rawPosition = endLen;
      } else {
        const t = elapsed / duration;
        rawPosition = Math.round(startLen + (endLen - startLen) * t);
      }

      const safePosition = findSafeBoundary(
        targetContentRef.current,
        rawPosition,
      );

      // Ensure forward progress (at least 1 char beyond current)
      const currentLen = displayedLengthRef.current;
      const newLength = Math.max(
        Math.min(safePosition, targetContentRef.current.length),
        Math.min(currentLen + 1, targetContentRef.current.length),
      );

      if (newLength !== currentLen) {
        displayedLengthRef.current = newLength;
        setDisplayedLength(newLength);
      }

      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);

    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [enabled, isStreaming]);

  if (!enabled) return targetContent;
  if (!isStreaming) return targetContent;

  return targetContent.slice(0, displayedLength);
}
