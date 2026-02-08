/**
 * Thread Creation Service
 *
 * Shared service for creating threads with optimistic UI and spawning agents.
 * Used by:
 * - Spotlight: For creating threads from the spotlight command palette
 * - EmptyPaneContent: For creating threads from the empty pane state
 *
 * This service handles:
 * - Thread ID generation
 * - Optimistic thread creation in the store
 * - Broadcasting THREAD_OPTIMISTIC_CREATED event
 * - Spawning the agent process (non-blocking)
 * - Updating worktree lastAccessedAt (for MRU sorting)
 */

import { threadService, eventBus } from "@/entities";
import { worktreeService } from "@/entities/worktrees";
import { EventName } from "@core/types/events.js";
import { spawnSimpleAgent } from "./agent-service";
import { loadSettings } from "./app-data-store";
import { logger } from "./logger-client";

export interface CreateThreadOptions {
  prompt: string;
  repoId: string;
  worktreeId: string;
  worktreePath: string;
}

export interface CreateThreadResult {
  threadId: string;
  taskId: string;
}

/**
 * Slugifies a repository name for use in paths.
 */
function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Creates a new thread with optimistic UI and spawns an agent.
 *
 * Uses optimistic UI pattern for instant feedback:
 * 1. Create thread metadata in store immediately (optimistic)
 * 2. Broadcast THREAD_OPTIMISTIC_CREATED so all windows have the thread
 * 3. Spawn agent in background (non-blocking)
 * 4. Return { threadId, taskId }
 *
 * The runner will update thread metadata on disk, which will be picked up
 * by listeners when THREAD_UPDATED events arrive.
 *
 * @param options - The thread creation options
 * @returns The created thread's ID and task ID
 */
export async function createThread(
  options: CreateThreadOptions
): Promise<CreateThreadResult> {
  const { prompt, repoId, worktreeId, worktreePath } = options;
  const startTime = Date.now();

  logger.info("[thread-creation-service] Creating thread", {
    repoId,
    worktreeId,
    worktreePath,
    promptLength: prompt.length,
  });

  const taskId = crypto.randomUUID();
  const threadId = crypto.randomUUID();

  // ═══════════════════════════════════════════════════════════════════════════
  // PHASE 1: Optimistic UI - Create thread in store and broadcast IMMEDIATELY
  // ═══════════════════════════════════════════════════════════════════════════

  logger.info("[thread-creation-service] Creating optimistic thread", {
    threadId,
    taskId,
  });

  threadService.createOptimistic({
    id: threadId,
    repoId,
    worktreeId,
    status: "running", // Mark as running since agent will start immediately
    prompt, // Include first message for immediate display
  });

  // Broadcast optimistic create to ALL windows so they have the thread before UI opens
  eventBus.emit(EventName.THREAD_OPTIMISTIC_CREATED, {
    threadId,
    repoId,
    worktreeId,
    prompt,
    status: "running",
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // PHASE 2: Touch worktree to update lastAccessedAt (non-blocking)
  // ═══════════════════════════════════════════════════════════════════════════

  // We need the repo name to touch the worktree - look it up from settings
  // This is fire-and-forget, doesn't block thread creation
  (async () => {
    try {
      // Find repo name by iterating through known repos
      // This is a bit awkward but necessary since we only have the UUID
      const { repoService } = await import("@/entities/repositories");
      const repos = repoService.getAll();
      for (const repo of repos) {
        const slug = slugify(repo.name);
        try {
          const settings = await loadSettings(slug);
          if (settings.id === repoId) {
            await worktreeService.touch(repo.name, worktreePath);
            logger.debug("[thread-creation-service] Touched worktree", {
              repoName: repo.name,
              worktreePath,
            });
            break;
          }
        } catch {
          // Skip repos that fail to load settings
        }
      }
    } catch (err) {
      logger.warn("[thread-creation-service] Failed to touch worktree (non-fatal)", err);
    }
  })();

  // ═══════════════════════════════════════════════════════════════════════════
  // PHASE 3: Spawn Agent - Non-blocking, runs in background
  // ═══════════════════════════════════════════════════════════════════════════

  logger.info("[thread-creation-service] Spawning agent in background", {
    threadId,
    worktreePath,
  });

  // Don't await - spawn in background for instant UI feedback
  spawnSimpleAgent({
    repoId,
    worktreeId,
    threadId,
    prompt,
    sourcePath: worktreePath,
  })
    .then(() => {
      logger.info("[thread-creation-service] Agent spawned successfully", {
        threadId,
        elapsedMs: Date.now() - startTime,
      });
    })
    .catch((err) => {
      logger.error("[thread-creation-service] Failed to spawn agent", {
        threadId,
        error: err instanceof Error ? err.message : String(err),
      });
      // Note: The optimistic thread will remain in the store with "running" status
      // until the next disk refresh replaces it or it times out
    });

  logger.info("[thread-creation-service] Thread created", {
    threadId,
    taskId,
    elapsedMs: Date.now() - startTime,
  });

  return { threadId, taskId };
}
