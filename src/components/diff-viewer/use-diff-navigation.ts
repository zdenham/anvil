import { useCallback, useEffect, useRef, useState } from "react";

interface UseDiffNavigationOptions {
  fileCount: number;
  /** Debounce delay for IntersectionObserver updates (ms) */
  scrollDebounceMs?: number;
}

export function useDiffNavigation({
  fileCount,
  scrollDebounceMs = 100,
}: UseDiffNavigationOptions) {
  const fileRefs = useRef<(HTMLDivElement | null)[]>([]);
  const [currentFileIndex, setCurrentFileIndex] = useState(0);
  const isNavigatingRef = useRef(false);

  // Callback for assigning refs to file elements
  const setFileRef = useCallback(
    (index: number) => (el: HTMLDivElement | null) => {
      fileRefs.current[index] = el;
    },
    []
  );

  const scrollToFile = useCallback((index: number) => {
    const el = fileRefs.current[index];
    if (el) {
      // Prevent IntersectionObserver from fighting with programmatic scroll
      isNavigatingRef.current = true;
      el.scrollIntoView({ behavior: "smooth", block: "start" });
      setCurrentFileIndex(index);

      // Re-enable observer updates after scroll completes
      setTimeout(() => {
        isNavigatingRef.current = false;
      }, 500);
    }
  }, []);

  const scrollToNextFile = useCallback(() => {
    scrollToFile(Math.min(currentFileIndex + 1, fileCount - 1));
  }, [currentFileIndex, fileCount, scrollToFile]);

  const scrollToPrevFile = useCallback(() => {
    scrollToFile(Math.max(currentFileIndex - 1, 0));
  }, [currentFileIndex, scrollToFile]);

  // IntersectionObserver to track current file on manual scroll
  useEffect(() => {
    let debounceTimer: ReturnType<typeof setTimeout>;

    const observer = new IntersectionObserver(
      (entries) => {
        // Skip if we're in the middle of programmatic navigation
        if (isNavigatingRef.current) return;

        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            // Use data attribute for reliable index lookup
            const indexAttr = entry.target.getAttribute("data-file-index");
            if (indexAttr !== null) {
              const index = parseInt(indexAttr, 10);
              // Debounce to avoid rapid updates during scroll
              clearTimeout(debounceTimer);
              debounceTimer = setTimeout(() => {
                setCurrentFileIndex(index);
              }, scrollDebounceMs);
            }
          }
        });
      },
      { threshold: 0.5 }
    );

    fileRefs.current.forEach((ref) => ref && observer.observe(ref));

    return () => {
      clearTimeout(debounceTimer);
      observer.disconnect();
    };
  }, [fileCount, scrollDebounceMs]);

  return {
    fileRefs,
    setFileRef,
    currentFileIndex,
    scrollToFile,
    scrollToNextFile,
    scrollToPrevFile,
  };
}
