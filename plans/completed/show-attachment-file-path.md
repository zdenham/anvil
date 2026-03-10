# Restore File Path Visibility in Thread Input

## Problem

When a user drags and drops a file into the thread input, the file path used to appear directly in the textarea content — visible and editable. A refactor moved attachments to a separate `attachments[]` array in `input-store.tsx`, so now users only see a 48x48 thumbnail with no visible path. We want to restore the original behavior where the path shows up in the input text.

## Current State

- `useFileDrop` → calls `addAttachments(paths)` → stores paths in separate `attachments: string[]` in input store
- `AttachmentPreviewStrip` reads from `attachments` prop (not from textarea content)
- On submit (`thread-input.tsx:73-81`): `[...attachments, text].filter(Boolean).join("\n")` — attachments are prepended to text
- `UserMessage` already uses `extractImagePaths` / `stripImagePaths` to render image previews in sent messages
- The original design (`plans/completed/file-attachments.md`) explicitly said: "On file drop, append the absolute path to the textarea content. The user sees it, can edit it."

## Approach

Revert to the original "path in content" approach: on file drop, append the path to the textarea content. Derive image previews from the content. Remove the separate `attachments` state from the drop/submit flow.

### Changes

`src/components/reusable/thread-input-section.tsx`

- Change `handleFileDrop` to call `appendContent` instead of `addAttachments`:

  ```ts
  const appendContent = useInputStore((s) => s.appendContent);
  const content = useInputStore((s) => s.content);
  
  const handleFileDrop = useCallback((paths: string[]) => {
    if (paths.length === 0) return;
    const prefix = content.trim() ? "\n" : "";
    appendContent(prefix + paths.join("\n"));
  }, [appendContent, content]);
  ```
- Change `AttachmentPreviewStrip` to derive from content instead of `attachments`:

  ```tsx
  const imagePaths = extractImagePaths(content);
  <AttachmentPreviewStrip attachments={imagePaths} onRemove={handleRemoveImagePath} />
  ```
- Add `handleRemoveImagePath` that strips the path line from content using store's `setContent` + a filter

`src/components/reusable/thread-input.tsx`

- Remove `attachments` and `clearAttachments` from the submit handler
- Submit just sends `value.trim()` — the paths are already in the content
- Remove the `attachments.length > 0` checks from submit/enter key conditions, replace with just checking `value.trim()`

`src/components/reusable/attachment-preview-strip.tsx`

- No structural changes needed — it already takes `attachments: string[]` and `onRemove`

`src/stores/input-store.tsx`

- Keep the `attachments` state for now (other consumers may use it), but the thread input flow no longer uses it for file drops

## Phases

- [x] Update thread-input-section to append paths to content and derive previews from content

- [x] Update thread-input submit to stop using separate attachments state

- [x] Verify onRemove strips the path line from content

&lt;!-- IMPORTANT: Mark phases complete with \[x\] as you finish them. Update this file immediately after completing each phase - do not batch updates. --&gt;

---