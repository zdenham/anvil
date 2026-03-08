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
