/**
 * Regex to find absolute image paths in text.
 * Matches /path/to/file.ext where ext is a known image extension,
 * preceded by whitespace or start of line, followed by whitespace or end of string.
 * Uses lazy quantifier to match the shortest path ending in an image extension.
 */
const IMAGE_PATH_RE = /(?<=^|\s)(\/[^\n]*?\.(?:png|jpe?g|gif|webp|bmp|ico|svg))(?=\s|$)/gim;

/** Extract absolute image paths from text content. */
export function extractImagePaths(content: string): string[] {
  const regex = new RegExp(IMAGE_PATH_RE.source, IMAGE_PATH_RE.flags);
  const paths: string[] = [];
  let match;
  while ((match = regex.exec(content)) !== null) {
    paths.push(match[1]);
  }
  return paths;
}

/** Strip image paths from text content, returning remaining text. */
export function stripImagePaths(content: string): string {
  return content
    .replace(new RegExp(IMAGE_PATH_RE.source, IMAGE_PATH_RE.flags), "")
    .split("\n")
    .map((line) => line.replace(/ {2,}/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}
