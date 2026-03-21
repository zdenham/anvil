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
import { ptyService } from "@/entities/pty";
import { useSettingsStore } from "@/entities/settings/store";
import { EventName } from "@core/types/events.js";
import type { PermissionModeId } from "@core/types/permissions.js";
import { useMRUWorktreeStore } from "@/stores/mru-worktree-store";
import { spawnSimpleAgent } from "./agent-service";
import { buildSpawnConfig } from "./claude-tui-args-builder";
import { logger } from "./logger-client";
import { toast } from "./toast";

export interface CreateThreadOptions {
  prompt: string;
  repoId: string;
  worktreeId: string;
  worktreePath: string;
  /** Permission mode for tool execution (defaults to "implement" if not provided) */
  permissionMode?: PermissionModeId;
  /** Skip worktree/thread naming (for setup threads) */
  skipNaming?: boolean;
  /** Force managed thread even when preferTerminalInterface is on */
  forceManaged?: boolean;
  /** Force TUI thread even when preferTerminalInterface is off */
  forceTui?: boolean;
}

export interface CreateThreadResult {
  threadId: string;
  taskId: string;
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
  // Route to TUI thread if preference is set (unless explicitly forced)
  const useTerminal = options.forceManaged ? false
    : options.forceTui ? true
    : useSettingsStore.getState().workspace.preferTerminalInterface ?? false;

  if (useTerminal) {
    const result = await createTuiThread({
      repoId: options.repoId,
      worktreeId: options.worktreeId,
      worktreePath: options.worktreePath,
      prompt: options.prompt || undefined,
    });
    return { threadId: result.threadId, taskId: crypto.randomUUID() };
  }

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
    permissionMode: options.permissionMode,
  });

  // Broadcast optimistic create to ALL windows so they have the thread before UI opens
  eventBus.emit(EventName.THREAD_OPTIMISTIC_CREATED, {
    threadId,
    repoId,
    worktreeId,
    prompt,
    status: "running",
    permissionMode: options.permissionMode,
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // PHASE 2: Touch worktree to update lastAccessedAt (non-blocking)
  // ═══════════════════════════════════════════════════════════════════════════

  useMRUWorktreeStore.getState().touchMRU(worktreeId);

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
    permissionMode: options.permissionMode,
    skipNaming: options.skipNaming,
  })
    .then(() => {
      logger.info("[thread-creation-service] Agent spawned successfully", {
        threadId,
        elapsedMs: Date.now() - startTime,
      });
    })
    .catch((err) => {
      const message = err instanceof Error ? err.message : String(err);
      logger.error("[thread-creation-service] Failed to spawn agent", {
        threadId,
        error: message,
      });
      toast.error(message, { duration: 6000 });
      threadService.markError(threadId);
    });

  logger.info("[thread-creation-service] Thread created", {
    threadId,
    taskId,
    elapsedMs: Date.now() - startTime,
  });

  return { threadId, taskId };
}

// ═══════════════════════════════════════════════════════════════════════════
// TUI Thread Creation
// ═══════════════════════════════════════════════════════════════════════════

export interface CreateTuiThreadOptions {
  repoId: string;
  worktreeId: string;
  worktreePath: string;
  /** Optional initial prompt — passed via --message so Claude starts immediately. */
  prompt?: string;
}

export interface CreateTuiThreadResult {
  threadId: string;
  terminalId: string;
}

/**
 * Creates a TUI thread backed by a Claude CLI PTY session.
 *
 * 1. Creates thread with `threadKind: "claude-tui"` and status "running"
 * 2. Builds CLI args via args builder
 * 3. Spawns PTY directly via PtyService (no TerminalSession created)
 * 4. Updates thread with `terminalId` (the pty connectionId)
 * 5. Returns { threadId, terminalId }
 */
export async function createTuiThread(
  options: CreateTuiThreadOptions,
): Promise<CreateTuiThreadResult> {
  const { repoId, worktreeId, worktreePath } = options;
  const threadId = crypto.randomUUID();

  logger.info("[thread-creation-service] Creating TUI thread", {
    threadId,
    repoId,
    worktreeId,
    worktreePath,
    hasPrompt: !!options.prompt,
  });

  // Create thread metadata with threadKind
  const thread = await threadService.create({
    id: threadId,
    repoId,
    worktreeId,
    prompt: options.prompt ?? "",
    threadKind: "claude-tui",
  });

  // Build CLI args
  const spawnConfig = buildSpawnConfig({
    prompt: options.prompt,
  });

  // Spawn PTY directly via PtyService — no TerminalSession entity created
  let spawnResult;
  try {
    spawnResult = await ptyService.spawn({
      cwd: worktreePath,
      cols: 80,
      rows: 24,
      command: "claude",
      args: spawnConfig.args,
      env: Object.keys(spawnConfig.env).length > 0 ? spawnConfig.env : undefined,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error("[thread-creation-service] Failed to spawn Claude TUI", {
      threadId,
      error: message,
    });
    toast.error(`Failed to start Claude session: ${message}`, { duration: 6000 });
    await threadService.markError(threadId);
    throw err;
  }

  // Link the PTY connection to the thread
  await threadService.update(threadId, {
    terminalId: spawnResult.connectionId,
    status: "running",
  });

  useMRUWorktreeStore.getState().touchMRU(worktreeId);

  logger.info("[thread-creation-service] TUI thread created", {
    threadId: thread.id,
    terminalId: spawnResult.connectionId,
    ptyId: spawnResult.ptyId,
  });

  return { threadId: thread.id, terminalId: spawnResult.connectionId };
}
