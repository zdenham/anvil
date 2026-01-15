# Phase 2: Priority Scoring & Annotated File Builder

## Overview

Create modules for prioritizing files by importance and merging full file content with diff annotations.

## Dependencies

This phase depends on types from Phase 1 (`src/lib/diff-parser.ts`):
- `ParsedDiff` - the full parsed diff result
- `ParsedDiffFile` - individual file metadata with `type`, `oldPath`, `newPath`, `stats`, `hunks`, `isBinary`
- `DiffHunk` - hunk with `oldStart`, `newStart`, `lines`
- `DiffLine` - line with `type` ("addition" | "deletion" | "context"), `content`, `oldLineNumber`, `newLineNumber`

**Note**: `ParsedDiffFile.isBinary` should be `true` for binary files where content diffing doesn't apply (images, compiled files, etc.).

## Data Models

### AnnotatedFile (After AnnotatedFileBuilder)

```typescript
// src/lib/annotated-file-builder.ts

export interface AnnotatedFile {
  /** Original parsed file metadata */
  file: ParsedDiffFile;
  /** Priority score (higher = more important), computed by prioritizer */
  priority: number;
  /**
   * All lines in display order: full file content + deleted lines inserted at positions.
   * This is the "merged view" that shows the complete picture.
   */
  lines: AnnotatedLine[];
}

export interface AnnotatedLine {
  /** Line type determines highlighting */
  type: "unchanged" | "addition" | "deletion";
  /** Line content */
  content: string;
  /** Line number in old file (null for additions) */
  oldLineNumber: number | null;
  /** Line number in new file (null for deletions) */
  newLineNumber: number | null;
}
```

## Tasks

### 2.1 Create prioritizer module

**`src/lib/diff-prioritizer.ts`**:

```typescript
export function prioritizeDiffs(files: ParsedDiffFile[]): ParsedDiffFile[];
export function calculatePriority(file: ParsedDiffFile): number;
```

Default priority scoring:

```typescript
const SOURCE_EXTENSIONS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs",
  ".py", ".rs", ".go", ".java", ".c", ".cpp", ".h",
  ".rb", ".php", ".swift", ".kt", ".scala", ".vue", ".svelte"
]);

const TEST_PATTERNS = [
  /\.test\.[jt]sx?$/,
  /\.spec\.[jt]sx?$/,
  /_test\.(go|py|rb)$/,
  /Test\.java$/,
  /tests?\//i
];

const CONFIG_EXTENSIONS = new Set([
  ".json", ".yaml", ".yml", ".toml", ".ini", ".env",
  ".config.js", ".config.ts", ".eslintrc", ".prettierrc"
]);

function isSourceFile(path: string | null): boolean {
  if (!path) return false;
  const ext = path.slice(path.lastIndexOf("."));
  return SOURCE_EXTENSIONS.has(ext) && !isTestFile(path);
}

function isTestFile(path: string | null): boolean {
  if (!path) return false;
  return TEST_PATTERNS.some(pattern => pattern.test(path));
}

function isConfigFile(path: string | null): boolean {
  if (!path) return false;
  const ext = path.slice(path.lastIndexOf("."));
  return CONFIG_EXTENSIONS.has(ext) || path.includes("config");
}

function calculatePriority(file: ParsedDiffFile): number {
  let score = 0;
  const path = file.newPath ?? file.oldPath; // Use oldPath for deleted files

  // More changes = higher priority
  score += file.stats.additions * 2;
  score += file.stats.deletions * 1.5;

  // Source files > config/docs
  if (isSourceFile(path)) score += 50;
  if (isTestFile(path)) score += 30;
  if (isConfigFile(path)) score += 10;

  // New files are interesting
  if (file.type === "added") score += 25;

  // Deleted files less interesting than modifications
  if (file.type === "deleted") score -= 10;

  return score;
}
```

### 2.2 Create annotated file builder

**`src/lib/annotated-file-builder.ts`**:

This is the key module that merges full file content with diff annotations.

```typescript
/**
 * Build annotated files from a parsed diff and full file contents.
 *
 * @param parsedDiff - The parsed diff from Phase 1
 * @param fullFileContents - Map of file path → array of lines.
 *   Key should be `newPath` for modified/added files, `oldPath` for deleted files.
 *   Files not in this map (e.g., binary files) will have empty `lines` array.
 * @param priorityFn - Optional custom priority function (defaults to calculatePriority)
 */
export function buildAnnotatedFiles(
  parsedDiff: ParsedDiff,
  fullFileContents: Record<string, string[]>,
  priorityFn?: (file: ParsedDiffFile) => number
): AnnotatedFile[];
```

**Edge Cases:**

1. **Deleted files** (`type === "deleted"`): Use `oldPath` as the key. The builder will produce only deletion lines since there's no new file content.

2. **Binary files** (`isBinary === true`): Skip annotation building entirely. Return `AnnotatedFile` with empty `lines` array.

3. **Missing file content**: If a file path isn't in `fullFileContents`, return `AnnotatedFile` with empty `lines` array and log a warning.

4. **Renamed files with no changes**: If `hunks` is empty, all lines are unchanged.

**Algorithm for `buildAnnotatedFile(parsedFile, fullContent)`:**

The algorithm processes hunks directly, using the line numbers from the diff as the source of truth for annotations. The full file content provides the actual text, while hunk data tells us which lines are additions/deletions/unchanged.

```typescript
function buildAnnotatedFile(
  parsedFile: ParsedDiffFile,
  fullContent: string[]
): AnnotatedLine[] {
  const result: AnnotatedLine[] = [];
  const totalLines = fullContent.length;

  // Build lookup maps from hunk data
  // Key: new line number, Value: line info from diff
  const additionLines = new Map<number, DiffLine>();
  // Deletions grouped by their insertion point (the new line number AFTER which they appear)
  const deletionsByInsertPoint = new Map<number, DiffLine[]>();

  for (const hunk of parsedFile.hunks) {
    let lastNewLineNum = hunk.newStart - 1; // Track position for deletion insertion

    for (const line of hunk.lines) {
      if (line.type === "addition") {
        additionLines.set(line.newLineNumber!, line);
        lastNewLineNum = line.newLineNumber!;
      } else if (line.type === "deletion") {
        // Deletions are inserted AFTER the last seen new line number
        // (which could be a context line or an addition)
        const insertPoint = lastNewLineNum;
        if (!deletionsByInsertPoint.has(insertPoint)) {
          deletionsByInsertPoint.set(insertPoint, []);
        }
        deletionsByInsertPoint.get(insertPoint)!.push(line);
      } else if (line.type === "context") {
        lastNewLineNum = line.newLineNumber!;
      }
    }
  }

  // Pre-compute running counts for O(n) performance instead of O(n²)
  // additionsUpTo[i] = count of additions with newLineNumber <= i
  // deletionsUpTo[i] = count of deletions with insertPoint <= i
  const additionsUpTo = new Array(totalLines + 2).fill(0);
  const deletionsUpTo = new Array(totalLines + 2).fill(0);

  for (let i = 1; i <= totalLines + 1; i++) {
    additionsUpTo[i] = additionsUpTo[i - 1] + (additionLines.has(i) ? 1 : 0);
    deletionsUpTo[i] =
      deletionsUpTo[i - 1] + (deletionsByInsertPoint.get(i - 1)?.length ?? 0);
  }

  // Build the annotated output by walking through new file line numbers
  // Insert deletions at their correct positions
  for (let newLineNum = 1; newLineNum <= totalLines; newLineNum++) {
    // First, insert any deletions that come BEFORE this line
    // (deletions anchored to the previous line number)
    const deletionsHere = deletionsByInsertPoint.get(newLineNum - 1);
    if (deletionsHere) {
      for (const del of deletionsHere) {
        result.push({
          type: "deletion",
          content: del.content,
          oldLineNumber: del.oldLineNumber,
          newLineNumber: null,
        });
      }
    }

    // Now add the current line from the new file
    // NOTE: We use fullContent instead of addition.content because the actual
    // file content is authoritative - diff content may be truncated or have
    // whitespace differences depending on the diff generation tool.
    const addition = additionLines.get(newLineNum);
    if (addition) {
      result.push({
        type: "addition",
        content: fullContent[newLineNum - 1],
        oldLineNumber: null,
        newLineNumber: newLineNum,
      });
    } else {
      // Unchanged line - compute oldLineNumber using pre-computed counts
      // Formula: oldLineNum = newLineNum - additions_before + deletions_before
      const additionsBefore = additionsUpTo[newLineNum - 1];
      const deletionsBefore = deletionsUpTo[newLineNum - 1];
      const oldLineNum = newLineNum - additionsBefore + deletionsBefore;

      result.push({
        type: "unchanged",
        content: fullContent[newLineNum - 1],
        oldLineNumber: oldLineNum,
        newLineNumber: newLineNum,
      });
    }
  }

  // Handle trailing deletions (at end of file)
  const trailingDeletions = deletionsByInsertPoint.get(totalLines);
  if (trailingDeletions) {
    for (const del of trailingDeletions) {
      result.push({
        type: "deletion",
        content: del.content,
        oldLineNumber: del.oldLineNumber,
        newLineNumber: null,
      });
    }
  }

  return result;
}
```

**Key insight**: The diff hunks contain the authoritative line number mappings. We use:
1. `DiffLine.newLineNumber` to identify additions and map them to new file positions
2. `DiffLine.oldLineNumber` directly from the diff for deletions
3. Computed old line numbers for unchanged lines (accounting for additions/deletions offset)

**Why this approach works**:
- The diff parser already assigns correct line numbers to each DiffLine
- We don't need to track counters manually—the diff is the source of truth
- Deletions are positioned relative to context/addition lines in the hunk

**Handler for deleted files:**

For files with `type === "deleted"`, we use the old file content and mark all lines as deletions:

```typescript
function buildDeletedFileAnnotation(
  parsedFile: ParsedDiffFile,
  oldContent: string[]
): AnnotatedLine[] {
  return oldContent.map((content, index) => ({
    type: "deletion" as const,
    content,
    oldLineNumber: index + 1,
    newLineNumber: null,
  }));
}
```

**Top-level orchestration:**

```typescript
export function buildAnnotatedFiles(
  parsedDiff: ParsedDiff,
  fullFileContents: Record<string, string[]>,
  priorityFn: (file: ParsedDiffFile) => number = calculatePriority
): AnnotatedFile[] {
  return parsedDiff.files.map((file) => {
    const priority = priorityFn(file);

    // Skip binary files
    if (file.isBinary) {
      return { file, priority, lines: [] };
    }

    // Determine which path to use for content lookup
    const contentKey =
      file.type === "deleted" ? file.oldPath : file.newPath;
    const content = fullFileContents[contentKey ?? ""];

    // Handle missing content
    if (!content) {
      console.warn(`Missing content for file: ${contentKey}`);
      return { file, priority, lines: [] };
    }

    // Build appropriate annotation based on file type
    const lines =
      file.type === "deleted"
        ? buildDeletedFileAnnotation(file, content)
        : buildAnnotatedFile(file, content);

    return { file, priority, lines };
  });
}
```

**Example transformation:**

```
Full file (new):     Diff hunks:           Annotated output:
─────────────────    ─────────────────     ─────────────────────────────
line 1               @@ -1,3 +1,3 @@       line 1        (unchanged)
line 2                context              line 2        (unchanged)
new line 3           -old line 3           old line 3    (deletion, ghost)
line 4               +new line 3           new line 3    (addition)
                      context              line 4        (unchanged)
```

## Completion Criteria

### Prioritizer
- [ ] `calculatePriority()` produces sensible scores for different file types
- [ ] `isSourceFile()`, `isTestFile()`, `isConfigFile()` correctly classify paths
- [ ] Handles null/undefined paths gracefully

### Annotated File Builder
- [ ] `buildAnnotatedFile()` correctly merges full file content with diff annotations
- [ ] Deleted lines appear as "ghost lines" at correct positions
- [ ] Unchanged lines have correct old and new line numbers
- [ ] Pre-computed counts work correctly (O(n) performance)

### Edge Cases
- [ ] Deleted files produce all-deletion annotations using old file content
- [ ] Binary files return empty `lines` array without errors
- [ ] Missing file content returns empty `lines` array with warning
- [ ] Renamed files with no changes show all lines as unchanged
- [ ] Files with deletions at start/end of file handled correctly
- [ ] Multiple consecutive deletions grouped at correct insertion point

### Unit Tests
- [ ] Simple addition-only diff
- [ ] Simple deletion-only diff
- [ ] Mixed additions and deletions
- [ ] Consecutive deletions at same position
- [ ] Deletions at start of file (before line 1)
- [ ] Deletions at end of file (trailing)
- [ ] Multiple hunks in same file
- [ ] Renamed file with modifications
- [ ] Completely deleted file
- [ ] Newly added file
