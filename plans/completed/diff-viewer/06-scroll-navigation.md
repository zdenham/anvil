# Phase 6: Scroll & Navigation

## Overview

Add smooth scrolling, keyboard navigation, and file quick-jump functionality.

## Tasks

### 6.1 Create navigation hook

**`src/components/diff-viewer/use-diff-navigation.ts`**:

```typescript
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
```

**Usage in file components:**

```tsx
// Parent component
const { setFileRef, currentFileIndex, ... } = useDiffNavigation({ fileCount: files.length });

// When rendering each file
<div ref={setFileRef(index)} data-file-index={index}>
  <FileContent ... />
</div>
```

### 6.2 Add keyboard navigation hook

**`src/components/diff-viewer/use-diff-keyboard.ts`**:

```typescript
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
```

**Usage in DiffViewer:**

```typescript
// DiffViewer.tsx
const { scrollToNextFile, scrollToPrevFile, setFileRef, currentFileIndex } =
  useDiffNavigation({ fileCount: files.length });

const { expandAll, collapseAll } = useCollapseState(files); // From phase 5

const [showHelp, setShowHelp] = useState(false);

useDiffKeyboard({
  scrollToNextFile,
  scrollToPrevFile,
  expandAll,
  collapseAll,
  onShowHelp: () => setShowHelp(true),
});
```

**Keyboard shortcut discoverability**: Add a `?` button in the header that opens a shortcuts help modal. The `?` key also triggers this modal.

### 6.3 Add file quick-jump dropdown

**`src/components/diff-viewer/file-jump-dropdown.tsx`**:

```typescript
interface FileJumpDropdownProps {
  files: AnnotatedFile[];
  currentFileIndex: number;
  onJumpToFile: (index: number) => void;
}
```

Features:
- Dropdown showing all file paths
- Current file highlighted
- Click to scroll to that file
- Keyboard accessible (arrow keys to navigate)

### 6.4 Add scroll position indicator

The `useDiffNavigation` hook (6.1) already includes an IntersectionObserver that tracks the current file. Use the `currentFileIndex` it provides to display position.

**`src/components/diff-viewer/file-position-indicator.tsx`**:

```typescript
interface FilePositionIndicatorProps {
  currentIndex: number;
  totalFiles: number;
}

export function FilePositionIndicator({
  currentIndex,
  totalFiles,
}: FilePositionIndicatorProps) {
  if (totalFiles === 0) return null;

  return (
    <span className="text-sm text-muted-foreground">
      File {currentIndex + 1} of {totalFiles}
    </span>
  );
}
```

Display in the diff viewer header alongside the file jump dropdown.

## Keyboard Shortcuts Summary

| Key | Action |
|-----|--------|
| `j` | Next file |
| `k` | Previous file |
| `e` | Expand all collapsed regions |
| `c` | Collapse all regions |
| `?` | Show keyboard shortcuts help |

## Completion Criteria

- [ ] `useDiffNavigation()` hook manages file refs via `setFileRef` callback
- [ ] `useDiffNavigation()` tracks current file index via IntersectionObserver with debouncing
- [ ] `useDiffNavigation()` prevents observer/keyboard race conditions via `isNavigatingRef`
- [ ] `useDiffKeyboard()` hook handles all keyboard shortcuts
- [ ] `j`/`k` keys navigate between files with smooth scrolling
- [ ] `e`/`c` keys expand/collapse all regions (integrated with phase 5)
- [ ] `?` key opens keyboard shortcuts help modal
- [ ] File elements include `data-file-index` attribute for reliable index lookup
- [ ] File quick-jump dropdown shows all files and current position
- [ ] `FilePositionIndicator` displays "File X of Y" in header
- [ ] Keyboard handler skips when input/textarea/contenteditable is focused
- [ ] All navigation is keyboard accessible
