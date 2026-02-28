import { Command, type Child } from "@tauri-apps/plugin-shell";
import { join, resolveResource, dirname } from "@tauri-apps/api/path";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { z } from "zod";
import { FilesystemClient } from "./filesystem-client";
import { threadService, settingsService } from "@/entities";
import { eventBus } from "@/entities/events";
import { shellEnvironmentCommands } from "./tauri-commands";
import { parseAgentOutput } from "./agent-output-parser";
import { EventName, type ThreadState, type OptimisticStreamPayload } from "@core/types/events.js";
import type { PermissionModeId } from "@core/types/permissions.js";
import type { PipelineStamp } from "@core/types/pipeline.js";
import { useHeartbeatStore } from "@/stores/heartbeat-store";
import { useSettingsStore } from "@/entities/settings/store";

const fs = new FilesystemClient();
const isDev = import.meta.env.DEV;
import { logger } from "./logger-client";
import { useQueuedMessagesStore } from "@/stores/queued-messages-store";

// Cache the shell PATH to avoid repeated Tauri calls
let cachedShellPath: string | null = null;

// Track warmup status to avoid duplicate calls
let warmupPromise: Promise<void> | null = null;

// ═══════════════════════════════════════════════════════════════════════════
// Process Tracking
// ═══════════════════════════════════════════════════════════════════════════
// Track agent processes for local reference cleanup on process exit.
// Cancellation now uses socket IPC (with SIGTERM via disk-persisted PID as fallback),
// so the HMR workaround (window.__agentServiceProcessMaps) is no longer needed.
// See plans/socket-ipc/06-cleanup-migration.md

// Track active simple agent processes
const activeSimpleProcesses = new Map<string, Child>();

// Track all agent processes by threadId
const agentProcesses = new Map<string, Child>();

// ═══════════════════════════════════════════════════════════════════════════
// Socket IPC: Tauri Event Listener for Agent Messages
// ═══════════════════════════════════════════════════════════════════════════
// Agents connect to AgentHub socket and send messages, which Tauri emits as
// `agent:message` events. This listener routes those messages to the eventBus.

/**
 * Message structure received from the AgentHub via Tauri events.
 * Matches the SocketMessage struct in agent_hub.rs.
 */
interface AgentSocketMessage {
  senderId: string;
  threadId: string;
  type: string;
  parentId?: string;
  // Flattened fields from the message
  state?: ThreadState;
  name?: string;
  payload?: unknown;
  blocks?: OptimisticStreamPayload["blocks"];
  /** Pipeline stamps from upstream stages (agent:sent, hub:received, hub:emitted) */
  pipeline?: PipelineStamp[];
  /** Agent-side timestamp (for heartbeat messages) */
  timestamp?: number;
}

/** Unlisten function for the agent message listener */
let agentMessageUnlisten: UnlistenFn | null = null;

// ═══════════════════════════════════════════════════════════════════════════
// Pipeline Sequence Tracking
// ═══════════════════════════════════════════════════════════════════════════

/** Last seen sequence number per thread — used for gap detection */
const lastSeqByThread = new Map<string, number>();

/**
 * Checks for sequence gaps and logs pipeline diagnostics.
 * Returns the sequence number from the first pipeline stamp.
 */
function trackPipelineSeq(msg: AgentSocketMessage): number {
  const seq = msg.pipeline?.[0]?.seq ?? 0;
  if (seq === 0) return 0;

  const lastSeq = lastSeqByThread.get(msg.threadId) ?? 0;

  // Detect gaps (always logged, not diagnostic-gated)
  if (lastSeq > 0 && seq > lastSeq + 1) {
    const gapSize = seq - lastSeq - 1;
    const lastStage = msg.pipeline?.[0]?.stage ?? "unknown";

    logger.warn(
      `[agent-service] SEQ GAP: expected ${lastSeq + 1}, got ${seq} — ${gapSize} events dropped. Last seen stages: ${lastStage}@seq=${lastSeq}`
    );

    // Record gap in heartbeat store for diagnostic panel
    useHeartbeatStore.getState().addGapRecord({
      threadId: msg.threadId,
      expectedSeq: lastSeq + 1,
      receivedSeq: seq,
      gapSize,
      timestamp: Date.now(),
      lastStage,
    });
  }

  lastSeqByThread.set(msg.threadId, seq);

  // Diagnostic pipeline logging (opt-in)
  const diagnosticConfig = useSettingsStore.getState().workspace.diagnosticLogging;
  if (diagnosticConfig?.pipeline && msg.pipeline) {
    const stages = msg.pipeline.map(
      (s) => `${s.stage}@${s.seq}(${s.ts})`
    ).join(" -> ");
    logger.debug(`[agent-service] Pipeline trail: ${stages} -> frontend:received@${seq}(${Date.now()})`);
  }

  return seq;
}

/**
 * Cleans up sequence tracking for a thread.
 */
function cleanupSeqTracking(threadId: string): void {
  lastSeqByThread.delete(threadId);
}

/**
 * Initializes the Tauri event listener for agent messages from the AgentHub socket.
 * Messages are routed to the eventBus based on their type.
 *
 * Call this once on app initialization. Safe to call multiple times - subsequent
 * calls are no-ops.
 */
export async function initAgentMessageListener(): Promise<void> {
  if (agentMessageUnlisten) {
    logger.info("[agent-service] Agent message listener already initialized");
    return;
  }

  logger.info("[agent-service] Initializing agent:message event listener");

  agentMessageUnlisten = await listen<AgentSocketMessage>("agent:message", (event) => {
    const msg = event.payload;
    logger.debug(`[agent-service] Received agent:message`, {
      threadId: msg.threadId,
      type: msg.type,
      senderId: msg.senderId,
    });

    // Track pipeline sequence for all messages (gap detection)
    const seq = trackPipelineSeq(msg);

    switch (msg.type) {
      case "state":
        // Agent sent a state update
        if (msg.state) {
          eventBus.emit(EventName.AGENT_STATE, {
            threadId: msg.threadId,
            state: msg.state,
          });
        }
        break;

      case "event":
        // Agent sent a named event - route based on event name
        if (msg.name) {
          routeAgentEvent(msg.threadId, msg.name, msg.payload);
        }
        break;

      case "optimistic_stream":
        // Agent sent a live streaming content snapshot
        if (msg.blocks) {
          eventBus.emit(EventName.OPTIMISTIC_STREAM, {
            threadId: msg.threadId,
            blocks: msg.blocks,
          });
        }
        break;

      case "heartbeat":
        // Agent sent a heartbeat — update heartbeat store
        useHeartbeatStore.getState().updateHeartbeat(
          msg.threadId,
          msg.timestamp ?? Date.now(),
          seq,
        );
        break;

      case "log":
        // Agent sent a log message - just log it, don't route to eventBus
        logger.info(`[Agent ${msg.threadId}]`, msg.payload);
        break;

      default:
        logger.warn(`[agent-service] Unknown message type: ${msg.type}`);
    }
  });

  logger.info("[agent-service] Agent message listener initialized");
}

/**
 * Routes a named event from an agent to the appropriate eventBus handler.
 */
function routeAgentEvent(threadId: string, eventName: string, payload: unknown): void {
  logger.info(`[agent-service] Routing event: ${eventName} for thread ${threadId}`);

  // Cast payload based on event type and emit to eventBus
  switch (eventName) {
    case EventName.PERMISSION_REQUEST:
      eventBus.emit(EventName.PERMISSION_REQUEST, payload as {
        requestId: string;
        threadId: string;
        toolName: string;
        toolInput: Record<string, unknown>;
        toolUseId?: string;
        timestamp: number;
      });
      break;

    case EventName.QUESTION_REQUEST:
      eventBus.emit(EventName.QUESTION_REQUEST, payload as {
        requestId: string;
        threadId: string;
        toolUseId: string;
        toolInput: Record<string, unknown>;
        timestamp: number;
      });
      break;

    case EventName.THREAD_CREATED:
    case EventName.THREAD_UPDATED:
    case EventName.THREAD_STATUS_CHANGED:
    case EventName.WORKTREE_ALLOCATED:
    case EventName.WORKTREE_RELEASED:
    case EventName.WORKTREE_NAME_GENERATED:
    case EventName.ACTION_REQUESTED:
    case EventName.AGENT_CANCELLED:
    case EventName.THREAD_NAME_GENERATED:
    case EventName.PLAN_DETECTED:
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      eventBus.emit(eventName as any, payload as any);
      break;

    case EventName.QUEUED_MESSAGE_ACK:
      // Handle queued message acknowledgement
      const ackPayload = payload as { messageId: string };
      useQueuedMessagesStore.getState().confirmMessage(ackPayload.messageId);
      eventBus.emit(EventName.QUEUED_MESSAGE_ACK, {
        threadId,
        messageId: ackPayload.messageId,
      });
      break;

    default:
      // For unknown events, emit them generically (allows extension)
      logger.warn(`[agent-service] Unhandled event name: ${eventName}`);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      eventBus.emit(eventName as any, { threadId, payload });
  }
}

/**
 * Cleans up the Tauri event listener for agent messages.
 * Call this on app unmount.
 */
export function cleanupAgentMessageListener(): void {
  if (agentMessageUnlisten) {
    logger.info("[agent-service] Cleaning up agent message listener");
    agentMessageUnlisten();
    agentMessageUnlisten = null;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Socket IPC: Send Messages to Agents via Tauri Command
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Sends a message to a connected agent via the AgentHub socket.
 * This replaces direct stdin writes for socket-connected agents.
 *
 * @param threadId - The thread ID of the agent to send to
 * @param message - The message object to send (will be JSON stringified)
 */
export async function sendToAgent(threadId: string, message: Record<string, unknown>): Promise<void> {
  const payload = JSON.stringify({
    senderId: "tauri",
    threadId,
    ...message,
  });

  logger.debug(`[agent-service] Sending to agent ${threadId}:`, message);

  try {
    await invoke("send_to_agent", {
      threadId,
      message: payload,
    });
  } catch (error) {
    logger.error(`[agent-service] Failed to send to agent ${threadId}:`, error);
    throw error;
  }
}

/**
 * Sends a permission response to an agent via the socket.
 */
export async function sendPermissionResponseSocket(
  threadId: string,
  requestId: string,
  decision: "approve" | "deny",
  reason?: string
): Promise<void> {
  await sendToAgent(threadId, {
    type: "permission_response",
    payload: { requestId, decision, reason },
  });
  logger.info(`[agent-service] Sent permission response via socket:`, { threadId, requestId, decision });
}

/**
 * Sends a cancel signal to an agent via the socket.
 */
export async function cancelAgentSocket(threadId: string): Promise<void> {
  await sendToAgent(threadId, { type: "cancel" });
  logger.info(`[agent-service] Sent cancel via socket to agent ${threadId}`);
}

/**
 * Sends a queued message to an agent via the socket.
 */
async function sendQueuedMessageSocket(
  threadId: string,
  content: string
): Promise<string> {
  const messageId = crypto.randomUUID();
  const timestamp = Date.now();

  // Add to store BEFORE sending (optimistic)
  useQueuedMessagesStore.getState().addMessage(threadId, messageId, content);

  try {
    await sendToAgent(threadId, {
      type: "queued_message",
      payload: { id: messageId, content, timestamp },
    });
    logger.info(`[agent-service] Sent queued message via socket:`, { threadId, messageId });
    return messageId;
  } catch (err) {
    // Rollback on failure
    useQueuedMessagesStore.getState().confirmMessage(messageId);
    throw err;
  }
}

/**
 * Checks if an agent is connected via the AgentHub socket.
 * Used to determine whether to use socket or stdin for communication.
 */
export async function isAgentSocketConnected(threadId: string): Promise<boolean> {
  try {
    const connectedAgents = await invoke<string[]>("list_connected_agents");
    return connectedAgents.includes(threadId);
  } catch (error) {
    logger.warn(`[agent-service] Failed to check socket connection:`, error);
    return false;
  }
}

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
  logger.info("[agent-service] ensureShellInitialized: checking shell initialization status...");

  try {
    const initialized = await shellEnvironmentCommands.isShellInitialized();
    logger.info(`[agent-service] ensureShellInitialized: isShellInitialized returned ${initialized}`);

    if (!initialized) {
      logger.info("[agent-service] ensureShellInitialized: Shell not initialized, running login shell...");
      const startTime = Date.now();

      try {
        const success = await shellEnvironmentCommands.initializeShellEnvironment();
        const elapsed = Date.now() - startTime;

        if (success) {
          // Clear cached shell path so next getShellPath() fetches updated value
          cachedShellPath = null;
          logger.info(`[agent-service] ensureShellInitialized: Shell initialized successfully in ${elapsed}ms`);
        } else {
          logger.warn(`[agent-service] ensureShellInitialized: Shell initialization returned false after ${elapsed}ms, will use fallback PATH`);
        }
      } catch (initError) {
        const elapsed = Date.now() - startTime;
        logger.error(`[agent-service] ensureShellInitialized: Shell initialization threw error after ${elapsed}ms:`, {
          error: initError,
          errorMessage: initError instanceof Error ? initError.message : String(initError),
          errorStack: initError instanceof Error ? initError.stack : undefined,
        });
        // Don't rethrow - we'll proceed with fallback PATH
      }
    } else {
      logger.info("[agent-service] ensureShellInitialized: Shell already initialized, skipping");
    }
  } catch (checkError) {
    logger.error("[agent-service] ensureShellInitialized: Failed to check shell initialization status:", {
      error: checkError,
      errorMessage: checkError instanceof Error ? checkError.message : String(checkError),
    });
    // Don't rethrow - we'll proceed with whatever PATH we have
  }
}

/**
 * Pre-warms the agent environment at app startup.
 * Call this early in the app lifecycle to ensure shell is initialized
 * before the user creates their first thread.
 *
 * This eliminates the 100-500ms delay on first thread creation that
 * comes from shell initialization (capturing user's PATH for nvm/fnm/volta).
 *
 * Safe to call multiple times - subsequent calls return immediately.
 */
export async function warmupAgentEnvironment(): Promise<void> {
  // Return existing promise if warmup is in progress or completed
  if (warmupPromise) {
    return warmupPromise;
  }

  warmupPromise = (async () => {
    const startTime = Date.now();
    logger.info("[agent-service] warmupAgentEnvironment: Starting...");

    try {
      // Pre-initialize shell environment (the main bottleneck on first run)
      await ensureShellInitialized();

      // Pre-resolve runner paths (minor optimization)
      await getRunnerPaths();

      const elapsed = Date.now() - startTime;
      logger.info(`[agent-service] warmupAgentEnvironment: Completed in ${elapsed}ms`);
    } catch (error) {
      const elapsed = Date.now() - startTime;
      logger.warn(`[agent-service] warmupAgentEnvironment: Failed after ${elapsed}ms:`, error);
      // Don't rethrow - warmup failure shouldn't block app startup
      // The shell will be initialized lazily on first thread creation
    }
  })();

  return warmupPromise;
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
  /** Permission mode for tool execution (defaults to "implement" if not provided) */
  permissionMode?: PermissionModeId;
  /** Skip worktree/thread naming (for setup threads) */
  skipNaming?: boolean;
}

// ═══════════════════════════════════════════════════════════════════════════
// Simple Agent Support
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Handles stdout output from an agent process.
 *
 * SOCKET-ONLY COMMUNICATION:
 * State and events now come exclusively via the AgentHub socket (agent:message events).
 * Stdout is used ONLY for log messages and debug output.
 *
 * NOTE: State and event parsing from stdout has been removed as part of the
 * socket IPC migration (see plans/socket-ipc/06-cleanup-migration.md).
 * All communication now goes through the socket.
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
        case "state":
          // State and events are now received via socket (agent:message Tauri events).
          // These should not appear in stdout anymore - log a warning if they do.
          logger.warn(`[simple-agent:${threadId}] Received ${output.type} via stdout - this is deprecated. Messages should come via socket.`);
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
  permissionMode: z.enum(["plan", "implement", "approve"]).optional(),
  skipNaming: z.boolean().optional(),
});

/**
 * Spawns a simple agent that runs directly in the source repository.
 * No worktree allocation, no branch management.
 */
export async function spawnSimpleAgent(options: SpawnSimpleAgentOptions): Promise<void> {
  const spawnStartTime = Date.now();
  logger.info("[agent-service] spawnSimpleAgent", {
    repoId: options.repoId,
    worktreeId: options.worktreeId,
    threadId: options.threadId,
    sourcePath: options.sourcePath,
    promptLength: options.prompt?.length ?? 0,
  });

  // Validate UUIDs early to fail fast with clear error
  let parsed: typeof options;
  try {
    parsed = SpawnOptionsSchema.parse(options);
  } catch (zodError) {
    logger.error("[agent-service] Zod validation FAILED:", {
      error: zodError,
      errorMessage: zodError instanceof Error ? zodError.message : String(zodError),
    });
    throw zodError;
  }

  // Ensure shell is initialized to get proper PATH with version managers (nvm, fnm, volta, etc.)
  await ensureShellInitialized();

  let mortDir: string;
  try {
    mortDir = await fs.getDataDir();
  } catch (mortDirError) {
    logger.error("[agent-service] Failed to get mortDir:", {
      error: mortDirError,
      errorMessage: mortDirError instanceof Error ? mortDirError.message : String(mortDirError),
    });
    throw mortDirError;
  }

  let runnerPath: string;
  let nodeModulesPath: string;
  try {
    const paths = await getRunnerPaths();
    runnerPath = paths.runnerPath;
    nodeModulesPath = paths.nodeModulesPath;
  } catch (pathsError) {
    logger.error("[agent-service] Failed to get runner paths:", {
      error: pathsError,
      errorMessage: pathsError instanceof Error ? pathsError.message : String(pathsError),
    });
    throw pathsError;
  }

  let shellPath: string;
  try {
    shellPath = await getShellPath();
  } catch (shellPathError) {
    logger.error("[agent-service] Failed to get shell PATH:", {
      error: shellPathError,
      errorMessage: shellPathError instanceof Error ? shellPathError.message : String(shellPathError),
    });
    throw shellPathError;
  }

  logger.info("[agent-service] Paths resolved", {
    mortDir,
    runnerPath,
    nodeModulesPath,
    sourcePath: options.sourcePath,
  });

  const pathEntries = shellPath?.split(":") ?? [];

  // Check if paths exist (to diagnose "file not found" errors)
  try {
    const runnerExists = await fs.exists(runnerPath);
    const cwdExists = await fs.exists(options.sourcePath);
    const nodeModulesExists = await fs.exists(nodeModulesPath);

    if (!runnerExists) {
      logger.error("[agent-service] CRITICAL: runner.js does not exist at path:", runnerPath);
    }
    if (!cwdExists) {
      logger.error("[agent-service] CRITICAL: working directory does not exist:", options.sourcePath);
    }
    if (!nodeModulesExists) {
      logger.warn("[agent-service] WARNING: node_modules path does not exist:", nodeModulesPath);
    }
  } catch (e) {
    logger.error("[agent-service] Failed to check path existence:", {
      error: e,
      errorMessage: e instanceof Error ? e.message : String(e),
    });
  }

  // Get API key from settings or env
  const settings = settingsService.get();
  const apiKey = settings.anthropicApiKey || import.meta.env.VITE_ANTHROPIC_API_KEY;

  if (!apiKey) {
    logger.error("[agent-service] No Anthropic API key configured");
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
    ...(parsed.permissionMode ? ["--permission-mode", parsed.permissionMode] : []),
    ...(parsed.skipNaming ? ["--skip-naming"] : []),
  ];

  // Build diagnostic logging env var from current settings
  const diagnosticConfig = useSettingsStore.getState().workspace.diagnosticLogging;
  const diagnosticEnv = diagnosticConfig ? JSON.stringify(diagnosticConfig) : undefined;

  const envVars: Record<string, string> = {
    ANTHROPIC_API_KEY: apiKey,
    NODE_PATH: nodeModulesPath,
    MORT_DATA_DIR: mortDir,
    PATH: shellPath,
  };
  if (diagnosticEnv) {
    envVars.MORT_DIAGNOSTIC_LOGGING = diagnosticEnv;
  }

  const command = Command.create("node", commandArgs, {
    cwd: options.sourcePath,
    env: envVars,
  });

  // Line buffer for stdout - shell plugin may split JSON across chunks
  // NOTE: Socket-connected agents send state/events via the AgentHub socket,
  // but we still process stdout for backward compatibility and debug logs.
  // See handleSimpleAgentOutput() documentation for dual-path communication details.
  const stdoutBuffer = { value: "" };

  command.stdout.on("data", (data) => {
    handleSimpleAgentOutput(options.threadId, data, stdoutBuffer);
  });

  command.stderr.on("data", (data) => {
    // Log stderr as error level since it often contains important error info
    logger.error("[simple-agent] stderr:", data);
  });

  command.on("close", async (code) => {
    const totalElapsed = Date.now() - spawnStartTime;
    logger.info(`[agent-service] Process closed`, {
      threadId: options.threadId,
      exitCode: code.code,
      signal: code.signal,
      totalElapsedMs: totalElapsed,
    });

    // Note: PID is cleared by the runner during cleanup, not here
    activeSimpleProcesses.delete(options.threadId);
    agentProcesses.delete(options.threadId);
    cleanupSeqTracking(options.threadId);

    if (code.code === 130) {
      // Cancelled via SIGINT/SIGTERM (exit code 128 + 2)
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
  const preSpawnTime = Date.now();
  try {
    const child = await command.spawn();
    const spawnDuration = Date.now() - preSpawnTime;

    activeSimpleProcesses.set(options.threadId, child);
    agentProcesses.set(options.threadId, child);

    logger.info("[agent-service] Spawn success", {
      threadId: options.threadId,
      pid: child.pid,
      spawnDurationMs: spawnDuration,
      totalSetupMs: Date.now() - spawnStartTime,
    });

    eventBus.emit(EventName.AGENT_SPAWNED, {
      threadId: options.threadId,
      repoId: options.repoId,
    });
  } catch (spawnError) {
    logger.error("[agent-service] Spawn failed", {
      error: spawnError,
      errorMessage: spawnError instanceof Error ? spawnError.message : String(spawnError),
      errorStack: spawnError instanceof Error ? spawnError.stack : undefined,
      threadId: options.threadId,
      sourcePath: options.sourcePath,
      runnerPath,
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
  const resumeStartTime = Date.now();
  logger.info("[agent-service] resumeSimpleAgent", {
    threadId,
    promptLength: prompt.length,
    sourcePath,
  });

  // Ensure shell is initialized to get proper PATH with version managers (nvm, fnm, volta, etc.)
  await ensureShellInitialized();

  const mortDir = await fs.getDataDir();
  const { runnerPath, nodeModulesPath } = await getRunnerPaths();
  const shellPath = await getShellPath();

  // Get API key from settings or env
  const settings = settingsService.get();
  const apiKey = settings.anthropicApiKey || import.meta.env.VITE_ANTHROPIC_API_KEY;

  if (!apiKey) {
    logger.error("[agent-service] resumeSimpleAgent: No API key configured");
    throw new Error("Anthropic API key not configured");
  }

  // State path: threads/{threadId}/state.json
  const stateFilePath = await join(mortDir, "threads", threadId, "state.json");

  // Get repoId and worktreeId from thread metadata for resume
  const thread = threadService.get(threadId);
  const repoId = thread?.repoId ?? threadId;
  const worktreeId = thread?.worktreeId ?? threadId;

  // Read permission mode from thread metadata (set by frontend)
  const permissionMode = thread?.permissionMode;

  const commandArgs = [
    runnerPath,
    "--repo-id", repoId,
    "--worktree-id", worktreeId,
    "--thread-id", threadId,
    "--cwd", sourcePath,
    "--prompt", prompt,
    "--mort-dir", mortDir,
    "--history-file", stateFilePath,
    ...(permissionMode ? ["--permission-mode", permissionMode] : []),
  ];

  // Build diagnostic logging env var from current settings
  const resumeDiagnosticConfig = useSettingsStore.getState().workspace.diagnosticLogging;
  const resumeEnvVars: Record<string, string> = {
    ANTHROPIC_API_KEY: apiKey,
    NODE_PATH: nodeModulesPath,
    MORT_DATA_DIR: mortDir,
    PATH: shellPath,
  };
  if (resumeDiagnosticConfig) {
    resumeEnvVars.MORT_DIAGNOSTIC_LOGGING = JSON.stringify(resumeDiagnosticConfig);
  }

  const command = Command.create("node", commandArgs, {
    cwd: sourcePath,
    env: resumeEnvVars,
  });

  const stdoutBuffer = { value: "" };

  command.stdout.on("data", (data) => {
    handleSimpleAgentOutput(threadId, data, stdoutBuffer);
  });

  command.stderr.on("data", (data) => {
    logger.error("[simple-agent-resume] stderr:", data);
  });

  command.on("close", async (code) => {
    const totalElapsed = Date.now() - resumeStartTime;
    logger.info("[agent-service] resumeSimpleAgent: process closed", {
      threadId,
      exitCode: code.code,
      signal: code.signal,
      totalElapsed: `${totalElapsed}ms`,
    });

    // Note: PID is cleared by the runner during cleanup, not here
    activeSimpleProcesses.delete(threadId);
    agentProcesses.delete(threadId);
    cleanupSeqTracking(threadId);

    if (code.code === 130) {
      // Cancelled via SIGINT/SIGTERM (exit code 128 + 2)
      logger.info("[agent-service] resumeSimpleAgent: exit code 130, marking as cancelled");
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
  try {
    const child = await command.spawn();
    activeSimpleProcesses.set(threadId, child);
    agentProcesses.set(threadId, child);
    logger.info("[agent-service] Resume spawn success", {
      threadId,
      pid: child.pid,
      elapsedMs: Date.now() - resumeStartTime,
    });
  } catch (spawnError) {
    logger.error("[agent-service] Resume spawn failed", {
      error: spawnError,
      errorMessage: spawnError instanceof Error ? spawnError.message : String(spawnError),
      threadId,
      sourcePath,
    });
    throw spawnError;
  }
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
 * Cancels a running agent.
 * Tries socket communication first (for graceful cancellation),
 * falls back to SIGTERM for process-based agents.
 *
 * Socket-connected agents receive a cancel message and can clean up gracefully.
 * Process-based agents receive SIGTERM via OS signal.
 *
 * @returns true if cancel was sent/process was killed, false if no agent found
 */
export async function cancelAgent(threadId: string): Promise<boolean> {
  logger.info(`[agent-service] cancelAgent called for threadId=${threadId}`);

  // Try socket first (preferred for graceful cancellation)
  const isSocketConnected = await isAgentSocketConnected(threadId);
  if (isSocketConnected) {
    try {
      await cancelAgentSocket(threadId);
      logger.info(`[agent-service] Sent cancel via socket to agent ${threadId}`);
      return true;
    } catch (error) {
      logger.warn(`[agent-service] Socket cancel failed, trying SIGTERM:`, error);
      // Fall through to SIGTERM
    }
  }

  // Fall back to SIGTERM for process-based agents
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
 * Sends a permission response to a running agent via socket.
 *
 * NOTE: stdin-based communication has been removed as part of the socket IPC migration.
 * All agents must now connect via socket to receive permission responses.
 * (see plans/socket-ipc/06-cleanup-migration.md)
 */
export async function sendPermissionResponse(
  threadId: string,
  requestId: string,
  decision: "approve" | "deny",
  reason?: string
): Promise<void> {
  await sendPermissionResponseSocket(threadId, requestId, decision, reason);
}

/**
 * Checks if an agent process exists for the given thread.
 * Used to verify if permission responses can be sent.
 */
export function hasAgentProcess(threadId: string): boolean {
  return agentProcesses.has(threadId);
}

// ═══════════════════════════════════════════════════════════════════════════
// Queued Message Support
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Sends a queued message to a running agent via socket.
 *
 * NOTE: stdin-based communication has been removed as part of the socket IPC migration.
 * All agents must now connect via socket to receive queued messages.
 * (see plans/socket-ipc/06-cleanup-migration.md)
 *
 * @returns The unique ID of the queued message for tracking
 */
export async function sendQueuedMessage(
  threadId: string,
  message: string
): Promise<string> {
  return await sendQueuedMessageSocket(threadId, message);
}

