import { Command, type Child } from "@tauri-apps/plugin-shell";
import { join, resolveResource, dirname } from "@tauri-apps/api/path";
import { invoke } from "@tauri-apps/api/core";
import { z } from "zod";
import { FilesystemClient } from "./filesystem-client";
import { threadService, settingsService } from "@/entities";
import { eventBus } from "@/entities/events";
import { shellEnvironmentCommands } from "./tauri-commands";
import { parseAgentOutput } from "./agent-output-parser";
import { EventName, type AgentEventMessage } from "@core/types/events.js";

const fs = new FilesystemClient();
const isDev = import.meta.env.DEV;
import { logger } from "./logger-client";
import type { ThreadState } from "@/lib/types/agent-messages";
import { useQueuedMessagesStore } from "@/stores/queued-messages-store";

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
    };
    logger.info("[agent-service] Initialized process maps on window");
  }
  return window.__agentServiceProcessMaps;
}

// Track active simple agent processes for cancellation
const activeSimpleProcesses = getProcessMaps().activeSimpleProcesses;

// Track all agent processes by threadId for stdin communication (e.g., permission responses)
const agentProcesses = getProcessMaps().agentProcesses;

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
 * Ensures shell environment is initialized before spawning agents.
 * Auto-runs login shell if not already initialized.
 * This ensures the real user PATH (with version managers like nvm, fnm, volta)
 * is available for finding the `node` binary.
 */
async function ensureShellInitialized(): Promise<void> {
  const initialized = await shellEnvironmentCommands.isShellInitialized();
  if (!initialized) {
    logger.info("[agent-service] Shell not initialized, running login shell...");
    const success = await shellEnvironmentCommands.initializeShellEnvironment();
    if (success) {
      // Clear cached shell path so next getShellPath() fetches updated value
      cachedShellPath = null;
      logger.info("[agent-service] Shell initialized successfully");
    } else {
      logger.warn("[agent-service] Shell initialization returned false, will use fallback PATH");
    }
  }
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
 * Handle typed events from agent process.
 * Emits to eventBus - entity listeners handle disk refreshes.
 *
 * @param event - The agent event message
 * @param threadId - Optional threadId to augment event payloads that need it
 */
function handleAgentEvent(event: AgentEventMessage, threadId?: string): void {
  const { name, payload } = event;

  // Type assertion needed because eventBus.emit expects specific event types
  // but we're handling all event types dynamically from agent output
  switch (name) {
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

    case EventName.QUEUED_MESSAGE_ACK:
      // Agent only sends messageId; we need to add threadId from context
      if (threadId) {
        const messageId = (payload as { messageId: string }).messageId;
        // Confirm in store (single source of truth)
        useQueuedMessagesStore.getState().confirmMessage(messageId);
        // Still emit event for any other listeners
        eventBus.emit(EventName.QUEUED_MESSAGE_ACK, {
          threadId,
          messageId,
        });
      } else {
        logger.warn(`[handleAgentEvent] QUEUED_MESSAGE_ACK received without threadId context`);
      }
      break;

    case EventName.PLAN_DETECTED:
      // Forward plan:detected to eventBus - listeners will refresh from disk
      logger.info(`[handleAgentEvent] 📋 PLAN_DETECTED received from agent stdout, planId=${(payload as { planId: string }).planId}`);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      eventBus.emit(name as any, payload as any);
      logger.info(`[handleAgentEvent] 📋 PLAN_DETECTED emitted to eventBus`);
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
  /** Repository UUID from settings.json */
  repoId: string;
  /** Worktree UUID from settings.json (can be same as repoId for main worktree) */
  worktreeId: string;
  threadId: string;
  prompt: string;
  /** Repository source path - agent runs here directly (no worktree) */
  sourcePath: string;
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
          logger.info(`[simple-agent:${threadId}] 📤 Parsed event from stdout: name=${output.name}`);
          handleAgentEvent(output, threadId);
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
 * Schema for validating spawn options.
 * Ensures repoId, worktreeId, and threadId are valid UUIDs.
 */
const SpawnOptionsSchema = z.object({
  repoId: z.string().uuid("repoId must be a valid UUID"),
  worktreeId: z.string().uuid("worktreeId must be a valid UUID"),
  threadId: z.string().uuid("threadId must be a valid UUID"),
  prompt: z.string(),
  sourcePath: z.string(),
});

/**
 * Spawns a simple agent that runs directly in the source repository.
 * No worktree allocation, no branch management.
 */
export async function spawnSimpleAgent(options: SpawnSimpleAgentOptions): Promise<void> {
  logger.info("[agent-service] spawnSimpleAgent START");

  // Validate UUIDs early to fail fast with clear error
  const parsed = SpawnOptionsSchema.parse(options);

  // Ensure shell is initialized to get proper PATH with version managers (nvm, fnm, volta, etc.)
  await ensureShellInitialized();

  logger.info(`[agent-service] Agent will spawn in path: ${parsed.sourcePath}`);

  const mortDir = await fs.getDataDir();
  const { runnerPath, nodeModulesPath } = await getRunnerPaths();
  const shellPath = await getShellPath();

  // Debug logging for spawn diagnostics
  logger.info("[agent-service] spawnSimpleAgent paths:", {
    mortDir,
    runnerPath,
    nodeModulesPath,
    shellPathLength: shellPath?.length ?? 0,
    shellPathPreview: shellPath?.substring(0, 200) ?? "NULL",
    sourcePath: options.sourcePath,
  });

  // Check if paths exist (to diagnose "file not found" errors)
  try {
    const runnerExists = await fs.exists(runnerPath);
    const cwdExists = await fs.exists(options.sourcePath);
    const nodeModulesExists = await fs.exists(nodeModulesPath);
    logger.info("[agent-service] Path existence check:", {
      runnerPath,
      runnerExists,
      cwdPath: options.sourcePath,
      cwdExists,
      nodeModulesPath,
      nodeModulesExists,
    });
  } catch (e) {
    logger.error("[agent-service] Failed to check path existence:", e);
  }

  // Get API key from settings or env
  const settings = settingsService.get();
  const apiKey = settings.anthropicApiKey || import.meta.env.VITE_ANTHROPIC_API_KEY;

  if (!apiKey) {
    throw new Error("Anthropic API key not configured");
  }

  // Command args for simple agent - matches SimpleRunnerStrategy.parseArgs()
  const commandArgs = [
    runnerPath,
    "--repo-id", parsed.repoId,
    "--worktree-id", parsed.worktreeId,
    "--thread-id", parsed.threadId,
    "--cwd", parsed.sourcePath,
    "--prompt", parsed.prompt,
    "--mort-dir", mortDir,
  ];

  logger.info("[agent-service] spawnSimpleAgent command:", {
    command: "node",
    argsCount: commandArgs.length,
    firstArg: commandArgs[0],
    cwd: options.sourcePath,
  });

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
  logger.info("[agent-service] About to spawn command...");
  try {
    const child = await command.spawn();
    activeSimpleProcesses.set(options.threadId, child);
    agentProcesses.set(options.threadId, child);
    logger.info(`[agent-service] Agent spawned for threadId=${options.threadId}, pid=${child.pid}`);

    eventBus.emit(EventName.AGENT_SPAWNED, {
      threadId: options.threadId,
      repoId: options.repoId,
    });

    logger.info("[agent-service] spawnSimpleAgent COMPLETE");
  } catch (spawnError) {
    logger.error("[agent-service] SPAWN FAILED:", {
      error: spawnError,
      errorMessage: spawnError instanceof Error ? spawnError.message : String(spawnError),
      errorType: typeof spawnError,
      errorConstructor: spawnError?.constructor?.name,
    });
    throw spawnError;
  }
}

/**
 * Resumes a simple agent with a new prompt.
 * State path: threads/{threadId}/state.json
 */
export async function resumeSimpleAgent(
  threadId: string,
  prompt: string,
  sourcePath: string,
): Promise<void> {
  // Ensure shell is initialized to get proper PATH with version managers (nvm, fnm, volta, etc.)
  await ensureShellInitialized();

  const mortDir = await fs.getDataDir();
  const { runnerPath, nodeModulesPath } = await getRunnerPaths();
  const shellPath = await getShellPath();

  // Get API key from settings or env
  const settings = settingsService.get();
  const apiKey = settings.anthropicApiKey || import.meta.env.VITE_ANTHROPIC_API_KEY;

  if (!apiKey) {
    throw new Error("Anthropic API key not configured");
  }

  // State path: threads/{threadId}/state.json
  const stateFilePath = await join(mortDir, "threads", threadId, "state.json");

  // Get repoId and worktreeId from thread metadata for resume
  const thread = threadService.get(threadId);
  const repoId = thread?.repoId ?? threadId;
  const worktreeId = thread?.worktreeId ?? threadId;

  const commandArgs = [
    runnerPath,
    "--repo-id", repoId,
    "--worktree-id", worktreeId,
    "--thread-id", threadId,
    "--cwd", sourcePath,
    "--prompt", prompt,
    "--mort-dir", mortDir,
    "--history-file", stateFilePath,
  ];

  logger.info("[agent-service] Resuming simple agent", { threadId });

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
  threadId: string,
  toolId: string,
  response: string,
  workingDirectory: string
): Promise<void> {
  return invoke("submit_tool_result", {
    threadId,
    toolId,
    response,
    workingDirectory,
  });
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

  // Add to store BEFORE sending (optimistic)
  useQueuedMessagesStore.getState().addMessage(threadId, messageId, message);

  try {
    await child.write(payload);
    logger.info('[agent-service] Sent queued message', { threadId, messageId });
    return messageId;
  } catch (err) {
    // Rollback on failure
    useQueuedMessagesStore.getState().confirmMessage(messageId);
    throw err;
  }
}

