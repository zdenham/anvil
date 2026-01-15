import { Command, type Child } from "@tauri-apps/plugin-shell";
import { join, resolveResource, dirname } from "@tauri-apps/api/path";
import { invoke } from "@tauri-apps/api/core";
import { FilesystemClient } from "./filesystem-client";
import { threadService, settingsService, taskService } from "@/entities";
import { eventBus } from "@/entities/events";
import { gitCommands, fsCommands } from "./tauri-commands";
import { parseAgentOutput } from "./agent-output-parser";
import { EventName, type AgentEventMessage } from "@core/types/events.js";
import type { AgentMode } from "@core/types/agent-mode.js";

const fs = new FilesystemClient();
const isDev = import.meta.env.DEV;
import { logger } from "./logger-client";
import type { ThreadState } from "@/lib/types/agent-messages";
import type { TaskMetadata } from "@/entities/tasks/types";
import type { WorkflowMode } from "@/entities/settings/types";
import { useSettingsStore } from "@/entities/settings/store";

// MergeContext type - mirrors agents/src/agent-types/merge-types.ts
// Defined locally until exported from @mort/agents
interface MergeContext {
  /** The task branch to merge (e.g., mort/task-abc123) */
  taskBranch: string;
  /** The base branch to merge into (e.g., main) */
  baseBranch: string;
  /** Absolute path to the worktree where task branch is checked out */
  taskWorktreePath: string;
  /** Absolute path to the main worktree (source repo) where base branch is checked out */
  mainWorktreePath: string;
  /** Workflow mode: solo (local merge) or team (PR) */
  workflowMode: WorkflowMode;
}

// Cache the shell PATH to avoid repeated Tauri calls
let cachedShellPath: string | null = null;

// ═══════════════════════════════════════════════════════════════════════════
// HMR-Resistant Process Tracking
// ═══════════════════════════════════════════════════════════════════════════
// Store process maps on window to survive Vite HMR reloads.
// Without this, HMR clears module-level Maps, breaking cancellation.

interface ProcessMaps {
  activeSimpleProcesses: Map<string, Child>;
  agentProcesses: Map<string, Child>;
  pendingQueuedMessages: Map<string, { threadId: string; content: string; timestamp: number }>;
}

declare global {
  interface Window {
    __agentServiceProcessMaps?: ProcessMaps;
  }
}

function getProcessMaps(): ProcessMaps {
  if (!window.__agentServiceProcessMaps) {
    window.__agentServiceProcessMaps = {
      activeSimpleProcesses: new Map(),
      agentProcesses: new Map(),
      pendingQueuedMessages: new Map(),
    };
    logger.info("[agent-service] Initialized process maps on window");
  }
  return window.__agentServiceProcessMaps;
}

// Track active simple agent processes for cancellation
const activeSimpleProcesses = getProcessMaps().activeSimpleProcesses;

// Track all agent processes by threadId for stdin communication (e.g., permission responses)
const agentProcesses = getProcessMaps().agentProcesses;

// Track queued message IDs for confirmation matching
const pendingQueuedMessages = getProcessMaps().pendingQueuedMessages;

/**
 * Gets the shell PATH captured from the user's login shell.
 * This is needed because macOS GUI apps don't inherit the user's PATH.
 */
async function getShellPath(): Promise<string> {
  if (cachedShellPath === null) {
    cachedShellPath = await invoke<string>("get_shell_path");
    logger.info(`[agent] Captured shell PATH: ${cachedShellPath}`);
  }
  return cachedShellPath;
}

/**
 * Resolves paths for the agent runner.
 * Shared between orchestrated and simple agents.
 */
async function getRunnerPaths(): Promise<{
  runnerPath: string;
  nodeModulesPath: string;
  cliPath: string;
}> {
  if (isDev) {
    return {
      runnerPath: `${__PROJECT_ROOT__}/agents/dist/runner.js`,
      nodeModulesPath: `${__PROJECT_ROOT__}/agents/node_modules`,
      cliPath: `${__PROJECT_ROOT__}/agents/dist/cli/mort.js`,
    };
  }
  const runnerPath = await resolveResource("_up_/agents/dist/runner.js");
  const agentsDistDir = await dirname(runnerPath);
  const agentsDir = await dirname(agentsDistDir);
  return {
    runnerPath,
    nodeModulesPath: await join(agentsDir, "node_modules"),
    cliPath: await join(agentsDistDir, "cli", "mort.js"),
  };
}

/**
 * Counts the number of tool_result blocks in the messages array.
 * Used to detect when new tool results have been added.
 */
function countToolResults(messages: ThreadState["messages"]): number {
  let count = 0;
  for (const msg of messages) {
    if (msg.role === "user" && Array.isArray(msg.content)) {
      for (const block of msg.content) {
        if (typeof block === "object" && block !== null && "type" in block && block.type === "tool_result") {
          count++;
        }
      }
    }
  }
  return count;
}

/**
 * Handle typed events from agent process.
 * Emits to eventBus - entity listeners handle disk refreshes.
 */
function handleAgentEvent(event: AgentEventMessage): void {
  const { name, payload } = event;

  // Type assertion needed because eventBus.emit expects specific event types
  // but we're handling all event types dynamically from agent output
  switch (name) {
    case EventName.TASK_CREATED:
    case EventName.TASK_UPDATED:
    case EventName.TASK_DELETED:
    case EventName.TASK_STATUS_CHANGED:
    case EventName.THREAD_CREATED:
    case EventName.THREAD_UPDATED:
    case EventName.THREAD_STATUS_CHANGED:
    case EventName.WORKTREE_ALLOCATED:
    case EventName.WORKTREE_RELEASED:
    case EventName.ACTION_REQUESTED:
    case EventName.AGENT_CANCELLED:
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      eventBus.emit(name as any, payload as any);
      break;

    default:
      logger.warn(`[handleAgentEvent] Unhandled event: ${name}`);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════

export interface AgentStreamCallbacks {
  onState: (state: ThreadState) => void;
  onComplete: (exitCode: number, costUsd?: number) => void;
  onError: (error: string) => void;
}

/**
 * Options for spawning a simple agent.
 * Simple agents run directly in the source repository without worktree allocation.
 */
export interface SpawnSimpleAgentOptions {
  taskId: string;
  threadId: string;
  prompt: string;
  /** Repository source path - agent runs here directly (no worktree) */
  sourcePath: string;
  /** Agent interaction mode - controls how agent handles edits */
  agentMode?: AgentMode;
}

/**
 * Options for spawning an agent with Node orchestration.
 * Node handles worktree allocation and thread creation.
 */
export interface SpawnAgentWithOrchestrationOptions {
  agentType: string;
  /** Task slug - Node reads task metadata from disk */
  taskSlug: string;
  /** Task ID - required for event emissions and optimistic UI */
  taskId: string;
  /** Pre-generated thread ID for optimistic UI */
  threadId: string;
  prompt: string;
  /** Override the agent's appended system prompt (used for merge agent with dynamic context) */
  appendedPromptOverride?: string;
}

/**
 * Spawns an agent with Node orchestration.
 * Node handles worktree allocation and thread creation.
 *
 * Simplified flow:
 * 1. Frontend creates draft task on disk
 * 2. Frontend spawns Node with --task-slug
 * 3. Node reads task, allocates worktree, creates thread
 * 4. Node emits events: worktree:allocated, thread:created, agent:state
 * 5. Frontend reacts to events via eventBus
 *
 * @param options - Orchestration options with taskSlug instead of cwd
 */
export async function spawnAgentWithOrchestration(
  options: SpawnAgentWithOrchestrationOptions
): Promise<void> {
  logger.log(`[spawnAgentWithOrchestration] Called with options:`, {
    agentType: options.agentType,
    taskSlug: options.taskSlug,
    threadId: options.threadId,
  });

  const settings = settingsService.get();
  const apiKey = settings.anthropicApiKey || import.meta.env.VITE_ANTHROPIC_API_KEY;

  if (!apiKey) {
    logger.error(`[spawnAgentWithOrchestration] No API key configured!`);
    throw new Error("Anthropic API key not configured");
  }

  // Get centralized data directory (e.g., ~/.mort or ~/.mort-dev)
  const mortDir = await fs.getDataDir();
  logger.log(`[spawnAgentWithOrchestration] Data dir: ${mortDir}`);

  // Resolve paths for the agent runner
  let runnerPath: string;
  let nodeModulesPath: string;
  let cliPath: string;

  if (isDev) {
    runnerPath = `${__PROJECT_ROOT__}/agents/dist/runner.js`;
    nodeModulesPath = `${__PROJECT_ROOT__}/agents/node_modules`;
    cliPath = `${__PROJECT_ROOT__}/agents/dist/cli/mort.js`;
    logger.info(`[spawnAgentWithOrchestration] Dev mode paths - runner: ${runnerPath}`);
  } else {
    runnerPath = await resolveResource("_up_/agents/dist/runner.js");
    const agentsDistDir = await dirname(runnerPath);
    const agentsDir = await dirname(agentsDistDir);
    nodeModulesPath = await join(agentsDir, "node_modules");
    cliPath = await join(agentsDistDir, "cli", "mort.js");
    logger.info(`[spawnAgentWithOrchestration] Prod mode paths - runner: ${runnerPath}`);
  }

  // Build the agent command args with --task-slug (orchestration mode)
  // Node will allocate worktree and create thread
  const commandArgs = [
    runnerPath,
    "--agent", options.agentType,
    "--task-slug", options.taskSlug, // Node reads task from disk, allocates worktree
    "--thread-id", options.threadId,
    "--prompt", options.prompt,
    "--mort-dir", mortDir,
    // NO --cwd, NO --merge-base - Node computes these via orchestration
  ];

  // Add appended prompt override for dynamic system prompts (e.g., merge agent)
  if (options.appendedPromptOverride) {
    commandArgs.push("--appended-prompt", options.appendedPromptOverride);
  }

  // Get the shell PATH (needed for bundled macOS apps which don't inherit user's PATH)
  const shellPath = await getShellPath();

  logger.info(`[spawnAgentWithOrchestration] Runner path: ${runnerPath}`);
  logger.info(`[spawnAgentWithOrchestration] Task slug: ${options.taskSlug}`);

  // Build and spawn the command
  const command = Command.create("node", commandArgs, {
    cwd: mortDir, // Initial cwd, Node will switch to allocated worktree
    env: {
      ANTHROPIC_API_KEY: apiKey,
      NODE_PATH: nodeModulesPath,
      MORT_CLI: cliPath,
      MORT_DATA_DIR: mortDir,
      PATH: shellPath,
    },
  });

  // Line buffer for stdout - shell plugin may split JSON across chunks
  let stdoutBuffer = "";
  let lastCostUsd: number | undefined;
  let lastToolResultCount = 0;

  command.stdout.on("data", (chunk: string) => {
    stdoutBuffer += chunk;

    // Process complete lines (each line is a full state JSON or orchestration event)
    const lines = stdoutBuffer.split("\n");
    stdoutBuffer = lines.pop() ?? "";

    const threadId = options.threadId;
    const taskId = options.taskId;

    for (const line of lines) {
      if (!line.trim()) continue;

      // Use typed parser for agent output
      const output = parseAgentOutput(line);
      if (output) {
        switch (output.type) {
          case "log": {
            const level = output.level.toLowerCase() as "debug" | "info" | "warn" | "error";
            const message = `[agent:${threadId}] ${output.message}`;
            switch (level) {
              case "error": logger.error(message); break;
              case "warn": logger.warn(message); break;
              case "debug": logger.debug(message); break;
              default: logger.info(message);
            }
            break;
          }

          case "event":
            handleAgentEvent(output);
            break;

          case "state": {
            const threadState = output.state;
            if (threadState.status === "complete" && threadState.metrics?.totalCostUsd !== undefined) {
              lastCostUsd = threadState.metrics.totalCostUsd;
            }

            // Emit state to eventBus for UI updates
            eventBus.emit(EventName.AGENT_STATE, {
              threadId,
              state: threadState,
            });

            // Detect tool completion and emit event for content refresh
            const currentCount = countToolResults(threadState.messages);
            if (currentCount > lastToolResultCount) {
              lastToolResultCount = currentCount;
              eventBus.emit(EventName.AGENT_TOOL_COMPLETED, {
                threadId,
                taskId, // Now correctly using options.taskId (fixes Bug 1)
              });
            }
            break;
          }
        }
        continue;
      }

      // Fall back to raw JSON parsing for legacy orchestration events
      try {
        const parsed = JSON.parse(line);

        // Legacy orchestration events (backward compat)
        if (parsed.type === "worktree:allocated") {
          logger.log(`[spawnAgentWithOrchestration] Worktree allocated:`, parsed.worktree?.path);
          eventBus.emit(EventName.AGENT_SPAWNED, {
            threadId,
            taskId,
          });
          continue;
        }

        if (parsed.type === "thread:created") {
          logger.log(`[spawnAgentWithOrchestration] Thread created:`, parsed.thread?.id);
          // Add thread to store directly (Node already wrote to disk)
          threadService.handleRemoteCreate(parsed.thread);
          // Also emit event for any other listeners
          eventBus.emit("thread:created", {
            threadId: parsed.thread.id,
            taskId: parsed.thread.taskId,
          });
          continue;
        }

        if (parsed.type === "worktree:released") {
          logger.log(`[spawnAgentWithOrchestration] Worktree released for thread:`, parsed.threadId);
          continue;
        }

        // Unknown JSON - log for visibility
        logger.debug(`[agent:${threadId}] unknown message: ${line}`);
      } catch {
        // Non-JSON stdout - pipe through as debug log
        logger.debug(`[agent:${threadId}] ${line}`);
      }
    }
  });

  command.stderr.on("data", (line: string) => {
    // stderr is reserved for actual process errors
    logger.error(`[agent:${options.threadId}] stderr: ${line}`);
    eventBus.emit("agent:error", { threadId: options.threadId, error: line });
  });

  command.on("close", async (data) => {
    // Note: PID is cleared by the runner during cleanup, not here
    agentProcesses.delete(options.threadId);
    logger.log(`[spawnAgentWithOrchestration] Agent closed with code: ${data.code}`);

    // Update thread entity based on exit code
    // Note: Thread was created by Node, so we need to update it
    const thread = threadService.get(options.threadId);
    if (thread) {
      if (data.code === 0) {
        await threadService.completeTurn(options.threadId, data.code, lastCostUsd);
        await threadService.markCompleted(options.threadId);
      } else if (data.code === 130) {
        // Cancelled via SIGINT/SIGTERM (exit code 128 + 2)
        await threadService.completeTurn(options.threadId, data.code, lastCostUsd);
        await threadService.markCancelled(options.threadId);
        eventBus.emit(EventName.AGENT_CANCELLED, {
          threadId: options.threadId,
        });
      } else {
        await threadService.completeTurn(options.threadId, data.code ?? -1);
        await threadService.markError(options.threadId);
      }
    }

    eventBus.emit("agent:completed", {
      threadId: options.threadId,
      exitCode: data.code ?? -1,
      costUsd: lastCostUsd,
    });
  });

  // Spawn the command
  // Note: PID is written to disk by the runner, not here
  try {
    logger.info(`[spawnAgentWithOrchestration] Spawning agent for thread ${options.threadId}`);
    const child = await command.spawn();
    agentProcesses.set(options.threadId, child);
    logger.info(`[spawnAgentWithOrchestration] Agent spawned successfully, pid=${child.pid}`);
  } catch (error) {
    logger.error(`[spawnAgentWithOrchestration] Failed to spawn agent:`, error);
    eventBus.emit("agent:error", {
      threadId: options.threadId,
      error: error instanceof Error ? error.message : String(error),
    });
    throw new Error(
      `Failed to spawn agent: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Resumes an existing thread with a follow-up message.
 * Uses the existing thread's working directory and agent type,
 * and passes the prior thread history via --history-file.
 */
export async function resumeAgent(
  threadId: string,
  prompt: string,
  callbacks: AgentStreamCallbacks
): Promise<void> {
  const settings = settingsService.get();
  const apiKey = settings.anthropicApiKey || import.meta.env.VITE_ANTHROPIC_API_KEY;

  if (!apiKey) {
    throw new Error("Anthropic API key not configured");
  }

  // 1. Look up the existing thread
  const thread = threadService.get(threadId);
  if (!thread) {
    throw new Error(`Thread not found: ${threadId}`);
  }

  // 2. Get paths using new structure: tasks/{slug}/threads/{agentType}-{threadId}/
  const mortDir = await fs.getDataDir();
  const threadFolderName = `${thread.agentType}-${threadId}`;
  // We need to get the task slug for the path - use the thread's taskId to look up the task
  const task = taskService.get(thread.taskId);
  if (!task) {
    throw new Error(`Task not found for thread: ${thread.taskId}`);
  }
  const stateFilePath = fs.joinPath(mortDir, "tasks", task.slug, "threads", threadFolderName, "state.json");

  // 3. Add a new turn to the thread
  await threadService.addTurn(threadId, prompt);

  // 4. Mark thread as running
  await threadService.markRunning(threadId);

  // Resolve paths for the agent runner
  let runnerPath: string;
  let nodeModulesPath: string;
  let cliPath: string;

  if (isDev) {
    runnerPath = `${__PROJECT_ROOT__}/agents/dist/runner.js`;
    nodeModulesPath = `${__PROJECT_ROOT__}/agents/node_modules`;
    cliPath = `${__PROJECT_ROOT__}/agents/dist/cli/mort.js`;
  } else {
    runnerPath = await resolveResource("_up_/agents/dist/runner.js");
    const agentsDistDir = await dirname(runnerPath);
    const agentsDir = await dirname(agentsDistDir);
    nodeModulesPath = await join(agentsDir, "node_modules");
    cliPath = await join(agentsDistDir, "cli", "mort.js");
  }

  // 5. Build command args with --task-slug and --history-file for resuming
  // Node orchestration will allocate a worktree (may be different from original)
  const commandArgs = [
    runnerPath,
    "--agent", thread.agentType,
    "--task-slug", task.slug,
    "--thread-id", threadId,
    "--prompt", prompt,
    "--mort-dir", mortDir,
    "--history-file", stateFilePath,
  ];

  logger.info(`[agent] Resuming thread ${threadId} with history from ${stateFilePath}`);

  // Get the shell PATH (needed for bundled macOS apps which don't inherit user's PATH)
  const shellPath = await getShellPath();

  // Use "node" as the command name to match the Tauri shell scope,
  // and set PATH in the environment so it resolves to the correct binary
  // Initial cwd is mortDir - Node orchestration will switch to allocated worktree
  const command = Command.create("node", commandArgs, {
    cwd: mortDir,
    env: {
      ANTHROPIC_API_KEY: apiKey,
      NODE_PATH: nodeModulesPath,
      MORT_CLI: cliPath,
      MORT_DATA_DIR: mortDir,
      PATH: shellPath,
    },
  });

  // Line buffer for stdout
  let stdoutBuffer = "";
  let lastCostUsd: number | undefined;
  let lastToolResultCount = 0;

  command.stdout.on("data", (chunk: string) => {
    stdoutBuffer += chunk;

    const lines = stdoutBuffer.split("\n");
    stdoutBuffer = lines.pop() ?? "";

    for (const line of lines) {
      if (!line.trim()) continue;

      // Use typed parser for agent output
      const output = parseAgentOutput(line);
      if (output) {
        switch (output.type) {
          case "log": {
            const level = output.level.toLowerCase() as "debug" | "info" | "warn" | "error";
            const message = `[agent:${threadId}] ${output.message}`;
            switch (level) {
              case "error": logger.error(message); break;
              case "warn": logger.warn(message); break;
              case "debug": logger.debug(message); break;
              default: logger.info(message);
            }
            break;
          }

          case "event":
            handleAgentEvent(output);
            break;

          case "state": {
            const threadState = output.state;
            if (threadState.status === "complete" && threadState.metrics?.totalCostUsd !== undefined) {
              lastCostUsd = threadState.metrics.totalCostUsd;
            }
            callbacks.onState(threadState);

            // Detect tool completion and emit event for content refresh
            const currentCount = countToolResults(threadState.messages);
            if (currentCount > lastToolResultCount) {
              lastToolResultCount = currentCount;
              eventBus.emit(EventName.AGENT_TOOL_COMPLETED, {
                threadId,
                taskId: thread.taskId,
              });
            }
            break;
          }
        }
        continue;
      }

      // Non-JSON stdout - pipe through as debug log
      logger.debug(`[agent:${threadId}] ${line}`);
    }
  });

  command.stderr.on("data", (line: string) => {
    // stderr is reserved for actual process errors
    logger.error(`[agent:${threadId}] stderr: ${line}`);
    callbacks.onError(line);
  });

  command.on("close", async (data) => {
    // Note: PID is cleared by the runner during cleanup, not here
    agentProcesses.delete(threadId);
    if (data.code === 0) {
      await threadService.completeTurn(threadId, data.code, lastCostUsd);
      await threadService.markCompleted(threadId);
    } else if (data.code === 130) {
      // Cancelled via SIGINT/SIGTERM (exit code 128 + 2)
      await threadService.completeTurn(threadId, data.code, lastCostUsd);
      await threadService.markCancelled(threadId);
      eventBus.emit(EventName.AGENT_CANCELLED, {
        threadId,
      });
    } else {
      await threadService.completeTurn(threadId, data.code ?? -1);
      await threadService.markError(threadId);
    }
    callbacks.onComplete(data.code ?? -1, lastCostUsd);
  });

  // Note: PID is written to disk by the runner, not here
  try {
    const child = await command.spawn();
    agentProcesses.set(threadId, child);
  } catch (error) {
    await threadService.markError(threadId);
    throw new Error(
      `Failed to spawn agent: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Simple Agent Support
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Handles stdout output from a simple agent process.
 * Parses JSON lines and emits events to eventBus.
 */
function handleSimpleAgentOutput(
  threadId: string,
  data: string,
  buffer: { value: string }
): void {
  buffer.value += data;

  const lines = buffer.value.split("\n");
  buffer.value = lines.pop() ?? "";

  for (const line of lines) {
    if (!line.trim()) continue;

    const output = parseAgentOutput(line);
    if (output) {
      switch (output.type) {
        case "log": {
          const level = output.level.toLowerCase() as "debug" | "info" | "warn" | "error";
          const message = `[simple-agent:${threadId}] ${output.message}`;
          switch (level) {
            case "error": logger.error(message); break;
            case "warn": logger.warn(message); break;
            case "debug": logger.debug(message); break;
            default: logger.info(message);
          }
          break;
        }

        case "event":
          handleAgentEvent(output);
          break;

        case "state":
          eventBus.emit(EventName.AGENT_STATE, {
            threadId,
            state: output.state,
          });
          break;
      }
    } else {
      logger.debug(`[simple-agent:${threadId}] ${line}`);
    }
  }
}

/**
 * Spawns a simple agent that runs directly in the source repository.
 * No worktree allocation, no branch management.
 */
export async function spawnSimpleAgent(options: SpawnSimpleAgentOptions): Promise<void> {
  logger.info("[agent-service] spawnSimpleAgent START");

  const mortDir = await fs.getDataDir();
  const { runnerPath, nodeModulesPath } = await getRunnerPaths();
  const shellPath = await getShellPath();

  // Get API key from settings or env
  const settings = settingsService.get();
  const apiKey = settings.anthropicApiKey || import.meta.env.VITE_ANTHROPIC_API_KEY;

  if (!apiKey) {
    throw new Error("Anthropic API key not configured");
  }

  const agentMode = options.agentMode ?? "normal";

  // Command args for simple agent - matches SimpleRunnerStrategy.parseArgs()
  const commandArgs = [
    runnerPath,
    "--agent", "simple",
    "--task-id", options.taskId,
    "--thread-id", options.threadId,
    "--cwd", options.sourcePath,
    "--prompt", options.prompt,
    "--mort-dir", mortDir,
    "--agent-mode", agentMode,
  ];

  const command = Command.create("node", commandArgs, {
    cwd: options.sourcePath,
    env: {
      ANTHROPIC_API_KEY: apiKey,
      NODE_PATH: nodeModulesPath,
      MORT_DATA_DIR: mortDir,
      PATH: shellPath,
    },
  });

  // Line buffer for stdout - shell plugin may split JSON across chunks
  const stdoutBuffer = { value: "" };

  command.stdout.on("data", (data) => {
    handleSimpleAgentOutput(options.threadId, data, stdoutBuffer);
  });

  command.stderr.on("data", (data) => {
    logger.debug("[simple-agent] stderr:", data);
  });

  command.on("close", async (code) => {
    logger.info(`[agent-service] Process closed for threadId=${options.threadId}, exitCode=${code.code}, signal=${code.signal}`);

    // Note: PID is cleared by the runner during cleanup, not here
    activeSimpleProcesses.delete(options.threadId);
    agentProcesses.delete(options.threadId);
    logger.info(`[agent-service] Removed from process maps. agentProcesses now has ${agentProcesses.size} entries`);

    if (code.code === 130) {
      // Cancelled via SIGINT/SIGTERM (exit code 128 + 2)
      logger.info(`[agent-service] Exit code 130 - marking thread as cancelled`);
      await threadService.markCancelled(options.threadId);
      eventBus.emit(EventName.AGENT_CANCELLED, {
        threadId: options.threadId,
      });
    } else if (code.code !== 0) {
      logger.error("[simple-agent] Process exited with code", { code: code.code });
    }

    eventBus.emit(EventName.AGENT_COMPLETED, {
      threadId: options.threadId,
      exitCode: code.code ?? -1,
    });
  });

  // Note: PID is written to disk by the runner, not here
  const child = await command.spawn();
  activeSimpleProcesses.set(options.threadId, child);
  agentProcesses.set(options.threadId, child);
  logger.info(`[agent-service] Agent spawned for threadId=${options.threadId}, pid=${child.pid}`);

  eventBus.emit(EventName.AGENT_SPAWNED, {
    threadId: options.threadId,
    taskId: options.taskId,
  });

  logger.info("[agent-service] spawnSimpleAgent COMPLETE");
}

/**
 * Resumes a simple agent with a new prompt.
 * State path: tasks/{taskId}/threads/simple-{threadId}/state.json
 */
export async function resumeSimpleAgent(
  taskId: string,
  threadId: string,
  prompt: string,
  sourcePath: string,
  agentMode: AgentMode = "normal",
): Promise<void> {
  const mortDir = await fs.getDataDir();
  const { runnerPath, nodeModulesPath } = await getRunnerPaths();
  const shellPath = await getShellPath();

  // Get API key from settings or env
  const settings = settingsService.get();
  const apiKey = settings.anthropicApiKey || import.meta.env.VITE_ANTHROPIC_API_KEY;

  if (!apiKey) {
    throw new Error("Anthropic API key not configured");
  }

  // State path: tasks/{taskId}/threads/simple-{threadId}/state.json
  const stateFilePath = await join(mortDir, "tasks", taskId, "threads", `simple-${threadId}`, "state.json");

  const commandArgs = [
    runnerPath,
    "--agent", "simple",
    "--task-id", taskId,
    "--thread-id", threadId,
    "--cwd", sourcePath,
    "--prompt", prompt,
    "--mort-dir", mortDir,
    "--agent-mode", agentMode,
    "--history-file", stateFilePath,
  ];

  logger.info("[agent-service] Resuming simple agent", { taskId, threadId });

  const command = Command.create("node", commandArgs, {
    cwd: sourcePath,
    env: {
      ANTHROPIC_API_KEY: apiKey,
      NODE_PATH: nodeModulesPath,
      MORT_DATA_DIR: mortDir,
      PATH: shellPath,
    },
  });

  const stdoutBuffer = { value: "" };

  command.stdout.on("data", (data) => {
    handleSimpleAgentOutput(threadId, data, stdoutBuffer);
  });

  command.stderr.on("data", (data) => {
    logger.debug("[simple-agent] stderr:", data);
  });

  command.on("close", async (code) => {
    // Note: PID is cleared by the runner during cleanup, not here
    activeSimpleProcesses.delete(threadId);
    agentProcesses.delete(threadId);

    if (code.code === 130) {
      // Cancelled via SIGINT/SIGTERM (exit code 128 + 2)
      await threadService.markCancelled(threadId);
      eventBus.emit(EventName.AGENT_CANCELLED, {
        threadId,
      });
    }

    eventBus.emit(EventName.AGENT_COMPLETED, {
      threadId,
      exitCode: code.code ?? -1,
    });
  });

  // Note: PID is written to disk by the runner, not here
  const child = await command.spawn();
  activeSimpleProcesses.set(threadId, child);
  agentProcesses.set(threadId, child);
}

/**
 * Cancels a running simple agent.
 */
export async function cancelSimpleAgent(threadId: string): Promise<void> {
  const process = agentProcesses.get(threadId);
  if (process) {
    await process.kill();
    agentProcesses.delete(threadId);
    activeSimpleProcesses.delete(threadId); // Keep in sync
    logger.info("[agent-service] Cancelled agent", { threadId });
  }
}

/**
 * Cancels a running agent by sending SIGTERM to its process.
 * Works for all agent types (simple, orchestrated, etc.)
 *
 * Uses PID from thread metadata for cross-window reliability:
 * - Any window can cancel any agent by reading PID from disk
 * - Survives HMR reloads (no in-memory state dependency)
 * - Uses OS-level signals via Rust command
 *
 * @returns true if process was killed, false if no process found
 */
export async function cancelAgent(threadId: string): Promise<boolean> {
  logger.info(`[agent-service] cancelAgent called for threadId=${threadId}`);

  try {
    // Get PID from thread metadata (persisted to disk)
    const thread = threadService.get(threadId);
    if (!thread?.pid) {
      logger.warn(`[agent-service] No PID found for thread: ${threadId}`);
      return false;
    }

    logger.info(`[agent-service] Found PID ${thread.pid} for thread ${threadId}, sending SIGTERM via Rust...`);

    // Use Rust command to send SIGTERM - works from any window
    const result = await invoke<boolean>("kill_process", { pid: thread.pid });

    if (result) {
      logger.info(`[agent-service] SIGTERM sent successfully to PID ${thread.pid}`);
      // Clear PID from metadata (close handler will also do this, but clear eagerly)
      await threadService.update(threadId, { pid: null });
      // Clean up local references if we have them
      agentProcesses.delete(threadId);
      activeSimpleProcesses.delete(threadId);
    } else {
      logger.warn(`[agent-service] Process ${thread.pid} not found (already exited)`);
      // Clear stale PID
      await threadService.update(threadId, { pid: null });
    }

    return result;
  } catch (error) {
    logger.error(`[agent-service] Failed to cancel agent:`, error);
    return false;
  }
}

/**
 * Checks if an agent is currently running for the given thread.
 * Works for all agent types.
 */
export function isAgentRunning(threadId: string): boolean {
  return agentProcesses.has(threadId);
}

/**
 * Checks if a simple agent is currently running for the given thread.
 */
export function isSimpleAgentRunning(threadId: string): boolean {
  return activeSimpleProcesses.has(threadId);
}

// ═══════════════════════════════════════════════════════════════════════════
// Permission Response Support
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Sends a permission response to a running agent process via stdin.
 * Used when UI approves/denies a permission request from the agent.
 */
export async function sendPermissionResponse(
  threadId: string,
  requestId: string,
  decision: "approve" | "deny",
  reason?: string
): Promise<void> {
  const process = agentProcesses.get(threadId);
  if (!process) {
    logger.warn(`[agent-service] No process found for threadId: ${threadId}`);
    return;
  }

  const message = JSON.stringify({
    type: "permission:response",
    requestId,
    decision,
    reason,
  }) + "\n";

  try {
    await process.write(message);
    logger.info(`[agent-service] Sent permission response:`, { requestId, decision });
  } catch (error) {
    // Handle case where process has already terminated
    // This can happen if the agent exits between the permission request and response
    if (error instanceof Error && error.message.includes("closed")) {
      logger.warn(`[agent-service] Process already terminated for threadId: ${threadId}`, {
        requestId,
        decision,
      });
      // Clean up the stale process reference
      agentProcesses.delete(threadId);
      return;
    }
    // Re-throw unexpected errors
    logger.error(`[agent-service] Failed to write permission response:`, error);
    throw error;
  }
}

/**
 * Checks if an agent process exists for the given thread.
 * Used to verify if permission responses can be sent.
 */
export function hasAgentProcess(threadId: string): boolean {
  return agentProcesses.has(threadId);
}

// ═══════════════════════════════════════════════════════════════════════════
// Interactive Tool Support
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Submit a tool result to resume agent execution.
 * Used for interactive tools like AskUserQuestion.
 *
 * Flow:
 * 1. UI calls this function with the user's response
 * 2. Tauri forwards the result to the Node agent process via IPC
 * 3. Agent appends tool_result message and resumes the agent loop
 */
export async function submitToolResult(
  taskId: string,
  threadId: string,
  toolId: string,
  response: string,
  workingDirectory: string
): Promise<void> {
  return invoke("submit_tool_result", {
    taskId,
    threadId,
    toolId,
    response,
    workingDirectory,
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// Merge Agent Support
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Builds the merge context for a task.
 * Returns null if context cannot be determined.
 * Note: taskWorktreePath is set to "." since the agent runs in the task worktree via orchestration.
 */
export async function buildMergeContextForTask(
  task: TaskMetadata
): Promise<MergeContext | null> {
  if (!task.repositoryName) {
    logger.warn("[agent] Cannot build merge context: task has no repositoryName", {
      taskId: task.id,
    });
    return null;
  }

  // Simple tasks don't have branches
  if (!task.branchName) {
    logger.warn("[agent] Cannot build merge context: task has no branchName (simple task)", {
      taskId: task.id,
    });
    return null;
  }

  // Derive branch info from task
  try {
    const repoPath = await fsCommands.getRepoSourcePath(task.repositoryName);
    const baseBranch = await gitCommands.getDefaultBranch(repoPath);

    const settings = useSettingsStore.getState();

    return {
      taskBranch: task.branchName,
      baseBranch,
      // Agent runs in task worktree via orchestration - use "." for current directory
      taskWorktreePath: ".",
      mainWorktreePath: repoPath,
      workflowMode: settings.getWorkflowMode(),
    };
  } catch (error) {
    logger.warn(`[agent] Failed to build merge context: ${error}`);
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Queued Message Support
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Sends a queued message to a running simple agent via stdin.
 * @returns The unique ID of the queued message for tracking
 */
export async function sendQueuedMessage(
  threadId: string,
  message: string
): Promise<string> {
  const child = agentProcesses.get(threadId);
  if (!child) {
    throw new Error(`No active process for thread: ${threadId}`);
  }

  const messageId = crypto.randomUUID();
  const timestamp = Date.now();

  // Format as JSON line (must end with newline)
  const payload = JSON.stringify({
    type: 'queued_message',
    id: messageId,
    content: message,
    timestamp,
  }) + '\n';

  // Track for confirmation
  pendingQueuedMessages.set(messageId, {
    threadId,
    content: message,
    timestamp,
  });

  try {
    await child.write(payload);
    logger.info('[agent-service] Sent queued message', { threadId, messageId });
    return messageId;
  } catch (err) {
    pendingQueuedMessages.delete(messageId);
    throw err;
  }
}

/**
 * Check if a queued message has been processed.
 */
export function isQueuedMessagePending(messageId: string): boolean {
  return pendingQueuedMessages.has(messageId);
}

/**
 * Mark a queued message as processed.
 */
export function confirmQueuedMessage(messageId: string): void {
  pendingQueuedMessages.delete(messageId);
}

/**
 * Clear all pending queued messages for a thread.
 */
export function clearPendingQueuedMessages(threadId: string): void {
  for (const [id, data] of pendingQueuedMessages.entries()) {
    if (data.threadId === threadId) {
      pendingQueuedMessages.delete(id);
    }
  }
}

