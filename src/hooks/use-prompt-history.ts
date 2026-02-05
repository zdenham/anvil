import { useState, useCallback, useRef } from "react";
import {
  promptHistoryService,
  PromptHistoryEntry,
} from "@/lib/prompt-history-service";

interface UsePromptHistoryOptions {
  onQueryChange: (query: string) => void;
}

interface UsePromptHistoryResult {
  historyIndex: number | null;
  handleHistoryNavigation: (direction: "up" | "down") => Promise<boolean>;
  resetHistory: () => void;
  isInHistoryMode: boolean;
}

/**
 * Hook for managing prompt history navigation.
 * Extracted from use-spotlight-history.ts for reuse in ThreadInput.
 *
 * Call resetHistory() when the user types to exit history mode.
 */
export function usePromptHistory(
  options: UsePromptHistoryOptions
): UsePromptHistoryResult {
  const { onQueryChange } = options;

  // null = not browsing history, 0+ = browsing (0 = most recent)
  const [historyIndex, setHistoryIndex] = useState<number | null>(null);

  // Cache history entries to avoid repeated async calls during navigation
  const historyCache = useRef<PromptHistoryEntry[]>([]);
  const historyCacheValid = useRef(false);

  const loadHistory = useCallback(async () => {
    if (!historyCacheValid.current) {
      historyCache.current = await promptHistoryService.getAll();
      historyCacheValid.current = true;
    }
    return historyCache.current;
  }, []);

  const handleHistoryNavigation = useCallback(
    async (direction: "up" | "down"): Promise<boolean> => {
      const entries = await loadHistory();

      if (entries.length === 0) {
        return false;
      }

      if (direction === "up") {
        if (historyIndex === null) {
          // Start browsing history - set first entry as query
          setHistoryIndex(0);
          onQueryChange(entries[0].prompt);
          return true;
        }

        // Already in history mode - cycle to next older entry
        const nextIndex = historyIndex + 1;
        if (nextIndex < entries.length) {
          setHistoryIndex(nextIndex);
          onQueryChange(entries[nextIndex].prompt);
          return true;
        }
        // At oldest entry, don't cycle further
        return true;
      }

      if (direction === "down") {
        if (historyIndex === null) {
          return false;
        }

        // Cycle to newer entry
        const nextIndex = historyIndex - 1;
        if (nextIndex >= 0) {
          setHistoryIndex(nextIndex);
          onQueryChange(entries[nextIndex].prompt);
          return true;
        } else {
          // Down from newest entry - exit history mode and clear
          setHistoryIndex(null);
          onQueryChange("");
          return true;
        }
      }

      return false;
    },
    [historyIndex, loadHistory, onQueryChange]
  );

  const resetHistory = useCallback(() => {
    setHistoryIndex(null);
    historyCacheValid.current = false;
  }, []);

  return {
    historyIndex,
    handleHistoryNavigation,
    resetHistory,
    isInHistoryMode: historyIndex !== null,
  };
}
