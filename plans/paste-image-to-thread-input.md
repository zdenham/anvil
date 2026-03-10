# Paste Image into Thread Input

## Problem

Users cannot paste images from the clipboard into the thread input. This is a common workflow (e.g., screenshot → Cmd+V) that currently does nothing.

## Current State

- Thread input uses `TriggerSearchInput` → `SearchInput` (a `<textarea>`)
- No `onPaste` handler exists anywhere in the input chain
- Images are attached via drag-and-drop only, using `useFileDrop` + Tauri's `onDragDropEvent`
- Attachments are stored as file paths (strings) in `input-store.tsx`
- The agent SDK consumes image paths, not blobs — images must be written to disk
- `fsCommands.writeFile` exists but only handles string content (not binary)
- No `fs_write_binary` Tauri command exists yet

## Approach

Intercept paste events on the thread input, extract image data from the clipboard, write it to a temp file via a new Tauri command, then add the temp file path as an attachment.

### Changes

**Backend: New Tauri command for writing binary files**

Add `fs_write_binary` command to the Rust backend (or a more specific `fs_save_clipboard_image` that accepts base64). The simplest approach: accept base64 string + destination path, decode and write.

- Add command in the same file that handles `fs_write_file`
- Register it in the Tauri command list
- Add to `invoke.ts` so the frontend can call it

`src/lib/tauri-commands.ts`

- Add `writeBinaryFile: (path: string, base64: string) => invoke<void>("fs_write_binary", { path, base64 })` to `fsCommands`

`src/hooks/use-image-paste.ts` (new)

- Hook that attaches a `paste` event listener to a ref'd element
- On paste: check `clipboardData.items` for `image/*` types
- Read the image as a blob, convert to base64
- Generate a temp path: `~/.mort/tmp/paste-{timestamp}-{random}.png`
- Call `fsCommands.writeBinaryFile(tempPath, base64Data)`
- Call the provided `onPaste(tempPath)` callback

`src/components/reusable/thread-input.tsx`

- Import and use `useImagePaste` hook
- Wire it to the textarea ref
- On paste callback: call `addAttachments([tempPath])` from input store

`src/lib/invoke.ts`

- No changes needed — `invoke` routes non-native commands through WS/Tauri automatically

### Edge Cases

- Paste with no image data: ignore, let default paste behavior handle text
- Multiple images: clipboard typically only has one, but handle array if present
- Large images: base64 encoding doubles size; consider a size limit (e.g., 10MB) and warn
- Temp file cleanup: files in `~/.mort/tmp/` can be cleaned up periodically or on app exit

## Phases

- [x] Add `fs_write_binary` Tauri command (Rust backend)

- [x] Add `writeBinaryFile` to `fsCommands` and ensure `~/.mort/tmp` directory setup

- [x] Create `use-image-paste` hook

- [x] Wire paste hook into `thread-input.tsx`

- [x] Add tests for the paste hook and integration

&lt;!-- IMPORTANT: Mark phases complete with \[x\] as you finish them. Update this file immediately after completing each phase - do not batch updates. --&gt;

---