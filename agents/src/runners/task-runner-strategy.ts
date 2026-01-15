/**
 * TaskRunnerStrategy for task-based agents (research, execution, merge).
 *
 * This strategy handles orchestration for agents that operate within a task context,
 * including worktree allocation, task metadata management, and thread lifecycle.
 */
import { join } from "path";
import type {
  RunnerStrategy,
  RunnerConfig,
  OrchestrationContext,
  AgentType,
} from "./types.js";
import { emitEvent, emitLog } from "./shared.js";
import { NodeFileSystemAdapter } from "@core/adapters/node/fs-adapter.js";
import { NodeGitAdapter } from "@core/adapters/node/git-adapter.js";
import { NodePathLock } from "@core/adapters/node/path-lock.js";
import type { Logger } from "@core/adapters/types.js";
import { RepositorySettingsService } from "@core/services/repository/settings-service.js";
import { MergeBaseService } from "@core/services/git/merge-base-service.js";
import { TaskMetadataService } from "@core/services/task/metadata-service.js";
import { ThreadService } from "@core/services/thread/thread-service.js";
import { WorktreeAllocationService } from "@core/services/worktree/allocation-service.js";
import { BranchManager } from "@core/services/worktree/branch-manager.js";
import { WorktreePoolManager } from "@core/services/worktree/worktree-pool-manager.js";
import { getThreadFolderName } from "@core/types/threads.js";
import { events } from "../lib/events.js";
import { logger } from "../lib/logger.js";

/** Valid agent types for task-based runners */
const VALID_TASK_AGENTS: AgentType[] = ["research", "execution", "merge"];

/**
 * Internal state for cleanup - tracks resources that need to be released.
 */
interface CleanupState {
  repoName: string;
  threadId: string;
  taskSlug: string;
  threadFolderName: string;
}

/**
 * Adapter to convert the agents logger to the core Logger interface.
 */
function createLoggerAdapter(): Logger {
  return {
    info: (message: string, context?: Record<string, unknown>) => {
      if (context) {
        logger.info(message, context);
      } else {
        logger.info(message);
      }
    },
    warn: (message: string, context?: Record<string, unknown>) => {
      if (context) {
        logger.warn(message, context);
      } else {
        logger.warn(message);
      }
    },
    error: (message: string, context?: Record<string, unknown>) => {
      if (context) {
        logger.error(message, context);
      } else {
        logger.error(message);
      }
    },
    debug: (message: string, context?: Record<string, unknown>) => {
      if (context) {
        logger.debug(message, context);
      } else {
        logger.debug(message);
      }
    },
  };
}

/**
 * TaskRunnerStrategy implements the RunnerStrategy interface for task-based agents.
 *
 * It handles:
 * - Parsing CLI arguments specific to task-based agents
 * - Setting up the execution environment (worktree, thread, task metadata)
 * - Cleaning up resources on exit (releasing worktree, updating thread status)
 */
export class TaskRunnerStrategy implements RunnerStrategy {
  private cleanupState?: CleanupState;
  private mortDir?: string;

  /**
   * Parse and validate CLI arguments for task-based agents.
   *
   * Required arguments:
   * - --agent: One of research, execution, merge
   * - --task-slug: Task identifier
   * - --thread-id: UUID for the thread
   * - --mort-dir: Path to .mort directory
   *
   * Optional arguments:
   * - --prompt: Additional prompt text
   * - --history-file: Path to state.json for resuming
   * - --parent-task-id: Parent task ID for subtask support
   * - --appended-prompt: Override appended prompt
   *
   * @param args - Raw CLI arguments (process.argv.slice(2))
   * @returns Normalized RunnerConfig
   * @throws Error if required arguments are missing or invalid
   */
  parseArgs(args: string[]): RunnerConfig {
    const config: Partial<RunnerConfig> = {};

    for (let i = 0; i < args.length; i++) {
      switch (args[i]) {
        case "--agent":
          config.agent = args[++i] as AgentType;
          break;
        case "--prompt":
          config.prompt = args[++i];
          break;
        case "--thread-id":
          config.threadId = args[++i];
          break;
        case "--task-slug":
          config.taskSlug = args[++i];
          break;
        case "--mort-dir":
          config.mortDir = args[++i];
          break;
        case "--history-file":
          config.historyFile = args[++i];
          break;
        case "--parent-task-id":
          config.parentTaskId = args[++i];
          break;
        case "--appended-prompt":
          config.appendedPrompt = args[++i];
          break;
      }
    }

    // Validate required arguments
    const missing: string[] = [];
    if (!config.agent) missing.push("--agent");
    if (!config.prompt) missing.push("--prompt");
    if (!config.threadId) missing.push("--thread-id");
    if (!config.taskSlug) missing.push("--task-slug");
    if (!config.mortDir) missing.push("--mort-dir");

    if (missing.length > 0) {
      throw new Error(
        `Missing required arguments for task-based agent: ${missing.join(", ")}`
      );
    }

    // Validate agent type
    if (!VALID_TASK_AGENTS.includes(config.agent!)) {
      throw new Error(
        `Invalid agent type "${config.agent}" for task-based runner. ` +
          `Valid options: ${VALID_TASK_AGENTS.join(", ")}`
      );
    }

    return config as RunnerConfig;
  }

  /**
   * Set up the execution environment for a task-based agent.
   *
   * This includes:
   * 1. Loading repository settings
   * 2. Loading task metadata
   * 3. Allocating a worktree (if enabled)
   * 4. Creating a thread record (unless resuming)
   * 5. Emitting lifecycle events
   *
   * @param config - Normalized configuration from parseArgs
   * @returns Context needed for agent execution
   * @throws Error if task metadata cannot be loaded
   * @throws Error if worktree allocation fails
   */
  async setup(config: RunnerConfig): Promise<OrchestrationContext> {
    this.mortDir = config.mortDir;

    // Create adapters
    const fs = new NodeFileSystemAdapter();
    const git = new NodeGitAdapter();
    const pathLock = new NodePathLock();
    const loggerAdapter = createLoggerAdapter();

    // Create services
    const settingsService = new RepositorySettingsService(config.mortDir, fs);
    const mergeBaseService = new MergeBaseService(git);
    const taskMetadataService = new TaskMetadataService(config.mortDir, fs);
    const threadService = new ThreadService(config.mortDir, fs);
    const branchManager = new BranchManager(git, loggerAdapter);
    const poolManager = new WorktreePoolManager(git, config.mortDir);
    const allocationService = new WorktreeAllocationService(
      config.mortDir,
      settingsService,
      mergeBaseService,
      git,
      pathLock,
      branchManager,
      poolManager,
      loggerAdapter
    );

    // Load task metadata
    const taskSlug = config.taskSlug!;
    let taskMeta;
    try {
      taskMeta = taskMetadataService.get(taskSlug);
    } catch (err) {
      const expectedPath = join(
        config.mortDir,
        "tasks",
        taskSlug,
        "metadata.json"
      );
      throw new Error(
        `Failed to load task metadata for "${taskSlug}". ` +
          `Expected file at: ${expectedPath}. ` +
          `Original error: ${err instanceof Error ? err.message : String(err)}`
      );
    }

    const repoName = taskMeta.repositoryName;
    if (!repoName) {
      throw new Error(
        `Task "${taskSlug}" has no repositoryName configured. ` +
          `Please set repositoryName in the task metadata.`
      );
    }

    // Allocate worktree
    let allocation;
    let workingDir: string;
    let mergeBase: string;
    let branchName: string;

    try {
      allocation = allocationService.allocate(repoName, config.threadId, {
        taskId: taskMeta.id,
        taskBranch: taskMeta.branchName,
      });

      workingDir = allocation.worktree.path;
      mergeBase = allocation.mergeBase;
      branchName = allocation.branch || taskMeta.branchName;

      logger.info("[TaskRunnerStrategy] Worktree allocated", {
        worktreePath: workingDir,
        mergeBase,
        desiredBranch: taskMeta.branchName,
        resolvedBranch: branchName,
        isResume: allocation.isResume,
      });

      // Emit worktree allocated event
      events.worktreeAllocated(
        {
          path: allocation.worktree.path,
          currentBranch: allocation.worktree.currentBranch,
        },
        allocation.mergeBase
      );
    } catch (err) {
      // Log warning but fall back to sourcePath
      logger.warn("[TaskRunnerStrategy] Worktree allocation failed, falling back to sourcePath", {
        error: err instanceof Error ? err.message : String(err),
        taskSlug,
        repoName,
      });

      // Emit event for UI awareness
      emitEvent("worktree:allocation_failed", {
        threadId: config.threadId,
        taskSlug,
        error: err instanceof Error ? err.message : String(err),
      });

      // Fall back to sourcePath from settings
      const settings = settingsService.load(repoName);
      workingDir = settings.sourcePath;
      mergeBase = mergeBaseService.compute(
        settings.sourcePath,
        `origin/${settings.defaultBranch}`
      );
      branchName = taskMeta.branchName;
    }

    // Determine thread folder name
    const threadFolderName = getThreadFolderName(config.agent, config.threadId);
    const threadPath = join(
      config.mortDir,
      "tasks",
      taskSlug,
      "threads",
      threadFolderName
    );

    // Create thread record (unless resuming)
    const isResume = Boolean(config.historyFile);
    if (!isResume) {
      const thread = threadService.create(taskSlug, {
        id: config.threadId,
        taskId: taskMeta.id,
        agentType: config.agent,
        workingDirectory: workingDir,
        prompt: config.prompt,
        git: {
          branch: branchName,
        },
      });

      // Emit thread created event
      events.threadCreated(thread.id, taskMeta.id);
      emitEvent("thread:created", {
        threadId: config.threadId,
        taskSlug,
        agent: config.agent,
      });
    }

    // Store cleanup state
    this.cleanupState = {
      repoName,
      threadId: config.threadId,
      taskSlug,
      threadFolderName,
    };

    // Build and return orchestration context
    const context: OrchestrationContext = {
      workingDir,
      task: taskMeta,
      threadId: config.threadId,
      branchName,
      mergeBase,
      threadPath,
      cleanup: () => this.cleanup(context, "completed"),
    };

    emitLog("INFO", `[TaskRunnerStrategy] Setup complete: cwd=${workingDir}, mergeBase=${mergeBase}`);

    return context;
  }

  /**
   * Clean up resources on exit.
   *
   * This includes:
   * 1. Releasing the worktree (if allocated)
   * 2. Updating thread status
   * 3. Emitting lifecycle events
   *
   * Note: This is called on both successful completion and error/signal.
   * Cleanup errors are logged but not thrown (best-effort cleanup).
   *
   * @param context - Context from setup
   * @param status - Final status ("completed" | "error")
   * @param error - Error message if status is "error"
   */
  async cleanup(
    context: OrchestrationContext,
    status: "completed" | "error" | "cancelled",
    error?: string
  ): Promise<void> {
    if (!this.cleanupState || !this.mortDir) {
      logger.warn("[TaskRunnerStrategy] Cleanup called without setup state");
      return;
    }

    const { repoName, threadId, taskSlug, threadFolderName } = this.cleanupState;

    // Release worktree
    try {
      const fs = new NodeFileSystemAdapter();
      const git = new NodeGitAdapter();
      const pathLock = new NodePathLock();
      const loggerAdapter = createLoggerAdapter();
      const settingsService = new RepositorySettingsService(this.mortDir, fs);
      const mergeBaseService = new MergeBaseService(git);
      const branchManager = new BranchManager(git, loggerAdapter);
      const poolManager = new WorktreePoolManager(git, this.mortDir);
      const allocationService = new WorktreeAllocationService(
        this.mortDir,
        settingsService,
        mergeBaseService,
        git,
        pathLock,
        branchManager,
        poolManager,
        loggerAdapter
      );

      allocationService.release(repoName, threadId);
      events.worktreeReleased(threadId);
      emitEvent("worktree:released", {
        threadId,
        worktreePath: context.workingDir,
      });

      logger.info("[TaskRunnerStrategy] Worktree released", {
        threadId,
        repoName,
      });
    } catch (err) {
      logger.error("[TaskRunnerStrategy] Failed to release worktree", {
        error: err instanceof Error ? err.message : String(err),
        threadId,
        repoName,
      });
      // Don't throw - cleanup should be best-effort
    }

    // Update thread status
    try {
      const fs = new NodeFileSystemAdapter();
      const threadService = new ThreadService(this.mortDir, fs);

      if (status === "completed") {
        threadService.markCompleted(taskSlug, threadFolderName);
      } else if (status === "cancelled") {
        threadService.markCancelled(taskSlug, threadFolderName);
      } else {
        threadService.markError(taskSlug, threadFolderName);
      }

      events.threadStatusChanged(threadId, status);
      emitEvent("thread:status:changed", { threadId, status });

      logger.info("[TaskRunnerStrategy] Thread status updated", {
        threadId,
        status,
      });
    } catch (err) {
      logger.error("[TaskRunnerStrategy] Failed to update thread status", {
        error: err instanceof Error ? err.message : String(err),
        threadId,
        status,
      });
      // Don't throw - cleanup should be best-effort
    }

    // Log error if provided
    if (error) {
      emitLog("ERROR", `[TaskRunnerStrategy] Cleanup after error: ${error}`);
    }
  }
}
