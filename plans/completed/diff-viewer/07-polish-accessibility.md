# Phase 7: Polish & Accessibility

## Overview

Add loading states, empty states, error handling, and accessibility features.

## Tasks

### 7.1 Add loading skeleton

While diff is parsing or highlighter is loading, show:

- Shimmer placeholders for file cards
- Progress indicator

```typescript
import { Skeleton } from "@/components/ui/skeleton";

function DiffViewerSkeleton() {
  return (
    <div className="space-y-4">
      <div className="h-10 bg-slate-800 rounded animate-pulse" />
      <div className="space-y-2">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-32 bg-slate-800 rounded animate-pulse" />
        ))}
      </div>
    </div>
  );
}
```

### 7.2 Add empty state

When diff is empty:

- "No changes to display" message
- Icon (empty document or similar)

```typescript
import { File } from "lucide-react";

function DiffEmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-slate-400">
      <File className="w-12 h-12 mb-4" />
      <p>No changes to display</p>
    </div>
  );
}
```

### 7.3 Add error state

When parsing fails:

- Error message with details
- Raw diff fallback view
- Integration with per-file error boundaries from Phase 4

```typescript
import { useState } from "react";
import { AlertTriangle } from "lucide-react";

interface DiffErrorStateProps {
  error: string;
  rawDiff: string;
  onRetry?: () => void;
}

function DiffErrorState({ error, rawDiff, onRetry }: DiffErrorStateProps) {
  const [showRaw, setShowRaw] = useState(false);

  return (
    <div className="p-4 border border-red-500/50 rounded bg-red-950/20">
      <div className="flex items-center gap-2 mb-2">
        <AlertTriangle className="w-4 h-4 text-red-400" />
        <p className="text-red-400">Failed to parse diff: {error}</p>
      </div>
      <div className="flex gap-2">
        <button
          onClick={() => setShowRaw(!showRaw)}
          className="text-sm text-slate-400 hover:text-white"
        >
          {showRaw ? "Hide" : "Show"} raw diff
        </button>
        {onRetry && (
          <button
            onClick={onRetry}
            className="text-sm text-slate-400 hover:text-white"
          >
            Retry
          </button>
        )}
      </div>
      {showRaw && (
        <pre className="mt-2 p-2 bg-slate-900 rounded text-xs overflow-auto max-h-96">
          {rawDiff}
        </pre>
      )}
    </div>
  );
}

// Usage with error boundary from Phase 4
function DiffFileCardWithErrorBoundary({ file, rawDiff }: Props) {
  return (
    <ErrorBoundary
      fallback={({ error, resetErrorBoundary }) => (
        <DiffErrorState
          error={error.message}
          rawDiff={rawDiff}
          onRetry={resetErrorBoundary}
        />
      )}
    >
      <DiffFileCard file={file} />
    </ErrorBoundary>
  );
}
```

### 7.4 Accessibility

#### ARIA Structure

Use proper table semantics for the diff grid:

```typescript
// DiffFileCard - wrapper with region role
<div
  role="region"
  aria-label={`Changes to ${file.file.newPath || file.file.oldPath}`}
>
  {/* File header */}
  <div role="table" aria-label="Diff content">
    <div role="rowgroup">
      {lines.map((line) => (
        <AnnotatedLineRow key={line.id} line={line} />
      ))}
    </div>
  </div>
</div>

// AnnotatedLineRow - with proper row semantics
<div
  role="row"
  aria-label={`Line ${line.newLineNumber ?? line.oldLineNumber}: ${
    line.type === "addition" ? "added" : line.type === "deletion" ? "deleted" : "unchanged"
  }`}
>
  <span role="cell" aria-label="Old line number">{line.oldLineNumber}</span>
  <span role="cell" aria-label="New line number">{line.newLineNumber}</span>
  <span role="cell">{line.content}</span>
</div>

// CollapsedRegionPlaceholder
<button
  aria-expanded={false}
  aria-label={`${region.lineCount} unchanged lines, click to expand`}
>
  ...
</button>
```

#### Skip Links for Long Files

```typescript
function DiffViewer({ files }: { files: ParsedFile[] }) {
  return (
    <div>
      {/* Skip links - visually hidden until focused */}
      <nav aria-label="Skip links" className="sr-only focus-within:not-sr-only">
        <ul className="flex gap-2 p-2 bg-slate-800 rounded mb-2">
          {files.map((file, index) => (
            <li key={file.file.newPath || file.file.oldPath}>
              <a
                href={`#diff-file-${index}`}
                className="text-sm text-blue-400 hover:underline focus:outline-none focus:ring-2 focus:ring-blue-500 rounded px-1"
              >
                {file.file.newPath || file.file.oldPath}
              </a>
            </li>
          ))}
        </ul>
      </nav>

      {/* File cards with IDs for skip links */}
      {files.map((file, index) => (
        <div key={index} id={`diff-file-${index}`} tabIndex={-1}>
          <DiffFileCard file={file} />
        </div>
      ))}
    </div>
  );
}
```

#### Screen Reader Announcements

```typescript
import { useRef, useCallback } from "react";

function useLiveAnnouncer() {
  const announceRef = useRef<HTMLDivElement>(null);

  const announce = useCallback((message: string) => {
    if (announceRef.current) {
      // Clear and re-set to ensure announcement is triggered
      announceRef.current.textContent = "";
      requestAnimationFrame(() => {
        if (announceRef.current) {
          announceRef.current.textContent = message;
        }
      });
    }
  }, []);

  const AnnouncerRegion = () => (
    <div
      ref={announceRef}
      role="status"
      aria-live="polite"
      aria-atomic="true"
      className="sr-only"
    />
  );

  return { announce, AnnouncerRegion };
}

// Usage in DiffViewer
function DiffViewer() {
  const { announce, AnnouncerRegion } = useLiveAnnouncer();

  const handleExpandAll = () => {
    expandAllRegions();
    announce(`Expanded all ${regions.length} collapsed regions`);
  };

  const handleCollapseAll = () => {
    collapseAllRegions();
    announce(`Collapsed ${regions.length} regions`);
  };

  return (
    <>
      <AnnouncerRegion />
      {/* ... */}
    </>
  );
}
```

#### Focus Management

```typescript
import { useRef, useEffect } from "react";

function CollapsibleRegion({ region, isExpanded, onToggle }) {
  const contentRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  // Preserve focus position after expand/collapse
  useEffect(() => {
    // Focus remains on trigger button, content expands below
    // No focus theft - user stays in control
  }, [isExpanded]);

  return (
    <div>
      <button
        ref={triggerRef}
        onClick={onToggle}
        aria-expanded={isExpanded}
        aria-controls={`region-${region.id}`}
      >
        {region.lineCount} unchanged lines
      </button>
      {isExpanded && (
        <div ref={contentRef} id={`region-${region.id}`}>
          {/* Expanded content */}
        </div>
      )}
    </div>
  );
}
```

#### Keyboard Navigation

- All interactive elements focusable via Tab
- Enter/Space to activate buttons
- Arrow keys within dropdown menus
- Escape to close dropdowns

```typescript
function DiffToolbar() {
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      closeDropdown();
    }
  };

  return (
    <div role="toolbar" aria-label="Diff viewer controls" onKeyDown={handleKeyDown}>
      <button type="button">Expand All</button>
      <button type="button">Collapse All</button>
      {/* Dropdown menus handle their own arrow key navigation */}
    </div>
  );
}
```

### 7.5 Additional Polish

#### Smooth Animations with CSS Grid

Use CSS Grid for smooth height animations (avoids max-height hack):

```css
/* Expand/collapse animation using grid */
.collapsible-wrapper {
  display: grid;
  grid-template-rows: 0fr;
  transition: grid-template-rows 150ms ease-out;
}

.collapsible-wrapper[data-expanded="true"] {
  grid-template-rows: 1fr;
}

.collapsible-content {
  overflow: hidden;
}
```

```typescript
function CollapsibleContent({ isExpanded, children }) {
  return (
    <div
      className="collapsible-wrapper"
      data-expanded={isExpanded}
    >
      <div className="collapsible-content">
        {children}
      </div>
    </div>
  );
}
```

Alternative: JS-based height calculation for complex cases:

```typescript
function AnimatedCollapse({ isExpanded, children }) {
  const contentRef = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState<number | "auto">(0);

  useEffect(() => {
    if (isExpanded && contentRef.current) {
      setHeight(contentRef.current.scrollHeight);
      // After animation, set to auto for dynamic content
      const timer = setTimeout(() => setHeight("auto"), 150);
      return () => clearTimeout(timer);
    } else {
      setHeight(0);
    }
  }, [isExpanded]);

  return (
    <div
      style={{
        height,
        overflow: "hidden",
        transition: "height 150ms ease-out",
      }}
    >
      <div ref={contentRef}>{children}</div>
    </div>
  );
}
```

#### Visual Feedback

- Hover states on interactive elements
- Focus rings for keyboard navigation
- Loading indicators for async operations

```css
/* Focus ring utility */
.focus-ring {
  outline: none;
}

.focus-ring:focus-visible {
  box-shadow: 0 0 0 2px rgb(59 130 246 / 0.5);
}

/* Hover states */
.diff-line:hover {
  background-color: rgb(255 255 255 / 0.05);
}

/* Interactive button states */
.diff-button {
  transition: background-color 100ms ease;
}

.diff-button:hover {
  background-color: rgb(255 255 255 / 0.1);
}

.diff-button:active {
  background-color: rgb(255 255 255 / 0.15);
}
```

#### Error Recovery

- Per-file error boundaries (from Phase 4)
- Retry buttons for failed operations (shown in 7.3)
- Graceful degradation when features unavailable

```typescript
function DiffViewer({ diff }: { diff: string }) {
  const { files, error } = useParsedDiff(diff);

  // Graceful degradation: show raw diff if parsing fails entirely
  if (error && files.length === 0) {
    return (
      <DiffErrorState
        error={error.message}
        rawDiff={diff}
        onRetry={() => window.location.reload()}
      />
    );
  }

  // Partial success: show what we can, errors for individual files
  return (
    <div>
      {files.map((file, index) => (
        <DiffFileCardWithErrorBoundary
          key={index}
          file={file}
          rawDiff={extractFileRawDiff(diff, file)}
        />
      ))}
    </div>
  );
}
```

## Tailwind sr-only Utility

Ensure this utility is available (included by default in Tailwind):

```css
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border-width: 0;
}

.not-sr-only {
  position: static;
  width: auto;
  height: auto;
  padding: 0;
  margin: 0;
  overflow: visible;
  clip: auto;
  white-space: normal;
}
```

## Completion Criteria

- [ ] Loading skeleton displays while parsing/loading
- [ ] Empty state shown when no changes
- [ ] Error state with raw diff fallback and retry option
- [ ] Proper ARIA table structure for diff content
- [ ] Skip links for navigating between files
- [ ] Screen reader announcements for state changes
- [ ] Focus management handles expand/collapse correctly
- [ ] All features accessible via keyboard
- [ ] Smooth animations using CSS Grid (not max-height hack)
- [ ] Hover and focus states visible
- [ ] Error recovery with retry options
- [ ] Error boundaries integrated with DiffErrorState
