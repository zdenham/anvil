# Phase 4: Core Components

## Overview

Build the main React components that make up the diff viewer.

## Data Models

### Viewer State

```typescript
// src/components/diff-viewer/types.ts

export interface DiffViewerState {
  /** Annotated files (full file + diff annotations merged) */
  files: AnnotatedFile[];
  /** Loading state */
  loading: boolean;
  /** Error message if parsing failed */
  error: string | null;
  /**
   * Expanded collapsed regions: Record<filePath, Set<regionIndex>>
   * Collapsed regions are identified by their index in findCollapsibleRegions() output.
   * By default all regions are collapsed; this tracks which are expanded.
   */
  expandedRegions: Record<string, Set<number>>;
  /** Whether all collapsed regions are expanded (overrides per-region state) */
  allExpanded: boolean;
}

export interface DiffViewerProps {
  /**
   * File changes from the agent, keyed by path.
   * Each FileChangeMessage contains the full cumulative diff from HEAD.
   * See system-integration.md for the FileChangeMessage type definition.
   */
  fileChanges: Map<string, FileChangeMessage>;
  /**
   * REQUIRED: Full file contents for building annotated view.
   * Key: file path, Value: array of lines (already split).
   *
   * Loaded upfront by the parent component for all changed files:
   * - For modified/added files: current file content from disk
   * - For deleted files: old file content from git (git show HEAD:path)
   * - For renamed files: current file content at new path
   *
   * This enables virtualization of large files while having all data available.
   */
  fullFileContents: Record<string, string[]>;
  /** Working directory for the conversation */
  workingDirectory: string;
  /** Optional: Custom priority scoring function */
  priorityFn?: (file: ParsedDiffFile) => number;
}

/**
 * Union type for items in the render list.
 * Used by DiffFileCard to render either lines or collapsed region placeholders.
 */
export type RenderItem =
  | { type: "line"; line: AnnotatedLine; index: number }
  | { type: "collapsed"; region: CollapsedRegion; regionIndex: number };
```

**Type Dependencies** (defined in other phases):
- `AnnotatedFile`, `AnnotatedLine` - from phase 03 (annotation utilities)
- `CollapsedRegion`, `findCollapsibleRegions()` - from phase 03 (collapsing utilities)
- `ParsedDiffFile` - from phase 02 (diff parser)
- `FileChangeMessage` - from system-integration.md

## Tasks

### 4.1 Create DiffViewer container

**`src/components/diff-viewer/diff-viewer.tsx`**:

```typescript
export function DiffViewer({
  fileChanges,
  fullFileContents,
  workingDirectory,
  priorityFn,
}: DiffViewerProps): JSX.Element;
```

Responsibilities:

- Parse diff on mount/change
- Manage expanded sections state
- Provide context for child components
- Handle loading/error states

### 4.2 Create DiffHeader component

**`src/components/diff-viewer/diff-header.tsx`**:

```typescript
interface DiffHeaderProps {
  fileCount: number;
  totalAdditions: number;
  totalDeletions: number;
  onExpandAll: () => void;
  onCollapseAll: () => void;
  allExpanded: boolean;
}
```

Contents:

- File count badge
- Total +/- stats
- Expand All / Collapse All buttons

### 4.3 Create DiffFileCard component

**`src/components/diff-viewer/diff-file-card.tsx`**:

```typescript
interface DiffFileCardProps {
  file: AnnotatedFile;
  expandedRegions: Set<number>; // indices of expanded collapsed regions
  onToggleRegion: (regionIndex: number) => void;
}
```

**Rendering Logic:**

The component computes collapsed regions from annotated lines and renders either lines or collapsed region placeholders:

```typescript
// In DiffFileCard
const collapsibleRegions = useMemo(
  () => findCollapsibleRegions(file.lines),
  [file.lines]
);

// Build render items: either individual lines or collapsed region placeholders
const renderItems = useMemo(() => {
  const items: RenderItem[] = [];
  let lineIndex = 0;

  while (lineIndex < file.lines.length) {
    // Check if this line starts a collapsible region
    const regionIndex = collapsibleRegions.findIndex(
      (r) => r.startIndex === lineIndex
    );

    if (regionIndex !== -1) {
      const region = collapsibleRegions[regionIndex];
      const isExpanded = expandedRegions.has(regionIndex);

      if (isExpanded) {
        // Render all lines in the region
        for (let i = region.startIndex; i <= region.endIndex; i++) {
          items.push({ type: "line", line: file.lines[i], index: i });
        }
      } else {
        // Render collapsed placeholder
        items.push({ type: "collapsed", region, regionIndex });
      }
      lineIndex = region.endIndex + 1;
    } else {
      // Render single line (addition, deletion, or unchanged outside a region)
      items.push({
        type: "line",
        line: file.lines[lineIndex],
        index: lineIndex,
      });
      lineIndex++;
    }
  }
  return items;
}, [file.lines, collapsibleRegions, expandedRegions]);
```

Layout:

- Sticky file header within scroll
- File path with operation type badge (Added/Deleted/Modified/Renamed/Binary)
- Stats: `+15 -3`
- Lines and collapsed regions rendered in order

### 4.4 Create FileHeader component

**`src/components/diff-viewer/file-header.tsx`**:

```typescript
interface FileHeaderProps {
  file: ParsedDiffFile;
}
```

Styling:

- `bg-slate-800` sticky header
- File icon based on extension
- Path with syntax highlighting for path separators
- Operation badge colors:
  - Added: emerald
  - Deleted: red
  - Modified: amber
  - Renamed: blue
  - Binary: slate

### 4.5 Create CollapsedRegionPlaceholder component

**`src/components/diff-viewer/collapsed-region-placeholder.tsx`**:

```typescript
interface CollapsedRegionPlaceholderProps {
  region: CollapsedRegion;
  onToggle: () => void;
}
```

This is a simple presentational component for the collapsed state:

- Single row showing `... N unchanged lines ...`
- Subtle dashed border
- Chevron icon pointing right
- Click to expand

**Note:** When expanded, the parent `DiffFileCard` renders individual `AnnotatedLine` components directly (see §4.3 rendering logic). There is no separate "expanded" component—expansion just means rendering the lines.

### 4.6 Create AnnotatedLineRow component

**`src/components/diff-viewer/annotated-line-row.tsx`**:

```typescript
interface AnnotatedLineRowProps {
  line: AnnotatedLine;
  language: string;
  onLineClick?: (lineNumber: number) => void;
}
```

Renders a single annotated line with:

- Line numbers gutter (old | new, showing `—` for null)
- Syntax highlighted content
- Background based on type:
  - Addition: `bg-emerald-950/50` with `border-l-2 border-emerald-500`
  - Deletion: `bg-red-950/50` with `border-l-2 border-red-500`
  - Unchanged: `bg-transparent`
- Hover state for clickable lines

### 4.7 Create BinaryFilePlaceholder component

**`src/components/diff-viewer/binary-file-placeholder.tsx`**:

```typescript
interface BinaryFilePlaceholderProps {
  file: ParsedDiffFile;
}
```

Display for binary files (images, compiled assets, etc.):

- File icon (generic or type-specific)
- "Binary file changed" message

### 4.8 Create FileCardErrorBoundary

**`src/components/diff-viewer/file-card-error-boundary.tsx`**:

```typescript
interface FileCardErrorBoundaryProps {
  filePath: string;
  children: React.ReactNode;
}
```

Wraps each `DiffFileCard` to prevent one broken file from crashing the entire viewer:

- Catches render errors
- Shows fallback UI with file path and error message
- "Show raw diff" button as escape hatch
- Logs error for debugging

### 4.9 Create useFileContents hook

**`src/hooks/use-file-contents.ts`**

This hook is used by the parent component to load all file contents upfront. This enables:
1. **Virtualization**: We have all data available for windowed rendering
2. **Consistent UX**: No loading spinners when expanding collapsed regions
3. **Simpler state management**: No async operations in the diff viewer itself

```typescript
// src/hooks/use-file-contents.ts
export function useFileContents(
  fileChanges: Map<string, FileChangeMessage>,
  workingDirectory: string
) {
  return useQuery({
    queryKey: ["fileContents", workingDirectory, [...fileChanges.keys()]],
    queryFn: async () => {
      const contents: Record<string, string[]> = {};

      for (const [path, change] of fileChanges) {
        try {
          if (change.operation === "delete") {
            // Deleted: get from git HEAD
            const content = await invoke<string>("git_show_file", {
              cwd: workingDirectory,
              path,
              ref: "HEAD",
            });
            contents[path] = content.split("\n");
          } else {
            // Added/modified/renamed: read from disk
            // For renames, path is already the new path from fileChanges key
            const fullPath = await join(workingDirectory, path);
            const content = await readTextFile(fullPath);
            contents[path] = content.split("\n");
          }
        } catch (err) {
          // Log error but continue - we'll show error state for this file
          console.error(`Failed to load ${path}:`, err);
          contents[path] = []; // Empty array signals load failure
        }
      }

      return contents;
    },
    staleTime: 30_000, // Cache for 30s
  });
}
```

### 4.10 Virtualization for Large Files

**`src/components/diff-viewer/virtualized-file-content.tsx`**

When a file has >1000 lines, use windowed rendering:

```typescript
// In DiffFileCard
const shouldVirtualize = file.lines.length > 1000;

if (shouldVirtualize) {
  return (
    <VirtualizedFileContent
      file={file}
      expandedRegions={expandedRegions}
      onToggleRegion={onToggleRegion}
    />
  );
}

// Otherwise render normally
return <FileContent ... />;
```

**VirtualizedFileContent** uses `@tanstack/react-virtual` to render only visible lines:

```typescript
import { useVirtualizer } from "@tanstack/react-virtual";

interface VirtualizedFileContentProps {
  file: AnnotatedFile;
  expandedRegions: Set<number>;
  onToggleRegion: (regionIndex: number) => void;
  maxHeight?: number; // Default: 600
}

function VirtualizedFileContent({
  file,
  expandedRegions,
  onToggleRegion,
  maxHeight = 600,
}: VirtualizedFileContentProps) {
  const parentRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: renderItems.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 24, // Line height in px
    overscan: 20, // Render 20 extra items above/below viewport
  });

  return (
    <div
      ref={parentRef}
      className="overflow-auto"
      style={{ maxHeight }}
    >
      <div style={{ height: virtualizer.getTotalSize() }}>
        {virtualizer.getVirtualItems().map((virtualRow) => (
          <div
            key={virtualRow.key}
            style={{
              position: "absolute",
              top: virtualRow.start,
              height: virtualRow.size,
              width: "100%",
            }}
          >
            <RenderItem item={renderItems[virtualRow.index]} />
          </div>
        ))}
      </div>
    </div>
  );
}
```

## Completion Criteria

- [ ] DiffViewer container handles parsing and state management
- [ ] DiffHeader shows file count and stats with expand/collapse buttons
- [ ] DiffFileCard renders files with correct layout and styling
- [ ] FileHeader shows path, operation badge, and stats
- [ ] CollapsedRegionPlaceholder shows collapsed line count
- [ ] AnnotatedLineRow renders lines with correct highlighting and line numbers
- [ ] BinaryFilePlaceholder handles binary files gracefully
- [ ] FileCardErrorBoundary prevents single file errors from crashing viewer
- [ ] useFileContents hook loads file contents for all changed files
- [ ] VirtualizedFileContent renders large files (>1000 lines) efficiently
