import { fsCommands } from "@/lib/tauri-commands";
import { getAnvilDir } from "@/lib/paths";

export const MAX_IMAGE_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB

export async function writeImageToTempFile(blob: File): Promise<string> {
  const anvilDir = await getAnvilDir();
  const ext = extensionFromMime(blob.type);
  const timestamp = Date.now();
  const random = Math.random().toString(36).slice(2, 8);
  const path = `${anvilDir}/tmp/paste-${timestamp}-${random}.${ext}`;

  const base64 = await readBlobAsBase64(blob);
  await fsCommands.writeBinaryFile(path, base64);

  return path;
}

export function extensionFromMime(mime: string): string {
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
