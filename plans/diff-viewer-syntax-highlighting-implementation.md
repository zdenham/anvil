# Diff Viewer Syntax Highlighting - Implementation Plan

## Overview

This plan integrates the existing Shiki syntax highlighting infrastructure into the diff viewer rendering pipeline. The approach pre-tokenizes content during annotation building to preserve multi-line syntax context.

## Why This Approach

**Pre-tokenization is required** because Shiki (and syntax highlighting in general) needs full file context to correctly handle multi-line constructs:

```typescript
// If line 6 is highlighted in isolation:
const template = `
  This is a multi-line string  // ← Highlighter doesn't know about opening backtick
`;
// Result: Wrong colors for the entire string content
```

Alternatives considered:
- **On-demand highlighting**: Violates Shiki's design principle, breaks multi-line syntax
- **CSS classes vs inline styles**: Not worth the complexity, negligible perf difference
- **Different library (Prism, highlight.js)**: Shiki already installed, better accuracy

## Architecture

### Current Flow (No Highlighting)
```
Raw diff → parseDiff() → ParsedDiff
                              ↓
ParsedDiff + file contents → buildAnnotatedFiles() → AnnotatedFile[]
                                                          ↓
                                                    DiffFileCard
                                                          ↓
                                                   AnnotatedLineRow (plain text)
```

### New Flow (With Highlighting)
```
Raw diff → parseDiff() → ParsedDiff
                              ↓
ParsedDiff + file contents → buildAnnotatedFiles() → AnnotatedFile[]
                                                          ↓
                                                   highlightAnnotatedFiles() ← NEW
                                                          ↓
                                                    AnnotatedFile[] (with tokens)
                                                          ↓
                                                    DiffFileCard
                                                          ↓
                                                   AnnotatedLineRow (conditionally renders tokens)
```

## Implementation Steps

### Step 1: Extend AnnotatedLine Type

**File:** `src/components/diff-viewer/types.ts`

Add optional tokens field:

```typescript
import type { ThemedToken } from "shiki";

export interface AnnotatedLine {
  type: "unchanged" | "addition" | "deletion";
  content: string;
  oldLineNumber: number | null;
  newLineNumber: number | null;
  /** Syntax highlighting tokens (optional, populated async) */
  tokens?: ThemedToken[];
}
```

This is backward compatible - existing code continues to work without tokens.

---

### Step 2: Create Integration Function

**File:** `src/lib/highlight-annotated-files.ts` (new)

```typescript
import type { AnnotatedFile } from "@/components/diff-viewer/types";
import { highlightDiff } from "./highlight-diff";

/**
 * Add syntax highlighting tokens to annotated files.
 * Modifies files in-place for efficiency.
 */
export async function highlightAnnotatedFiles(
  files: AnnotatedFile[],
  fullFileContents: Record<string, string[]>
): Promise<void> {
  await Promise.all(
    files.map(async (file) => {
      // Skip binary files
      if (file.file.isBinary || file.file.type === "binary") {
        return;
      }

      const filePath = file.file.newPath ?? file.file.oldPath;
      if (!filePath) return;

      // Get old and new content
      const oldPath = file.file.oldPath;
      const newPath = file.file.newPath;

      const oldContent = oldPath && fullFileContents[oldPath]
        ? fullFileContents[oldPath].join("\n")
        : "";
      const newContent = newPath && fullFileContents[newPath]
        ? fullFileContents[newPath].join("\n")
        : "";

      // Convert AnnotatedLine[] to DiffLine[] format expected by highlightDiff
      const diffLines = file.lines.map(line => ({
        type: line.type === "unchanged" ? "context" as const : line.type,
        content: line.content,
        oldLineNumber: line.oldLineNumber,
        newLineNumber: line.newLineNumber,
      }));

      try {
        const highlighted = await highlightDiff(
          oldContent,
          newContent,
          diffLines,
          file.file.language
        );

        // Merge tokens back into annotated lines
        for (let i = 0; i < file.lines.length; i++) {
          file.lines[i].tokens = highlighted[i]?.tokens;
        }
      } catch (error) {
        // Graceful degradation: leave tokens undefined, render as plain text
        console.warn(`Syntax highlighting failed for ${filePath}:`, error);
      }
    })
  );
}
```

---

### Step 3: Update AnnotatedLineRow Component

**File:** `src/components/diff-viewer/annotated-line-row.tsx`

Conditionally render tokens when available:

```typescript
import type { ThemedToken } from "shiki";

// In the component, replace the content span:

{/* Line content */}
<span
  role="cell"
  className={`
    flex-1 px-2 whitespace-pre overflow-x-auto
    ${line.tokens ? "" : getContentColor(line.type)}
  `}
>
  {line.tokens ? (
    <TokenizedContent tokens={line.tokens} />
  ) : (
    line.content || " "
  )}
</span>

// Add helper component:
function TokenizedContent({ tokens }: { tokens: ThemedToken[] }) {
  if (tokens.length === 0) {
    return <span>&nbsp;</span>;
  }

  return (
    <>
      {tokens.map((token, index) => (
        <span key={index} style={{ color: token.color }}>
          {token.content}
        </span>
      ))}
    </>
  );
}
```

**Note:** When tokens are present, we skip `getContentColor()` since Shiki provides the colors. The diff line type styling (background, border) is preserved.

---

### Step 4: Integrate at DiffViewer Level

**File:** `src/components/diff-viewer/diff-viewer.tsx`

Add highlighting call after building annotated files. This requires finding where `buildAnnotatedFiles` is called and adding the highlighting step.

```typescript
import { highlightAnnotatedFiles } from "@/lib/highlight-annotated-files";

// After building annotated files:
const annotatedFiles = buildAnnotatedFiles(parsedDiff, fullFileContents);

// Add highlighting (async)
await highlightAnnotatedFiles(annotatedFiles, fullFileContents);

// Continue with rendering...
```

**Loading state consideration:** Since highlighting is async, either:
1. Show skeleton/loading state until highlighting completes
2. Render immediately with plain text, then re-render when tokens arrive (may cause flash)

Option 1 is preferred for visual consistency.

---

### Step 5: Add Loading State (Optional but Recommended)

If the DiffViewer doesn't already handle async data loading, add a loading state:

```typescript
const [isHighlighting, setIsHighlighting] = useState(false);

useEffect(() => {
  async function highlight() {
    setIsHighlighting(true);
    await highlightAnnotatedFiles(annotatedFiles, fullFileContents);
    setIsHighlighting(false);
  }
  highlight();
}, [annotatedFiles, fullFileContents]);

if (isHighlighting) {
  return <DiffViewerSkeleton />;
}
```

---

## File Summary

| File | Action | Description |
|------|--------|-------------|
| `src/components/diff-viewer/types.ts` | Modify | Add `tokens?: ThemedToken[]` to `AnnotatedLine` |
| `src/lib/highlight-annotated-files.ts` | Create | Integration function connecting annotation → highlighting |
| `src/components/diff-viewer/annotated-line-row.tsx` | Modify | Conditionally render tokens |
| `src/components/diff-viewer/diff-viewer.tsx` | Modify | Call `highlightAnnotatedFiles()` after building |

---

## Testing Checklist

- [ ] TypeScript types compile without errors
- [ ] Diff viewer renders without highlighting (backward compat)
- [ ] Diff viewer renders with highlighting for supported languages
- [ ] Multi-line strings/comments are correctly colored
- [ ] Binary files are skipped (no errors)
- [ ] New files (all additions) highlight correctly
- [ ] Deleted files (all deletions) highlight correctly
- [ ] Renamed files with changes highlight correctly
- [ ] Empty files don't cause errors
- [ ] Large files (1000+ lines) don't freeze UI
- [ ] Unsupported languages fall back to plain text gracefully

---

## Performance Notes

**Expected impact:**
- Initial diff parse: +50-150ms for typical files (async, non-blocking)
- Memory: +5-10% per file (token storage)
- Render: No change (tokens pre-computed)

**Optimizations already in place:**
- LRU cache (100 entries) in `syntax-highlighter.ts` prevents re-highlighting
- Language preloading for common languages
- Virtualization for large files (>1000 lines)

---

## Future Improvements (Out of Scope)

- Theme customization (currently only `github-dark`)
- Word-level diff highlighting (intra-line changes)
- Web worker offloading for very large files
- CSS class generation for theme switching without re-tokenizing
