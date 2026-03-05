import type {
  BlockDelta,
  FileChange,
  RenderContentBlock,
  ResultMetrics,
  StoredMessage,
  ThreadState,
  TokenUsage,
  ToolExecutionState,
} from "../types/events.js";

// ============================================================================
// ThreadAction — discriminated union mapping 1:1 to output.ts mutations
// ============================================================================

export type ThreadAction =
  | { type: "INIT"; payload: InitPayload }
  | { type: "APPEND_USER_MESSAGE"; payload: { content: string; id: string } }
  | { type: "APPEND_ASSISTANT_MESSAGE"; payload: { message: StoredMessage } }
  | { type: "MARK_TOOL_RUNNING"; payload: { toolUseId: string; toolName: string } }
  | { type: "MARK_TOOL_COMPLETE"; payload: { toolUseId: string; result: string; isError: boolean } }
  | { type: "UPDATE_FILE_CHANGE"; payload: { change: FileChange } }
  | { type: "SET_SESSION_ID"; payload: { sessionId: string } }
  | { type: "UPDATE_USAGE"; payload: { usage: TokenUsage } }
  | { type: "COMPLETE"; payload: { metrics: ResultMetrics } }
  | { type: "ERROR"; payload: { message: string } }
  | { type: "CANCELLED" }
  | { type: "HYDRATE"; payload: { state: ThreadState } }
  | { type: "STREAM_START"; payload: { anthropicMessageId: string } }
  | { type: "STREAM_DELTA"; payload: { anthropicMessageId: string; deltas: BlockDelta[] } };

export interface InitPayload {
  workingDirectory: string;
  messages?: StoredMessage[];
  sessionId?: string;
  toolStates?: Record<string, ToolExecutionState>;
  lastCallUsage?: TokenUsage;
  cumulativeUsage?: TokenUsage;
  fileChanges?: FileChange[];
}

// ============================================================================
// threadReducer — pure (state, action) → state
// ============================================================================

export function threadReducer(state: ThreadState, action: ThreadAction): ThreadState {
  switch (action.type) {
    case "INIT":
      return applyInit(action.payload);
    case "APPEND_USER_MESSAGE":
      return {
        ...state,
        messages: [
          ...state.messages,
          { role: "user" as const, content: action.payload.content, id: action.payload.id },
        ],
      };
    case "APPEND_ASSISTANT_MESSAGE":
      return applyAppendAssistantMessage(state, action.payload.message);
    case "MARK_TOOL_RUNNING":
      return {
        ...state,
        toolStates: {
          ...state.toolStates,
          [action.payload.toolUseId]: {
            status: "running",
            toolName: action.payload.toolName,
          },
        },
      };
    case "MARK_TOOL_COMPLETE":
      return applyMarkToolComplete(state, action.payload);
    case "UPDATE_FILE_CHANGE":
      return applyUpdateFileChange(state, action.payload);
    case "SET_SESSION_ID":
      return { ...state, sessionId: action.payload.sessionId };
    case "UPDATE_USAGE":
      return applyUpdateUsage(state, action.payload);
    case "COMPLETE":
      return applyComplete(state, action.payload);
    case "ERROR":
      return applyError(state, action.payload);
    case "CANCELLED":
      return applyCancelled(state);
    case "HYDRATE":
      return { ...action.payload.state };
    case "STREAM_START":
      return applyStreamStart(state, action.payload);
    case "STREAM_DELTA":
      return applyStreamDelta(state, action.payload);
  }
}

// ============================================================================
// Helper functions — all pure, private-scope
// ============================================================================

function applyInit(payload: InitPayload): ThreadState {
  return {
    messages: payload.messages ?? [],
    fileChanges: payload.fileChanges ?? [],
    workingDirectory: payload.workingDirectory,
    status: "running",
    timestamp: 0,
    toolStates: payload.toolStates ?? {},
    sessionId: payload.sessionId,
    lastCallUsage: payload.lastCallUsage,
    cumulativeUsage: payload.cumulativeUsage,
    idMap: {},
  };
}

/**
 * Append or replace an assistant message.
 * If the message has an anthropicId and a streaming message with that ID exists (via idMap),
 * replace the streaming message in-place. Otherwise, append.
 */
function applyAppendAssistantMessage(state: ThreadState, message: StoredMessage): ThreadState {
  const idMap = state.idMap ?? {};
  const anthropicId = message.anthropicId;

  if (anthropicId && idMap[anthropicId]) {
    // Replace the streaming message in-place
    const streamingUuid = idMap[anthropicId];
    const messages = state.messages.map((m) =>
      m.id === streamingUuid ? { ...message, id: streamingUuid } : m,
    );
    return { ...state, messages };
  }

  // No streaming message to replace — append
  return {
    ...state,
    messages: [...state.messages, message],
  };
}

/**
 * Create a new streaming assistant message with empty content.
 */
function applyStreamStart(
  state: ThreadState,
  payload: { anthropicMessageId: string },
): ThreadState {
  const idMap = { ...(state.idMap ?? {}) };

  // If we already have a message for this anthropicId, no-op
  if (idMap[payload.anthropicMessageId]) return state;

  // Generate a stable UUID for this streaming message
  const uuid = `stream-${payload.anthropicMessageId}`;
  idMap[payload.anthropicMessageId] = uuid;

  const wipMessage: StoredMessage = {
    id: uuid,
    anthropicId: payload.anthropicMessageId,
    role: "assistant",
    content: [],
  };

  return {
    ...state,
    messages: [...state.messages, wipMessage],
    idMap,
  };
}

/**
 * Apply streaming deltas to an in-flight assistant message.
 * If no message exists yet for this anthropicId, creates one first (implicit STREAM_START).
 */
function applyStreamDelta(
  state: ThreadState,
  payload: { anthropicMessageId: string; deltas: BlockDelta[] },
): ThreadState {
  const idMap = { ...(state.idMap ?? {}) };
  let messages = [...state.messages];

  // Implicit STREAM_START if needed
  if (!idMap[payload.anthropicMessageId]) {
    const uuid = `stream-${payload.anthropicMessageId}`;
    idMap[payload.anthropicMessageId] = uuid;
    messages.push({
      id: uuid,
      anthropicId: payload.anthropicMessageId,
      role: "assistant",
      content: [],
    });
  }

  const uuid = idMap[payload.anthropicMessageId];
  const msgIdx = messages.findIndex((m) => m.id === uuid);
  if (msgIdx === -1) return { ...state, idMap };

  const msg = messages[msgIdx];
  const blocks = [...(msg.content as RenderContentBlock[])];

  for (const delta of payload.deltas) {
    const existing = blocks[delta.index];
    if (existing) {
      const field = delta.type === "text" ? "text" : "thinking";
      blocks[delta.index] = {
        ...existing,
        [field]: ((existing[field] as string) ?? "") + delta.append,
        isStreaming: true,
      };
    } else {
      blocks[delta.index] =
        delta.type === "text"
          ? { type: "text", text: delta.append, isStreaming: true }
          : { type: "thinking", thinking: delta.append, isStreaming: true };
    }
  }

  messages = [...messages];
  messages[msgIdx] = { ...msg, content: blocks };

  return { ...state, messages, idMap };
}

function applyMarkToolComplete(
  state: ThreadState,
  payload: { toolUseId: string; result: string; isError: boolean },
): ThreadState {
  const existing = state.toolStates[payload.toolUseId];
  return {
    ...state,
    toolStates: {
      ...state.toolStates,
      [payload.toolUseId]: {
        status: payload.isError ? "error" : "complete",
        result: payload.result,
        isError: payload.isError,
        toolName: existing?.toolName,
      },
    },
  };
}

function applyUpdateFileChange(
  state: ThreadState,
  payload: { change: FileChange },
): ThreadState {
  const idx = state.fileChanges.findIndex((c) => c.path === payload.change.path);
  const fileChanges = [...state.fileChanges];
  if (idx >= 0) {
    fileChanges[idx] = payload.change;
  } else {
    fileChanges.push(payload.change);
  }
  return { ...state, fileChanges };
}

function applyUpdateUsage(
  state: ThreadState,
  payload: { usage: TokenUsage },
): ThreadState {
  const prev = state.cumulativeUsage;
  return {
    ...state,
    lastCallUsage: payload.usage,
    cumulativeUsage: {
      inputTokens: (prev?.inputTokens ?? 0) + payload.usage.inputTokens,
      outputTokens: (prev?.outputTokens ?? 0) + payload.usage.outputTokens,
      cacheCreationTokens: (prev?.cacheCreationTokens ?? 0) + payload.usage.cacheCreationTokens,
      cacheReadTokens: (prev?.cacheReadTokens ?? 0) + payload.usage.cacheReadTokens,
    },
  };
}

function applyComplete(
  state: ThreadState,
  payload: { metrics: ResultMetrics },
): ThreadState {
  const toolStates = markOrphanedTools(state.toolStates);
  const metrics = { ...payload.metrics };
  if (state.lastCallUsage && !metrics.lastCallUsage) {
    metrics.lastCallUsage = state.lastCallUsage;
  }
  return { ...state, toolStates, metrics, status: "complete" };
}

function applyError(
  state: ThreadState,
  payload: { message: string },
): ThreadState {
  const toolStates = markOrphanedTools(state.toolStates);
  return { ...state, toolStates, error: payload.message, status: "error" };
}

function applyCancelled(state: ThreadState): ThreadState {
  const toolStates = markOrphanedTools(state.toolStates);
  return { ...state, toolStates, status: "cancelled" };
}

function markOrphanedTools(
  toolStates: Record<string, ToolExecutionState>,
): Record<string, ToolExecutionState> {
  const result: Record<string, ToolExecutionState> = {};
  for (const [id, tool] of Object.entries(toolStates)) {
    if (tool.status === "running") {
      result[id] = {
        status: "error",
        result: "Tool execution was interrupted",
        isError: true,
      };
    } else {
      result[id] = tool;
    }
  }
  return result;
}
