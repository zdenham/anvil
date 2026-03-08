# CodeMirror 6 File Editor

Replace the read-only Shiki-based file view in `file-content.tsx` with a CodeMirror 6 editor, enabling in-place editing of text files.

## Current State

- `src/components/content-pane/file-content.tsx` renders files read-only with Shiki syntax highlighting
- `src/lib/syntax-highlighter.ts` + `src/hooks/use-code-highlight.ts` provide Shiki tokenization
- `src/lib/language-detection.ts` maps file extensions → Shiki language IDs (reusable for CM6)
- `FilesystemClient.writeFile()` already exists for saving
- Markdown files have a rendered/source toggle — source mode will become the editor
- Shiki is still used elsewhere (thread code blocks) so we keep it; just stop using it for file-content

## Design Decisions

- **Replace `HighlightedFileView` with CM6** — CM6 provides its own syntax highlighting, so Shiki is redundant for this view
- **Single `CodeMirrorEditor` wrapper component** — encapsulates CM6 setup, exposes `value`, `language`, `onChange`, `onSave`
- **Dirty state tracking** — compare editor content against last-saved content, show indicator in header
- **Save via Cmd+S** — CM6 keymap extension calls `FilesystemClient.writeFile()`
- **Theme** — use CM6's `oneDark` or build a minimal custom theme to match the app's dark palette
- **Read-only mode** — support a `readOnly` prop for when we want to disable editing (e.g., future permissions)
- **Keep markdown rendered/source toggle** — rendered mode stays as `MarkdownRenderer`, source mode becomes CM6 editor
- **Language mapping** — create a small adapter from our existing Shiki language IDs to CM6 `LanguageSupport` objects. CM6 languages are loaded as extensions, not all at once — use dynamic `import()` for non-core languages

## Phases

- [x] Install CM6 dependencies and create the `CodeMirrorEditor` component
- [x] Create language-to-CM6 mapping adapter
- [x] Integrate into `file-content.tsx`, replacing `HighlightedFileView`
- [x] Add dirty state tracking and save (Cmd+S) support
- [x] Style/theme the editor to match the app
- [ ] Test manually across file types (TS, markdown, JSON, plain text, large files)

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Phase 1: Install CM6 + Create Editor Component

**New dependencies:**
```
@codemirror/state
@codemirror/view
@codemirror/language
@codemirror/commands
@codemirror/search
@codemirror/autocomplete
@codemirror/lint
@codemirror/lang-javascript
@codemirror/lang-markdown
@codemirror/lang-json
@codemirror/lang-css
@codemirror/lang-html
@codemirror/lang-python
@codemirror/lang-rust
@codemirror/lang-go
codemirror              (convenience meta-package, pulls in basics)
@codemirror/theme-one-dark
```

**New file: `src/components/content-pane/code-mirror-editor.tsx`** (~100-120 lines)

Wrapper component:
```tsx
interface CodeMirrorEditorProps {
  value: string;
  language: string;
  readOnly?: boolean;
  onSave?: (content: string) => void;
  onChange?: (content: string) => void;
  lineNumber?: number;
}
```

Responsibilities:
- Create `EditorState` + `EditorView` on mount, destroy on unmount
- Reconfigure language extension when `language` prop changes (via compartment)
- Reconfigure `readOnly` via compartment
- Call `onChange` on doc changes (debounced)
- Bind Cmd+S to `onSave` callback via custom keymap
- Scroll to `lineNumber` on mount if provided

Uses CM6 compartments for dynamic reconfiguration (language, readOnly) without recreating the editor.

## Phase 2: Language Mapping Adapter

**New file: `src/lib/cm6-languages.ts`** (~80 lines)

Maps our existing Shiki language IDs (from `language-detection.ts`) to CM6 `LanguageSupport` objects:

```ts
export async function getCM6Language(shikiLang: string): Promise<LanguageSupport | null>
```

Core languages (bundled eagerly): `typescript/tsx/javascript/jsx`, `markdown/mdx`, `json`, `css`, `html`, `python`, `rust`, `go`

Other languages: return `null` (CM6 will just show plain text — still editable, just no highlighting). We can add more later on demand.

This keeps the language detection logic centralized in `language-detection.ts` and just adapts the output.

## Phase 3: Integration into `file-content.tsx`

Replace `HighlightedFileView` and `PlainFileView` with `CodeMirrorEditor`:

```tsx
// Before (read-only Shiki)
<HighlightedFileView content={content} language={language} />

// After (editable CM6)
<CodeMirrorEditor
  value={content}
  language={language}
  lineNumber={lineNumber}
  onSave={handleSave}
  onChange={handleChange}
/>
```

- Remove `useCodeHighlight` import from this file (no longer needed here)
- Keep `HighlightedFileView` / `PlainFileView` for now in case other components use them, or delete if unused
- Markdown source mode: same `CodeMirrorEditor` with `language="markdown"`
- SVG source mode in `media-preview.tsx`: pass through `CodeMirrorEditor` via the existing `renderHighlighted` prop (rename to `renderSource` or similar)

## Phase 4: Dirty State + Save

In `file-content.tsx`:

- Track `savedContent` (last known disk content) and `currentContent` (editor state) with `useState`
- `isDirty = savedContent !== currentContent`
- Show dirty indicator: small dot or `[modified]` text in the content pane header/breadcrumb
- `handleSave`: calls `filesystemClient.writeFile(filePath, currentContent)`, updates `savedContent`
- Error handling: toast/inline error if save fails
- Optional: warn on tab switch if dirty (can defer to later)

## Phase 5: Theming

Use `@codemirror/theme-one-dark` as a starting point. If it doesn't match the app well enough, create a minimal custom theme using CM6's `EditorView.theme()`:

- Background: match `surface-900`
- Gutter: match current line number styling (`text-zinc-500`)
- Selection: match app's selection color
- Cursor: match app accent color

## Phase 6: Manual Testing

Verify across:
- TypeScript/TSX files — syntax highlighting, save works
- Markdown — rendered/source toggle, editing in source, save
- JSON — bracket matching, highlighting
- Plain text — no errors, basic editing
- Large files (1000+ lines) — performance acceptable
- Line number scrolling — `lineNumber` prop scrolls correctly
- Dirty state — indicator appears/disappears correctly
- Cmd+S — saves and clears dirty state
