export type FileCategory = "image" | "svg" | "pdf" | "video" | "audio" | "text";

const IMAGE_EXTENSIONS = new Set([
  "png", "jpg", "jpeg", "gif", "webp", "bmp", "ico",
]);

const VIDEO_EXTENSIONS = new Set([
  "mp4", "webm", "mov",
]);

const AUDIO_EXTENSIONS = new Set([
  "mp3", "wav", "ogg", "m4a",
]);

function getExtension(filePath: string): string {
  const filename = filePath.split("/").pop() ?? "";
  return filename.split(".").pop()?.toLowerCase() ?? "";
}

/** Classify a file path into a rendering category based on extension. */
export function getFileCategory(filePath: string): FileCategory {
  const ext = getExtension(filePath);

  if (ext === "svg") return "svg";
  if (ext === "pdf") return "pdf";
  if (IMAGE_EXTENSIONS.has(ext)) return "image";
  if (VIDEO_EXTENSIONS.has(ext)) return "video";
  if (AUDIO_EXTENSIONS.has(ext)) return "audio";
  return "text";
}

/** Quick check for whether a file is a non-text media type. */
export function isMediaFile(filePath: string): boolean {
  return getFileCategory(filePath) !== "text";
}
