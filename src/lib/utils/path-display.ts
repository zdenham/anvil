/**
 * Path display utilities for tool blocks.
 *
 * Provides performant helpers to convert absolute paths to:
 * - Relative paths (relative to workspace root)
 * - Home-relative paths (~/...) for external files
 * - File names only
 */

// Cached home directory - fetched once and stored
let cachedHomeDir: string | null = null;

/**
 * Initialize the home directory cache.
 * Should be called early in the app lifecycle (e.g., at startup).
 */
export async function initHomeDir(): Promise<void> {
  if (cachedHomeDir !== null) return;

  try {
    const { fsCommands } = await import("@/lib/tauri-commands");
    cachedHomeDir = await fsCommands.getHomeDir();
  } catch {
    // Fallback for tests or non-Tauri environments
    cachedHomeDir = "";
  }
}

/**
 * Get the cached home directory.
 * Returns empty string if not yet initialized.
 */
export function getHomeDir(): string {
  return cachedHomeDir ?? "";
}

/**
 * Convert an absolute path to a display-friendly path.
 *
 * Priority:
 * 1. If within workspace root -> relative path (e.g., "src/file.ts")
 * 2. If within home directory -> home-relative path (e.g., "~/other/file.ts")
 * 3. Otherwise -> absolute path as-is
 *
 * @param absolutePath - The absolute file path
 * @param workspaceRoot - The workspace root directory
 * @returns Display-friendly path
 *
 * Performance: O(1) string operations, no filesystem access
 */
export function toRelativePath(
  absolutePath: string,
  workspaceRoot: string
): string {
  if (!absolutePath) {
    return "";
  }

  // Check workspace root first (most common case)
  if (workspaceRoot) {
    const normalizedRoot = workspaceRoot.endsWith("/")
      ? workspaceRoot.slice(0, -1)
      : workspaceRoot;

    if (absolutePath.startsWith(normalizedRoot + "/")) {
      return absolutePath.slice(normalizedRoot.length + 1);
    }
  }

  // Fall back to home-relative path for external files
  const homeDir = getHomeDir();
  if (homeDir && absolutePath.startsWith(homeDir + "/")) {
    return "~" + absolutePath.slice(homeDir.length);
  }

  // Path is outside home, return as-is
  return absolutePath;
}

/**
 * Extract just the file name from a path.
 *
 * @param path - Absolute or relative file path
 * @returns File name only (e.g., "file.ts")
 *
 * Performance: O(1) string operations
 */
export function toFileName(path: string): string {
  if (!path) return "";

  // Handle both forward and back slashes
  const lastSlash = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return lastSlash === -1 ? path : path.slice(lastSlash + 1);
}

/**
 * Convert multiple paths to display-friendly paths efficiently.
 * Useful for batch processing (e.g., glob/grep results).
 *
 * @param absolutePaths - Array of absolute file paths
 * @param workspaceRoot - The workspace root directory
 * @returns Array of display-friendly paths
 */
export function toRelativePaths(
  absolutePaths: string[],
  workspaceRoot: string
): string[] {
  // Pre-compute normalized roots for efficiency
  const normalizedWorkspace = workspaceRoot?.endsWith("/")
    ? workspaceRoot.slice(0, -1)
    : workspaceRoot;
  const workspacePrefix = normalizedWorkspace ? normalizedWorkspace + "/" : "";
  const workspacePrefixLen = workspacePrefix.length;

  const homeDir = getHomeDir();
  const homePrefix = homeDir ? homeDir + "/" : "";
  const homePrefixLen = homeDir?.length ?? 0;

  return absolutePaths.map((p) => {
    if (!p) return "";
    if (workspacePrefix && p.startsWith(workspacePrefix)) {
      return p.slice(workspacePrefixLen);
    }
    if (homePrefix && p.startsWith(homePrefix)) {
      return "~" + p.slice(homePrefixLen);
    }
    return p;
  });
}
