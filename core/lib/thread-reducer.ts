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
  | { type: "MOVE_MESSAGE_TO_END"; payload: { id: string } }
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
    case "APPEND_USER_MESSAGE": {
      // Deduplicate by ID — no-op if a message with this ID already exists
      if (state.messages.some((m) => m.id === action.payload.id)) return state;
      return {
        ...state,
        messages: [
          ...state.messages,
          { role: "user" as const, content: action.payload.content, id: action.payload.id },
        ],
      };
    }
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
            startedAt: Date.now(),
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
    case "MOVE_MESSAGE_TO_END": {
      const idx = state.messages.findIndex((m) => m.id === action.payload.id);
      if (idx === -1) return state;
      const msg = state.messages[idx];
      const messages = [...state.messages];
      messages.splice(idx, 1);
      messages.push(msg);
      return { ...state, messages };
    }
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
    wipMap: {},
    blockIdMap: {},
  };
}

/**
 * Append or replace an assistant message.
 *
 * If a WIP message exists for this anthropicId (via wipMap), replace it in-place
 * and **consume** the wipMap entry so subsequent messages with the same anthropicId
 * take the append path (the SDK splits responses into multiple messages).
 *
 * Block IDs are carried forward from streaming via blockIdMap, keyed by correlation
 * key: `${anthropicId}:${blockIndex}` for text/thinking, or the Anthropic-provided
 * `block.id` for tool_use blocks.
 */
function applyAppendAssistantMessage(state: ThreadState, message: StoredMessage): ThreadState {
  const wipMap = { ...(state.wipMap ?? {}) };
  const blockIdMap = { ...(state.blockIdMap ?? {}) };
  const anthropicId = message.anthropicId;

  // Resolve block IDs from blockIdMap (works whether or not a WIP exists)
  const content = Array.isArray(message.content)
    ? (message.content as RenderContentBlock[]).map((block, i) => {
        const correlationKey = blockCorrelationKey(anthropicId, block, i);
        if (correlationKey && blockIdMap[correlationKey]) {
          const ourId = blockIdMap[correlationKey];
          delete blockIdMap[correlationKey]; // consume
          return { ...block, id: ourId };
        }
        return block;
      })
    : message.content;

  if (anthropicId && wipMap[anthropicId]) {
    const streamingUuid = wipMap[anthropicId];
    const messages = state.messages.map((m) =>
      m.id === streamingUuid ? { ...message, id: streamingUuid, content } : m,
    );
    // Consume wipMap entry — subsequent messages with same anthropicId will append
    delete wipMap[anthropicId];
    return { ...state, messages, wipMap, blockIdMap };
  }

  // Deduplicate by ID — no-op if a message with this ID already exists.
  // Guards against HYDRATE + socket replay races: disk state already
  // contains the message, then the same action arrives via socket.
  if (state.messages.some((m) => m.id === message.id)) return state;

  // No WIP to replace — append
  return {
    ...state,
    messages: [...state.messages, { ...message, content }],
    blockIdMap,
  };
}

/**
 * Compute the correlation key for a content block.
 * - tool_use blocks: use the Anthropic-provided `block.id`
 * - text/thinking blocks: composite `${anthropicId}:${blockIndex}`
 */
function blockCorrelationKey(
  anthropicId: string | undefined,
  block: RenderContentBlock,
  index: number,
): string | undefined {
  if (!anthropicId) return undefined;
  // tool_use blocks have a stable id from the API
  const b = block as unknown as { type: string; id?: string };
  if (b.type === "tool_use" && b.id) {
    return b.id;
  }
  return `${anthropicId}:${index}`;
}

/**
 * Create a new streaming assistant message with empty content.
 */
function applyStreamStart(
  state: ThreadState,
  payload: { anthropicMessageId: string },
): ThreadState {
  const wipMap = { ...(state.wipMap ?? {}) };

  // If we already have a WIP for this anthropicId, no-op
  if (wipMap[payload.anthropicMessageId]) return state;

  // If a committed message with this anthropicId already exists (post-HYDRATE),
  // don't create a phantom WIP.
  if (state.messages.some((m) => m.anthropicId === payload.anthropicMessageId)) return state;

  const uuid = crypto.randomUUID();
  wipMap[payload.anthropicMessageId] = uuid;

  const wipMessage: StoredMessage = {
    id: uuid,
    anthropicId: payload.anthropicMessageId,
    role: "assistant",
    content: [],
  };

  return {
    ...state,
    messages: [...state.messages, wipMessage],
    wipMap,
  };
}

/**
 * Apply streaming deltas to an in-flight assistant message.
 * If no WIP exists yet for this anthropicId, creates one (implicit STREAM_START).
 * If the wipMap entry was already consumed (message committed), this is a late
 * delta and we ignore it.
 */
function applyStreamDelta(
  state: ThreadState,
  payload: { anthropicMessageId: string; deltas: BlockDelta[] },
): ThreadState {
  const wipMap = { ...(state.wipMap ?? {}) };
  const blockIdMap = { ...(state.blockIdMap ?? {}) };
  let messages = [...state.messages];

  // Implicit STREAM_START if needed
  if (!wipMap[payload.anthropicMessageId]) {
    // Check if this anthropicId was already committed (wipMap entry consumed).
    // If any existing message has this anthropicId, it's a late delta — ignore.
    const alreadyCommitted = messages.some(
      (m) => m.anthropicId === payload.anthropicMessageId,
    );
    if (alreadyCommitted) return state;

    const uuid = crypto.randomUUID();
    wipMap[payload.anthropicMessageId] = uuid;
    messages.push({
      id: uuid,
      anthropicId: payload.anthropicMessageId,
      role: "assistant",
      content: [],
    });
  }

  const uuid = wipMap[payload.anthropicMessageId];
  const msgIdx = messages.findIndex((m) => m.id === uuid);
  if (msgIdx === -1) return { ...state, wipMap, blockIdMap };

  const msg = messages[msgIdx];
  const blocks = [...(msg.content as RenderContentBlock[])];

  for (const delta of payload.deltas) {
    const existing = blocks[delta.index];
    // Store block ID mapping: correlationKey → our nanoid
    if (delta.blockId) {
      const correlationKey = `${payload.anthropicMessageId}:${delta.index}`;
      blockIdMap[correlationKey] = delta.blockId;
    }

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
          ? { type: "text", text: delta.append, isStreaming: true, id: delta.blockId }
          : { type: "thinking", thinking: delta.append, isStreaming: true, id: delta.blockId };
    }
  }

  messages = [...messages];
  messages[msgIdx] = { ...msg, content: blocks };

  return { ...state, messages, wipMap, blockIdMap };
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
        startedAt: existing?.startedAt,
        completedAt: Date.now(),
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
  // Strip totalCostUsd — cost lives exclusively in metadata.json
  const { totalCostUsd: _, ...metricsWithoutCost } = payload.metrics;
  const metrics = { ...metricsWithoutCost };
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
  // Clear wipMap to commit all WIP streaming content — partial but valuable
  return { ...state, toolStates, wipMap: {}, status: "cancelled" };
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
        startedAt: tool.startedAt,
        completedAt: Date.now(),
      };
    } else {
      result[id] = tool;
    }
  }
  return result;
}
