/**
 * Shim: @tauri-apps/api/path
 *
 * Provides browser-compatible path utilities.
 * These match the async signatures of Tauri's path API.
 */

export async function join(...paths: string[]): Promise<string> {
  return paths
    .map((s) => s.replace(/\/+$/, ""))
    .filter((s) => s.length > 0)
    .join("/");
}

export async function resolveResource(path: string): Promise<string> {
  return path;
}

export async function dirname(path: string): Promise<string> {
  const lastSlash = path.lastIndexOf("/");
  return lastSlash === -1 ? "." : path.substring(0, lastSlash);
}

export async function basename(path: string): Promise<string> {
  const lastSlash = path.lastIndexOf("/");
  return lastSlash === -1 ? path : path.substring(lastSlash + 1);
}
