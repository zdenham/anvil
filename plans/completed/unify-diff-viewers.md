# Unify Diff Viewers

## Problem

We have two diff viewing paths:
1. **Inline** (`InlineDiffBlock`) — used in the thread for Edit/Write tool results. No full-file syntax highlighting.
2. **Standalone** (`DiffViewer` + `DiffFileCard`) — used in the Changes tab. Full-file syntax highlighting via `fullFileContents`.

Both already share `AnnotatedLineRow`, `useDiffHighlight`, `useCollapsedRegions`, and `parseDiff()`. The only real difference is that inline never receives full file contents, so syntax highlighting falls back to per-hunk mode (breaks on multi-line constructs like template literals, block comments).

## Goal

- Give the inline diff viewer full-file syntax highlighting by reading file contents from disk
- Converge on a single diff component used everywhere
- Reduce maintenance surface area

## Phases

- [ ] Phase 1: Add `useFileContent` hook for lazy file reading
- [ ] Phase 2: Wire full-file content into inline diff blocks (Edit + Write)
- [ ] Phase 3: Migrate standalone `DiffFileCard` to use `InlineDiffBlock`
- [ ] Phase 4: Clean up dead code from standalone path

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Phase 1: Add `useFileContent` hook

Create a hook that lazily reads a file from disk and caches the result.

**File:** `src/hooks/use-file-content.ts`

```typescript
// Reads a single file from disk via fs_read_file Tauri command
// Returns { content: string | null, isLoading: boolean }
// Caches by filePath so multiple tool blocks reading the same file don't duplicate reads
```

- Use the existing `fsCommands.readFile(path)` from `src/lib/tauri-commands.ts`
- Accept `workingDirectory` to resolve relative paths
- Module-level cache (Map) so re-renders and sibling tool blocks share results
- Return null for files that don't exist (new file writes)

**Note:** The existing `useFileContents` (plural) hook in `src/hooks/use-file-contents.ts` reads all files for a diff at once. Our new hook reads one file on-demand — simpler and avoids loading files we don't need.

## Phase 2: Wire full-file content into tool blocks

### EditToolBlock changes

For the Edit tool, we have `file_path`, `old_string`, `new_string` in the input.

1. Use `useFileContent(file_path)` to read the current file from disk → this is `newContent`
2. Reconstruct `oldContent` by replacing `new_string` → `old_string` in `newContent` (reverse the edit)
   - For `replace_all`: replace all occurrences
   - For single replace: replace first occurrence
3. Pass `oldContent` and `newContent` to `InlineDiffBlock`
4. Replace the current non-permission render path (raw `<pre>` red/green blocks) with `InlineDiffBlock` + full-file content

**Current non-permission path** renders raw old_string/new_string as styled `<pre>` blocks — no diff computation, no line numbers, no syntax highlighting. This should become `InlineDiffBlock` with proper diff + highlighting.

### WriteToolBlock changes

For the Write tool, we have `file_path` and `content` in the input.

1. `newContent` = `input.content` (we already have the full new file)
2. Use `useFileContent(file_path)` to read the current file from disk → this is `oldContent`
   - If file doesn't exist yet, `oldContent` = null (shows as all-additions)
3. Pass `oldContent` and `newContent` to `InlineDiffBlock`

### Shared: Build proper annotated lines from full file

Currently `useToolDiff` generates `AnnotatedLine[]` from just the snippet (`old_string`/`new_string`). With full file content available, we should use `buildAnnotatedFiles()` (from `src/lib/annotated-file-builder.ts`) to produce full-file annotated lines — same as the standalone viewer does.

This means:
1. Generate a unified diff from old/new content (use existing diff utilities)
2. Parse it with `parseDiff()`
3. Build annotated lines with `buildAnnotatedFiles(parsedDiff, fullFileContents)`
4. Pass the resulting `lines` + `oldContent`/`newContent` to `InlineDiffBlock`

## Phase 3: Migrate standalone DiffFileCard to InlineDiffBlock

Once `InlineDiffBlock` has full-file syntax highlighting and proper annotated lines, `DiffFileCard` is doing the same thing. Replace it:

1. In `DiffViewer` / `ChangesTab`, render `InlineDiffBlock` instead of `DiffFileCard`
2. Pass the same `oldContent`, `newContent`, and annotated `lines` that `DiffFileCard` currently computes
3. Verify feature parity:
   - Collapsed regions ✓ (shared)
   - Line numbers ✓ (shared via `AnnotatedLineRow`)
   - Expand/collapse header ✓ (`InlineDiffHeader`)
   - Syntax highlighting ✓ (now both use full-file path)

**Key differences to reconcile:**
- `DiffFileCard` has virtualization (`VirtualizedFileContent` using `react-window`). Large files need this. Either add virtualization to `InlineDiffBlock` or keep virtualized rendering as an option.
- `DiffFileCard` shows file-level metadata (rename info, mode changes). Ensure `InlineDiffHeader` can display this.

## Phase 4: Clean up

- Remove `DiffFileCard` if fully replaced
- Remove `VirtualizedFileContent` if inlined into the unified component (or keep if shared)
- Remove `HighlightedLine` (appears unused, superseded by `AnnotatedLineRow`)
- Audit `useFileContents` (plural) — if no longer needed, remove
- Remove the raw `<pre>` red/green rendering from `EditToolBlock`

## Risks & Open Questions

1. **File staleness**: Reading from disk gives the *current* file, not the file at the time the edit was made. For edits earlier in a conversation, the file may have changed since. This is the same limitation the standalone viewer has (it reads current disk state). Acceptable for now; could use git to reconstruct historical state later.

2. **Performance**: Reading files on-demand for each tool block could cause layout shifts if highlighting is async. The existing `useDiffHighlight` already handles async highlighting gracefully (shows unhighlighted first, then highlighted). Should be fine.

3. **Virtualization**: Large files (1000+ lines) may need virtualized rendering. `InlineDiffBlock` currently renders all lines. Phase 3 should evaluate whether virtualization is needed and add it if so.

4. **Reverse-edit accuracy**: Reconstructing `oldContent` by replacing `new_string` → `old_string` in the current file assumes the edit was applied cleanly and no subsequent edits changed the same region. For the current file on disk this should hold; for historical edits it might not. Same staleness caveat as #1.
