import { useState, useEffect, useRef } from "react";
import { highlightCode, getCachedTokens, type ThemedToken } from "@/lib/syntax-highlighter";

const DEBOUNCE_MS = 100;

export interface UseCodeHighlightResult {
  tokens: ThemedToken[][] | null;
  isLoading: boolean;
}

/**
 * Hook for syntax highlighting code using Shiki.
 *
 * Returns highlighted tokens after a 100ms debounce to handle streaming.
 * Returns null tokens while loading, allowing fallback to unstyled code.
 */
export function useCodeHighlight(
  code: string,
  language: string
): UseCodeHighlightResult {
  // Initialize with cached tokens if available (prevents flicker on remount)
  const [tokens, setTokens] = useState<ThemedToken[][] | null>(() =>
    getCachedTokens(code, language)
  );
  const [isLoading, setIsLoading] = useState(() =>
    getCachedTokens(code, language) === null
  );

  // Track previous code+language to avoid re-highlighting unchanged code
  const prevInputRef = useRef<string>("");

  useEffect(() => {
    const inputKey = `${language}:${code}`;

    // Skip if code+language unchanged
    if (inputKey === prevInputRef.current) {
      return;
    }

    // Skip if already cached (initial state handled this)
    const cached = getCachedTokens(code, language);
    if (cached) {
      setTokens(cached);
      setIsLoading(false);
      prevInputRef.current = inputKey;
      return;
    }

    setIsLoading(true);

    const timeoutId = setTimeout(() => {
      let cancelled = false;

      highlightCode(code, language)
        .then((result) => {
          if (!cancelled) {
            setTokens(result);
            setIsLoading(false);
            prevInputRef.current = inputKey;
          }
        })
        .catch(() => {
          if (!cancelled) {
            setTokens(null);
            setIsLoading(false);
            prevInputRef.current = inputKey;
          }
        });

      // Cleanup for when effect re-runs during async operation
      return () => {
        cancelled = true;
      };
    }, DEBOUNCE_MS);

    return () => {
      clearTimeout(timeoutId);
    };
  }, [code, language]);

  return { tokens, isLoading };
}
