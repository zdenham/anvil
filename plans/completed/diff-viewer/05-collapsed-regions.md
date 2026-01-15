# Phase 5: Collapsed Region Behavior

## Overview

Implement the logic for computing and managing collapsible regions of unchanged lines.

## Data Models

### Collapsed Regions (Computed at Render Time)

Collapsed regions are **not stored in the data model**. They are computed dynamically by the `DiffFileCard` component when rendering:

```typescript
// src/components/diff-viewer/use-collapsed-regions.ts

export interface CollapsedRegion {
  /** Index of first line in this region (into AnnotatedLine[]) */
  startIndex: number;
  /** Index of last line in this region (inclusive) */
  endIndex: number;
  /** Number of unchanged lines */
  lineCount: number;
}

/** Minimum consecutive unchanged lines to create a collapsible region */
const MIN_COLLAPSE_LINES = 8;

/**
 * Scans annotated lines and identifies collapsible regions.
 * Returns indices into the lines array, not line numbers.
 */
export function findCollapsibleRegions(
  lines: AnnotatedLine[]
): CollapsedRegion[] {
  const regions: CollapsedRegion[] = [];
  let regionStart: number | null = null;

  for (let i = 0; i < lines.length; i++) {
    const isUnchanged = lines[i].type === "unchanged";

    if (isUnchanged && regionStart === null) {
      regionStart = i;
    } else if (!isUnchanged && regionStart !== null) {
      const length = i - regionStart;
      if (length >= MIN_COLLAPSE_LINES) {
        regions.push({
          startIndex: regionStart,
          endIndex: i - 1,
          lineCount: length,
        });
      }
      regionStart = null;
    }
  }

  // Handle trailing unchanged region
  if (regionStart !== null) {
    const length = lines.length - regionStart;
    if (length >= MIN_COLLAPSE_LINES) {
      regions.push({
        startIndex: regionStart,
        endIndex: lines.length - 1,
        lineCount: length,
      });
    }
  }

  return regions;
}
```

This approach:

1. Keeps the data model simple (just annotated lines)
2. Makes collapse logic a pure function of the data
3. Allows easy adjustment of collapse threshold
4. Naturally handles edge cases (all unchanged, no unchanged, etc.)

## Tasks

### 5.1 Create collapsed regions hook

**`src/components/diff-viewer/use-collapsed-regions.ts`**:

```typescript
export function useCollapsedRegions(lines: AnnotatedLine[]) {
  // Compute collapsible regions (memoized)
  const regions = useMemo(() => findCollapsibleRegions(lines), [lines]);

  // Track which regions are expanded
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  const toggle = useCallback((index: number) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }, []);

  const expandAll = useCallback(() => {
    setExpanded(new Set(regions.map((_, i) => i)));
  }, [regions]);

  const collapseAll = useCallback(() => {
    setExpanded(new Set());
  }, []);

  return { regions, expanded, toggle, expandAll, collapseAll };
}
```

### 5.2 Collapsed region rendering

The `DiffFileCard` component uses the hook and builds render items:

- Unchanged lines within a collapsible region → collapsed placeholder OR expanded lines
- All other lines (additions, deletions, unchanged outside threshold) → individual line rows

### 5.3 Handling Deleted Files

For **deleted files**, there is no "new file" on disk to read. We need special handling.

**Data Loading (Parent Component)**:

The parent component loads deleted file content from git:

```typescript
// In useConversation or ConversationWindow
async function loadFileContents(
  fileChanges: Map<string, FileChangeMessage>,
  workingDirectory: string
): Promise<Record<string, string[]>> {
  const contents: Record<string, string[]> = {};

  for (const [path, change] of fileChanges) {
    if (change.operation === "delete") {
      // Deleted file: get content from git HEAD
      const content = await execCommand(
        `git show HEAD:${path}`,
        workingDirectory
      );
      contents[path] = content.split("\n");
    } else if (change.operation === "rename" && change.oldPath) {
      // Renamed file: read from new path on disk
      const fullPath = await join(workingDirectory, path);
      const content = await readTextFile(fullPath);
      contents[path] = content.split("\n");
    } else {
      // Added/modified: read current file from disk
      const fullPath = await join(workingDirectory, path);
      const content = await readTextFile(fullPath);
      contents[path] = content.split("\n");
    }
  }

  return contents;
}
```

**Annotated File Builder for Deleted Files**:

When `parsedFile.type === "deleted"`:

```typescript
function buildAnnotatedDeletedFile(
  parsedFile: ParsedDiffFile,
  oldFileContent: string[]
): AnnotatedLine[] {
  // For deleted files, every line is a deletion
  // The fullFileContent passed in is the OLD file content (from git show HEAD:path)
  return oldFileContent.map((content, index) => ({
    type: "deletion" as const,
    content,
    oldLineNumber: index + 1,
    newLineNumber: null,
  }));
}
```

**Display Considerations**:

- **Collapsed regions**: For large deleted files (>50 lines), collapse interior deletions but show first/last 5 lines. This provides context without overwhelming the viewer.
- **Header badge**: Show "Deleted" badge in red
- **Stats**: Show only deletions count (`-150 lines`)
- **Empty state**: If file was empty, show "Empty file deleted" message

**Error Handling**:

If `git show HEAD:path` fails (e.g., file wasn't tracked):
- Log warning
- Show file card with error state: "Could not load deleted file content"
- Display raw diff hunks as fallback

### 5.4 Handling New Files

For **new files**, all lines are additions. The file content is loaded from disk normally.

```typescript
function buildAnnotatedNewFile(
  parsedFile: ParsedDiffFile,
  newFileContent: string[]
): AnnotatedLine[] {
  return newFileContent.map((content, index) => ({
    type: "addition" as const,
    content,
    oldLineNumber: null,
    newLineNumber: index + 1,
  }));
}
```

**Collapsed regions for new files**: For very large new files (>100 lines), collapse interior additions to avoid overwhelming the viewer. Show first 10 and last 10 lines expanded, collapse the middle. This differs from the default behavior (no collapse for changes) because a 2000-line new file is unwieldy.

### 5.5 Handling Renamed Files

For **renamed files**, load content from the new path. The diff shows what changed between old and new versions.

```typescript
// In buildAnnotatedFiles
if (parsedFile.type === "renamed") {
  // Use newPath to look up content
  const content = fullFileContents[parsedFile.newPath!];
  // Process like a modified file
  return buildAnnotatedFile(parsedFile, content);
}
```

**Display**: Show both paths in header: `old/path.ts → new/path.ts` with "Renamed" badge in blue. If similarity is 100%, show "Renamed (no changes)" message instead of empty diff.

## Completion Criteria

- [ ] `findCollapsibleRegions()` correctly identifies regions of 8+ unchanged lines
- [ ] `useCollapsedRegions()` hook manages expand/collapse state
- [ ] Toggle, expand all, and collapse all functions work correctly
- [ ] Deleted files load content from git and display all lines as deletions
- [ ] New files collapse interior for very large files (>100 lines)
- [ ] Renamed files show both paths and handle 100% similarity case
- [ ] Error states handled gracefully with fallback to raw diff
