# TipTap Parity with MarkdownRenderer

Bring the TipTap editor's visual output to parity with the `MarkdownRenderer` used in threads: syntax highlighting, inline code coloring, code block chrome, and remove the Source/Rendered toggle for markdown files.

## Context

The `MarkdownRenderer` (react-markdown + Shiki) in thread messages looks great:
- **Code blocks**: Shiki syntax highlighting (github-dark theme), header bar with language label + copy button, collapsible for long blocks
- **Inline code**: amber-400 text on zinc-800/50 background
- **Headings**: Atkinson Hyperlegible Mono font, proper sizing hierarchy
- **Tables, links, HR**: all nicely styled

The TipTap editor shares the same `prose prose-invert prose-sm` base classes but is missing:
1. **No syntax highlighting** in code blocks — just monochrome text
2. **No code block header** (no language label, no copy button)
3. **No inline code coloring** (missing the amber-400 treatment)
4. **Unnecessary Source/Rendered toggle** — since TipTap is already editable WYSIWYG, the toggle adds friction without value

## Design Decisions

- **Use Shiki for TipTap code highlighting** — we already have the Shiki highlighter (`src/lib/syntax-highlighter.ts`) with github-dark theme loaded. Rather than adding lowlight/highlight.js as a second highlighting engine, we'll create a custom TipTap NodeView for code blocks that uses the existing Shiki infrastructure. This guarantees exact color parity.
- **Custom CodeBlock NodeView** — TipTap's built-in `CodeBlock` node is a plain `<pre><code>`. We'll replace it with a custom NodeView that:
  - Renders highlighted tokens from Shiki (same `HighlightedCode` approach as the thread `CodeBlock`)
  - Shows a header bar with language label
  - Includes a copy button
  - Keeps the code editable (TipTap handles the editing; we just decorate the output)
- **Remove toggle entirely for markdown** — TipTap IS the editor for markdown files. No "Rendered"/"Source" toggle. If users need raw markdown, they still have CM6 for non-markdown text files. For markdown, TipTap is the single editing surface.
- **Inline code styling** — add `text-amber-400 bg-zinc-800/50 px-1 py-0.5 rounded` to `.tiptap-editor code` (matching `InlineCode` component styling)

## Phases

- [x] Remove Source/Rendered toggle for markdown files
- [x] Add Shiki syntax highlighting to TipTap code blocks via custom NodeView
- [x] Style inline code to match MarkdownRenderer (amber-400)
- [x] Verify visual parity across common markdown elements

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Phase 1: Remove Source/Rendered Toggle

**File: `src/components/content-pane/file-content.tsx`**

Remove the `ViewModeToggle` for markdown files. The markdown path should always render `TiptapEditor` — no rendered/source branching needed.

Changes:
- Remove the `viewMode` state and `ViewModeToggle` rendering for the `isMarkdown` code path
- Remove the `FileContentHeader` wrapper that currently holds the toggle for markdown
- The TipTap editor becomes the sole rendering mode for `.md`/`.mdx` files
- Keep `ViewModeToggle` for SVG files (they still need rendered/source)

The CM6 source editor path (`isMarkdown && viewMode === "source"`) is removed — markdown files always use TipTap.

## Phase 2: Shiki Syntax Highlighting in TipTap Code Blocks

This is the biggest change. Create a custom TipTap `CodeBlock` extension with a NodeView that uses Shiki.

**New file: `src/components/content-pane/tiptap-code-block.tsx`** (~150 lines)

A custom TipTap NodeView that:
1. Reads the code text content and language attribute from the TipTap node
2. Calls `useCodeHighlight(code, language)` (existing hook) to get Shiki tokens
3. Renders a header bar with language label + copy button (matching thread `CodeBlock` chrome)
4. Renders highlighted tokens as colored `<span>` elements overlaying the editable content
5. Falls back to plain monochrome text while Shiki is loading

Implementation approach:
- Use `ReactNodeViewRenderer` from `@tiptap/react` to create a React-based NodeView
- The NodeView wraps the code editing area with the Shiki decoration layer
- Language detection from fenced code block info string (TipTap stores this as a `language` attribute on the `codeBlock` node)

**Modify: `src/components/content-pane/tiptap-editor.tsx`**
- Replace `StarterKit`'s built-in `codeBlock` with the custom extension
- Import and register the new Shiki-powered code block extension

Key challenge: TipTap's ProseMirror needs to remain the editing surface. The approach is:
- Use TipTap's `CodeBlockLowlight`-style architecture but swap lowlight for Shiki
- Or use a decoration-based approach where Shiki tokens are applied as ProseMirror decorations over the plain text
- The simpler approach: use `NodeViewContent` for the editable text area, and a separate decoration layer that mirrors the content with syntax colors. This is how `@tiptap/extension-code-block-lowlight` works internally.

Recommended: extend from `@tiptap/extension-code-block` (included in StarterKit) and add a plugin that applies Shiki-based decorations. This keeps editing native and just colors the text.

## Phase 3: Inline Code Styling

**File: `src/index.css`**

Add inline code styles to the TipTap editor section:

```css
.tiptap-editor code:not(.tiptap-code-block code) {
  @apply text-amber-400 bg-zinc-800/50 px-1 py-0.5 rounded;
}
```

This matches the `InlineCode` component used in `MarkdownRenderer` threads. The `:not()` selector ensures we don't accidentally style code inside code blocks.

## Phase 4: Visual Parity Check

Test with a markdown file containing:
- Headings (h1-h4) — should use Atkinson Hyperlegible Mono (already works via prose config)
- Fenced code blocks with language (```typescript, ```python, etc.) — should have Shiki highlighting
- Inline code — should be amber-400 on dark background
- Tables — should match thread table styling (already close)
- Task lists — should have styled checkboxes (already works)
- Blockquotes — should have left border styling (already works via prose)
- Links — should be zinc-200 underline (already works)

No new CSS needed here — just verification and minor tweaks if anything is off.
