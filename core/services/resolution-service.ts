import type { FSAdapter } from "./fs-adapter.js";
import type { TaskResolution, ThreadResolution } from "../types/resolution.js";
import { TaskMetadataSchema } from "../types/tasks.js";
import { ThreadMetadataSchema, type ThreadMetadata } from "@core/types/threads.js";
import { join } from "path";

/**
 * Resolution Service - Path Resolution with Lazy Fallback
 *
 * ## Problem
 * Task slugs can change (rename), but thread writes need correct paths.
 *
 * ## Solution
 * 1. Always try "hint" path first (O(1))
 * 2. Fall back to directory scan only when hint fails (O(n))
 * 3. Cache successful resolution for subsequent writes
 *
 * ## Usage
 * - Pass expected/cached paths as hints
 * - Don't pre-verify paths (lazy verification)
 * - Use task ID as source of truth, not slug
 *
 * Shared resolution logic - same code for both Node.js and Tauri.
 * Platform differences handled by FSAdapter.
 */
export class ResolutionService {
  constructor(
    private fs: FSAdapter,
    private tasksDir: string
  ) {}

  /**
   * Resolve task by ID. O(1) if hintSlug is correct, O(n) fallback otherwise.
   */
  async resolveTask(taskId: string, hintSlug?: string): Promise<TaskResolution | null> {
    // O(1): Try hint first
    if (hintSlug) {
      const result = await this.tryTaskPath(taskId, hintSlug);
      if (result) return result;
    }

    // O(n): Fallback to directory scan
    return this.scanForTask(taskId);
  }

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

  private async tryTaskPath(taskId: string, slug: string): Promise<TaskResolution | null> {
    const metaPath = join(this.tasksDir, slug, "metadata.json");
    if (!await this.fs.exists(metaPath)) return null;

    const meta = TaskMetadataSchema.parse(JSON.parse(await this.fs.readFile(metaPath)));
    if (meta.id !== taskId) return null;

    return {
      taskId,
      slug,
      taskDir: join(this.tasksDir, slug),
      branchName: meta.branchName,
    };
  }

  private async scanForTask(taskId: string): Promise<TaskResolution | null> {
    const dirs = await this.fs.readDir(this.tasksDir);
    for (const slug of dirs) {
      const result = await this.tryTaskPath(taskId, slug);
      if (result) return result;
    }
    return null;
  }

  private async scanForThread(threadId: string): Promise<ThreadResolution | null> {
    const pattern = `*/threads/*-${threadId}/metadata.json`;
    const matches = await this.fs.glob(pattern, this.tasksDir);
    if (matches.length === 0) return null;

    const metaPath = join(this.tasksDir, matches[0]);
    const meta = ThreadMetadataSchema.parse(JSON.parse(await this.fs.readFile(metaPath)));
    return this.buildThreadResolution(
      join(this.tasksDir, matches[0].replace("/metadata.json", "")),
      meta
    );
  }

  private buildThreadResolution(threadDir: string, meta: ThreadMetadata): ThreadResolution {
    // Extract taskSlug from path: tasks/{taskSlug}/threads/{threadFolder}
    const parts = threadDir.split("/");
    const threadsIdx = parts.indexOf("threads");
    const taskSlug = parts[threadsIdx - 1];

    return {
      threadId: meta.id,
      taskId: meta.taskId,
      taskSlug,
      threadDir,
      agentType: meta.agentType,
    };
  }
}
