import { getFileCategory } from "./file-categories";

function isImagePath(path: string): boolean {
  const category = getFileCategory(path);
  return category === "image" || category === "svg";
}

/** Extract absolute image paths from text content (one per line). */
export function extractImagePaths(content: string): string[] {
  return content
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("/") && isImagePath(line));
}

/** Strip image path lines from text content, returning remaining text. */
export function stripImagePaths(content: string): string {
  return content
    .split("\n")
    .filter((line) => !(line.trim().startsWith("/") && isImagePath(line.trim())))
    .join("\n")
    .trim();
}
