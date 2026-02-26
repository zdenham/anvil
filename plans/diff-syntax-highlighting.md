# Diff Syntax Highlighting

Add syntax highlighting to changes-view diffs and thread inline diffs. Both use `InlineDiffBlock` → `AnnotatedLineRow`, which already renders `tokens` when present on `AnnotatedLine`. The only missing piece is populating those tokens.

## Phases

- [x] Create `useDiffHighlight` hook that highlights AnnotatedLine arrays
- [x] Wire hook into InlineDiffBlock
- [x] Test and polish

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Research Findings

### What already works
- **DiffViewer** (thread full-diff view) gets `fullFileContents` prop, calls `highlightAnnotatedFiles()` which calls `highlightDiff()`, which highlights the **entire old and new files** via Shiki, then maps tokens to diff lines by line number. This produces perfect results because Shiki sees the full AST.
- **AnnotatedLineRow** already renders `line.tokens` when present — colored `<span>` per token. When tokens are absent, it falls back to diff-colored plain text. No changes needed here.
- **AnnotatedLine** type (in `src/components/diff-viewer/types.ts:77`) already has `tokens?: ThemedToken[]`.
- **Shiki singleton** (`src/lib/syntax-highlighter.ts`) is already initialized with `github-dark` theme and 12 preloaded languages. Has an LRU cache (100 entries) and `highlightCode(code, language)` that returns `ThemedToken[][]`.
- **Language detection** (`src/lib/language-detection.ts`) maps file extensions → Shiki language IDs with 85+ mappings.

### What's missing
`InlineDiffBlock` and `ChangesDiffContent` only have the raw unified diff string — they don't have `fullFileContents`. Without the full file, we can't use the existing `highlightDiff()` pipeline that maps line numbers to fully-highlighted file tokens.

### Chosen approach: Concatenate diff lines into a pseudo-file

**Why not line-by-line?** Shiki uses TextMate grammars that are stateful — a closing `}` or a multi-line string/comment won't highlight correctly without preceding context. Highlighting each line independently gives poor results for anything beyond simple keywords.

**Why not fetch full files?** That would require:
- New async file reads from git (`git show HEAD:path` for old, filesystem read for new)
- Different handling for uncommitted vs committed vs single-commit diffs
- Significant data overhead for large files when we only display a few diff lines

**Best approach: Concatenate all hunk lines per side into a pseudo-file, highlight that, then map tokens back.** This preserves grammar state across all visible lines in each hunk. The only case it won't handle perfectly is when a hunk starts mid-construct (e.g., inside a multi-line template literal) — but that's rare and the context lines usually provide enough preamble. This is what VS Code's inline diff does too.

**Shiki's `grammarState` API** (added in v1.10.0, [docs](https://shiki.style/guide/grammar-state)) could theoretically help by pre-seeding state, but we don't have the preceding code to generate it from, so it doesn't help here.

### Data flow

```
InlineDiffBlock receives: filePath + diff string (or pre-computed lines)
                ↓
useDiffHighlight hook:
  1. Detect language from filePath via getLanguageFromPath()
  2. Separate lines into old-side and new-side arrays
  3. Concatenate each side into a pseudo-file string
  4. highlightCode(oldPseudo, language) + highlightCode(newPseudo, language)
  5. Map resulting tokens back to each AnnotatedLine by position
  6. Return new AnnotatedLine[] with tokens populated
                ↓
AnnotatedLineRow renders tokens (already implemented)
```

---

## Phase 1: Create `useDiffHighlight` hook

**New file: `src/hooks/use-diff-highlight.ts`** (~80 lines)

### Interface

```typescript
function useDiffHighlight(
  lines: AnnotatedLine[],
  filePath: string
): AnnotatedLine[]
```

- Input: unhighlighted `AnnotatedLine[]` + file path for language detection
- Output: same array but with `tokens` populated (or original array while loading)
- Async — returns unhighlighted lines immediately, then re-renders with tokens

### Algorithm

1. **Detect language**: `getLanguageFromPath(filePath)` → e.g. `"typescript"`
2. **Skip if plaintext**: If language is `"plaintext"`, return lines unchanged (no point highlighting)
3. **Build pseudo-files**: Iterate lines, maintaining two arrays:
   - `oldLines`: content from lines where `type === "deletion"` or `type === "unchanged"`
   - `newLines`: content from lines where `type === "addition"` or `type === "unchanged"`
   - Track which position in oldLines/newLines each AnnotatedLine maps to
4. **Highlight both**: `await Promise.all([highlightCode(oldText, lang), highlightCode(newText, lang)])`
5. **Map tokens back**: For each AnnotatedLine, look up its position in the appropriate highlighted result and set `line.tokens`
6. **State management**: Use `useState` for highlighted lines, `useEffect` to trigger async highlight. Return unhighlighted lines during loading for instant display (no flash — just colored text swaps to syntax-colored text).
7. **Cancellation**: Track a `cancelled` flag in the effect cleanup to avoid setting stale state.
8. **Cache-aware**: Try `getCachedTokens()` synchronously first for instant hits on remount.

### Handling hunk boundaries

When the diff has multiple hunks (separated by `@@` headers), they may have disjoint line numbers. We concatenate all visible lines in order (context + changed) per side. The pseudo-file won't have perfect multi-line state across hunk boundaries, but each hunk's internal highlighting will be correct since context lines establish the grammar state.

### Example mapping

```
Lines:        [unchanged, unchanged, deletion, deletion, addition, addition, unchanged]
Old indices:  [0,         1,         2,        3,        -,        -,        4        ]
New indices:  [0,         1,         -,        -,        2,        3,        4        ]

oldPseudo = join lines at old indices → highlight → 5 token arrays
newPseudo = join lines at new indices → highlight → 5 token arrays

Then: deletion lines get tokens from oldHighlighted[2], oldHighlighted[3]
      addition lines get tokens from newHighlighted[2], newHighlighted[3]
      unchanged lines get tokens from newHighlighted (prefer new side)
```

---

## Phase 2: Wire hook into InlineDiffBlock

**Edit: `src/components/thread/inline-diff-block.tsx`** (~5 lines changed)

1. Import `useDiffHighlight` hook
2. After the `useMemo` that produces `lines`, add:
   ```typescript
   const highlightedLines = useDiffHighlight(lines, filePath);
   ```
3. Pass `highlightedLines` instead of `lines` to `useCollapsedRegions` and `buildRenderItems`

That's it — `AnnotatedLineRow` already renders tokens when present. No changes needed to `ChangesDiffContent` since it delegates to `InlineDiffBlock`.

### Both use cases covered
- **Thread inline diffs**: `InlineDiffBlock` used directly in `assistant-message.tsx` with `diff` prop
- **Changes view**: `ChangesDiffContent` uses `InlineDiffBlock` with `diff` prop for each file card

---

## Phase 3: Test and polish

- Verify highlighting across common languages (TS, Rust, CSS, JSON, Python, Go, HTML)
- Verify no layout shift — line content area should be the same size before and after token swap
- Verify performance: highlight should not block the initial render; diff appears immediately with colored text, then upgrades to syntax highlighting
- Test with multi-hunk diffs to verify cross-hunk highlighting
- Test with large diffs (100+ lines) — should still be fast since Shiki is fast and we cache
- Test edge cases: binary files (skipped), unknown languages (plaintext fallback), empty diffs
- Verify that `ChangesDiffContent` virtualized list still works correctly (tokens survive mount/unmount since `InlineDiffBlock` re-runs the hook on mount, and cache hits make it instant)
