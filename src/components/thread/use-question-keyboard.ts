import { useEffect } from "react";

interface UseQuestionKeyboardOptions {
  /** Number of options available */
  optionCount: number;
  /** Current focused index */
  focusedIndex: number;
  /** Move focus to a new index */
  setFocusedIndex: (index: number) => void;
  /** Whether multiple selection is enabled */
  allowMultiple: boolean;
  /** Toggle selection at index */
  toggleOption: (index: number) => void;
  /** Select all options (multi-select only) */
  selectAll: () => void;
  /** Deselect all options (multi-select only) */
  deselectAll: () => void;
  /** Submit current selection(s). For single-select, receives the index directly. */
  submit: (index?: number) => void;
  /** Whether keyboard handling is enabled */
  enabled?: boolean;
}

export function useQuestionKeyboard({
  optionCount,
  focusedIndex,
  setFocusedIndex,
  allowMultiple,
  toggleOption,
  selectAll,
  deselectAll,
  submit,
  enabled = true,
}: UseQuestionKeyboardOptions) {
  useEffect(() => {
    if (!enabled) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Skip if user is typing in an input
      const target = e.target as HTMLElement;
      if (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable
      ) {
        return;
      }

      switch (e.key) {
        case "ArrowDown":
        case "j":
          e.preventDefault();
          setFocusedIndex(Math.min(focusedIndex + 1, optionCount - 1));
          return;

        case "ArrowUp":
        case "k":
          e.preventDefault();
          setFocusedIndex(Math.max(focusedIndex - 1, 0));
          return;

        case " ":
          e.preventDefault();
          toggleOption(focusedIndex);
          if (!allowMultiple) submit(focusedIndex);
          return;

        case "Enter":
          e.preventDefault();
          submit();
          return;

        case "Escape":
          e.preventDefault();
          deselectAll();
          return;
      }

      // Number keys 1-9
      const num = parseInt(e.key, 10);
      if (num >= 1 && num <= 9 && num <= optionCount) {
        e.preventDefault();
        const index = num - 1;
        toggleOption(index);
        if (!allowMultiple) submit(index);
        return;
      }

      // Multi-select shortcuts
      if (allowMultiple) {
        if (e.key === "a") {
          e.preventDefault();
          selectAll();
        } else if (e.key === "n") {
          e.preventDefault();
          deselectAll();
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    enabled,
    focusedIndex,
    optionCount,
    allowMultiple,
    toggleOption,
    selectAll,
    deselectAll,
    submit,
    setFocusedIndex,
  ]);
}
