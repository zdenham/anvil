import { FilesystemClient, type DirEntry } from "./filesystem-client";
import { logger } from "./logger-client";

/**
 * Low-level persistence layer for the data directory.
 * All paths are relative to the data directory (e.g., ~/.mort or ~/.mort-dev).
 *
 * This is a singleton - use `persistence` export directly.
 */
class Persistence {
  private fs = new FilesystemClient();
  private baseDir: string | null = null;

  /**
   * Gets the base data directory, caching for performance.
   * Uses the paths module from Tauri backend (respects APP_SUFFIX).
   */
  private async getBaseDir(): Promise<string> {
    if (!this.baseDir) {
      this.baseDir = await this.fs.getDataDir();
    }
    return this.baseDir;
  }

  /**
   * Resolves a relative path to an absolute path within the data directory
   */
  private async resolvePath(relativePath: string): Promise<string> {
    const baseDir = await this.getBaseDir();
    return this.fs.joinPath(baseDir, relativePath);
  }

  /**
   * Reads and parses a JSON file.
   * Returns null if the file doesn't exist.
   */
  async readJson<T>(path: string): Promise<T | null> {
    const fullPath = await this.resolvePath(path);
    if (!(await this.fs.exists(fullPath))) {
      return null;
    }
    try {
      return await this.fs.readJsonFile<T>(fullPath);
    } catch {
      return null;
    }
  }

  /**
   * Writes an object as JSON to a file.
   * Creates parent directories if needed.
   */
  async writeJson<T>(path: string, data: T): Promise<void> {
    const fullPath = await this.resolvePath(path);
    logger.debug(`[persistence.writeJson] path=${path}, fullPath=${fullPath}`);
    try {
      await this.fs.writeJsonFile(fullPath, data);
      logger.debug(`[persistence.writeJson] Successfully wrote to ${fullPath}`);
    } catch (err) {
      logger.error(`[persistence.writeJson] Failed to write to ${fullPath}:`, err);
      throw err;
    }
  }

  /**
   * Reads text content from a file.
   * Returns null if the file doesn't exist.
   */
  async readText(path: string): Promise<string | null> {
    const fullPath = await this.resolvePath(path);
    const exists = await this.fs.exists(fullPath);
    logger.debug(`[persistence.readText] path=${path}, fullPath=${fullPath}, exists=${exists}`);
    if (!exists) {
      return null;
    }
    try {
      const content = await this.fs.readFile(fullPath);
      logger.debug(`[persistence.readText] Read ${content?.length ?? 0} chars`);
      return content;
    } catch (e) {
      logger.error(`[persistence.readText] Error reading file:`, e);
      return null;
    }
  }

  /**
   * Writes text content to a file.
   * Creates parent directories if needed.
   */
  async writeText(path: string, content: string): Promise<void> {
    const fullPath = await this.resolvePath(path);
    await this.fs.writeFile(fullPath, content);
  }

  /**
   * Deletes a file. No-op if file doesn't exist.
   */
  async deleteFile(path: string): Promise<void> {
    const fullPath = await this.resolvePath(path);
    if (await this.fs.exists(fullPath)) {
      await this.fs.remove(fullPath);
    }
  }

  /**
   * Lists files in a directory.
   * Returns filenames only (not full paths).
   * Returns empty array if directory doesn't exist.
   */
  async listDir(path: string): Promise<string[]> {
    const fullPath = await this.resolvePath(path);
    if (!(await this.fs.exists(fullPath))) {
      return [];
    }
    const entries = await this.fs.listDir(fullPath);
    return entries.map((e) => e.name);
  }

  /**
   * Lists directory contents with full metadata.
   * Returns empty array if directory doesn't exist.
   */
  async listDirEntries(path: string): Promise<DirEntry[]> {
    const fullPath = await this.resolvePath(path);
    if (!(await this.fs.exists(fullPath))) {
      return [];
    }
    return this.fs.listDir(fullPath);
  }

  /**
   * Ensures a directory exists.
   */
  async ensureDir(path: string): Promise<void> {
    const fullPath = await this.resolvePath(path);
    logger.debug(`[persistence.ensureDir] path=${path}, fullPath=${fullPath}`);
    try {
      await this.fs.mkdir(fullPath);
      logger.debug(`[persistence.ensureDir] Successfully ensured ${fullPath}`);
    } catch (err) {
      logger.error(`[persistence.ensureDir] Failed to ensure ${fullPath}:`, err);
      throw err;
    }
  }

  /**
   * Checks if a file exists.
   */
  async exists(path: string): Promise<boolean> {
    const fullPath = await this.resolvePath(path);
    const result = await this.fs.exists(fullPath);
    logger.debug(`[persistence.exists] path=${path}, fullPath=${fullPath}, exists=${result}`);
    return result;
  }

  /**
   * Removes a directory and all its contents.
   */
  async removeDir(path: string): Promise<void> {
    const fullPath = await this.resolvePath(path);
    if (await this.fs.exists(fullPath)) {
      await this.fs.removeAll(fullPath);
    }
  }

  /**
   * Resolves a relative path to absolute path within the data directory.
   * Exposed for operations that need the full path (e.g., git worktrees)
   */
  async getAbsolutePath(relativePath: string): Promise<string> {
    return this.resolvePath(relativePath);
  }

  /**
   * Simple glob implementation for finding files matching a pattern.
   * Supports patterns like: "tasks/* /threads/* /metadata.json"
   * Only supports * as a wildcard for directory names.
   * Returns relative paths.
   */
  async glob(pattern: string): Promise<string[]> {
    const parts = pattern.split("/");
    return this.globRecursive("", parts);
  }

  private async globRecursive(basePath: string, remainingParts: string[]): Promise<string[]> {
    if (remainingParts.length === 0) {
      return [];
    }

    const [current, ...rest] = remainingParts;
    const currentPath = basePath ? `${basePath}/${current}` : current;

    // If this is the last part, check if it exists
    if (rest.length === 0) {
      if (current === "*") {
        // List all files in the directory
        const entries = await this.listDirEntries(basePath);
        return entries.filter(e => !e.isDirectory).map(e => `${basePath}/${e.name}`);
      } else if (current.includes("*")) {
        // Pattern matching for filenames (e.g., "*-uuid" or "*.json")
        const entries = await this.listDirEntries(basePath);
        const regex = new RegExp("^" + current.replace(/\*/g, ".*") + "$");
        return entries
          .filter(e => !e.isDirectory && regex.test(e.name))
          .map(e => `${basePath}/${e.name}`);
      } else {
        // Exact filename
        if (await this.exists(currentPath)) {
          return [currentPath];
        }
        return [];
      }
    }

    // If current is *, enumerate all subdirectories
    if (current === "*") {
      const entries = await this.listDirEntries(basePath);
      const dirs = entries.filter(e => e.isDirectory);
      const results: string[] = [];
      for (const dir of dirs) {
        const subPath = basePath ? `${basePath}/${dir.name}` : dir.name;
        const subResults = await this.globRecursive(subPath, rest);
        results.push(...subResults);
      }
      return results;
    }

    // If current contains *, pattern match directories
    if (current.includes("*")) {
      const entries = await this.listDirEntries(basePath);
      const regex = new RegExp("^" + current.replace(/\*/g, ".*") + "$");
      const matchingDirs = entries.filter(e => e.isDirectory && regex.test(e.name));
      const results: string[] = [];
      for (const dir of matchingDirs) {
        const subPath = basePath ? `${basePath}/${dir.name}` : dir.name;
        const subResults = await this.globRecursive(subPath, rest);
        results.push(...subResults);
      }
      return results;
    }

    // Regular directory - recurse if it exists
    if (await this.exists(currentPath)) {
      return this.globRecursive(currentPath, rest);
    }
    return [];
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Git operations (work with absolute paths)
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Checks if an absolute path is a git repository.
   */
  async isGitRepo(absolutePath: string): Promise<boolean> {
    logger.debug(`[persistence.isGitRepo] Checking: ${absolutePath}`);
    try {
      const result = await this.fs.isGitRepo(absolutePath);
      logger.debug(`[persistence.isGitRepo] ${absolutePath} isGitRepo=${result}`);
      return result;
    } catch (err) {
      logger.error(`[persistence.isGitRepo] Failed to check ${absolutePath}:`, err);
      throw err;
    }
  }

  /**
   * Checks if an absolute path exists.
   */
  async absolutePathExists(absolutePath: string): Promise<boolean> {
    logger.debug(`[persistence.absolutePathExists] Checking: ${absolutePath}`);
    try {
      const result = await this.fs.exists(absolutePath);
      logger.debug(`[persistence.absolutePathExists] ${absolutePath} exists=${result}`);
      return result;
    } catch (err) {
      logger.error(`[persistence.absolutePathExists] Failed to check ${absolutePath}:`, err);
      throw err;
    }
  }

  /**
   * Creates a git worktree from a source repo to a destination within the data directory
   */
  async gitWorktreeAdd(sourceRepoPath: string, destRelativePath: string): Promise<void> {
    const destPath = await this.resolvePath(destRelativePath);
    await this.fs.gitWorktreeAdd(sourceRepoPath, destPath);
  }

  /**
   * Removes a git worktree.
   */
  async gitWorktreeRemove(sourceRepoPath: string, worktreePath: string): Promise<void> {
    await this.fs.gitWorktreeRemove(sourceRepoPath, worktreePath);
  }

  /**
   * Copies a directory from an absolute source to a relative destination within the data directory
   */
  async copyDirectory(sourceAbsolutePath: string, destRelativePath: string): Promise<void> {
    const destPath = await this.resolvePath(destRelativePath);
    await this.fs.copyDirectory(sourceAbsolutePath, destPath);
  }
}

/** Global persistence instance for data directory operations */
export const persistence = new Persistence();

// ═══════════════════════════════════════════════════════════════════════════
// Repository Settings helpers
// ═══════════════════════════════════════════════════════════════════════════

import { RepositorySettingsSchema, type RepositorySettings } from "@/entities/repositories/types";

const SETTINGS_FILE = "settings.json";
const REPOS_DIR = "repositories";

/**
 * Loads repository settings from settings.json.
 * Falls back to migrating from metadata.json if settings.json doesn't exist.
 */
export async function loadSettings(repoName: string): Promise<RepositorySettings> {
  const settingsPath = `${REPOS_DIR}/${repoName}/${SETTINGS_FILE}`;

  const raw = await persistence.readJson(settingsPath);
  if (raw) {
    const result = RepositorySettingsSchema.safeParse(raw);
    if (result.success) {
      return result.data;
    }
    // Invalid settings.json - fall through to migrate
    logger.warn(`[loadSettings] Invalid settings.json for ${repoName}, attempting migration:`, result.error.message);
  }

  // Try migrating from metadata.json
  return await migrateFromMetadata(repoName);
}

/**
 * Saves repository settings to settings.json.
 */
export async function saveSettings(
  repoName: string,
  settings: RepositorySettings
): Promise<void> {
  logger.debug(`[saveSettings] Saving settings for repo: ${repoName}`);
  const settingsPath = `${REPOS_DIR}/${repoName}/${SETTINGS_FILE}`;
  logger.debug(`[saveSettings] Settings path: ${settingsPath}`);
  try {
    await persistence.writeJson(settingsPath, settings);
    logger.debug(`[saveSettings] Successfully saved settings for ${repoName}`);
  } catch (err) {
    logger.error(`[saveSettings] Failed to save settings for ${repoName}:`, err);
    throw err;
  }
}

/**
 * Migrates from old metadata.json format to new settings.json format.
 */
async function migrateFromMetadata(repoName: string): Promise<RepositorySettings> {
  const metadataPath = `${REPOS_DIR}/${repoName}/metadata.json`;

  const metadata = await persistence.readJson<{
    name: string;
    originalUrl?: string | null;
    sourcePath?: string | null;
    useWorktrees?: boolean;
    createdAt?: number;
  }>(metadataPath);

  if (!metadata) {
    throw new Error(`Repository ${repoName} not found`);
  }

  // Discover existing worktrees from disk
  const existingWorktrees = await discoverExistingWorktrees(repoName);

  // Convert to new format
  const settings: RepositorySettings = {
    schemaVersion: 1,
    name: metadata.name,
    originalUrl: metadata.originalUrl ?? null,
    sourcePath: metadata.sourcePath ?? "",
    useWorktrees: metadata.useWorktrees ?? true,
    defaultBranch: 'main',
    createdAt: metadata.createdAt ?? Date.now(),
    worktrees: existingWorktrees,
    taskBranches: {},
    lastUpdated: Date.now(),
  };

  // Save new format
  await saveSettings(repoName, settings);

  return settings;
}

/**
 * Discover existing worktrees on disk during migration.
 */
async function discoverExistingWorktrees(repoName: string): Promise<import("@/entities/repositories/types").WorktreeState[]> {
  const worktrees: import("@/entities/repositories/types").WorktreeState[] = [];
  const repoDir = `${REPOS_DIR}/${repoName}`;

  // Look for worktree-* directories
  const entries = await persistence.listDirEntries(repoDir);

  for (const entry of entries) {
    if (!entry.isDirectory) continue;

    // Match worktree-N pattern
    const match = entry.name.match(/^worktree-(\d+)$/);
    if (match) {
      worktrees.push({
        path: entry.path,
        name: entry.name,
        currentBranch: null,
      });
    }

    // Also match {slug}-N pattern (e.g., shortcut-1)
    const slugMatch = entry.name.match(/^[a-z0-9-]+-(\d+)$/);
    if (slugMatch && !match) {
      worktrees.push({
        path: entry.path,
        name: entry.name,
        currentBranch: null,
      });
    }
  }

  // Sort by name
  worktrees.sort((a, b) => a.name.localeCompare(b.name));
  return worktrees;
}
