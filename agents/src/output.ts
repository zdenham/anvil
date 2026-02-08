import { writeFileSync } from "fs";
import { join, isAbsolute, relative } from "path";
import { z } from "zod";
import type { MessageParam } from "@anthropic-ai/sdk/resources/messages";
import type { ThreadWriter } from "./services/thread-writer.js";
import { logger } from "./lib/logger.js";
import type {
  FileChange,
  ResultMetrics,
  ThreadState,
  ToolExecutionState,
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
export type { FileChange, ResultMetrics, ThreadState, ToolExecutionState };

let statePath: string;
let state: ThreadState;
let threadWriter: ThreadWriter | null = null;
let hubClient: HubClient | null = null;

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
 * Initialize state with thread path, working directory, optional prior state, and ThreadWriter.
 * ThreadWriter is used for resilient state.json writes that handle task renames during execution.
 *
 * @param threadPath - Path to thread directory
 * @param workingDirectory - Agent working directory
 * @param priorMessages - Prior conversation messages (for UI history display)
 * @param writer - Optional ThreadWriter for resilient writes
 * @param priorSessionId - SDK session ID from previous run (for resuming)
 * @param priorToolStates - Prior tool states (for UI rendering of completed tools from previous turns)
 */
export async function initState(
  threadPath: string,
  workingDirectory: string,
  priorMessages: MessageParam[] = [],
  writer?: ThreadWriter,
  priorSessionId?: string,
  priorToolStates?: Record<string, ToolExecutionState>
): Promise<void> {
  statePath = join(threadPath, "state.json");
  threadWriter = writer ?? null;
  state = {
    messages: priorMessages,
    fileChanges: [],
    workingDirectory,
    status: "running",
    timestamp: Date.now(),
    toolStates: priorToolStates ?? {},
    sessionId: priorSessionId,
  };
  await emitState();
}

/**
 * Emit current state to socket and write to file.
 * Each emission is a complete state snapshot.
 *
 * IMPORTANT: Disk write completes BEFORE socket emit (disk-as-truth pattern).
 * This ensures UI can safely read from disk when it receives the event signal.
 *
 * NOTE: State is ONLY emitted via socket. Agents must connect to the AgentHub
 * to communicate with the frontend. The stdout fallback has been removed as
 * part of the socket IPC migration (see plans/socket-ipc/06-cleanup-migration.md).
 */
export async function emitState(): Promise<void> {
  state.timestamp = Date.now();
  const payload = { ...state };

  logger.info(`[FC-DEBUG] emitState called`, {
    fileChangesCount: state.fileChanges.length,
    fileChangePaths: state.fileChanges.map((c) => c.path),
    status: state.status,
    messageCount: state.messages.length,
  });

  // Write to disk FIRST (await completion)
  if (threadWriter) {
    try {
      await threadWriter.writeState(payload);
    } catch (err) {
      logger.warn(`[output] Failed to write state via ThreadWriter: ${err}`);
      // Fallback to direct write if ThreadWriter fails
      writeFileSync(statePath, JSON.stringify(payload, null, 2));
    }
  } else {
    // No ThreadWriter - use direct sync write
    writeFileSync(statePath, JSON.stringify(payload, null, 2));
  }

  // Emit via socket (socket connection is required for state updates)
  if (hubClient?.isConnected) {
    hubClient.sendState(payload);
  } else {
    logger.debug(`[output] Not connected to hub, state written to disk only`);
  }
}

/**
 * Append a user message to the thread.
 */
export async function appendUserMessage(content: string): Promise<void> {
  state.messages.push({ role: "user", content });
  await emitState();
}

/**
 * Append an assistant message. Just push - SDK guarantees ordering.
 * No replace logic needed with includePartialMessages: false.
 */
export async function appendAssistantMessage(message: MessageParam): Promise<void> {
  // Defensive: log warning if consecutive assistant messages (shouldn't happen with SDK)
  const lastMsg = state.messages[state.messages.length - 1];
  if (lastMsg?.role === "assistant") {
    // Log details about both messages to help diagnose
    const summarize = (m: MessageParam) => {
      if (typeof m.content === "string") {
        return `text(${m.content.slice(0, 50)}...)`;
      }
      if (Array.isArray(m.content)) {
        return `blocks[${m.content.map(b => b.type).join(",")}]`;
      }
      return "unknown";
    };
    logger.warn(
      `[output] Consecutive assistant messages detected. ` +
      `Total messages: ${state.messages.length}. ` +
      `Previous: ${summarize(lastMsg)}, New: ${summarize(message)}`
    );
  }
  state.messages.push(message);
  await emitState();
}

/**
 * Mark a tool as running (called when assistant message has tool_use).
 */
export async function markToolRunning(toolUseId: string, toolName: string): Promise<void> {
  state.toolStates[toolUseId] = { status: "running", toolName };
  await emitState();
}

/**
 * Mark a tool as complete (called when user message has tool result).
 *
 * NOTE: This updates tool STATE only. It does NOT add messages to history.
 * Message history is built directly from SDK messages via MessageHandler.
 */
export async function markToolComplete(
  toolUseId: string,
  result: string,
  isError: boolean
): Promise<void> {
  const existingState = state.toolStates[toolUseId];
  const toolName = existingState?.toolName;

  // Defensive validation: toolName should exist from markToolRunning
  if (!toolName) {
    logger.warn(
      `[markToolComplete] toolName missing for ${toolUseId}. ` +
        `This may indicate messages arrived out of order.`
    );
  }

  state.toolStates[toolUseId] = {
    status: isError ? "error" : "complete",
    result,
    isError,
    toolName, // Preserve from running state
  };
  await emitState();
}

/**
 * Update or add a file change. Later changes for the same path supersede earlier ones.
 * Paths are normalized to be relative to the working directory.
 *
 * @param change - The file change to record
 * @param workingDirectory - The working directory for path normalization (optional for backwards compat)
 */
export async function updateFileChange(change: FileChange, workingDirectory?: string): Promise<void> {
  // Normalize path to relative if workingDirectory is provided
  const normalizedPath = workingDirectory
    ? normalizeToRelativePath(change.path, workingDirectory)
    : change.path;

  const normalizedChange: FileChange = {
    ...change,
    path: normalizedPath,
  };

  logger.info(`[FC-DEBUG] updateFileChange called`, {
    originalPath: change.path,
    normalizedPath,
    operation: change.operation,
    currentFileChangesCount: state.fileChanges.length,
  });

  const idx = state.fileChanges.findIndex((c) => c.path === normalizedPath);
  if (idx >= 0) {
    logger.info(`[FC-DEBUG] Updating existing file change at index ${idx}`);
    state.fileChanges[idx] = normalizedChange;
  } else {
    logger.info(`[FC-DEBUG] Adding new file change, new count will be ${state.fileChanges.length + 1}`);
    state.fileChanges.push(normalizedChange);
  }
  await emitState();
}

/**
 * Mark orphaned tools as errors.
 * Called before completing or erroring to clean up any tools that never finished.
 */
function markOrphanedToolsAsError(): void {
  for (const id of Object.keys(state.toolStates)) {
    if (state.toolStates[id].status === "running") {
      state.toolStates[id] = {
        status: "error",
        result: "Tool execution was interrupted",
        isError: true,
      };
    }
  }
}

/**
 * Mark the thread as complete with metrics.
 */
export async function complete(metrics: ResultMetrics): Promise<void> {
  markOrphanedToolsAsError();
  state.metrics = metrics;
  state.status = "complete";
  await emitState();
}

/**
 * Mark the thread as errored.
 */
export async function error(message: string): Promise<void> {
  markOrphanedToolsAsError();
  state.error = message;
  state.status = "error";
  await emitState();
}

/**
 * Mark the thread as cancelled.
 * Called when agent receives abort signal.
 * Returns a promise that resolves when state is persisted to disk.
 */
export async function cancelled(): Promise<void> {
  markOrphanedToolsAsError();
  state.status = "cancelled";
  await emitState();
}

/**
 * Get current messages (for UI display).
 */
export function getMessages(): MessageParam[] {
  return state.messages;
}

/**
 * Set the SDK session ID (called when we receive init message from SDK).
 */
export async function setSessionId(sessionId: string): Promise<void> {
  state.sessionId = sessionId;
  await emitState();
}

/**
 * Get current session ID (for SDK resume).
 */
export function getSessionId(): string | undefined {
  return state.sessionId;
}

/**
 * Parse tool output for event protocol messages and relay them via socket.
 *
 * CLI tools (like `mort request-human`) can emit events by outputting JSON lines
 * in the format: {"type":"event","name":"<event-name>","payload":{...}}
 *
 * These events are captured by the bash tool as part of the tool result,
 * but wouldn't normally reach the frontend. This function parses the output,
 * extracts any event protocol lines, and re-emits them via the socket
 * so the frontend can receive them.
 *
 * Uses Zod validation to ensure event messages conform to the expected schema.
 *
 * NOTE: Events are ONLY emitted via socket. The stdout fallback has been removed
 * as part of the socket IPC migration (see plans/socket-ipc/06-cleanup-migration.md).
 *
 * @param toolOutput - The raw output from a tool execution
 */
export function relayEventsFromToolOutput(toolOutput: string): void {
  const lines = toolOutput.split("\n");

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || !trimmed.startsWith("{")) continue;

    try {
      const parsed = JSON.parse(trimmed);

      // Validate with Zod schema
      const result = ToolEventSchema.safeParse(parsed);
      if (result.success) {
        // Re-emit the event via socket so frontend receives it
        logger.debug(`[output] Relaying event from tool output: ${result.data.name}`);
        if (hubClient?.isConnected) {
          hubClient.sendEvent(result.data.name, result.data.payload);
        } else {
          logger.debug(`[output] Not connected to hub, event not relayed: ${result.data.name}`);
        }
      }
    } catch {
      // Not valid JSON, skip this line
    }
  }
}
