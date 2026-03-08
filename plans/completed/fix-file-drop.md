# Fix File Drop Not Working

Dragging files from the desktop onto the input area does nothing — no visual feedback, no path insertion.

## Root Cause

`use-file-drop.ts` uses a two-system approach: DOM drag events set an `isOverRef` flag, and Tauri's `onDragDropEvent` checks that flag before processing the drop. The problem is that **macOS Tauri v2 doesn't reliably forward OS-level file drags to the webview as DOM events**. The native window intercepts them before they reach the webview.

So the flow breaks at step 1:
1. User drags file over input → DOM `dragenter` **never fires** → `isOverRef` stays `false`
2. User drops → Tauri `onDragDropEvent` fires with type `drop` → checks `isOverRef.current` → **false** → callback skipped

Both visual feedback (`isDragging` state) and path insertion depend on DOM events firing, so neither works.

## Fix

Use Tauri's `onDragDropEvent` for **both** visual feedback and path extraction. Remove the DOM event coordination entirely.

## Phases

- [x] Rewrite `use-file-drop.ts` to use only Tauri events

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Implementation

**File: `src/hooks/use-file-drop.ts`**

Replace the entire file. Remove all DOM event listeners (`dragenter`, `dragover`, `dragleave`, `drop`) and the `isOverRef` coordination logic. Use only Tauri's `onDragDropEvent` which provides `enter`, `leave`, and `drop` event types:

```ts
import { useState, useEffect, useRef, type RefObject } from "react";
import { getCurrentWindow } from "@/lib/browser-stubs";

/**
 * Hook for handling file drag-and-drop.
 *
 * Uses Tauri's onDragDropEvent for both visual feedback and path extraction.
 * DOM drag events are unreliable for external file drags on macOS — the
 * native window intercepts them before they reach the webview.
 */
export function useFileDrop(
  _containerRef: RefObject<HTMLElement | null>,
  onDrop: (paths: string[]) => void,
): boolean {
  const [isDragging, setIsDragging] = useState(false);
  const onDropRef = useRef(onDrop);
  onDropRef.current = onDrop;

  useEffect(() => {
    let unlisten: (() => void) | null = null;
    let mounted = true;

    getCurrentWindow()
      .onDragDropEvent((event) => {
        const { type } = event.payload;
        if (type === "enter") {
          setIsDragging(true);
        } else if (type === "leave") {
          setIsDragging(false);
        } else if (type === "drop") {
          setIsDragging(false);
          onDropRef.current(event.payload.paths);
        }
      })
      .then((fn) => {
        if (mounted) unlisten = fn;
        else fn();
      });

    return () => {
      mounted = false;
      unlisten?.();
    };
  }, []);

  return isDragging;
}
```

Key changes:
- `enter` → set `isDragging = true` (visual ring highlight)
- `leave` → set `isDragging = false`
- `drop` → set `isDragging = false` + call `onDrop` with paths
- No DOM event listeners needed
- `_containerRef` kept in signature for API compatibility (unused now since Tauri events are window-scoped)

**No other files need changes** — `thread-input-section.tsx` calls `useFileDrop` the same way.
