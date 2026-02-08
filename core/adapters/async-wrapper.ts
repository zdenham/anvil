/**
 * Async wrapper for FileSystemAdapter to provide backward compatibility.
 * Use this during migration to avoid breaking existing consumers that
 * expect the async FSAdapter interface.
 */

import type { FileSystemAdapter } from './types';
import type { FSAdapter, DirEntry } from '../services/fs-adapter';

/**
 * Wraps the new sync FileSystemAdapter to provide the old async interface.
 * Use this during migration to avoid breaking existing consumers.
 *
 * @example
 * ```typescript
 * const syncAdapter = new NodeFileSystemAdapter();
 * const asyncAdapter = new AsyncFileSystemAdapter(syncAdapter);
 *
 * // Now use asyncAdapter with existing code that expects FSAdapter
 * const content = await asyncAdapter.readFile(path);
 * ```
 */
export class AsyncFileSystemAdapter implements FSAdapter {
  constructor(private sync: FileSystemAdapter) {}

  async exists(path: string): Promise<boolean> {
    return this.sync.exists(path);
  }

  async readFile(path: string): Promise<string> {
    return this.sync.readFile(path);
  }

  async writeFile(path: string, content: string): Promise<void> {
    return this.sync.writeFile(path, content);
  }

  async readDir(path: string): Promise<string[]> {
    return this.sync.readDir(path);
  }

  async glob(pattern: string, cwd: string): Promise<string[]> {
    return this.sync.glob(pattern, cwd);
  }

  async mkdir(path: string, recursive?: boolean): Promise<void> {
    return this.sync.mkdir(path, { recursive });
  }

  async listDirWithMetadata(path: string): Promise<DirEntry[]> {
    return this.sync.listDirWithMetadata(path);
  }

  joinPath(...segments: string[]): string {
    return this.sync.joinPath(...segments);
  }
}
