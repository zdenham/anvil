# Phase 3: Syntax Highlighting

## Overview

Create a syntax highlighting service using Shiki to highlight code with VS Code-quality grammar accuracy.

## Tasks

### 3.1 Create language detection utility

**`src/lib/language-detection.ts`**:

```typescript
const EXTENSION_MAP: Record<string, string> = {
  ts: "typescript",
  tsx: "tsx",
  js: "javascript",
  jsx: "jsx",
  rs: "rust",
  py: "python",
  json: "json",
  yaml: "yaml",
  yml: "yaml",
  md: "markdown",
  css: "css",
  html: "html",
  go: "go",
  // ... extend as needed
};

export function getLanguageFromPath(filePath: string): string {
  const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
  return EXTENSION_MAP[ext] ?? "plaintext";
}
```

### 3.2 Create highlighter service

**`src/lib/syntax-highlighter.ts`**:

```typescript
import { createHighlighter, type Highlighter, type ThemedToken } from "shiki";

let highlighter: Highlighter | null = null;

export async function initHighlighter(): Promise<void>;

export async function highlightCode(
  code: string,
  language: string
): Promise<ThemedToken[][]>;

export function isLanguageLoaded(language: string): boolean;

export async function loadLanguage(language: string): Promise<void>;
```

Key design decisions:

- **Return tokens, not HTML**: Use `codeToTokens` instead of `codeToHtml` for granular control. This returns `ThemedToken[][]` (array of lines, each containing tokens with color info).
- **Highlight entire file first**: Never highlight individual lines in isolation—this breaks multi-line syntax constructs (strings, comments, etc.).
- **All highlighting is async**: Even after init, `highlightCode` remains async to support lazy language loading.

Configuration:

```typescript
const highlighter = await createHighlighter({
  themes: ["github-dark"],
  langs: [
    "typescript",
    "javascript",
    "tsx",
    "jsx",
    "rust",
    "python",
    "json",
    "yaml",
    "markdown",
    "css",
    "html",
    "go",
  ],
});
```

### 3.3 Create highlighted line component

**`src/components/diff-viewer/highlighted-line.tsx`**:

```typescript
import type { ThemedToken } from "shiki";

interface HighlightedLineProps {
  tokens: ThemedToken[];
  lineType: "context" | "addition" | "deletion";
  oldLineNumber: number | null;
  newLineNumber: number | null;
}
```

The component receives pre-tokenized content (not raw strings), ensuring syntax context is preserved.

Line styling:

- Addition: `bg-emerald-950/50` with `border-l-2 border-emerald-500`
- Deletion: `bg-red-950/50` with `border-l-2 border-red-500`
- Context: `bg-transparent`
- Line numbers: `text-slate-500 select-none w-12 text-right pr-2 font-mono`

### 3.4 Create diff highlighting coordinator

**`src/lib/highlight-diff.ts`**:

```typescript
import type { ThemedToken } from "shiki";
import type { DiffLine } from "./diff-parser";

interface HighlightedDiffLine {
  tokens: ThemedToken[];
  lineType: "context" | "addition" | "deletion";
  oldLineNumber: number | null;
  newLineNumber: number | null;
}

export async function highlightDiff(
  oldContent: string,
  newContent: string,
  diffLines: DiffLine[],
  language: string
): Promise<HighlightedDiffLine[]>;
```

This function:
1. Highlights the full old content → get token lines for deletions/context
2. Highlights the full new content → get token lines for additions/context
3. Maps diff lines to their corresponding highlighted token arrays

## Error Handling

### Unsupported Languages

When a language is not supported:
1. Log a warning (not an error)
2. Fall back to `plaintext` highlighting (no syntax colors, but still renders)

```typescript
export async function highlightCode(
  code: string,
  language: string
): Promise<ThemedToken[][]> {
  const lang = isLanguageSupported(language) ? language : "plaintext";
  // ... highlight with lang
}
```

### Highlighting Failures

Wrap highlighting in try/catch and return plain tokens on failure:

```typescript
function plainTextFallback(code: string): ThemedToken[][] {
  return code.split("\n").map((line) => [
    { content: line, color: undefined },
  ]);
}
```

## Configuration Details

### Theme Selection

Use `github-dark` theme as the base, which provides good contrast and matches the dark UI. Can be customized later if needed.

### Language Preloading

Preload these languages on initialization to avoid loading delays:
- typescript, tsx, javascript, jsx
- rust
- python
- json, yaml
- markdown
- css, html
- go

All other languages are lazy-loaded on first use via `loadLanguage()`.

### Performance Considerations

- Initialize highlighter once at app startup
- Cache highlighted results by content hash for large files
- Consider web workers for very large files (>5000 lines)
- Memoize `highlightDiff` results when old/new content hasn't changed

## Completion Criteria

- [ ] `getLanguageFromPath()` correctly maps file extensions to Shiki language IDs
- [ ] `initHighlighter()` successfully loads Shiki with preloaded languages
- [ ] `highlightCode()` returns properly tokenized output preserving multi-line syntax
- [ ] Unsupported languages gracefully fall back to plaintext
- [ ] Highlighting failures don't crash the app (fallback to plain rendering)
- [ ] Theme colors match the application's dark mode palette
- [ ] Lazy loading works for non-preloaded languages
- [ ] `HighlightedLine` component renders tokens with correct diff styling
- [ ] No noticeable delay when highlighting typical file sizes (<1000 lines)
