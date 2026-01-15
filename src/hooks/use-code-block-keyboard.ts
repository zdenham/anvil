import { useEffect, useCallback, useRef } from "react";

/**
 * Hook for keyboard navigation between code blocks within a container.
 *
 * Features:
 * - Tab/Shift+Tab to navigate between code blocks
 * - Cmd+C to copy focused code block
 * - Enter/Space to toggle collapse on focused block
 */
export function useCodeBlockKeyboard(
  containerRef: React.RefObject<HTMLElement>
): void {
  const focusedIndexRef = useRef<number>(-1);

  const getCodeBlocks = useCallback((): HTMLElement[] => {
    if (!containerRef.current) return [];
    return Array.from(
      containerRef.current.querySelectorAll<HTMLElement>("[data-code-block]")
    );
  }, [containerRef]);

  const focusBlock = useCallback((index: number) => {
    const blocks = getCodeBlocks();
    if (blocks.length === 0) return;

    // Wrap around for cycling
    const wrappedIndex = ((index % blocks.length) + blocks.length) % blocks.length;
    const block = blocks[wrappedIndex];
    if (block) {
      block.focus();
      focusedIndexRef.current = wrappedIndex;
    }
  }, [getCodeBlocks]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      const blocks = getCodeBlocks();
      if (blocks.length === 0) return;

      const activeElement = document.activeElement as HTMLElement;
      const currentIndex = blocks.indexOf(activeElement);
      const isFocusedOnCodeBlock = currentIndex !== -1;

      // Tab navigation between code blocks
      if (event.key === "Tab" && isFocusedOnCodeBlock) {
        event.preventDefault();
        if (event.shiftKey) {
          focusBlock(currentIndex - 1);
        } else {
          focusBlock(currentIndex + 1);
        }
        return;
      }

      // Only handle other keys when focused on a code block
      if (!isFocusedOnCodeBlock) return;

      // Cmd+C to copy focused code block
      if ((event.metaKey || event.ctrlKey) && event.key === "c") {
        const copyButton = activeElement.querySelector<HTMLButtonElement>(
          'button[aria-label*="Copy"], button[aria-label*="copy"]'
        );
        if (copyButton) {
          copyButton.click();
        }
        return;
      }

      // Enter/Space to toggle collapse
      if (event.key === "Enter" || event.key === " ") {
        // Look for expand or collapse button
        const expandButton = activeElement.querySelector<HTMLButtonElement>(
          'button:has(.lucide-chevron-down)'
        );
        const collapseButton = activeElement.querySelector<HTMLButtonElement>(
          'button[aria-label*="Collapse"], button[aria-label*="collapse"]'
        );

        if (expandButton) {
          event.preventDefault();
          expandButton.click();
        } else if (collapseButton) {
          event.preventDefault();
          collapseButton.click();
        }
      }
    };

    container.addEventListener("keydown", handleKeyDown);
    return () => container.removeEventListener("keydown", handleKeyDown);
  }, [containerRef, getCodeBlocks, focusBlock]);
}
