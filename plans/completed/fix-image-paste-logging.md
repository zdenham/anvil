# Fix Image Paste Not Working

## Diagnosis

The `useImagePaste` hook uses DOM-level `addEventListener("paste", ...)` via refs, but `SearchInputProps` already extends `React.TextareaHTMLAttributes` — meaning `onPaste` is accepted and spread onto the `<textarea>` through `TriggerSearchInput → SearchInput → {...props}`.

The ref-chasing approach (`textareaRef` + effect + `useImagePaste`) is both fragile (timing bug with ref staleness) and unnecessary. React's `onPaste` prop is the correct way to handle this.

### What to change

1. Delete the `useImagePaste` hook entirely
2. Extract the image-handling logic into a plain `onPaste` handler in `thread-input.tsx`
3. Pass it as a prop to `TriggerSearchInput` (already supported via `...props` spread)
4. Add logging at key points in the handler

## Phases

- [x] Replace `useImagePaste` hook with `onPaste` prop in `thread-input.tsx`

- [x] Add diagnostic logging throughout the paste handler

- [x] Update/remove tests

&lt;!-- IMPORTANT: Mark phases complete with \[x\] as you finish them. Update this file immediately after completing each phase - do not batch updates. --&gt;

---

## Phase 1: Replace `useImagePaste` with `onPaste` prop

In `src/components/reusable/thread-input.tsx`:

1. **Remove** the ref-chasing code (lines 50-56):

   ```ts
   // DELETE all of this:
   const textareaRef = useRef<HTMLTextAreaElement | null>(null);
   useEffect(() => {
       textareaRef.current = inputRef.current?.getElement() ?? null;
   });
   useImagePaste(textareaRef, (path) => addAttachments([path]));
   ```

2. **Add** an `onPaste` handler that extracts images:

   ```ts
   const handlePaste = useCallback((e: React.ClipboardEvent<HTMLTextAreaElement>) => {
     const items = e.clipboardData?.items;
     if (!items) return;
   
     for (const item of items) {
       if (!item.type.startsWith("image/")) continue;
       e.preventDefault();
   
       const blob = item.getAsFile();
       if (!blob) continue;
       if (blob.size > MAX_IMAGE_SIZE_BYTES) {
         logger.warn("[image-paste] image too large", { size: blob.size });
         continue;
       }
   
       writeImageToTempFile(blob)
         .then((path) => addAttachments([path]))
         .catch((err) => logger.error("[image-paste] save failed", { error: String(err) }));
       break;
     }
   }, [addAttachments]);
   ```

3. **Pass** `onPaste={handlePaste}` to `<TriggerSearchInput>` — it already spreads `...props` onto the textarea.

4. **Move** `writeImageToTempFile`, `extensionFromMime`, `readBlobAsBase64`, and `MAX_IMAGE_SIZE_BYTES` from `use-image-paste.ts` into a utility file (e.g. `src/lib/image-paste.ts`) so `thread-input.tsx` can import them without the hook.

5. **Delete** `src/hooks/use-image-paste.ts`.

## Phase 2: Add diagnostic logging

Add `logger` calls in the `handlePaste` callback:

1. Entry: `logger.log("[image-paste] paste event", { itemCount, types })`
2. Image found: `logger.log("[image-paste] image item", { type, size })`
3. Success: `logger.log("[image-paste] saved", { path })`

These are already inline in the handler above — just confirm they're present.

## Phase 3: Update/remove tests

- Delete or rewrite `use-image-paste.test.ts` since the hook no longer exists
- If coverage is needed, test `writeImageToTempFile` and the paste extraction logic directly