import type { FSAdapter, DirEntry } from "../../core/services/fs-adapter";
import { FilesystemClient } from "@/lib/filesystem-client";

/**
 * Tauri/frontend implementation of FSAdapter.
 * Uses FilesystemClient directly for absolute path operations.
 *
 * IMPORTANT: This adapter works with ABSOLUTE paths (e.g., ~/.claude/skills).
 * It does NOT use the persistence module which prepends the data directory.
 */
export class TauriFSAdapter implements FSAdapter {
  private fsClient = new FilesystemClient();

  async exists(path: string): Promise<boolean> {
    return this.fsClient.exists(path);
  }

  async readFile(path: string): Promise<string> {
    return this.fsClient.readFile(path);
  }

  async writeFile(path: string, content: string): Promise<void> {
    return this.fsClient.writeFile(path, content);
  }

  async readDir(path: string): Promise<string[]> {
    const entries = await this.fsClient.listDir(path);
    return entries.map((entry) => entry.name);
  }

  async glob(_pattern: string, _cwd: string): Promise<string[]> {
    // TODO: Implement glob using Tauri fs if needed
    // For now, skill discovery doesn't use glob
    throw new Error("glob not implemented in TauriFSAdapter");
  }

  async mkdir(path: string, _recursive?: boolean): Promise<void> {
    return this.fsClient.mkdir(path);
  }

  async listDirWithMetadata(path: string): Promise<DirEntry[]> {
    return this.fsClient.listDir(path);
  }

  joinPath(...segments: string[]): string {
    return this.fsClient.joinPath(...segments);
  }
}
