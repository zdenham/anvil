# Fix Syntax Highlighting: Consolidate into One Pipeline

Consolidate the two diff highlighting pipelines into one, fix the hunk-boundary tokenization bug, and delete the redundant code.

## Phases

- [x] Phase 1: Upgrade `useDiffHighlight` to accept optional full-file content
- [x] Phase 2: Migrate `DiffViewer` off `highlightAnnotatedFiles` onto `useDiffHighlight`
- [x] Phase 3: Pipe full file content through the Changes pane
- [x] Phase 4: Delete dead code (`highlight-diff.ts`, `highlight-annotated-files.ts`)

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Problem

There are two separate highlighting pipelines that do the same thing differently:

| Pipeline | Entry point | Used by | Has full file content? | Correct? |
|----------|-------------|---------|----------------------|----------|
| **A** | `highlightAnnotatedFiles()` → `highlightDiff()` | `DiffViewer` (thread file review) | Yes | Yes |
| **B** | `useDiffHighlight()` → `buildPseudoFiles()` | `InlineDiffBlock` (6 consumers) | No | **No** — leaks lexer state across hunks |

Pipeline A highlights full old/new files then slices tokens by line number. Pipeline B concatenates only diff lines into "pseudo-files" — if a hunk ends mid-comment/string, the next hunk gets wrong tokenization.

This is an accidental split caused by data availability, not an intentional architectural choice. The fix is to **consolidate into one pipeline** (`useDiffHighlight`) that does the right thing when full content is available and gracefully degrades when it isn't.

### Why consolidate instead of just fixing the bug?

- **One implementation to maintain.** `highlightDiff`, `highlightAnnotatedFiles`, and `useDiffHighlight` all solve the same problem: "given diff lines, produce syntax tokens."
- **DiffViewer's highlighting is overengineered.** It deep-clones every annotated file, runs an imperative async effect, manages a separate `highlightedFiles` state, and shows a skeleton until ALL files are highlighted. The hook approach is simpler — each file highlights independently, shows plain text immediately, and upgrades to highlighted in-place.
- **Delete ~200 lines.** `highlight-diff.ts` (138 lines) and `highlight-annotated-files.ts` (65 lines) become dead code.

## `InlineDiffBlock` consumers (6 call sites)

| Consumer | Has full file content? | After fix |
|----------|----------------------|-----------|
| `ChangesDiffContent` (changes pane) | Not yet — but parent has worktree access | Phase 3: pipe content through |
| `ChangesTab` (control panel) | Has annotated files with content | Phase 3: pipe content through |
| `ToolUseBlock` (thread) | No — only tool input/result | Pseudo-file fallback |
| `WriteToolBlock` (thread) | No — only tool input | Pseudo-file fallback |
| `PermissionRequestBlock` | No — only tool input | Pseudo-file fallback |
| `InlinePermissionApproval` | No — only tool input | Pseudo-file fallback |

Thread-inline consumers (tool blocks, permission prompts) will never have full file content — they only see the tool's input/output. The pseudo-file fallback is acceptable here because these diffs are typically single-hunk edits where the bug rarely manifests.

## Phase 1: Upgrade `useDiffHighlight`

Make the hook accept optional full-file content. When provided, highlight full files and map tokens by line number. When not provided, fall back to the existing pseudo-file approach.

### `src/hooks/use-diff-highlight.ts`

**New signature:**
```ts
export function useDiffHighlight(
  lines: AnnotatedLine[],
  filePath: string,
  oldContent?: string,   // full old file as string
  newContent?: string,    // full new file as string
): AnnotatedLine[]
```

**New internal logic:**

```ts
// Determine what to highlight
const { textToHighlight, mappingStrategy } = useMemo(() => {
  if (oldContent != null || newContent != null) {
    // Full-file path: highlight complete files, map by line number
    return {
      oldText: oldContent ?? "",
      newText: newContent ?? "",
      strategy: "line-number" as const,
    };
  }
  // Pseudo-file fallback: concatenate diff lines
  const pseudo = buildPseudoFiles(lines);
  return {
    oldText: pseudo.oldText,
    newText: pseudo.newText,
    strategy: "pseudo-mapping" as const,
    mappings: pseudo.mappings,
  };
}, [lines, oldContent, newContent]);
```

**Token mapping for full-file path:**
When using line numbers, map each `AnnotatedLine` to tokens from the highlighted full file:
- `deletion` → `oldTokens[line.oldLineNumber - 1]`
- `addition` → `newTokens[line.newLineNumber - 1]`
- `unchanged` → `newTokens[line.newLineNumber - 1]`

This is the same logic as `getTokensForLine` in `highlight-diff.ts` — just inlined into the hook's `applyTokens` function.

**Keep `buildPseudoFiles` and the existing pseudo-mapping path** as fallback for consumers without full content.

### `src/components/thread/inline-diff-block.tsx`

**Add optional props and forward to hook:**
```ts
interface InlineDiffBlockProps {
  // ... existing
  oldContent?: string;
  newContent?: string;
}

// In component body:
const highlightedLines = useDiffHighlight(lines, filePath, oldContent, newContent);
```

No existing consumers need to change — the new props are optional.

### Files changed:
| File | Change |
|------|--------|
| `src/hooks/use-diff-highlight.ts` | Add full-content path with line-number mapping |
| `src/components/thread/inline-diff-block.tsx` | Accept + forward `oldContent`/`newContent` |

## Phase 2: Migrate `DiffViewer` off the old pipeline

Replace the imperative highlighting in `DiffViewer` with per-file `useDiffHighlight` calls.

### `src/components/diff-viewer/diff-viewer.tsx`

**Remove:**
- `highlightedFiles` state
- `isHighlighting` state
- The `useEffect` that calls `highlightAnnotatedFiles` (lines 223-262)
- The deep-clone logic
- The skeleton-while-highlighting loading gate (line 288)

**Replace with:**
- Pass `fullFileContents` down to each `DiffFileCard`
- Let each card highlight its own lines via `useDiffHighlight`

```tsx
// Before:
const displayFiles = highlightedFiles.length > 0 ? highlightedFiles : files;

// After:
const displayFiles = files; // highlighting happens per-card
```

### `src/components/diff-viewer/diff-file-card.tsx`

**Add props:**
```ts
interface DiffFileCardProps {
  file: AnnotatedFile;
  fileIndex: number;
  allExpanded: boolean;
  fullFileContents?: Record<string, string[]>;
}
```

**Use `useDiffHighlight` for the file's lines:**
```ts
const oldContent = file.file.oldPath
  ? fullFileContents?.[file.file.oldPath]?.join("\n")
  : undefined;
const newContent = file.file.newPath
  ? fullFileContents?.[file.file.newPath]?.join("\n")
  : undefined;

const highlightedLines = useDiffHighlight(
  file.lines,
  file.file.newPath ?? file.file.oldPath ?? "",
  oldContent,
  newContent,
);
```

Then render `highlightedLines` instead of `file.lines`.

**Benefits of this migration:**
- Files render immediately with plain text, then upgrade to highlighted (no global skeleton)
- Each file highlights independently — fast files appear highlighted first
- Virtualized files (>1000 lines) only highlight when expanded
- Simpler state management in DiffViewer

### Files changed:
| File | Change |
|------|--------|
| `src/components/diff-viewer/diff-viewer.tsx` | Remove highlighting state/effect, pass fullFileContents to cards |
| `src/components/diff-viewer/diff-file-card.tsx` | Accept fullFileContents, call useDiffHighlight |

## Phase 3: Pipe full file content through the Changes pane

The Changes pane currently passes raw diff strings to `InlineDiffBlock`. To get correct highlighting, we need to provide full file content.

### Approach

Check what `use-changes-data.ts` already fetches. The changes data hook fetches diffs from the Rust backend — we need to also fetch (or derive) the full file contents for old and new sides.

**Option A — Fetch file content at the data layer:**
Add a Tauri command call in `use-changes-data.ts` to read file contents for each changed file. Cache in the hook's state. Pass down as a `Record<string, string>`.

**Option B — Reconstruct from diff + worktree:**
For the new side, read the file from the worktree. For the old side, use `git show <merge-base>:<path>`. Both are already available via Tauri commands.

**Option C — Accept imperfect highlighting:**
If fetching file contents for 300 files is too expensive, skip this phase. The pseudo-file fallback is already better than no highlighting, and the bug only manifests when hunks break mid-scope. This is a pragmatic choice.

### Changes (assuming Option A or B):

**`src/components/changes/use-changes-data.ts`**
- Fetch full file contents alongside diffs
- Return `fullFileContents: Record<string, { old: string; new: string }>`

**`src/components/changes/changes-diff-content.tsx`**
- Accept and forward file content to InlineDiffBlock:
  ```tsx
  <InlineDiffBlock
    filePath={filePath}
    diff={rawDiff}
    oldContent={fileContents[filePath]?.old}
    newContent={fileContents[filePath]?.new}
  />
  ```

Highlighting is naturally lazy — Virtuoso only mounts visible cards, so `useDiffHighlight` only fires for visible files. The LRU cache handles re-scrolling.

### Files changed:
| File | Change |
|------|--------|
| `src/components/changes/use-changes-data.ts` | Fetch full file contents |
| `src/components/changes/changes-diff-content.tsx` | Forward content to InlineDiffBlock |

## Phase 4: Delete dead code

Once DiffViewer and the Changes pane both use `useDiffHighlight`, the old pipeline is dead code.

### Delete:
| File | Action |
|------|--------|
| `src/lib/highlight-diff.ts` | **Delete entirely** (~138 lines) |
| `src/lib/highlight-annotated-files.ts` | **Delete entirely** (~65 lines) |

### Verify no remaining imports:
```
grep -r "highlight-diff\|highlight-annotated-files\|highlightDiff\|highlightAnnotatedFiles" src/
```

### Optionally bump LRU cache:
In `src/lib/syntax-highlighter.ts`, consider `MAX_CACHE_SIZE = 200` if the Changes pane regularly shows many files. Each entry is ~40KB, so 200 entries ≈ 8MB — fine for a desktop app.

## Architecture: Before and After

```
BEFORE (two pipelines):

  DiffViewer ──→ highlightAnnotatedFiles() ──→ highlightDiff() ──→ highlightCode()
                 (imperative, batch, blocks render)

  InlineDiffBlock ──→ useDiffHighlight() ──→ buildPseudoFiles() ──→ highlightCode()
                      (hook, per-file, broken across hunks)

AFTER (one pipeline):

  DiffViewer
    └─ DiffFileCard ──┐
                      ├──→ useDiffHighlight(lines, path, oldContent?, newContent?)
  InlineDiffBlock ────┘       ├─ has full content? → highlight full file, map by line number ✓
                              └─ no full content?  → pseudo-file fallback (best-effort)
```

## Notes

- No new dependencies
- Thread-inline consumers (ToolUseBlock, PermissionRequestBlock, etc.) will continue using pseudo-file fallback — they never have full file content and their diffs are typically single-hunk
- The LRU cache keyed by `${language}:${code}` means full-file highlights cache well across remounts
- DiffViewer gets a UX improvement: files render immediately instead of waiting behind a skeleton for all highlighting to complete
