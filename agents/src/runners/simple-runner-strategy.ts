import { mkdirSync, writeFileSync, readFileSync, existsSync, statSync } from "fs";
import { execFileSync } from "child_process";
import { join } from "path";
import { z } from "zod";
import type { RunnerStrategy, RunnerConfig, OrchestrationContext } from "./types.js";
import type { AgentMode } from "@core/types/agent-mode.js";
import { emitEvent, emitLog } from "./shared.js";
import {
  ThreadMetadataBaseSchema,
} from "@core/types/threads.js";
import { TaskMetadataSchema, type TaskMetadata } from "@core/types/tasks.js";

/**
 * Get the current HEAD commit hash.
 * Returns undefined if not in a git repo or git command fails.
 */
function getHeadCommit(cwd: string): string | undefined {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], {
      cwd,
      encoding: "utf-8",
    }).trim();
  } catch {
    return undefined;
  }
}

/**
 * Get the current git branch name.
 * Returns undefined if not in a git repo or git command fails.
 */
function getCurrentBranch(cwd: string): string | undefined {
  try {
    return execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
      cwd,
      encoding: "utf-8",
    }).trim();
  } catch {
    return undefined;
  }
}

/**
 * Schema for simple thread metadata with stricter typing.
 * Derives from ThreadMetadataBaseSchema, omitting fields not used by simple threads
 * and narrowing agentType to "simple".
 */
const SimpleThreadMetadataSchema = ThreadMetadataBaseSchema.omit({
  ttlMs: true,
  agentType: true,
}).extend({
  /** Agent type - always "simple" for simple threads */
  agentType: z.literal("simple"),
}).transform((data) => ({
  ...data,
  isRead: data.isRead ?? true, // Default to true for backwards compatibility
}));

/** Type derived from schema */
type SimpleThreadMetadata = z.infer<typeof SimpleThreadMetadataSchema>;

/**
 * SimpleRunnerStrategy implements the RunnerStrategy interface for simple agents.
 *
 * Simple agents run in a user-provided working directory without task orchestration,
 * worktree allocation, or git-based file tracking.
 */
export class SimpleRunnerStrategy implements RunnerStrategy {
  /**
   * Parse and validate CLI arguments for simple agent.
   *
   * Required arguments:
   * - --agent simple
   * - --task-id <uuid>
   * - --cwd <path> (must exist and be a directory)
   * - --thread-id <uuid>
   * - --mort-dir <path>
   * - --prompt <string>
   *
   * Optional arguments:
   * - --history-file <path> (for resuming a thread)
   */
  parseArgs(args: string[]): RunnerConfig {
    const config: Partial<RunnerConfig> = {
      agent: "simple",
    };

    for (let i = 0; i < args.length; i++) {
      switch (args[i]) {
        case "--agent":
          // Validate agent type is "simple"
          const agentType = args[++i];
          if (agentType !== "simple") {
            throw new Error(
              `SimpleRunnerStrategy only handles simple agent type, got: ${agentType}`
            );
          }
          config.agent = "simple";
          break;
        case "--task-id":
          config.taskId = args[++i];
          break;
        case "--cwd":
          config.cwd = args[++i];
          break;
        case "--thread-id":
          config.threadId = args[++i];
          break;
        case "--mort-dir":
          config.mortDir = args[++i];
          break;
        case "--prompt":
          config.prompt = args[++i];
          break;
        case "--history-file":
          config.historyFile = args[++i];
          break;
        case "--agent-mode":
          config.agentMode = args[++i] as AgentMode;
          break;
      }
    }

    // Validate required arguments
    if (!config.taskId) {
      throw new Error("Missing required argument: --task-id");
    }
    if (!config.cwd) {
      throw new Error("Missing required argument: --cwd");
    }
    if (!config.threadId) {
      throw new Error("Missing required argument: --thread-id");
    }
    if (!config.mortDir) {
      throw new Error("Missing required argument: --mort-dir");
    }
    if (!config.prompt) {
      throw new Error("Missing required argument: --prompt");
    }

    // Validate --cwd exists
    if (!existsSync(config.cwd)) {
      throw new Error(`Working directory does not exist: ${config.cwd}`);
    }

    // Validate --cwd is a directory
    const cwdStat = statSync(config.cwd);
    if (!cwdStat.isDirectory()) {
      throw new Error(`Path is not a directory: ${config.cwd}`);
    }

    return config as RunnerConfig;
  }

  /**
   * Set up the execution environment for simple agent.
   *
   * For new threads:
   * 1. Validate cwd exists and is accessible
   * 2. Create tasks/{taskId}/ directory
   * 3. Write task metadata to tasks/{taskId}/metadata.json
   * 4. Create tasks/{taskId}/threads/simple-{threadId}/ directory
   * 5. Write thread metadata
   * 6. Emit thread:created event
   * 7. Return context with cwd as workingDir
   *
   * For resumed threads (historyFile provided):
   * 1. Validate cwd exists and is accessible
   * 2. Add a new turn to existing thread metadata
   * 3. Emit thread:updated event
   * 4. Return context with cwd as workingDir
   */
  async setup(config: RunnerConfig): Promise<OrchestrationContext> {
    const { cwd, taskId, threadId, mortDir, prompt, historyFile } = config;

    if (!cwd) {
      throw new Error("cwd is required for simple agent");
    }
    if (!taskId) {
      throw new Error("taskId is required for simple agent");
    }

    // 1. Validate cwd exists and is accessible (already validated in parseArgs, but double-check)
    if (!existsSync(cwd)) {
      throw new Error(`Working directory does not exist: ${cwd}`);
    }

    const cwdStat = statSync(cwd);
    if (!cwdStat.isDirectory()) {
      throw new Error(`Path is not a directory: ${cwd}`);
    }

    const taskPath = join(mortDir, "tasks", taskId);
    const threadFolderName = `simple-${threadId}`;
    const threadPath = join(taskPath, "threads", threadFolderName);
    const threadMetadataPath = join(threadPath, "metadata.json");
    const now = Date.now();

    // Check if this is a resume scenario (historyFile provided and thread metadata exists)
    const isResume = historyFile && existsSync(threadMetadataPath);

    if (isResume) {
      // Resume scenario: add a new turn to existing thread
      emitLog("INFO", `Resuming existing thread ${threadId}`);

      try {
        const existingContent = readFileSync(threadMetadataPath, "utf-8");
        const parseResult = SimpleThreadMetadataSchema.safeParse(JSON.parse(existingContent));

        if (parseResult.success) {
          const existingMetadata = parseResult.data;
          const newTurnIndex = existingMetadata.turns.length;

          const updatedMetadata: SimpleThreadMetadata = {
            ...existingMetadata,
            status: "running",
            updatedAt: now,
            pid: process.pid, // Write our own PID for cross-window cancellation
            turns: [
              ...existingMetadata.turns,
              {
                index: newTurnIndex,
                prompt,
                startedAt: now,
                completedAt: null,
              },
            ],
          };

          writeFileSync(threadMetadataPath, JSON.stringify(updatedMetadata, null, 2));

          // Emit thread:updated event (not thread:created)
          emitEvent("thread:updated", {
            threadId,
            taskId,
            agent: "simple",
            cwd,
          });
        } else {
          emitLog("ERROR", `Invalid thread metadata during resume: ${parseResult.error.message}`);
          throw new Error("Failed to resume: invalid thread metadata");
        }
      } catch (err) {
        if (err instanceof Error && err.message.includes("Failed to resume")) {
          throw err;
        }
        emitLog("ERROR", `Failed to read thread metadata during resume: ${err}`);
        throw new Error("Failed to resume: could not read thread metadata");
      }
    } else {
      // New thread scenario: create task and thread from scratch

      // 2. Create tasks/{taskId}/ directory
      try {
        mkdirSync(taskPath, { recursive: true });
      } catch (err) {
        emitLog("ERROR", `Failed to create task directory: ${taskPath}: ${err}`);
        throw err;
      }

      // 3. Write task metadata (unified format compatible with TaskMetadataSchema)
      // Check if task metadata already exists (e.g., created by test harness) and preserve repositoryName
      const taskMetadataPath = join(taskPath, "metadata.json");
      let existingRepositoryName: string | undefined;
      if (existsSync(taskMetadataPath)) {
        try {
          const existingTaskContent = readFileSync(taskMetadataPath, "utf-8");
          const existingTask = JSON.parse(existingTaskContent);
          existingRepositoryName = existingTask.repositoryName;
        } catch {
          // Ignore errors reading existing metadata
        }
      }

      const taskMetadata = {
        id: taskId,
        slug: taskId,                    // Use taskId as slug (simple tasks don't have title-based slugs)
        type: "simple" as const,
        title: prompt.slice(0, 100),     // First 100 chars of prompt as title
        description: prompt,             // Preserve full prompt in description
        status: "in-progress" as const,
        cwd,                             // Working directory
        branchName: null,                // No branch for simple tasks
        subtasks: [],
        parentId: null,
        tags: [],
        sortOrder: now,
        createdAt: now,
        updatedAt: now,
        pendingReviews: [],
        // Preserve repositoryName if it was set by test harness or external tooling
        ...(existingRepositoryName && { repositoryName: existingRepositoryName }),
      };

      writeFileSync(taskMetadataPath, JSON.stringify(taskMetadata, null, 2));

      // 4. Create tasks/{taskId}/threads/simple-{threadId}/ directory
      try {
        mkdirSync(threadPath, { recursive: true });
      } catch (err) {
        emitLog("ERROR", `Failed to create thread directory: ${threadPath}: ${err}`);
        throw err;
      }

      // 5. Write thread metadata with turns array (matches frontend schema)
      // Capture git info for diff generation if in a git repo
      const initialCommitHash = getHeadCommit(cwd);
      const branch = getCurrentBranch(cwd);

      const threadMetadata: SimpleThreadMetadata = {
        id: threadId,
        taskId,
        agentType: "simple",
        workingDirectory: cwd,
        status: "running",
        createdAt: now,
        updatedAt: now,
        pid: process.pid, // Write our own PID for cross-window cancellation
        isRead: true,
        // Capture git info for diff generation (if in a git repo)
        ...(initialCommitHash && branch ? {
          git: {
            branch,
            initialCommitHash,
          },
        } : {}),
        turns: [
          {
            index: 0,
            prompt,
            startedAt: now,
            completedAt: null,
          },
        ],
      };

      writeFileSync(threadMetadataPath, JSON.stringify(threadMetadata, null, 2));

      // 6. Emit task:created and thread:created events
      emitEvent("task:created", { taskId });
      emitEvent("thread:created", {
        threadId,
        taskId,
        agent: "simple",
        cwd,
      });
    }

    // 7. Return context with cwd as workingDir
    // Read task metadata to include in context
    let taskForContext: TaskMetadata | undefined;
    const taskMetadataPathForContext = join(taskPath, "metadata.json");
    if (existsSync(taskMetadataPathForContext)) {
      try {
        const taskContent = readFileSync(taskMetadataPathForContext, "utf-8");
        const parseResult = TaskMetadataSchema.safeParse(JSON.parse(taskContent));
        if (parseResult.success) {
          taskForContext = parseResult.data;
        }
      } catch {
        // Ignore errors reading task metadata
      }
    }

    return {
      workingDir: cwd,
      threadId,
      threadPath,
      task: taskForContext,
      // No branchName for simple agents
      // No mergeBase for simple agents
    };
  }

  /**
   * Clean up resources on exit.
   *
   * 1. Update thread metadata with final status (completed/error)
   * 2. Update task metadata with final status (done/cancelled)
   * 3. Emit thread:status:changed event
   *
   * Note: No worktree to release for simple agents
   */
  async cleanup(
    context: OrchestrationContext,
    status: "completed" | "error" | "cancelled",
    error?: string
  ): Promise<void> {
    const { threadPath, threadId } = context;
    const now = Date.now();

    try {
      // 1. Update thread metadata
      const threadMetadataPath = join(threadPath, "metadata.json");
      if (existsSync(threadMetadataPath)) {
        const existingContent = readFileSync(threadMetadataPath, "utf-8");
        const parseResult = SimpleThreadMetadataSchema.safeParse(JSON.parse(existingContent));

        if (parseResult.success) {
          // Update the last turn's completedAt timestamp
          const turns = [...parseResult.data.turns];
          if (turns.length > 0) {
            turns[turns.length - 1] = {
              ...turns[turns.length - 1],
              completedAt: now,
            };
          }

          const updated: SimpleThreadMetadata = {
            ...parseResult.data,
            status: status === "completed" ? "completed" : status === "cancelled" ? "cancelled" : "error",
            updatedAt: now,
            pid: null, // Clear PID - process is exiting
            turns,
          };
          writeFileSync(threadMetadataPath, JSON.stringify(updated, null, 2));
        } else {
          emitLog("ERROR", `Invalid thread metadata during cleanup: ${parseResult.error.message}`);
        }
      } else {
        emitLog("WARN", `Thread metadata not found during cleanup: ${threadMetadataPath}`);
      }

      // 2. Update task metadata using unified schema
      // threadPath is: tasks/{taskId}/threads/simple-{threadId}
      // taskPath is: tasks/{taskId}
      const taskPath = join(threadPath, "..", "..");
      const taskMetadataPath = join(taskPath, "metadata.json");
      // Extract taskId from thread path for fallback
      const taskId = taskPath.split("/").pop() ?? "unknown";

      if (existsSync(taskMetadataPath)) {
        const existingContent = readFileSync(taskMetadataPath, "utf-8");
        let jsonContent: unknown;
        try {
          jsonContent = JSON.parse(existingContent);
        } catch (e) {
          emitLog("ERROR", `Failed to parse task metadata JSON: ${e}`);
          jsonContent = null;
        }

        if (jsonContent) {
          const parseResult = TaskMetadataSchema.safeParse(jsonContent);

          if (parseResult.success) {
            const updated = {
              ...parseResult.data,
              status: status === "completed" ? "done" : status === "cancelled" ? "cancelled" : "cancelled",
              updatedAt: now,
            };
            writeFileSync(taskMetadataPath, JSON.stringify(updated, null, 2));
          } else {
            emitLog("ERROR", `Invalid task metadata during cleanup: ${parseResult.error.message}`);
            // Fallback: write minimal valid metadata to unstick the task
            // This prevents tasks from being stuck in "in-progress" indefinitely
            const fallbackMetadata = {
              id: taskId,
              slug: taskId,
              type: "simple" as const,
              title: "Task (recovered)",
              status: status === "completed" ? "done" : status === "cancelled" ? "cancelled" : "cancelled",
              branchName: null,
              subtasks: [],
              parentId: null,
              tags: [],
              sortOrder: now,
              createdAt: now,
              updatedAt: now,
              pendingReviews: [],
            };
            writeFileSync(taskMetadataPath, JSON.stringify(fallbackMetadata, null, 2));
            emitLog("WARN", `Wrote fallback metadata for task ${taskId}`);
          }
        }
      } else {
        emitLog("WARN", `Task metadata not found during cleanup: ${taskMetadataPath}`);
      }

      // 3. Emit thread:status:changed event
      emitEvent("thread:status:changed", {
        threadId,
        status,
        ...(error && { error }),
      });
    } catch (err) {
      // Log error but do not rethrow (best-effort cleanup)
      emitLog(
        "ERROR",
        `Failed during cleanup: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }
}
