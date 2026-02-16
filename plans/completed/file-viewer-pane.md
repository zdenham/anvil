# File Viewer Pane

## Problem

Files referenced in thread messages and plan markdown are not clickable. When an agent mentions a file path like `src/lib/utils.ts` or a markdown link like `[utils.ts](src/lib/utils.ts)`, users have no way to open that file inline. They must manually find and open it externally.

We want:
1. File paths in markdown (threads + plans) to be clickable links that open in the content pane
2. Files rendered fresh from disk with syntax highlighting for code files
3. Paths resolved relative to the worktree

## Phases

- [x] Add `file` view type to ContentPaneView and wire up navigation
- [x] Create FileContent component with syntax-highlighted rendering
- [x] Add FileHeader to ContentPaneHeader
- [x] Make markdown links open files in the content pane

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Phase 1: Add `file` view type and wire up navigation

### 1a. Extend ContentPaneView

**File: `src/components/content-pane/types.ts`**

Add a new variant to the discriminated union:

```typescript
| { type: "file"; filePath: string; repoId?: string; worktreeId?: string }
```

- `filePath` — absolute path to the file on disk
- `repoId` / `worktreeId` — optional, for breadcrumb context (repo name, worktree name)

No new props interface needed — the `FileContent` component will just take `filePath` and the optional context fields.

### 1b. Add `navigateToFile` to navigationService

**File: `src/stores/navigation-service.ts`**

Add a method that clears tree selection (files aren't tree items) and sets the pane view:

```typescript
async navigateToFile(filePath: string, context?: { repoId?: string; worktreeId?: string }): Promise<void> {
  await treeMenuService.setSelectedItem(null);
  await contentPanesService.setActivePaneView({
    type: "file",
    filePath,
    ...context,
  });
}
```

### 1c. Route in ContentPane

**File: `src/components/content-pane/content-pane.tsx`**

Add the rendering case:

```typescript
{view.type === "file" && (
  <FileContent filePath={view.filePath} repoId={view.repoId} worktreeId={view.worktreeId} />
)}
```

---

## Phase 2: Create FileContent component

**New file: `src/components/content-pane/file-content.tsx`**

A self-contained file viewer that:
1. Reads file from disk via `FilesystemClient.readFile(filePath)`
2. Detects language via `getLanguageFromPath(filePath)` from `src/lib/language-detection.ts`
3. Highlights with `useCodeHighlight(content, language)` from `src/hooks/use-code-highlight.ts`
4. Renders highlighted tokens with line numbers

### Existing syntax highlighting infrastructure to reuse

The codebase already has a complete Shiki-based syntax highlighting pipeline. **Do not create any new highlighting logic** — wire together these existing modules:

| Module | Path | What it provides |
|--------|------|------------------|
| **Highlighter singleton** | `src/lib/syntax-highlighter.ts` | `highlightCode()`, `getCachedTokens()`, token cache (100-item LRU), lazy init with `initHighlighter()`. Theme: `github-dark`. Pre-loads 12 common languages. |
| **useCodeHighlight hook** | `src/hooks/use-code-highlight.ts` | `useCodeHighlight(code, language)` → `{ tokens: ThemedToken[][] | null, isLoading }`. 100ms debounce, sync cache lookup on mount, cancellation on unmount. |
| **Language detection** | `src/lib/language-detection.ts` | `getLanguageFromPath(filePath)` → Shiki language string. 80+ extensions + special filenames (Dockerfile, Makefile, .env, etc.). Falls back to `"plaintext"`. |
| **Token rendering** | `src/components/thread/code-block.tsx` | `HighlightedCode` component (memo'd) — maps `ThemedToken[][]` to `<div>` per line, `<span style={{ color }}>` per token. |
| **Line-numbered rendering** | `src/components/diff-viewer/highlighted-line.tsx` | `HighlightedLine` — renders a single token line with line number gutter columns. Uses `LINE_NUMBER_STYLES = "text-zinc-500 select-none w-12 text-right pr-2 font-mono text-xs"`. |
| **ThemedToken type** | `src/lib/syntax-highlighter.ts` | Re-exported from Shiki: `{ content: string; color?: string; offset: number }`. Tokens are `ThemedToken[][]` (array of lines, each an array of tokens). |

### Design decisions

- **Read fresh on every mount** — no caching. The file view should always show the current state on disk. Use a simple `useEffect` + `useState` pattern to load content.
- **Don't reuse `CodeBlock` directly** — `CodeBlock` (`src/components/thread/code-block.tsx`) is designed for embedded code blocks: it collapses after 20 lines (`LINE_COLLAPSE_THRESHOLD`), has a copy button header bar, and streaming concerns. A file viewer needs the full file without collapse, with a line number gutter and full-pane scrolling. Instead:
  - Use `useCodeHighlight` hook directly for async highlighting with debounce + caching
  - Use `getLanguageFromPath` for language detection
  - Render tokens following the same `<span style={{ color: token.color }}>` pattern used by `HighlightedCode` in `code-block.tsx`
  - For the line number gutter, follow the styling from `HighlightedLine` in `highlighted-line.tsx` (`text-zinc-500 select-none w-12 text-right pr-2 font-mono text-xs`)
- **For markdown files** — render as formatted markdown using `MarkdownRenderer`, not as highlighted source. Add a toggle to switch between "rendered" and "source" view.
- **Line numbers** — show them in a gutter column, styled to match `highlighted-line.tsx`.
- **Large files** — for files over ~5000 lines, consider virtualization. But start simple (render all lines) and optimize only if needed.
- **Error handling** — show a clear message if the file doesn't exist or can't be read (e.g., binary file, permission denied).
- **Binary files** — detect via null bytes or file extension and show "Binary file — cannot display" message.

### Component structure

```
FileContent
├── useEffect → FilesystemClient.readFile(filePath)
├── getLanguageFromPath(filePath)          ← from src/lib/language-detection.ts
├── useCodeHighlight(content, language)    ← from src/hooks/use-code-highlight.ts
├── if markdown && renderedMode → <MarkdownRenderer content={content} />
├── else → line-by-line token rendering with line number gutter
│   └── tokens.map((line, i) => <div> <lineNumber/> <tokens via span style={{color}}/> </div>)
│       (same pattern as HighlightedCode in code-block.tsx + gutter from highlighted-line.tsx)
└── error/loading states (fallback: <pre> with unstyled text, same as CodeBlock)
```

---

## Phase 3: Add FileHeader to ContentPaneHeader

**File: `src/components/content-pane/content-pane-header.tsx`**

Add a `FileHeader` sub-component following the pattern of `PlanHeader`:

```typescript
function FileHeader({ filePath, repoId, worktreeId, onClose }: { ... }) {
  const { repoName, worktreeName } = useBreadcrumbContext(repoId, worktreeId);
  const fileName = filePath.split("/").pop() ?? "file";

  return (
    <div className="...">
      <Breadcrumb
        repoName={repoName}
        worktreeName={worktreeName}
        category="files"
        itemLabel={fileName}
        onCategoryClick={onClose}
      />
      {/* close button */}
    </div>
  );
}
```

Wire it up in `ContentPaneHeader`:

```typescript
if (view.type === "file") {
  return <FileHeader filePath={view.filePath} repoId={view.repoId} worktreeId={view.worktreeId} onClose={onClose} />;
}
```

---

## Phase 4: Make markdown links open files in the content pane

**File: `src/components/thread/markdown-renderer.tsx`**

This is the key UX change. Currently, non-external links are rendered as plain `<a>` tags with no click handler. We need to intercept links that look like file paths and navigate to the file viewer.

### Link detection strategy

A link is treated as a file path if:
1. It does NOT start with `http://` or `https://` (already handled — these open in browser)
2. It does NOT start with `#` (anchor links)
3. It looks like a relative or absolute file path:
   - Starts with `./`, `../`, or doesn't start with a protocol
   - Has a file extension (`.ts`, `.md`, `.json`, etc.)

Examples that should open as files:
- `[utils.ts](./src/lib/utils.ts)`
- `[config](src/config.json)`
- `[readme](../docs/readme.md)`

### Resolution strategy

The `MarkdownRenderer` doesn't currently know about the working directory. We need to pass it down:

1. Add an optional `workingDirectory` prop to `MarkdownRenderer`
2. Thread views pass the thread's resolved worktree path
3. Plan views pass the plan's resolved worktree path (already computed in `PlanContent`)
4. When a file link is clicked:
   - If path is absolute → use as-is
   - If path is relative → resolve against `workingDirectory`
   - Call `navigationService.navigateToFile(absolutePath, { repoId, worktreeId })`

### Changes to MarkdownRenderer

Add `workingDirectory` and optional `onFileClick` callback props:

```typescript
interface MarkdownRendererProps {
  content: string;
  isStreaming?: boolean;
  className?: string;
  workingDirectory?: string;   // for resolving relative file paths
  onFileClick?: (absolutePath: string) => void;  // callback when a file link is clicked
}
```

Update the `a` component override:

```typescript
a: ({ href, children, ...props }) => {
  // External links → open in browser (existing behavior)
  if (isExternal(href)) { ... }

  // File-like links → open in content pane
  if (href && workingDirectory && looksLikeFilePath(href)) {
    const handleFileClick = (e: React.MouseEvent) => {
      e.preventDefault();
      const absolutePath = isAbsolute(href) ? href : join(workingDirectory, href);
      onFileClick?.(absolutePath) ?? navigationService.navigateToFile(absolutePath);
    };
    return (
      <a href={href} onClick={handleFileClick} className="text-zinc-200 hover:text-white underline cursor-pointer">
        {children}
      </a>
    );
  }

  // Everything else → render normally
  return <a href={href} {...props}>{children}</a>;
}
```

### Passing working directory through

**`src/components/content-pane/plan-content.tsx`** — already has `workingDirectory` state. Pass it to `MarkdownRenderer` as a prop (already done).

**`src/components/content-pane/thread-content.tsx`** — passes `workingDirectory` as a prop through the component chain: `ThreadView` → `MessageList` → `TurnRenderer` → `AssistantMessage` → `TextBlock` → `MarkdownRenderer`. This follows the same pattern as `isStreaming` and `toolStates` which already flow through the same path. No React context needed.

---

## Files summary

| File | Action | Description |
|------|--------|-------------|
| `src/components/content-pane/types.ts` | Modify | Add `file` variant to `ContentPaneView` |
| `src/stores/navigation-service.ts` | Modify | Add `navigateToFile()` method |
| `src/components/content-pane/content-pane.tsx` | Modify | Add `file` view routing |
| `src/components/content-pane/file-content.tsx` | **New** | File viewer component with syntax highlighting |
| `src/components/content-pane/content-pane-header.tsx` | Modify | Add `FileHeader` sub-component |
| `src/components/thread/markdown-renderer.tsx` | Modify | Intercept file links, add `workingDirectory` prop |
| `src/components/content-pane/plan-content.tsx` | Modify | Pass `workingDirectory` to `MarkdownRenderer` |
| `src/components/content-pane/thread-content.tsx` | Modify | Resolve and pass `workingDirectory` to `MarkdownRenderer` |

## Success criteria

- Clicking a relative file path link in a plan or thread message opens the file in the content pane
- Code files are syntax-highlighted using Shiki (same theme as code blocks)
- Markdown files render as formatted markdown by default with a source toggle
- File content is always read fresh from disk (no stale cache)
- Breadcrumb shows repo > worktree > files > filename
- Non-existent files show a clear error state
- External links continue to open in the system browser
