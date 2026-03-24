import { invoke } from "@/lib/invoke";
import { logger } from "@/lib/logger-client";
import { toast } from "@/lib/toast";
import { z } from "zod";
import { PathsInfoSchema, type PathsInfo } from "./types/paths";

/**
 * Schema for directory entry metadata returned by listDir
 */
export const DirEntrySchema = z.object({
  name: z.string(),
  path: z.string(),
  isDirectory: z.boolean(),
  isFile: z.boolean(),
});
export type DirEntry = z.infer<typeof DirEntrySchema>;

/**
 * Schema for grep match results returned by fs_grep
 */
export const GrepMatchSchema = z.object({
  path: z.string(),
  line: z.string(),
  lineNumber: z.number(),
});
export type GrepMatch = z.infer<typeof GrepMatchSchema>;

// Re-export PathsInfo for backwards compatibility
export type { PathsInfo };

/**
 * Low-level filesystem client that wraps Rust Tauri commands.
 * Provides generic file and directory operations.
 * Business logic should live in higher-level clients that use this.
 */
export class FilesystemClient {
  /**
   * Returns paths info from the Tauri backend, including the data directory.
   * The data directory is the centralized location for all anvil data.
   */
  async getPathsInfo(): Promise<PathsInfo> {
    const raw = await invoke<unknown>("get_paths_info");
    const result = PathsInfoSchema.safeParse(raw);
    if (!result.success) {
      logger.error("[filesystem-client] Failed to parse paths info", {
        error: result.error.message,
        rawPreview: JSON.stringify(raw).slice(0, 200),
      });
      toast.error("Failed to load application paths — data may be corrupted");
      throw new Error("Failed to parse paths info from backend");
    }
    return result.data;
  }

  /**
   * Returns the data directory path (e.g., ~/.anvil or ~/.anvil-dev).
   * This is the centralized location for all anvil data.
   */
  async getDataDir(): Promise<string> {
    const info = await this.getPathsInfo();
    return info.data_dir;
  }

  /**
   * Writes text content to a file, creating parent directories if needed
   */
  async writeFile(path: string, contents: string): Promise<void> {
    await invoke("fs_write_file", { path, contents });
  }

  /**
   * Reads text content from a file
   */
  async readFile(path: string): Promise<string> {
    return invoke<string>("fs_read_file", { path });
  }

  /**
   * Reads and parses a JSON file
   */
  async readJsonFile<T>(path: string): Promise<T> {
    const contents = await this.readFile(path);
    return JSON.parse(contents) as T;
  }

  /**
   * Writes an object as JSON to a file
   */
  async writeJsonFile<T>(path: string, data: T): Promise<void> {
    const contents = JSON.stringify(data, null, 2);
    await this.writeFile(path, contents);
  }

  /**
   * Creates a directory and all parent directories
   */
  async mkdir(path: string): Promise<void> {
    await invoke("fs_mkdir", { path });
  }

  /**
   * Checks if a path exists
   */
  async exists(path: string): Promise<boolean> {
    return invoke<boolean>("fs_exists", { path });
  }

  /**
   * Removes a file or empty directory
   */
  async remove(path: string): Promise<void> {
    await invoke("fs_remove", { path });
  }

  /**
   * Removes a directory and all its contents recursively
   */
  async removeAll(path: string): Promise<void> {
    await invoke("fs_remove_dir_all", { path });
  }

  /**
   * Lists directory contents with metadata
   */
  async listDir(path: string): Promise<DirEntry[]> {
    const raw = await invoke<unknown>("fs_list_dir", { path });
    const result = z.array(DirEntrySchema).safeParse(raw);
    if (!result.success) {
      logger.error("[filesystem-client] Failed to parse dir listing", {
        error: result.error.message,
        rawPreview: JSON.stringify(raw).slice(0, 200),
        path,
      });
      toast.error("Failed to read directory — received corrupted data");
      return [];
    }
    return result.data;
  }

  /**
   * Moves or renames a file or directory
   */
  async move(from: string, to: string): Promise<void> {
    await invoke("fs_move", { from, to });
  }

  /**
   * Copies a single file
   */
  async copyFile(from: string, to: string): Promise<void> {
    await invoke("fs_copy_file", { from, to });
  }

  /**
   * Recursively copies an entire directory tree
   */
  async copyDirectory(from: string, to: string): Promise<void> {
    await invoke("fs_copy_directory", { from, to });
  }

  /**
   * Checks if a directory is a git repository
   */
  async isGitRepo(path: string): Promise<boolean> {
    return invoke<boolean>("fs_is_git_repo", { path });
  }

  /**
   * Creates a git worktree at the specified path.
   * Much faster than copying for git repositories - shares the .git directory.
   */
  async gitWorktreeAdd(repoPath: string, worktreePath: string): Promise<void> {
    await invoke("fs_git_worktree_add", { repoPath, worktreePath });
  }

  /**
   * Removes a git worktree
   */
  async gitWorktreeRemove(
    repoPath: string,
    worktreePath: string
  ): Promise<void> {
    await invoke("fs_git_worktree_remove", { repoPath, worktreePath });
  }

  /**
   * Searches files matching a glob pattern under a directory for lines matching a regex.
   * Single IPC call — all I/O happens in Rust.
   */
  async grep(dir: string, pattern: string, fileGlob: string): Promise<GrepMatch[]> {
    const raw = await invoke<unknown>("fs_grep", { dir, pattern, fileGlob });
    const result = z.array(GrepMatchSchema).safeParse(raw);
    if (!result.success) {
      logger.error("[filesystem-client] Failed to parse grep results", {
        error: result.error.message,
        rawPreview: JSON.stringify(raw).slice(0, 200),
        dir,
        pattern,
        fileGlob,
      });
      toast.error("Failed to search files — received corrupted data");
      return [];
    }
    return result.data;
  }

  /**
   * Reads multiple files in a single IPC call.
   * Returns contents in the same order as paths. Null for files that fail to read.
   */
  async bulkRead(paths: string[]): Promise<(string | null)[]> {
    return invoke<(string | null)[]>("fs_bulk_read", { paths });
  }

  /**
   * Joins path segments using forward slashes
   */
  joinPath(...segments: string[]): string {
    return segments
      .map((s) => s.replace(/\/+$/, ""))
      .filter((s) => s.length > 0)
      .join("/");
  }
}
