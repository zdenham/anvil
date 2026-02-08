import { mkdirSync, writeFileSync, readFileSync, existsSync, statSync, readdirSync } from "fs";
import { execFileSync } from "child_process";
import { join } from "path";
import { z } from "zod";
import type { RunnerStrategy, RunnerConfig, OrchestrationContext } from "./types.js";
import { emitEvent, emitLog } from "./shared.js";
import {
  ThreadMetadataBaseSchema,
} from "@core/types/threads.js";
import { RepositorySettingsSchema } from "@core/types/repositories.js";
import { generateThreadName } from "../services/thread-naming-service.js";
import { generateWorktreeName } from "../services/worktree-naming-service.js";
import { events } from "../lib/events.js";
import { NodeGitAdapter } from "@core/adapters/node/git-adapter.js";

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
 * Check if a worktree has already been renamed by looking up repository settings from disk.
 * Scans all repositories in mortDir/repositories/ to find the one matching repoId,
 * then looks up the worktree by worktreeId to check its isRenamed flag.
 *
 * @returns true if the worktree has been renamed, false otherwise (including on any errors)
 */
function isWorktreeRenamed(mortDir: string, repoId: string, worktreeId: string): boolean {
  try {
    const reposDir = join(mortDir, "repositories");
    if (!existsSync(reposDir)) {
      return false;
    }

    // Scan all repository directories to find the one with matching repoId
    const repoDirs = readdirSync(reposDir).filter(name => {
      const stat = statSync(join(reposDir, name));
      return stat.isDirectory();
    });

    for (const repoDir of repoDirs) {
      const settingsPath = join(reposDir, repoDir, "settings.json");
      if (!existsSync(settingsPath)) {
        continue;
      }

      try {
        const content = readFileSync(settingsPath, "utf-8");
        const parsed = RepositorySettingsSchema.safeParse(JSON.parse(content));
        if (!parsed.success) {
          continue;
        }

        const settings = parsed.data;
        if (settings.id !== repoId) {
          continue;
        }

        // Found the right repository, now find the worktree
        const worktree = settings.worktrees.find(w => w.id === worktreeId);
        if (worktree) {
          return worktree.isRenamed ?? false;
        }

        // Worktree not found in this repo
        return false;
      } catch {
        // Skip repos with invalid settings
        continue;
      }
    }

    // No matching repository found
    return false;
  } catch (err) {
    emitLog("WARN", `[worktree_rename] Failed to check isRenamed status: ${err}`);
    return false;
  }
}

/**
 * Check if a worktree is the main worktree (sourcePath == worktree path).
 * The main worktree is the original repository directory and should not be renamed.
 *
 * @returns true if this is the main worktree, false otherwise (including on any errors)
 */
function isMainWorktree(mortDir: string, repoId: string, worktreeId: string): boolean {
  try {
    const reposDir = join(mortDir, "repositories");
    if (!existsSync(reposDir)) {
      return false;
    }

    // Scan all repository directories to find the one with matching repoId
    const repoDirs = readdirSync(reposDir).filter(name => {
      const stat = statSync(join(reposDir, name));
      return stat.isDirectory();
    });

    for (const repoDir of repoDirs) {
      const settingsPath = join(reposDir, repoDir, "settings.json");
      if (!existsSync(settingsPath)) {
        continue;
      }

      try {
        const content = readFileSync(settingsPath, "utf-8");
        const parsed = RepositorySettingsSchema.safeParse(JSON.parse(content));
        if (!parsed.success) {
          continue;
        }

        const settings = parsed.data;
        if (settings.id !== repoId) {
          continue;
        }

        // Found the right repository, now find the worktree
        const worktree = settings.worktrees.find(w => w.id === worktreeId);
        if (worktree) {
          // Compare worktree path with repository sourcePath
          // Normalize paths for comparison (resolve symlinks, trailing slashes)
          const normalizedWorktreePath = worktree.path.replace(/\/$/, '');
          const normalizedSourcePath = settings.sourcePath.replace(/\/$/, '');
          return normalizedWorktreePath === normalizedSourcePath;
        }

        return false;
      } catch {
        continue;
      }
    }

    return false;
  } catch (err) {
    emitLog("WARN", `[worktree_rename] Failed to check isMainWorktree: ${err}`);
    return false;
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
        case "--parent-thread-id":
          config.parentThreadId = args[++i];
          break;
        // Ignore deprecated arguments for backwards compatibility
        case "--worktree-renamed":
          // Deprecated: now read from disk instead of CLI arg
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
        // Track parent thread for sub-agents spawned via bash
        ...(config.parentThreadId ? { parentThreadId: config.parentThreadId } : {}),
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

      // Start thread naming in parallel (fire and forget)
      this.initiateThreadNaming(threadId, prompt, threadPath);

      // Start worktree naming in parallel (fire and forget)
      // Only trigger if the worktree hasn't already been renamed from its initial animal name
      // and this is not the main worktree (which should never be renamed)
      const alreadyRenamed = isWorktreeRenamed(mortDir, repoId, worktreeId);
      const mainWorktree = isMainWorktree(mortDir, repoId, worktreeId);

      if (mainWorktree) {
        emitLog("INFO", `[worktree_rename] Skipping worktree naming - this is the main worktree (worktreeId=${worktreeId})`);
      } else if (!alreadyRenamed) {
        emitLog("INFO", `[worktree_rename] New thread created, worktree not yet renamed - initiating worktree naming for worktreeId=${worktreeId}`);
        this.initiateWorktreeNaming(worktreeId, repoId, prompt, mortDir);
      } else {
        emitLog("INFO", `[worktree_rename] Skipping worktree naming - worktree already renamed (worktreeId=${worktreeId})`);
      }
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

  /**
   * Initiate thread naming in parallel (fire and forget).
   * Generates a name using Claude Haiku and updates thread metadata.
   */
  private initiateThreadNaming(
    threadId: string,
    prompt: string,
    threadPath: string
  ): void {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      emitLog("WARN", "[thread-naming] No API key available, skipping name generation");
      return;
    }

    generateThreadName(prompt, apiKey)
      .then(async (name) => {
        // Update thread metadata with name
        const threadMetadataPath = join(threadPath, "metadata.json");
        if (existsSync(threadMetadataPath)) {
          try {
            const existingContent = readFileSync(threadMetadataPath, "utf-8");
            const parseResult = SimpleThreadMetadataSchema.safeParse(JSON.parse(existingContent));

            if (parseResult.success) {
              const updated = {
                ...parseResult.data,
                name,
                updatedAt: Date.now(),
              };
              writeFileSync(threadMetadataPath, JSON.stringify(updated, null, 2));
              emitLog("INFO", `[thread-naming] Generated name: "${name}"`);
            }
          } catch (err) {
            emitLog("ERROR", `[thread-naming] Failed to update metadata: ${err}`);
          }
        }

        // Broadcast event for UI
        events.threadNameGenerated(threadId, name);
      })
      .catch((error) => {
        // Log error but don't fail the main agent flow
        emitLog("WARN", `[thread-naming] Failed to generate name: ${error instanceof Error ? error.message : String(error)}`);
      });
  }

  /**
   * Initiate worktree naming in parallel (fire and forget).
   * Generates a name using Claude Haiku, writes to disk, then emits event for UI refresh.
   * Only called for new threads (not resumes) and only for the first thread in a worktree.
   */
  private initiateWorktreeNaming(
    worktreeId: string,
    repoId: string,
    prompt: string,
    mortDir: string
  ): void {
    emitLog("INFO", `[worktree_rename] initiateWorktreeNaming called: worktreeId=${worktreeId}, repoId=${repoId}, prompt="${prompt.slice(0, 50)}${prompt.length > 50 ? '...' : ''}"`);

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      emitLog("WARN", "[worktree_rename] No API key available, skipping name generation");
      return;
    }
    emitLog("INFO", "[worktree_rename] API key present, calling generateWorktreeName...");

    generateWorktreeName(prompt, apiKey)
      .then((name) => {
        emitLog("INFO", `[worktree_rename] generateWorktreeName resolved with name: "${name}"`);

        // Write to disk FIRST (same pattern as thread naming)
        try {
          this.updateWorktreeNameOnDisk(mortDir, repoId, worktreeId, name);
          emitLog("INFO", `[worktree_rename] Updated worktree name on disk: "${name}"`);
        } catch (err) {
          emitLog("ERROR", `[worktree_rename] Failed to write name to disk: ${err}`);
          // Continue to emit event anyway - frontend listener can serve as backup
        }

        // Emit event for UI refresh
        emitLog("INFO", `[worktree_rename] Emitting worktree:name:generated event for worktreeId=${worktreeId}, repoId=${repoId}, name="${name}"`);
        events.worktreeNameGenerated(worktreeId, repoId, name);
        emitLog("INFO", `[worktree_rename] Event emitted successfully`);
      })
      .catch((error) => {
        // Log error but don't fail the main agent flow
        emitLog("WARN", `[worktree_rename] generateWorktreeName failed: ${error instanceof Error ? error.message : String(error)}`);
        if (error instanceof Error && error.stack) {
          emitLog("WARN", `[worktree_rename] Stack trace: ${error.stack}`);
        }
      });
  }

  /**
   * Update worktree name in repository settings on disk.
   * Scans repositories to find the one with matching repoId,
   * then updates the worktree's name, sets isRenamed=true,
   * creates a branch with the new name, and checks it out.
   */
  private updateWorktreeNameOnDisk(
    mortDir: string,
    repoId: string,
    worktreeId: string,
    newName: string
  ): void {
    const reposDir = join(mortDir, "repositories");

    if (!existsSync(reposDir)) {
      throw new Error(`Repositories directory does not exist: ${reposDir}`);
    }

    // Find the repository settings file
    const repoDirs = readdirSync(reposDir).filter(name => {
      const stat = statSync(join(reposDir, name));
      return stat.isDirectory();
    });

    for (const repoDir of repoDirs) {
      const settingsPath = join(reposDir, repoDir, "settings.json");
      if (!existsSync(settingsPath)) continue;

      let content: string;
      try {
        content = readFileSync(settingsPath, "utf-8");
      } catch {
        continue;
      }

      const parsed = RepositorySettingsSchema.safeParse(JSON.parse(content));
      if (!parsed.success) continue;

      const settings = parsed.data;
      if (settings.id !== repoId) continue;

      // Found the right repo - update the worktree
      const worktreeIndex = settings.worktrees.findIndex(w => w.id === worktreeId);
      if (worktreeIndex === -1) {
        throw new Error(`Worktree ${worktreeId} not found in repo ${repoId}`);
      }

      const worktreePath = settings.worktrees[worktreeIndex].path;

      // Create and checkout the branch with the new name
      let currentBranch: string | null = null;
      try {
        const gitAdapter = new NodeGitAdapter();

        // Check if branch already exists
        if (!gitAdapter.branchExists(worktreePath, newName)) {
          gitAdapter.createBranch(worktreePath, newName);
          emitLog("INFO", `[worktree_rename] Created branch: "${newName}"`);
        } else {
          emitLog("INFO", `[worktree_rename] Branch already exists: "${newName}"`);
        }

        // Checkout the branch
        gitAdapter.checkoutBranch(worktreePath, newName);
        emitLog("INFO", `[worktree_rename] Checked out branch: "${newName}"`);

        currentBranch = newName;
      } catch (err) {
        emitLog("WARN", `[worktree_rename] Failed to create/checkout branch: ${err}`);
        // Continue - branch creation is not critical, still update metadata
      }

      // Update worktree metadata including currentBranch if we successfully checked it out
      settings.worktrees[worktreeIndex] = {
        ...settings.worktrees[worktreeIndex],
        name: newName,
        isRenamed: true,
        ...(currentBranch && { currentBranch }),
      };
      settings.lastUpdated = Date.now();

      writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
      emitLog("INFO", `[worktree_rename] Wrote updated settings to ${settingsPath}`);
      return;
    }

    throw new Error(`Repository ${repoId} not found in ${reposDir}`);
  }
}
