import { ResolutionService } from "@core/services/resolution-service.js";
import type { FSAdapter } from "@core/services/fs-adapter.js";
import { join } from "path";
import { logger } from "../lib/logger.js";

/**
 * ThreadWriter handles all writes to thread directories with lazy fallback resolution.
 *
 * Design principles:
 * - O(1) by default: Uses hint path for fast writes
 * - Lazy fallback: Only resolves via scan when hint path is invalid
 * - Cached path: After first successful write, caches path for subsequent writes
 */
export class ThreadWriter {
  private cachedPath: string | null = null;

  constructor(
    private resolution: ResolutionService,
    private fs: FSAdapter,
    private threadId: string
  ) {}

  /**
   * Write to thread directory. O(1) if hintPath valid, O(n) fallback on failure.
   *
   * @param filename - File to write (e.g., "metadata.json", "state.json")
   * @param content - Content to write
   * @param hintPath - Optional path hint (try this first)
   * @returns The actual path written to
   */
  async write(filename: string, content: string, hintPath?: string): Promise<string> {
    const pathToTry = hintPath ?? this.cachedPath;

    // O(1): Try hint/cached path first
    if (pathToTry) {
      try {
        // Verify directory exists before writing
        if (await this.fs.exists(pathToTry)) {
          const filePath = join(pathToTry, filename);
          await this.fs.writeFile(filePath, content);
          this.cachedPath = pathToTry;
          return filePath;
        }
      } catch (err) {
        logger.error(`[ThreadWriter] Write failed at ${pathToTry}, falling back to resolution: ${err}`);
        // Fall through to resolution
      }
    }

    // O(n): Fallback - resolve and retry
    const resolved = await this.resolution.resolveThread(this.threadId, pathToTry ?? undefined);
    if (!resolved) {
      throw new Error(`Thread not found: ${this.threadId}`);
    }

    // Log if path changed (task was renamed)
    if (pathToTry && resolved.threadDir !== pathToTry) {
      logger.warn(`[ThreadWriter] Path changed: ${pathToTry} → ${resolved.threadDir}`);
    }

    const filePath = join(resolved.threadDir, filename);
    await this.fs.writeFile(filePath, content);
    this.cachedPath = resolved.threadDir;
    return filePath;
  }

  /**
   * Write metadata.json to thread directory.
   */
  async writeMetadata(metadata: object, hintPath?: string): Promise<string> {
    return this.write("metadata.json", JSON.stringify(metadata, null, 2), hintPath);
  }

  /**
   * Write state.json to thread directory.
   */
  async writeState(state: object, hintPath?: string): Promise<string> {
    return this.write("state.json", JSON.stringify(state, null, 2), hintPath);
  }

  /**
   * Get current cached path (may be stale if task was renamed).
   */
  getCachedPath(): string | null {
    return this.cachedPath;
  }

  /**
   * Set the cached path directly (used when path is known to be correct).
   */
  setCachedPath(path: string): void {
    this.cachedPath = path;
  }
}
