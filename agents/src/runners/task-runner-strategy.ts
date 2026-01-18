/**
 * TaskRunnerStrategy for task-based agents (research, execution, merge).
 *
 * This strategy handles agents that work on tasks with explicit worktree management.
 * The UI selects a worktree and passes it via --worktree-path.
 */
import { mkdirSync, writeFileSync, readFileSync, existsSync, statSync } from "fs";
import { execFileSync } from "child_process";
import { join } from "path";
import { z } from "zod";
import type {
  RunnerStrategy,
  RunnerConfig,
  OrchestrationContext,
  AgentType,
} from "./types.js";
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
 * Get the merge base between the current branch and the default branch.
 * Used for diff generation against the base branch.
 */
function getMergeBase(cwd: string, baseBranch: string): string | undefined {
  try {
    return execFileSync("git", ["merge-base", "HEAD", baseBranch], {
      cwd,
      encoding: "utf-8",
    }).trim();
  } catch {
    return undefined;
  }
}

/**
 * Get the default branch (main or master).
 */
function getDefaultBranch(cwd: string): string {
  try {
    // Check for main first, then master
    execFileSync("git", ["rev-parse", "--verify", "main"], {
      cwd,
      encoding: "utf-8",
      stdio: "pipe",
    });
    return "main";
  } catch {
    try {
      execFileSync("git", ["rev-parse", "--verify", "master"], {
        cwd,
        encoding: "utf-8",
        stdio: "pipe",
      });
      return "master";
    } catch {
      return "main"; // Default to main if neither exists
    }
  }
}

/**
 * Schema for task thread metadata with stricter typing.
 */
const TaskThreadMetadataSchema = ThreadMetadataBaseSchema.omit({
  ttlMs: true,
}).transform((data) => ({
  ...data,
  isRead: data.isRead ?? true,
}));

type TaskThreadMetadata = z.infer<typeof TaskThreadMetadataSchema>;

/**
 * TaskRunnerStrategy implements the RunnerStrategy interface for task-based agents.
 *
 * Task-based agents work on tasks with explicit worktree management:
 * - UI selects a worktree and passes it via --worktree-path
 * - Strategy validates the worktree exists
 * - Agent runs in the worktree directory
 */
export class TaskRunnerStrategy implements RunnerStrategy {
  /**
   * Parse and validate CLI arguments for task-based agent.
   *
   * Required arguments:
   * - --agent <research|execution|merge>
   * - --task-slug <slug>
   * - --thread-id <uuid>
   * - --mort-dir <path>
   * - --prompt <string>
   * - --worktree-path <path> (required - explicit worktree management)
   *
   * Optional arguments:
   * - --history-file <path> (for resuming a thread)
   * - --appended-prompt <string> (for merge agent with dynamic context)
   */
  parseArgs(args: string[]): RunnerConfig {
    const config: Partial<RunnerConfig> = {};

    for (let i = 0; i < args.length; i++) {
      switch (args[i]) {
        case "--agent":
          config.agent = args[++i] as AgentType;
          break;
        case "--task-slug":
          config.taskSlug = args[++i];
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
        case "--worktree-path":
          config.worktreePath = args[++i];
          break;
        case "--history-file":
          config.historyFile = args[++i];
          break;
        case "--appended-prompt":
          config.appendedPrompt = args[++i];
          break;
      }
    }

    // Validate agent type
    if (!config.agent || !["research", "execution", "merge"].includes(config.agent)) {
      throw new Error(
        `TaskRunnerStrategy requires agent type to be research, execution, or merge, got: ${config.agent}`
      );
    }

    // Validate required arguments
    if (!config.taskSlug) {
      throw new Error("Missing required argument: --task-slug");
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
    if (!config.worktreePath) {
      throw new Error("Missing required argument: --worktree-path (explicit worktree management required)");
    }

    // Validate worktree path exists
    if (!existsSync(config.worktreePath)) {
      throw new Error(`Worktree path does not exist: ${config.worktreePath}`);
    }

    const worktreeStat = statSync(config.worktreePath);
    if (!worktreeStat.isDirectory()) {
      throw new Error(`Worktree path is not a directory: ${config.worktreePath}`);
    }

    return config as RunnerConfig;
  }

  /**
   * Set up the execution environment for task-based agent.
   *
   * 1. Load task metadata from disk
   * 2. Create thread folder and metadata
   * 3. Emit thread:created event
   * 4. Return context with worktree as workingDir
   */
  async setup(config: RunnerConfig): Promise<OrchestrationContext> {
    const { taskSlug, threadId, mortDir, prompt, worktreePath, historyFile, agent } = config;

    if (!taskSlug) {
      throw new Error("taskSlug is required for task-based agent");
    }
    if (!worktreePath) {
      throw new Error("worktreePath is required for task-based agent");
    }

    // 1. Load task metadata
    const taskPath = join(mortDir, "tasks", taskSlug);
    const taskMetadataPath = join(taskPath, "metadata.json");

    if (!existsSync(taskMetadataPath)) {
      throw new Error(`Task not found: ${taskSlug}`);
    }

    const taskRaw = JSON.parse(readFileSync(taskMetadataPath, "utf-8"));
    const taskResult = TaskMetadataSchema.safeParse(taskRaw);
    if (!taskResult.success) {
      throw new Error(`Invalid task metadata: ${taskResult.error.message}`);
    }
    const task = taskResult.data;

    // 2. Set up thread folder
    const threadFolderName = `${agent}-${threadId}`;
    const threadPath = join(taskPath, "threads", threadFolderName);
    const threadMetadataPath = join(threadPath, "metadata.json");
    const now = Date.now();

    // Check if this is a resume scenario
    const isResume = historyFile && existsSync(threadMetadataPath);

    // Get git info from the worktree
    const initialCommitHash = getHeadCommit(worktreePath);
    const defaultBranch = getDefaultBranch(worktreePath);
    const mergeBase = getMergeBase(worktreePath, defaultBranch);

    if (isResume) {
      // Resume scenario: add a new turn to existing thread
      emitLog("INFO", `Resuming existing thread ${threadId}`);

      try {
        const existingContent = readFileSync(threadMetadataPath, "utf-8");
        const parseResult = TaskThreadMetadataSchema.safeParse(JSON.parse(existingContent));

        if (parseResult.success) {
          const existingMetadata = parseResult.data;
          const newTurnIndex = existingMetadata.turns.length;

          const updatedMetadata: TaskThreadMetadata = {
            ...existingMetadata,
            status: "running",
            updatedAt: now,
            pid: process.pid,
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

          emitEvent("thread:updated", {
            threadId,
            taskId: task.id,
            agent,
            worktreePath,
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
      // New thread scenario: create thread from scratch
      mkdirSync(threadPath, { recursive: true });

      const threadMetadata: TaskThreadMetadata = {
        id: threadId,
        taskId: task.id,
        agentType: agent ?? "research",
        workingDirectory: worktreePath,
        worktreePath, // Store explicit worktree path
        status: "running",
        createdAt: now,
        updatedAt: now,
        pid: process.pid,
        isRead: true,
        ...(initialCommitHash && task.branchName ? {
          git: {
            branch: task.branchName,
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

      emitEvent("thread:created", {
        threadId,
        taskId: task.id,
        agent,
        worktreePath,
      });
    }

    // Update task to in-progress
    const updatedTask: TaskMetadata = {
      ...task,
      status: "in-progress",
      updatedAt: now,
    };
    writeFileSync(taskMetadataPath, JSON.stringify(updatedTask, null, 2));
    emitEvent("task:status:changed", { taskId: task.id, status: "in-progress" });

    return {
      workingDir: worktreePath,
      task,
      threadId,
      branchName: task.branchName ?? undefined,
      mergeBase,
      threadPath,
    };
  }

  /**
   * Clean up resources on exit.
   *
   * 1. Update thread metadata with final status
   * 2. Emit thread:status:changed event
   */
  async cleanup(
    context: OrchestrationContext,
    status: "completed" | "error" | "cancelled",
    error?: string
  ): Promise<void> {
    const { threadPath, threadId, task } = context;
    const now = Date.now();

    try {
      // 1. Update thread metadata
      const threadMetadataPath = join(threadPath, "metadata.json");
      if (existsSync(threadMetadataPath)) {
        const existingContent = readFileSync(threadMetadataPath, "utf-8");
        const parseResult = TaskThreadMetadataSchema.safeParse(JSON.parse(existingContent));

        if (parseResult.success) {
          const turns = [...parseResult.data.turns];
          if (turns.length > 0) {
            turns[turns.length - 1] = {
              ...turns[turns.length - 1],
              completedAt: now,
            };
          }

          const updated: TaskThreadMetadata = {
            ...parseResult.data,
            status: status === "completed" ? "completed" : status === "cancelled" ? "cancelled" : "error",
            updatedAt: now,
            pid: null,
            turns,
          };
          writeFileSync(threadMetadataPath, JSON.stringify(updated, null, 2));
        } else {
          emitLog("ERROR", `Invalid thread metadata during cleanup: ${parseResult.error.message}`);
        }
      }

      // 2. Emit thread:status:changed event
      emitEvent("thread:status:changed", {
        threadId,
        status,
        ...(error && { error }),
      });

      // Note: We don't update task status here because:
      // - A task can have multiple threads
      // - Task status should be managed based on all thread states
      // - The UI handles task status transitions based on business logic

    } catch (err) {
      emitLog(
        "ERROR",
        `Failed during cleanup: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }
}
