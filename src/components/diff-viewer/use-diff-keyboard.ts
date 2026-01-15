import { useEffect } from "react";

interface UseDiffKeyboardOptions {
  scrollToNextFile: () => void;
  scrollToPrevFile: () => void;
  expandAll: () => void;
  collapseAll: () => void;
  onShowHelp?: () => void;
  /** Set to false to disable keyboard handling (e.g., when a modal is open) */
  enabled?: boolean;
}

export function useDiffKeyboard({
  scrollToNextFile,
  scrollToPrevFile,
  expandAll,
  collapseAll,
  onShowHelp,
  enabled = true,
}: UseDiffKeyboardOptions) {
  useEffect(() => {
    if (!enabled) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Skip if user is typing in an input or textarea
      const target = e.target as HTMLElement;
      if (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable
      ) {
        return;
      }

      switch (e.key) {
        case "j":
          e.preventDefault();
          scrollToNextFile();
          break;
        case "k":
          e.preventDefault();
          scrollToPrevFile();
          break;
        case "e":
          e.preventDefault();
          expandAll();
          break;
        case "c":
          e.preventDefault();
          collapseAll();
          break;
        case "?":
          e.preventDefault();
          onShowHelp?.();
          break;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    enabled,
    scrollToNextFile,
    scrollToPrevFile,
    expandAll,
    collapseAll,
    onShowHelp,
  ]);
}
