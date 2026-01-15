import { useState, useRef, useCallback, useEffect } from "react";
import { triggerRegistry } from "@/lib/triggers/registry";
import type {
  TriggerResult,
  TriggerHandler,
  TriggerContext,
  SelectionResult,
} from "@/lib/triggers/types";

export interface TriggerState {
  isActive: boolean;
  triggerChar: string | null;
  query: string;
  startIndex: number; // Position of trigger in input
  results: TriggerResult[];
  selectedIndex: number;
  isLoading: boolean;
  handler: TriggerHandler | null;
  error: string | null;
}

export interface TriggerAutocompleteOptions {
  context: TriggerContext;
  debounceMs?: number; // Default: 150ms
}

const INITIAL_STATE: TriggerState = {
  isActive: false,
  triggerChar: null,
  query: "",
  startIndex: 0,
  results: [],
  selectedIndex: 0,
  isLoading: false,
  handler: null,
  error: null,
};

export function useTriggerAutocomplete(options: TriggerAutocompleteOptions) {
  const { context, debounceMs = 150 } = options;
  const [state, setState] = useState<TriggerState>(INITIAL_STATE);

  const abortControllerRef = useRef<AbortController | null>(null);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const currentValueRef = useRef<string>(""); // Track current input value

  // Cancel any pending search when starting a new one
  const cancelPendingSearch = useCallback(() => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      cancelPendingSearch();
    };
  }, [cancelPendingSearch]);

  const close = useCallback(() => {
    cancelPendingSearch();
    setState(INITIAL_STATE);
  }, [cancelPendingSearch]);

  const setSelectedIndex = useCallback((index: number) => {
    setState((prev) => ({ ...prev, selectedIndex: index }));
  }, []);

  // Returns SelectionResult with new value and cursor position
  const selectResult = useCallback(
    (result: TriggerResult): SelectionResult | null => {
      if (!state.isActive) return null;

      const currentValue = currentValueRef.current;
      const before = currentValue.slice(0, state.startIndex);
      const after = currentValue.slice(
        state.startIndex + 1 + state.query.length
      );

      // Insert with trailing space for continuation
      const newValue = before + result.insertText + " " + after;
      const newCursorPosition = before.length + result.insertText.length + 1;

      close();

      return {
        value: newValue,
        cursorPosition: newCursorPosition,
      };
    },
    [state.isActive, state.startIndex, state.query.length, close]
  );

  const analyzeInput = useCallback(
    (value: string, cursorPosition: number, inputType?: string): void => {
      // Store current value for selectResult
      currentValueRef.current = value;

      // 1. Handle paste - don't activate on paste
      if (inputType === "insertFromPaste") {
        close();
        return;
      }

      // 2. Scan backwards from cursor for trigger char
      let triggerIndex = -1;
      let triggerChar: string | null = null;
      let isEscaped = false;

      for (let i = cursorPosition - 1; i >= 0; i--) {
        const char = value[i];

        // Stop at whitespace or newline - no trigger found in current word
        // (textarea can have newlines, treat them as word boundaries)
        if (/\s/.test(char)) break;

        // Check for escape sequence (double trigger char = literal)
        if (triggerRegistry.isTrigger(char)) {
          // Check if escaped: @@foo -> literal @foo, not trigger
          if (i > 0 && value[i - 1] === char) {
            isEscaped = true;
            break; // Escaped, don't trigger
          }

          // Check word boundary: only trigger at start or after whitespace
          if (i === 0 || /\s/.test(value[i - 1])) {
            triggerIndex = i;
            triggerChar = char;
            break;
          }
        }
      }

      // 3. No trigger found - close any active trigger
      if (triggerIndex === -1 || isEscaped) {
        close();
        return;
      }

      // 4. Extract query and get handler
      const query = value.slice(triggerIndex + 1, cursorPosition);
      const handler = triggerRegistry.getHandler(triggerChar!);

      if (!handler) {
        close();
        return;
      }

      // 5. Update state immediately (show loading)
      setState((prev) => ({
        ...prev,
        isActive: true,
        triggerChar,
        query,
        startIndex: triggerIndex,
        handler,
        isLoading: true,
        error: null,
      }));

      // 6. Debounce the search
      cancelPendingSearch();

      debounceTimerRef.current = setTimeout(() => {
        const controller = new AbortController();
        abortControllerRef.current = controller;

        handler
          .search(query, context, controller.signal)
          .then((results) => {
            if (!controller.signal.aborted) {
              setState((prev) => ({
                ...prev,
                results,
                isLoading: false,
                selectedIndex: 0,
              }));
            }
          })
          .catch((error) => {
            if (error.name !== "AbortError") {
              setState((prev) => ({
                ...prev,
                error: error.message,
                isLoading: false,
              }));
            }
          });
      }, debounceMs);
    },
    [context, debounceMs, close, cancelPendingSearch]
  );

  return {
    state,
    analyzeInput,
    selectResult,
    close,
    setSelectedIndex,
    cancelPendingSearch,
    // Store current value for selectResult to use
    setCurrentValue: (value: string) => {
      currentValueRef.current = value;
    },
  };
}
