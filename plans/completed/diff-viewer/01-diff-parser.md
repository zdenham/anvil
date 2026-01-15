# Phase 1: Diff Parser

## Overview

Create a parser that converts raw git diff output to structured data.

## Data Models

### ParsedDiff (Parser Output)

```typescript
// src/lib/diff-parser.ts

export interface ParsedDiff {
  files: ParsedDiffFile[];
}

export interface ParsedDiffFile {
  /** Original file path (null for new files) */
  oldPath: string | null;
  /** New file path (null for deleted files) */
  newPath: string | null;
  /** File operation type */
  type: "added" | "deleted" | "modified" | "renamed" | "binary";
  /** For renamed files, similarity percentage */
  similarity?: number;
  /** Hunks from the diff (parser only outputs hunks, not collapsed regions) */
  hunks: DiffHunk[];
  /** Summary statistics */
  stats: {
    additions: number;
    deletions: number;
  };
  /** Detected language for syntax highlighting */
  language: string;
}

export interface DiffHunk {
  /** Starting line number in old file */
  oldStart: number;
  /** Number of lines in old file */
  oldLines: number;
  /** Starting line number in new file */
  newStart: number;
  /** Number of lines in new file */
  newLines: number;
  /** Optional section header from hunk (e.g., function name) */
  sectionHeader?: string;
  /** Individual line changes (includes context lines from diff) */
  lines: DiffLine[];
}

export interface DiffLine {
  /** Line type: context lines are unchanged lines IN the diff output */
  type: "context" | "addition" | "deletion";
  /** Line content (without +/- prefix) */
  content: string;
  /** Line number in old file (null for additions) */
  oldLineNumber: number | null;
  /** Line number in new file (null for deletions) */
  newLineNumber: number | null;
}
```

## Tasks

### 1.1 Create diff parser module

**`src/lib/diff-parser.ts`**:

Core parser that converts raw git diff output to structured data.

```typescript
export function parseDiff(diffText: string): ParsedDiff;
```

Parsing strategy:

1. Split by file headers (`diff --git a/... b/...`)
2. Extract old/new paths from `--- a/...` and `+++ b/...` lines
   - Convert `/dev/null` to `null` for new/deleted files
3. Parse `@@ -start,count +start,count @@ optional section header` hunk headers
   - Capture the optional section header after the closing `@@`
4. Categorize lines by prefix: ` ` (context), `+` (addition), `-` (deletion)
5. Track line numbers for each `DiffLine`:
   - Initialize `oldLineNum = oldStart`, `newLineNum = newStart` from hunk header
   - Context lines: set both line numbers, increment both counters
   - Addition lines: set `newLineNumber`, `oldLineNumber = null`, increment new counter
   - Deletion lines: set `oldLineNumber`, `newLineNumber = null`, increment old counter
6. Detect file operation type from headers
7. Calculate stats by counting `+` and `-` prefixed lines (excluding `+++`/`---` headers)

### 1.2 Handle edge cases

Must handle:
- New files: `--- /dev/null` → set `oldPath = null`
- Deleted files: `+++ /dev/null` → set `newPath = null`
- Renamed files: `rename from ... rename to ...` with `similarity index X%`
- Binary files: `Binary files ... differ`
- No newline at EOF: `\ No newline at end of file` (strip from output, don't treat as diff line)

Out of scope (rare, can add later if needed):
- File mode changes (`old mode 100644`, `new mode 100755`)
- Copy operations (`copy from ... copy to ...`)
- Combined/merge diffs (multiple `@@` markers)
- Quoted/escaped filenames with special characters

### 1.3 Language detection

**`src/lib/language-detector.ts`**:

```typescript
export function detectLanguage(filePath: string): string;
```

Create a simple extension-to-language map. Shiki's `bundledLanguages` only maps language IDs to grammar modules—it doesn't provide extension detection.

Map file extensions to Shiki language identifiers:

- `.ts` → `typescript`
- `.tsx` → `tsx`
- `.js` → `javascript`
- `.jsx` → `jsx`
- `.rs` → `rust`
- `.py` → `python`
- `.md` → `markdown`
- `.json` → `json`
- `.css` → `css`
- `.html` → `html`
- `.yaml`, `.yml` → `yaml`
- `.toml` → `toml`
- Default: `plaintext`

### 1.4 Add unit tests for parser

**`src/lib/diff-parser.test.ts`**:

Test cases:

- Simple single-file diff with correct line number tracking
- Multi-file diff
- New file creation (`oldPath` should be `null`)
- File deletion (`newPath` should be `null`)
- File rename with similarity percentage
- Binary file detection
- Hunk with section header (e.g., `@@ -10,5 +10,7 @@ function foo()`)
- Stats calculation (additions/deletions count)
- No newline at EOF marker (should be stripped)
- Empty diff

## Completion Criteria

- [ ] `parseDiff()` function handles all standard git diff formats
- [ ] Line numbers correctly tracked for each `DiffLine`
- [ ] Hunk section headers captured when present
- [ ] Edge cases (new/deleted/renamed/binary files) handled correctly
- [ ] Stats (additions/deletions) calculated accurately
- [ ] Language detection working for common file types
- [ ] Unit tests passing for all test cases
