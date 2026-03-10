import { useEffect, useRef, type RefObject } from "react";
import { fsCommands } from "@/lib/tauri-commands";
import { getMortDir } from "@/lib/paths";
import { logger } from "@/lib/logger-client";

const MAX_IMAGE_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB

/**
 * Hook that intercepts paste events on a target element and extracts pasted images.
 *
 * When an image is pasted (e.g., Cmd+V after a screenshot), this hook:
 * 1. Reads the image blob from the clipboard
 * 2. Converts it to base64
 * 3. Writes it to a temp file via the Tauri backend
 * 4. Calls onImagePasted with the file path
 *
 * Text pastes are ignored (default behavior preserved).
 */
export function useImagePaste(
  targetRef: RefObject<HTMLElement | null>,
  onImagePasted: (path: string) => void,
) {
  const callbackRef = useRef(onImagePasted);
  callbackRef.current = onImagePasted;

  useEffect(() => {
    const el = targetRef.current;
    if (!el) return;

    const handlePaste = (e: Event) => {
      const clipboardEvent = e as ClipboardEvent;
      const items = clipboardEvent.clipboardData?.items;
      if (!items) return;

      for (const item of items) {
        if (!item.type.startsWith("image/")) continue;

        // Prevent default to avoid the browser inserting the image as content
        e.preventDefault();

        const blob = item.getAsFile();
        if (!blob) continue;

        if (blob.size > MAX_IMAGE_SIZE_BYTES) {
          logger.warn("Pasted image too large", { size: blob.size, limit: MAX_IMAGE_SIZE_BYTES });
          continue;
        }

        writeImageToTempFile(blob)
          .then((path) => callbackRef.current(path))
          .catch((err) => logger.error("Failed to save pasted image", { error: String(err) }));

        // Only handle the first image
        break;
      }
    };

    el.addEventListener("paste", handlePaste);
    return () => el.removeEventListener("paste", handlePaste);
  }, [targetRef]);
}

async function writeImageToTempFile(blob: File): Promise<string> {
  const mortDir = await getMortDir();
  const ext = extensionFromMime(blob.type);
  const timestamp = Date.now();
  const random = Math.random().toString(36).slice(2, 8);
  const path = `${mortDir}/tmp/paste-${timestamp}-${random}.${ext}`;

  const base64 = await readBlobAsBase64(blob);
  await fsCommands.writeBinaryFile(path, base64);

  return path;
}

function extensionFromMime(mime: string): string {
  if (mime === "image/png") return "png";
  if (mime === "image/jpeg") return "jpg";
  if (mime === "image/gif") return "gif";
  if (mime === "image/webp") return "webp";
  if (mime === "image/bmp") return "bmp";
  return "png";
}

function readBlobAsBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      // result is "data:<mime>;base64,<data>" — extract just the base64 part
      const dataUrl = reader.result as string;
      resolve(dataUrl.split(",")[1]);
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}
