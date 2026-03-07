# File Attachments (Drag-and-Drop)

Users drag-and-drop files into the thread input area. The absolute path is inserted directly into the textarea content (like typing it). For images, a visual preview renders above the input so the user can see what they attached. The user sees and can edit the path before sending.

## Architecture Summary

### Current State
- `ThreadInput` uses `TriggerSearchInput` with `onSubmit(prompt: string)`
- `InputStore` holds `content: string` with `setContent`, `appendContent`
- Messages flow as plain strings all the way through to the agent
- `convertFileSrc()` already converts absolute paths to Tauri asset URLs (scope `**` configured)
- `getFileCategory()` / `isMediaFile()` already classifies files by extension

### Design: Insert Path into Textarea

On file drop, append the absolute path to the textarea content. The user sees it, can edit it, and submits normally. No special markers, no parsing, no changes to agent/runner/reducer/SDK.

For image files specifically, show a small preview above the input so the user can visually confirm what they're attaching. This preview is ephemeral — it's derived from the paths currently in the textarea, not separate state.

## Phases

- [ ] Handle file drop events on the input area
- [ ] Show image previews above input for detected image paths
- [ ] Write tests

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Phase 1: Handle File Drop Events on the Input Area

**File: `src/components/reusable/thread-input-section.tsx`**

Add drag-and-drop handlers to the outer `<div>`:

1. **`onDragOver`**: `e.preventDefault()` + set a `isDragging` state for visual feedback (border highlight)
2. **`onDragLeave`**: clear `isDragging`
3. **`onDrop`**: Extract file paths, append to input content, clear `isDragging`

**Getting file paths in Tauri v2**: `dataTransfer.files` does NOT expose `.path` in Tauri v2. Use `getCurrentWindow().onDragDropEvent()` from `@tauri-apps/api/window` which provides `{ paths: string[] }` on the `drop` variant. Register this listener on mount and wire it to the input store's `appendContent`.

Alternative: Check if the `onDrop` DOM event's `dataTransfer.getData('text/uri-list')` or `dataTransfer.files[n].name` provides usable data. If Tauri exposes the paths through the standard DOM event (some Tauri versions do), use that for simplicity.

**Path insertion format**: For each dropped file, append its absolute path on a new line:
```
<existing content>\n/absolute/path/to/file.png
```

If the input is empty, just insert the path without a leading newline.

**Visual feedback**: While dragging over the input area, show a dashed border / subtle overlay. CSS-only via the `isDragging` state.

## Phase 2: Show Image Previews Above Input

**File: `src/components/reusable/attachment-preview-strip.tsx`** (new, small component)

A component that sits above the `ThreadInput` in `ThreadInputSection`. It watches the input content, extracts anything that looks like an absolute image path, and renders small thumbnails.

```tsx
interface AttachmentPreviewStripProps {
  content: string;
}

function AttachmentPreviewStrip({ content }: AttachmentPreviewStripProps) {
  const imagePaths = extractImagePaths(content);
  if (imagePaths.length === 0) return null;

  return (
    <div className="flex gap-2 px-2 pb-2 overflow-x-auto">
      {imagePaths.map(path => (
        <img
          key={path}
          src={convertFileSrc(path)}
          className="h-12 w-12 rounded object-cover border border-surface-600"
          alt={path.split('/').pop()}
        />
      ))}
    </div>
  );
}
```

**Path extraction**: Scan the textarea content for lines that look like absolute file paths to images:
```ts
function extractImagePaths(content: string): string[] {
  return content.split('\n')
    .map(line => line.trim())
    .filter(line => line.startsWith('/') && isImagePath(line));
}

function isImagePath(path: string): boolean {
  const category = getFileCategory(path);
  return category === 'image' || category === 'svg';
}
```

**Integration in `ThreadInputSection`**: Read `content` from the input store and pass to `AttachmentPreviewStrip`, rendered between the quick actions area and the `ThreadInput`.

This is purely cosmetic — if the user deletes the path from the textarea, the preview disappears. No separate attachment state needed.

## Phase 3: Tests

1. **Path extraction**: Unit test `extractImagePaths` — returns image paths, ignores non-image paths, handles empty/multiline content
2. **Drop handler**: Test that dropping files appends paths to input content
3. **Preview strip**: Test that component renders thumbnails for image paths, renders nothing for non-image or empty content

## Key Design Points

- **No new state**: Paths live in the textarea content. Preview is derived, not stored.
- **No agent/runner/reducer changes**: The prompt is just text containing file paths.
- **User is in control**: They see the path, can edit/delete it before sending.
- **Reuses existing infra**: `convertFileSrc`, `getFileCategory`, `isMediaFile`.
- **Tauri asset protocol**: Already configured with `scope: ["**"]`.
