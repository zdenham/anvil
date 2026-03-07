# Fix Streaming Cursor to Render Inline

## Problem

The `StreamingCursor` renders as a `<div>` with `mt-1`, making it a block element that sits on its own line below the text. This causes a visual "jump" when streaming finishes and the cursor disappears — the content area height shrinks by one line.

## Analysis

`streaming-cursor.tsx:13` — wraps the cursor `<span>` in a `<div className="mt-1">`, creating a block element.

Two call sites:
- **`text-block.tsx:29`** — `{isStreaming && <StreamingCursor className="ml-1" />}` — rendered *after* the `MarkdownRenderer` output, so it's on a new line.
- **`assistant-message.tsx:62`** — `{isLast && blockContent.length > 0 && <StreamingCursor />}` — also rendered after `TrickleBlock`, within a `<div className="relative">`, so again on its own line.

**Core challenge**: Even changing to a `<span>`, the cursor lives *outside* the markdown output. Since markdown renders into `<p>` and other block elements, placing a `<span>` after them still won't be truly inline with the last word.

**Simplest effective fix**: Append a blinking cursor character (`▊` or similar) directly to the markdown content string before passing it to `MarkdownRenderer`, and remove the separate `StreamingCursor` component from these call sites. The cursor renders inside the last `<p>` tag naturally, avoiding all layout issues.

## Phases

- [x] Integrate cursor into markdown content (append cursor to content string in MarkdownRenderer when streaming, remove standalone StreamingCursor from text-block.tsx and assistant-message.tsx)
- [x] Verify cursor sits inline with last word and disappearance causes no layout shift

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Implementation Details

### Approach: Inject cursor into markdown content

**File: `src/components/thread/text-block.tsx`**
- Remove the separate `<StreamingCursor>` after `MarkdownRenderer`.
- `MarkdownRenderer` already receives `isStreaming` — use this to conditionally append a cursor character to the content string.

**File: `src/components/thread/assistant-message.tsx`**
- Remove the separate `<StreamingCursor />` at line 62.
- `TrickleBlock` (which calls `MarkdownRenderer`) already handles `isStreaming` — cursor rendering happens there.

**File: `src/components/thread/trickle-block.tsx`**
- `TrickleBlock` passes `isStreaming={isLast}` to `MarkdownRenderer`. The cursor is rendered by `MarkdownRenderer` when `isStreaming` is true.

**File: `src/components/thread/markdown-renderer.tsx`**
- When `isStreaming` is true, append an inline cursor element at the end of the rendered content. Options:
  - Append a special character (e.g., `▊`) to the content string and style it via CSS.
  - Use a custom rehype plugin to inject a cursor `<span>` as the last child of the last block element.
  - Simply append ` ▊` to the markdown string before rendering.

**File: `src/components/thread/streaming-cursor.tsx`**
- Change outer element from `<div>` to `<span>`, remove `mt-1` class (for any remaining call sites).
- May become unused if all call sites switch to the inline approach.
