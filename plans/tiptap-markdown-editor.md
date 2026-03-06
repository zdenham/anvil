# Tiptap WYSIWYG Markdown Editor

Replace the read-only `MarkdownRenderer` (react-markdown) with an editable Tiptap WYSIWYG editor for the "rendered" view of markdown files.

## Context

Currently, markdown files in the content pane have a rendered/source toggle:
- **Rendered**: read-only `MarkdownRenderer` (react-markdown + remark-gfm)
- **Source**: read-only Shiki-highlighted code (will become CM6 editor per `plans/cm6-file-editor.md`)

This plan makes the rendered mode **editable** via Tiptap, so both modes support editing. Content is always stored/saved as markdown text.

**Dependency on CM6 plan**: This plan builds on the save/dirty-state infrastructure from the CM6 plan (Phase 4). Can be implemented independently but shares the same `onSave`/`onChange` contract.

## Current State

- `src/components/content-pane/file-content.tsx` — owns the rendered/source toggle for markdown
- `src/components/thread/markdown-renderer.tsx` — read-only react-markdown wrapper (used in threads, plans, PR descriptions, file preview)
- `MarkdownRenderer` stays untouched for thread/plan rendering — Tiptap is only for the file editor context
- `FilesystemClient.writeFile()` exists for saving

## Design Decisions

- **Tiptap only in file-content rendered mode** — thread code blocks, plan views, etc. keep using `MarkdownRenderer` (react-markdown). Tiptap is heavier and only needed where editing is required.
- **Markdown as source of truth** — load markdown string → parse into Tiptap doc → edit → serialize back to markdown on save. The file on disk is always `.md`.
- **Use `tiptap-markdown` extension** — community package that handles markdown ↔ Tiptap serialization (better maintained than the first-party one).
- **Minimal extension set** — only include what standard markdown and GFM need. No slash commands, no drag-and-drop blocks (keep it simple).
- **Headless styling** — Tiptap is unstyled by default. We apply our own styles matching the existing `prose prose-invert` look from `MarkdownRenderer`.
- **Same `onSave`/`onChange` contract** as CM6 — dirty state and Cmd+S handled at the `file-content.tsx` level, not inside the editor component.

## Phases

- [ ] Install Tiptap dependencies and create `TiptapEditor` component
- [ ] Wire markdown serialization (load from string, serialize on change)
- [ ] Integrate into `file-content.tsx` rendered mode for markdown files
- [ ] Add a minimal floating toolbar for formatting
- [ ] Style the editor to match the app's prose theme
- [ ] Test roundtrip fidelity (markdown → Tiptap → markdown)

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Phase 1: Install Tiptap + Create Editor Component

**New dependencies:**
```
@tiptap/react
@tiptap/starter-kit          (includes: Document, Paragraph, Text, Bold, Italic,
                               Strike, Code, Heading, BulletList, OrderedList,
                               ListItem, Blockquote, HorizontalRule, HardBreak,
                               CodeBlock, History)
@tiptap/extension-link
@tiptap/extension-task-list
@tiptap/extension-task-item
@tiptap/extension-table
@tiptap/extension-table-row
@tiptap/extension-table-header
@tiptap/extension-table-cell
@tiptap/extension-image
@tiptap/extension-placeholder
tiptap-markdown               (community: markdown ↔ Tiptap serialization)
```

**New file: `src/components/content-pane/tiptap-editor.tsx`** (~120 lines)

```tsx
interface TiptapEditorProps {
  initialContent: string;    // markdown string
  onChange?: (markdown: string) => void;
  onSave?: (markdown: string) => void;
  readOnly?: boolean;
}
```

Responsibilities:
- Initialize `useEditor()` with StarterKit + extensions + Markdown extension
- Set initial content via `editor.commands.setContent()` with markdown parsing
- Emit `onChange` with serialized markdown on doc updates (debounced ~300ms)
- Bind Cmd+S to `onSave` via Tiptap keyboard shortcut extension
- Clean up on unmount

## Phase 2: Markdown Serialization

Configure `tiptap-markdown` for roundtrip fidelity:

```ts
import { Markdown } from "tiptap-markdown";

Markdown.configure({
  html: false,                // don't output raw HTML
  tightLists: true,           // no blank lines between list items
  bulletListMarker: "-",      // match common convention
  linkify: true,              // auto-detect URLs
  breaks: false,              // soft breaks → spaces (standard markdown)
  transformPastedText: true,  // parse pasted markdown
  transformCopiedText: true,  // copy as markdown
})
```

Key behaviors:
- **Load**: `editor.commands.setContent(markdownString)` — tiptap-markdown intercepts and parses
- **Save**: `editor.storage.markdown.getMarkdown()` — serializes doc back to markdown
- **Paste**: pasting markdown text is parsed into rich content automatically

Known limitations (acceptable):
- Complex raw HTML blocks won't roundtrip (we set `html: false`)
- Nested blockquotes may lose depth beyond 2 levels
- These are edge cases for typical markdown files

## Phase 3: Integration into `file-content.tsx`

In the markdown rendered-mode branch of `file-content.tsx`, replace `MarkdownRenderer` with `TiptapEditor`:

```tsx
// Before (read-only)
<MarkdownRenderer content={content} />

// After (editable WYSIWYG)
<TiptapEditor
  initialContent={content}
  onChange={handleChange}
  onSave={handleSave}
/>
```

- `MarkdownRenderer` import stays for other consumers (threads, plans, etc.)
- Same `handleSave`/`handleChange` callbacks used by CM6 in source mode
- Switching between rendered↔source syncs content:
  - Source→Rendered: pass current CM6 content as `initialContent` to Tiptap
  - Rendered→Source: serialize Tiptap markdown, update CM6 value

## Phase 4: Floating Toolbar

Minimal floating/bubble toolbar that appears on text selection:

```
[ B | I | S | Code | Link | H1 | H2 | H3 | Quote | List | Task ]
```

Use Tiptap's `BubbleMenu` component:

```tsx
import { BubbleMenu } from "@tiptap/react";

<BubbleMenu editor={editor}>
  <ToolbarButton active={editor.isActive("bold")} onClick={() => editor.chain().focus().toggleBold().run()}>
    B
  </ToolbarButton>
  {/* ... */}
</BubbleMenu>
```

Style to match app palette (dark background, surface-700 borders, small icons via lucide).

Keep it minimal — no block insertion menus, no slash commands. Just formatting on selection.

## Phase 5: Styling

Apply styles to the Tiptap `.ProseMirror` container to match the existing `prose prose-invert prose-sm` look:

```css
.tiptap-editor .ProseMirror {
  /* Match MarkdownRenderer's prose styling */
  @apply prose prose-invert prose-sm prose-p:leading-relaxed max-w-none;

  /* Editor-specific */
  outline: none;
  min-height: 100%;
  padding: 1rem;
}

/* Cursor and selection */
.tiptap-editor .ProseMirror .is-editor-empty:first-child::before {
  content: attr(data-placeholder);
  @apply text-surface-500 float-left h-0 pointer-events-none;
}
```

Additional styling:
- Code blocks: match the existing `CodeBlock` component look (dark bg, rounded corners)
- Tables: match the existing `MarkdownRenderer` table styling
- Task lists: checkboxes styled to match app theme
- Links: match existing `text-zinc-200 hover:text-white underline` pattern

## Phase 6: Roundtrip Testing

Verify markdown fidelity across:
- **Headings** (h1-h6) — correct `#` prefix count
- **Inline formatting** — bold, italic, strikethrough, inline code
- **Lists** — bullet, ordered, nested, task lists with checkboxes
- **Links** — inline links, auto-detected URLs
- **Images** — `![alt](src)` syntax preserved
- **Code blocks** — fenced with language identifier preserved
- **Tables** — GFM pipe tables
- **Blockquotes** — single and nested
- **Horizontal rules** — `---`
- **Hard breaks** — preserved correctly

Test by: load a markdown file → make no edits → serialize → diff against original. Differences should be minimal (whitespace normalization is acceptable).
