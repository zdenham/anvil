# Fix Image Preview Persistence on Typing

## Problem

When you drag-and-drop a screenshot into the input, a preview appears above (via `AttachmentPreviewStrip`), but disappears as soon as you type.

## Root Cause

Image paths are stored **inline in the text content** of the input store. The drop handler (`thread-input-section.tsx:60-68`) appends `/path/to/screenshot.png` to the textarea's text value. `AttachmentPreviewStrip` then calls `extractImagePaths(content)` which only matches lines that are **exactly** an absolute image path (starts with `/`, has image extension).

When you drop an image into an empty input, the textarea content becomes:

```
/Users/me/screenshot.png
```

Your cursor is at the end of that line. When you type "hello", the content becomes:

```
/Users/me/screenshot.pnghello
```

This no longer matches `extractImagePaths`' pattern (the extension is mangled), so the preview disappears.

The same happens even with a space — `"/Users/me/screenshot.png hey"` also fails because `extractImagePaths` calls `isImagePath(line)` on the **entire trimmed line**, which passes the whole string (including trailing text) to `getFileCategory`. Since the line doesn't end with a recognized image extension, it doesn't match.

Even if the path ended with a newline, the user could easily backspace into it or move their cursor. The fundamental issue is that attachment metadata is mixed into editable text.

## Fix

Store attachments as a **separate array** in the input store, independent of text content.

### Files to change

1. `src/stores/input-store.tsx` — Add `attachments: string[]` state with `addAttachments`, `removeAttachment`, `clearAttachments` actions.

2. `src/components/reusable/thread-input-section.tsx` — `handleFileDrop` calls `addAttachments(paths)` instead of `appendContent(paths)`.

3. `src/components/reusable/attachment-preview-strip.tsx` — Read from `useInputStore((s) => s.attachments)` instead of parsing `content`. Add a remove button on each thumbnail so users can detach images. Remove the `content` prop entirely.

4. `src/components/reusable/thread-input.tsx` — On submit, merge attachments into the prompt string (prepend each path on its own line before the text, same format as today so `user-message.tsx` rendering still works). Call `clearAttachments()` alongside `clearContent()`.

5. `src/lib/__tests__/image-paths.test.ts` — Existing tests remain valid (they test `extractImagePaths` / `stripImagePaths` which are still used by `user-message.tsx` for rendering submitted messages).

### Submit-time merge

In `thread-input.tsx` `handleSubmit`, build the final prompt:

```ts
const attachments = useInputStore((s) => s.attachments);
// ...
const parts = [...attachments, value.trim()].filter(Boolean);
onSubmit(parts.join("\n"));
```

This preserves backwards compatibility — the submitted string still contains image paths on their own lines, so `user-message.tsx` renders them correctly with `extractImagePaths` / `stripImagePaths`.

## Phases

- [x] Add `attachments` state to input store

- [x] Update `thread-input-section` drop handler to use `addAttachments`

- [x] Update `attachment-preview-strip` to read from store + add remove button

- [x] Merge attachments into prompt at submit time in `thread-input`

- [x] Verify existing image-paths tests still pass

&lt;!-- IMPORTANT: Mark phases complete with \[x\] as you finish them. Update this file immediately after completing each phase - do not batch updates. --&gt;

---