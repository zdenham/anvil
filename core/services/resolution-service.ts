import type { FSAdapter } from "./fs-adapter.js";
import type { ThreadResolution } from "../types/resolution.js";
import { ThreadMetadataSchema, type ThreadMetadata } from "@core/types/threads.js";
import { join } from "path";

/**
 * Resolution Service - Path Resolution with Lazy Fallback
 *
 * ## Problem
 * Thread paths need to be resolved efficiently.
 *
 * ## Solution
 * 1. Always try "hint" path first (O(1))
 * 2. Fall back to directory scan only when hint fails (O(n))
 * 3. Cache successful resolution for subsequent writes
 *
 * ## Usage
 * - Pass expected/cached paths as hints
 * - Don't pre-verify paths (lazy verification)
 *
 * Shared resolution logic - same code for both Node.js and Tauri.
 * Platform differences handled by FSAdapter.
 */
export class ResolutionService {
  constructor(
    private fs: FSAdapter,
    private threadsDir: string
  ) {}

  /**
   * Resolve thread by ID. O(1) if hintPath provided and valid, O(n) glob fallback.
   */
  async resolveThread(threadId: string, hintPath?: string): Promise<ThreadResolution | null> {
    // O(1): Try hint first
    if (hintPath) {
      const metaPath = join(hintPath, "metadata.json");
      if (await this.fs.exists(metaPath)) {
        const meta = ThreadMetadataSchema.parse(JSON.parse(await this.fs.readFile(metaPath)));
        if (meta.id === threadId) {
          return this.buildThreadResolution(hintPath, meta);
        }
      }
    }

    // O(n): Fallback to glob
    return this.scanForThread(threadId);
  }

  private async scanForThread(threadId: string): Promise<ThreadResolution | null> {
    const pattern = `*-${threadId}/metadata.json`;
    const matches = await this.fs.glob(pattern, this.threadsDir);
    if (matches.length === 0) return null;

    const metaPath = join(this.threadsDir, matches[0]);
    const meta = ThreadMetadataSchema.parse(JSON.parse(await this.fs.readFile(metaPath)));
    return this.buildThreadResolution(
      join(this.threadsDir, matches[0].replace("/metadata.json", "")),
      meta
    );
  }

  private buildThreadResolution(threadDir: string, meta: ThreadMetadata): ThreadResolution {
    return {
      threadId: meta.id,
      threadDir,
    };
  }
}
