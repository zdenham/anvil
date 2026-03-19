import { writeFileSync, readFileSync, existsSync } from "fs";
import { join, isAbsolute, relative } from "path";
import { z } from "zod";
import type { ThreadWriter } from "./services/thread-writer.js";
import { logger } from "./lib/logger.js";
import { threadReducer, type ThreadAction } from "@core/lib/thread-reducer.js";
import type {
  FileChange,
  ResultMetrics,
  StoredMessage,
  ThreadState,
  ToolExecutionState,
  TokenUsage,
} from "@core/types/events.js";
import type { HubClient } from "./lib/hub/index.js";

/**
 * Normalize a file path to be relative to the working directory.
 * This ensures consistent path handling regardless of whether tools
 * return absolute or relative paths.
 */
function normalizeToRelativePath(filePath: string, workingDirectory: string): string {
  if (isAbsolute(filePath)) {
    return relative(workingDirectory, filePath);
  }
  return filePath;
}

/**
 * Schema for tool event protocol messages.
 * CLI tools can emit events by outputting JSON in this format.
 */
const ToolEventSchema = z.object({
  type: z.literal("event"),
  name: z.string(),
  payload: z.record(z.string(), z.unknown()),
});

// Re-export shared types for backwards compatibility
export type { FileChange, ResultMetrics, ThreadState, ToolExecutionState, TokenUsage };

let statePath: string;
let metadataPath: string;
let state: ThreadState;
let threadWriter: ThreadWriter | null = null;
let hubClient: HubClient | null = null;

/** Track last logged connection state to avoid spamming on every write. */
let lastLoggedConnectionState: string | null = null;

/**
 * Set the hub client for socket-based communication.
 * Called from runner.ts after connecting to the AgentHub.
 */
export function setHubClient(client: HubClient): void {
  hubClient = client;
}

/**
 * Get the current hub client for socket-based communication.
 * Returns null if not connected.
 */
export function getHubClient(): HubClient | null {
  return hubClient;
}

/**
 * Emit via socket with connection-state-aware logging.
 *
 * - connected: call sendFn directly (HubClient stamps and writes)
 * - reconnecting: call sendFn (HubClient queues internally during reconnect)
 * - disconnected: log once on transition, then silently drop
 */
function emitViaSocket(sendFn: () => void): void {
  if (!hubClient) return;

  const connState = hubClient.connectionState;
  if (connState === "connected" || connState === "reconnecting") {
    sendFn();
    if (lastLoggedConnectionState === "disconnected") {
      lastLoggedConnectionState = connState;
    }
    return;
  }

  // disconnected — log once on transition
  if (lastLoggedConnectionState !== "disconnected") {
    logger.debug("[output] Hub disconnected, state written to disk only");
    lastLoggedConnectionState = "disconnected";
  }
}

// ============================================================================
// Dispatch — single entry point for all state mutations + socket emission
// ============================================================================

/**
 * Apply a ThreadAction through the shared reducer and emit it via socket.
 * Every state change flows through here, keeping agent and client in sync.
 */
function dispatch(action: ThreadAction): void {
  state = threadReducer(state, action);
  emitAction(action);
}

/** Send a ThreadAction over the socket for client-side replay. */
function emitAction(action: ThreadAction): void {
  emitViaSocket(() => hubClient?.send({ type: "thread_action", action }));
}

/**
 * Initialize state with thread path, working directory, optional prior state, and ThreadWriter.
 */
export async function initState(
  threadPath: string,
  workingDirectory: string,
  priorMessages: StoredMessage[] = [],
  writer?: ThreadWriter,
  priorSessionId?: string,
  priorToolStates?: Record<string, ToolExecutionState>,
  priorLastCallUsage?: TokenUsage,
  priorCumulativeUsage?: TokenUsage,
  priorFileChanges?: FileChange[],
): Promise<void> {
  statePath = join(threadPath, "state.json");
  metadataPath = join(threadPath, "metadata.json");
  threadWriter = writer ?? null;

  dispatch({
    type: "INIT",
    payload: {
      workingDirectory,
      messages: priorMessages,
      sessionId: priorSessionId,
      toolStates: priorToolStates,
      lastCallUsage: priorLastCallUsage,
      cumulativeUsage: priorCumulativeUsage,
      fileChanges: priorFileChanges,
    },
  });
  await writeToDisk();
}

/**
 * Emit full state as a HYDRATE action for reconnection/cold-start.
 * Writes to disk first (disk-as-truth), then sends HYDRATE over socket.
 */
export async function emitState(): Promise<void> {
  state.timestamp = Date.now();
  const snapshot = structuredClone(state);
  await writeStateToDisk(snapshot);
  emitAction({ type: "HYDRATE", payload: { state: snapshot } });
}

/**
 * Write current state to disk with fresh timestamp.
 * Used after dispatch() — socket emission already happened in dispatch.
 */
async function writeToDisk(): Promise<void> {
  state.timestamp = Date.now();
  await writeStateToDisk(structuredClone(state));
}

/**
 * Write state to disk via ThreadWriter or direct sync write.
 */
async function writeStateToDisk(payload: ThreadState): Promise<void> {
  if (threadWriter) {
    try {
      await threadWriter.writeState(payload);
    } catch (err) {
      logger.warn(`[output] Failed to write state via ThreadWriter: ${err}`);
      writeFileSync(statePath, JSON.stringify(payload, null, 2));
    }
  } else {
    writeFileSync(statePath, JSON.stringify(payload, null, 2));
  }
}

/**
 * Append a user message to the thread.
 */
export async function appendUserMessage(id: string, content: string): Promise<void> {
  dispatch({ type: "APPEND_USER_MESSAGE", payload: { content, id } });
  await writeToDisk();
}

/**
 * Append a user message to local state and disk only (no socket emission).
 * Used for queued messages where the frontend manages visibility via the
 * queued store + ACK flow rather than thread_action replay.
 */
export async function appendUserMessageLocal(id: string, content: string): Promise<void> {
  state = threadReducer(state, { type: "APPEND_USER_MESSAGE", payload: { content, id } });
  await writeToDisk();
}

/**
 * Move a message to the end of the messages array (dispatch + disk write).
 * Used by QueuedAckManager to reposition queued messages after ACK.
 */
export async function moveMessageToEnd(id: string): Promise<void> {
  dispatch({ type: "MOVE_MESSAGE_TO_END", payload: { id } });
  await writeToDisk();
}

/**
 * Append an assistant message with a stable UUID and anthropicId for reducer matching.
 */
export async function appendAssistantMessage(message: StoredMessage): Promise<void> {
  dispatch({ type: "APPEND_ASSISTANT_MESSAGE", payload: { message } });
  await writeToDisk();
}

/**
 * Mark a tool as running (called when assistant message has tool_use).
 */
export async function markToolRunning(toolUseId: string, toolName: string): Promise<void> {
  dispatch({ type: "MARK_TOOL_RUNNING", payload: { toolUseId, toolName } });
  await writeToDisk();
}

/**
 * Mark a tool as complete (called when user message has tool result).
 */
export async function markToolComplete(
  toolUseId: string,
  result: string,
  isError: boolean,
): Promise<void> {
  dispatch({ type: "MARK_TOOL_COMPLETE", payload: { toolUseId, result, isError } });
  await writeToDisk();
}

/**
 * Update or add a file change. Paths are normalized to be relative to the working directory.
 */
export async function updateFileChange(change: FileChange, workingDirectory?: string): Promise<void> {
  const normalizedPath = workingDirectory
    ? normalizeToRelativePath(change.path, workingDirectory)
    : change.path;

  dispatch({
    type: "UPDATE_FILE_CHANGE",
    payload: { change: { ...change, path: normalizedPath } },
  });
  await writeToDisk();
}

/**
 * Mark the thread as complete with metrics.
 * Writes totalCostUsd to metadata.json so cost lives exclusively in metadata.
 */
export async function complete(metrics: ResultMetrics): Promise<void> {
  dispatch({ type: "COMPLETE", payload: { metrics } });
  await writeToDisk();
  await writeCostToMetadata(metadataPath, metrics.totalCostUsd);
}

/**
 * Mark the thread as errored.
 */
export async function error(message: string): Promise<void> {
  dispatch({ type: "ERROR", payload: { message } });
  await writeToDisk();
}

/**
 * Mark the thread as cancelled.
 */
export async function cancelled(): Promise<void> {
  dispatch({ type: "CANCELLED" });
  await writeToDisk();
}

/**
 * Get current messages (for UI display).
 */
export function getMessages(): StoredMessage[] {
  return state.messages;
}

/**
 * Set the SDK session ID (called when we receive init message from SDK).
 */
export async function setSessionId(sessionId: string): Promise<void> {
  dispatch({ type: "SET_SESSION_ID", payload: { sessionId } });
  await writeToDisk();
}

/**
 * Get current session ID (for SDK resume).
 */
export function getSessionId(): string | undefined {
  return state.sessionId;
}

/**
 * Update token usage from the latest API call.
 * Sets per-call snapshot and accumulates cumulative totals.
 */
export async function updateUsage(usage: TokenUsage): Promise<void> {
  dispatch({ type: "UPDATE_USAGE", payload: { usage } });
  await writeToDisk();

  // Also write usage to metadata.json so it's available without loading full state
  await writeUsageToMetadata(metadataPath, state.lastCallUsage, state.cumulativeUsage);
}

/**
 * Read-modify-write usage fields into a metadata.json file.
 * Used by updateUsage (parent thread) and child thread handling.
 */
export async function writeUsageToMetadata(
  mdPath: string,
  lastCallUsage: TokenUsage | undefined,
  cumulativeUsage: TokenUsage | undefined,
): Promise<void> {
  try {
    if (!existsSync(mdPath)) return;
    const raw = readFileSync(mdPath, "utf-8");
    const metadata = JSON.parse(raw);
    metadata.lastCallUsage = lastCallUsage;
    metadata.cumulativeUsage = cumulativeUsage;
    metadata.updatedAt = Date.now();

    if (threadWriter) {
      try {
        await threadWriter.writeMetadata(metadata);
      } catch {
        writeFileSync(mdPath, JSON.stringify(metadata, null, 2));
      }
    } else {
      writeFileSync(mdPath, JSON.stringify(metadata, null, 2));
    }
  } catch (err) {
    logger.warn(`[output] Failed to write usage to metadata: ${err}`);
  }
}

/**
 * Write totalCostUsd to metadata.json on thread completion.
 * Cost lives exclusively in metadata — state.json strips it via the reducer.
 */
async function writeCostToMetadata(
  mdPath: string,
  costUsd: number | undefined,
): Promise<void> {
  if (costUsd === undefined) return;
  try {
    if (!existsSync(mdPath)) return;
    const raw = readFileSync(mdPath, "utf-8");
    const metadata = JSON.parse(raw);
    metadata.totalCostUsd = costUsd;
    metadata.updatedAt = Date.now();

    if (threadWriter) {
      try {
        await threadWriter.writeMetadata(metadata);
      } catch {
        writeFileSync(mdPath, JSON.stringify(metadata, null, 2));
      }
    } else {
      writeFileSync(mdPath, JSON.stringify(metadata, null, 2));
    }
  } catch (err) {
    logger.warn(`[output] Failed to write cost to metadata: ${err}`);
  }
}

/**
 * Parse tool output for event protocol messages and relay them via socket.
 */
export function relayEventsFromToolOutput(toolOutput: string): void {
  const lines = toolOutput.split("\n");

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || !trimmed.startsWith("{")) continue;

    try {
      const parsed = JSON.parse(trimmed);

      const result = ToolEventSchema.safeParse(parsed);
      if (result.success) {
        logger.debug(`[output] Relaying event from tool output: ${result.data.name}`);
        emitViaSocket(() => hubClient?.sendEvent(result.data.name, result.data.payload));
      }
    } catch {
      // Not valid JSON, skip this line
    }
  }
}
