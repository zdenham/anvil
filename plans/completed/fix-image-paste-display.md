# Fix Image Paste: Not Displaying + No Loading State

## Problem

Two issues with image paste:

### 1. Pasted image never appears in chat

The paste handler (`thread-input.tsx:72-76`) calls `addAttachments([path])` which writes to `store.attachments`. But **nothing reads `store.attachments`**. The entire attachment display pipeline is text-based:

- **File drop** (`thread-input-section.tsx:63-68`): calls `appendContent(path)` — embeds path in textarea text
- **Preview strip** (`thread-input-section.tsx:71,93`): calls `extractImagePaths(content)` — parses paths from text
- **Submitted messages** (`user-message.tsx:23-24`): same `extractImagePaths`/`stripImagePaths` from text

The `store.attachments` array is orphaned — nothing renders it and submit never consumes it.

### 2. No loading feedback during async save

`writeImageToTempFile` is async (reads blob → writes to disk via Tauri). During this time there's no visual feedback that a paste is in progress.

## Solution

### Fix 1: Append path to text content (match file drop behavior)

In the paste handler, replace `addAttachments([path])` with `appendContent(path)`. This feeds into the existing working pipeline: `extractImagePaths(content)` → `AttachmentPreviewStrip` → `user-message.tsx`.

### Fix 2: Add a "pasting..." indicator

Add a `isPasting` boolean state to the paste handler. Set it `true` before the async call, `false` after. Render a small inline indicator (e.g. "Pasting image...") near the input or in the `AttachmentPreviewStrip` area.

## Phases

- [x] Fix paste to append path to text content instead of store.attachments
- [x] Add pasting loading state
- [x] Clean up unused store.attachments if no longer needed

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Phase 1: Fix paste to append path to text content

In `src/components/reusable/thread-input.tsx`:

1. Add `appendContent` from the input store (alongside existing `addAttachments`):
   ```ts
   const appendContent = useInputStore((s) => s.appendContent);
   ```

2. In `handlePaste`, replace `addAttachments([path])` with:
   ```ts
   const prefix = content.trim() ? "\n" : "";
   appendContent(prefix + path);
   ```
   This matches exactly how file drop works in `thread-input-section.tsx:63-68`.

3. Remove the `addAttachments` import/usage from `thread-input.tsx` since it's no longer needed here.

4. Add `content` to the `handlePaste` dependency array (read via store selector).

No changes needed downstream — `thread-input-section.tsx` already reads `content`, extracts image paths, and renders the `AttachmentPreviewStrip`. The `user-message.tsx` display pipeline also already works via `extractImagePaths`/`stripImagePaths`.

## Phase 2: Add pasting loading state

1. Add state in `thread-input.tsx`:
   ```ts
   const [isPasting, setIsPasting] = useState(false);
   ```

2. Wrap the async save:
   ```ts
   setIsPasting(true);
   writeImageToTempFile(blob)
     .then((path) => {
       logger.log("[image-paste] saved", { path });
       const prefix = content.trim() ? "\n" : "";
       appendContent(prefix + path);
     })
     .catch((err) => logger.error("[image-paste] save failed", { error: String(err) }))
     .finally(() => setIsPasting(false));
   ```

3. Pass `isPasting` to the parent or render inline. Simplest approach: render a small indicator directly in `ThreadInput` below or above the textarea:
   ```tsx
   {isPasting && (
     <div className="text-xs text-surface-400 px-2 py-1">Pasting image...</div>
   )}
   ```

## Phase 3: Clean up unused store.attachments

If `addAttachments` / `removeAttachment` / `clearAttachments` / `attachments` are not used anywhere else after this change, remove them from `input-store.tsx` to avoid confusion. Check all references first.
