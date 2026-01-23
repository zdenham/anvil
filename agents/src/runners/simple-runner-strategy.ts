import { mkdirSync, writeFileSync, readFileSync, existsSync, statSync } from "fs";
import { execFileSync } from "child_process";
import { join } from "path";
import { z } from "zod";
import type { RunnerStrategy, RunnerConfig, OrchestrationContext } from "./types.js";
import { emitEvent, emitLog } from "./shared.js";
import {
  ThreadMetadataBaseSchema,
} from "@core/types/threads.js";

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
 * Schema for simple thread metadata.
 * Uses ThreadMetadataBaseSchema with default for isRead.
 */
const SimpleThreadMetadataSchema = ThreadMetadataBaseSchema.transform((data) => ({
  ...data,
  isRead: data.isRead ?? true, // Default to true for backwards compatibility
}));

/** Type derived from schema */
type SimpleThreadMetadata = z.infer<typeof SimpleThreadMetadataSchema>;

/**
 * SimpleRunnerStrategy implements the RunnerStrategy interface for simple agents.
 *
 * Simple agents run in a user-provided working directory without worktree allocation.
 * Each agent run creates or resumes a thread.
 */
export class SimpleRunnerStrategy implements RunnerStrategy {
  /**
   * Parse and validate CLI arguments for simple agent.
   *
   * Required arguments:
   * - --repo-id <uuid>
   * - --worktree-id <uuid>
   * - --cwd <path> (must exist and be a directory)
   * - --thread-id <uuid>
   * - --mort-dir <path>
   * - --prompt <string>
   *
   * Optional arguments:
   * - --history-file <path> (for resuming a thread)
   */
  parseArgs(args: string[]): RunnerConfig {
    const config: Partial<RunnerConfig> = {};

    for (let i = 0; i < args.length; i++) {
      switch (args[i]) {
        case "--repo-id":
          config.repoId = args[++i];
          break;
        case "--worktree-id":
          config.worktreeId = args[++i];
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
        // Ignore deprecated arguments for backwards compatibility
        case "--agent":
        case "--agent-mode":
          i++; // Skip the value
          break;
      }
    }

    // Validate required arguments
    if (!config.repoId) {
      throw new Error("Missing required argument: --repo-id");
    }
    if (!config.worktreeId) {
      throw new Error("Missing required argument: --worktree-id");
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
   * 2. Create threads/{threadId}/ directory
   * 3. Write thread metadata
   * 4. Emit thread:created event
   * 5. Return context with cwd as workingDir
   *
   * For resumed threads (historyFile provided):
   * 1. Validate cwd exists and is accessible
   * 2. Add a new turn to existing thread metadata
   * 3. Emit thread:updated event
   * 4. Return context with cwd as workingDir
   */
  async setup(config: RunnerConfig): Promise<OrchestrationContext> {
    const { cwd, repoId, worktreeId, threadId, mortDir, prompt, historyFile } = config;

    if (!cwd) {
      throw new Error("cwd is required for simple agent");
    }
    if (!repoId) {
      throw new Error("repoId is required for simple agent");
    }
    if (!worktreeId) {
      throw new Error("worktreeId is required for simple agent");
    }

    // 1. Validate cwd exists and is accessible (already validated in parseArgs, but double-check)
    if (!existsSync(cwd)) {
      throw new Error(`Working directory does not exist: ${cwd}`);
    }

    const cwdStat = statSync(cwd);
    if (!cwdStat.isDirectory()) {
      throw new Error(`Path is not a directory: ${cwd}`);
    }
    const threadPath = join(mortDir, "threads", threadId);
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
      // New thread scenario: create thread directory and metadata

      // Create threads/{threadId}/ directory
      try {
        mkdirSync(threadPath, { recursive: true });
      } catch (err) {
        emitLog("ERROR", `Failed to create thread directory: ${threadPath}: ${err}`);
        throw err;
      }

      // Write thread metadata with turns array (matches frontend schema)
      // Capture git info for diff generation if in a git repo
      const initialCommitHash = getHeadCommit(cwd);
      const branch = getCurrentBranch(cwd);

      const threadMetadata: SimpleThreadMetadata = {
        id: threadId,
        repoId,
        worktreeId,
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

      // Emit thread:created event
      emitEvent("thread:created", {
        threadId,
        repoId,
        worktreeId,
      });
    }

    // Return context with cwd as workingDir
    return {
      workingDir: cwd,
      threadId,
      threadPath,
      repoId,
      worktreeId,
    };
  }

  /**
   * Clean up resources on exit.
   *
   * 1. Update thread metadata with final status (completed/error)
   * 2. Emit thread:status:changed event
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

      // 2. Emit thread:status:changed event
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
