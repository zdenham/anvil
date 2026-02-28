import type {
  SDKAssistantMessage,
  SDKUserMessage,
  SDKResultMessage,
  SDKToolProgressMessage,
  SDKPartialAssistantMessage,
  SDKMessage,
  SDKTaskStartedMessage,
  SDKTaskProgressMessage,
  SDKTaskNotificationMessage,
} from "@anthropic-ai/claude-agent-sdk";
import type { StreamAccumulator } from "../lib/stream-accumulator.js";
import {
  appendAssistantMessage,
  appendUserMessage,
  markToolRunning,
  markToolComplete,
  complete,
  setSessionId,
  updateUsage,
  writeUsageToMetadata,
} from "../output.js";
import { logger } from "../lib/logger.js";
import { getChildThreadId, emitEvent } from "./shared.js";
import { join } from "path";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { EventName, type ThreadState } from "@core/types/events.js";
import type { DrainManager } from "../lib/drain-manager.js";
import { DrainEventName } from "@core/types/drain-events.js";

/**
 * MessageHandler processes SDK messages and updates thread state.
 *
 * Single responsibility: Route SDK messages to appropriate state updates.
 * Does NOT handle side effects (hooks handle those).
 *
 * NOTE: File change tracking is handled in the PostToolUse hook in shared.ts,
 * NOT here. The hook fires before/instead of SDK user messages being emitted
 * to the async iterator, so we can't reliably track file changes here.
 */
export class MessageHandler {
  private mortDir: string | null = null;
  private accumulator: StreamAccumulator | null = null;
  private drainManager: DrainManager | null = null;

  // In-memory state cache for child threads (childThreadId -> state)
  private childThreadStates = new Map<string, ThreadState>();

  /** Turn counter incremented on each assistant message with usage */
  private turnIndex = 0;

  /** Context pressure thresholds already crossed (emit once per threshold) */
  private crossedThresholds = new Set<number>();

  /** Cumulative input tokens across all turns (for context pressure) */
  private cumulativeInputTokens = 0;

  /** Context window size (populated from result message) */
  private contextWindow: number | null = null;


  /**
   * Create a MessageHandler.
   * @param mortDir - Optional path to mort directory for sub-agent state routing
   * @param accumulator - Optional stream accumulator for live streaming display
   * @param drainManager - Optional drain manager for analytics event emission
   */
  constructor(mortDir?: string, accumulator?: StreamAccumulator, drainManager?: DrainManager) {
    this.mortDir = mortDir ?? null;
    this.accumulator = accumulator ?? null;
    this.drainManager = drainManager ?? null;
  }

  /**
   * Process a single SDK message.
   * Returns true if processing should continue.
   */
  async handle(message: SDKMessage): Promise<boolean> {
    // Check if this message belongs to a sub-agent
    const parentToolUseId = this.getParentToolUseId(message);
    if (parentToolUseId && this.mortDir) {
      const childThreadId = getChildThreadId(parentToolUseId);
      if (childThreadId) {
        // Route to child thread's state
        return this.handleForChildThread(childThreadId, message);
      }
    }

    // Normal parent thread handling
    switch (message.type) {
      case "system":
        return this.handleSystem(message);
      case "assistant":
        return this.handleAssistant(message);
      case "user":
        return this.handleUser(message);
      case "result":
        return this.handleResult(message);
      case "tool_progress":
        return this.handleToolProgress(message);
      case "stream_event":
        return this.handleStreamEvent(message as SDKPartialAssistantMessage);
      default:
        logger.debug(`[MessageHandler] Ignoring message type: ${(message as { type: string }).type}`);
        return true;
    }
  }

  private async handleSystem(msg: SDKMessage & { type: "system" }): Promise<boolean> {
    // Capture session ID from init message for future resumption
    if (msg.subtype === "init") {
      logger.info(`[MessageHandler] Session started: ${msg.session_id}`);
      await setSessionId(msg.session_id);
      return true;
    }

    // Background task lifecycle messages (SDK v0.2.45+)
    if (msg.subtype === "task_started") {
      return this.handleTaskStarted(msg as unknown as SDKTaskStartedMessage);
    }
    if (msg.subtype === "task_progress") {
      return this.handleTaskProgress(msg as unknown as SDKTaskProgressMessage);
    }
    if (msg.subtype === "task_notification") {
      return this.handleTaskNotification(msg as unknown as SDKTaskNotificationMessage);
    }

    return true;
  }

  private async handleAssistant(msg: SDKAssistantMessage): Promise<boolean> {
    // Log the message type for debugging consecutive messages
    const blockTypes = msg.message.content.map(b => b.type);
    logger.debug(
      `[MessageHandler] handleAssistant: blocks=[${blockTypes.join(",")}], ` +
      `stop_reason=${msg.message.stop_reason}`
    );

    // Mark all tool_use blocks as running
    for (const block of msg.message.content) {
      if (block.type === "tool_use") {
        await markToolRunning(block.id, block.name);
      }
    }

    // Extract and store per-call usage
    if (msg.message.usage) {
      const usage = msg.message.usage;
      await updateUsage({
        inputTokens: usage.input_tokens,
        outputTokens: usage.output_tokens,
        cacheCreationTokens: usage.cache_creation_input_tokens ?? 0,
        cacheReadTokens: usage.cache_read_input_tokens ?? 0,
      });

      // Emit api:call drain event
      if (this.drainManager) {
        const cacheCreation = usage.cache_creation_input_tokens ?? 0;
        const cacheRead = usage.cache_read_input_tokens ?? 0;
        const totalInput = usage.input_tokens;

        this.drainManager.emit(DrainEventName.API_CALL, {
          turnIndex: this.turnIndex++,
          inputTokens: totalInput,
          outputTokens: usage.output_tokens,
          cacheCreationTokens: cacheCreation,
          cacheReadTokens: cacheRead,
          cacheHitRate: totalInput > 0 ? cacheRead / totalInput : 0,
          stopReason: msg.message.stop_reason ?? "unknown",
          toolUseCount: this.countBlocks(msg, "tool_use"),
          thinkingBlockCount: this.countBlocks(msg, "thinking"),
          textBlockCount: this.countBlocks(msg, "text"),
        });

        // Track cumulative input tokens for context pressure
        this.cumulativeInputTokens += totalInput;
        this.checkContextPressure();
      }
    }

    // Cast content type - BetaContentBlock[] is structurally compatible with ContentBlockParam[]
    await appendAssistantMessage({
      role: "assistant",
      content: msg.message.content as Parameters<typeof appendAssistantMessage>[0]["content"],
    });

    return true;
  }

  private async handleUser(msg: SDKUserMessage): Promise<boolean> {
    // Tool result message
    // NOTE: File change tracking is handled in PostToolUse hook (shared.ts),
    // not here, because hooks fire before/instead of these user messages.
    if (msg.parent_tool_use_id) {
      const toolUseId = msg.parent_tool_use_id;
      const result = this.extractToolResult(msg);
      const isError = this.detectToolError(msg);

      logger.debug(
        `[MessageHandler] handleUser: tool_result for toolUseId=${toolUseId}, ` +
        `isError=${isError}, result_len=${result.length}`
      );

      await markToolComplete(toolUseId, result, isError);

      return true;
    }

    // Queued user message (not synthetic, not tool result)
    // isSynthetic is explicitly set to false for queued messages from stdin stream.
    // The initial prompt has isSynthetic: true, so it won't be appended here
    // (runAgentLoop already calls appendUserMessage for it).
    if (msg.isSynthetic === false) {
      const content = typeof msg.message.content === "string"
        ? msg.message.content
        : (msg.message.content as Array<{ type: string; text?: string }>)
            .filter((block): block is { type: "text"; text: string } => block.type === "text")
            .map(block => block.text)
            .join("\n");

      // Emit acknowledgement event BEFORE appending (so UI gets it first)
      // msg.uuid carries the queued message ID from socket message stream
      // Emit via socket or stdout fallback
      if (msg.uuid) {
        emitEvent("queued-message:ack", { messageId: msg.uuid });
        logger.info(`[MessageHandler] Emitted ack for queued message: ${msg.uuid}`);
      }

      await appendUserMessage(content);
      logger.info("[MessageHandler] Processed queued user message");
      return true;
    }

    // Other non-tool user messages (synthetic or undefined) - ignore
    logger.debug("[MessageHandler] Ignoring synthetic/initial user message");
    return true;
  }

  private async handleResult(msg: SDKResultMessage): Promise<boolean> {
    // Extract context window size from modelUsage (use first model's value)
    const modelUsageEntries = Object.values(msg.modelUsage ?? {});
    const contextWindow = modelUsageEntries[0]?.contextWindow;

    // Store context window for pressure checks on future turns
    if (contextWindow) this.contextWindow = contextWindow;

    switch (msg.subtype) {
      case "success": {
        await complete({
          durationApiMs: msg.duration_api_ms,
          totalCostUsd: msg.total_cost_usd,
          numTurns: msg.num_turns,
          contextWindow,
        });
        break;
      }
      case "error_during_execution": {
        const errorMsg = "errors" in msg && msg.errors.length > 0
          ? msg.errors[0]
          : "unknown";
        logger.warn(`[MessageHandler] Execution error: ${errorMsg}`);
        break;
      }
      case "error_max_turns":
        logger.warn(`[MessageHandler] Max turns reached: ${msg.num_turns}`);
        break;
      default:
        if (!msg.is_error) {
          await complete({
            durationApiMs: msg.duration_api_ms,
            totalCostUsd: msg.total_cost_usd,
            numTurns: msg.num_turns,
            contextWindow,
          });
        }
    }
    return false;  // Stop processing
  }

  private handleToolProgress(msg: SDKToolProgressMessage): boolean {
    logger.debug(
      `[MessageHandler] Tool ${msg.tool_name} running for ${msg.elapsed_time_seconds}s`
    );
    return true;
  }

  private handleStreamEvent(msg: SDKPartialAssistantMessage): boolean {
    if (!this.accumulator) return true;

    this.accumulator.handleDelta(msg.event);

    if (msg.event.type === "message_stop") {
      this.accumulator.flush();
      this.accumulator.reset();
    }

    return true;
  }

  // ============================================================================
  // Background Task Handlers (SDK v0.2.45+)
  // ============================================================================

  private handleTaskStarted(msg: SDKTaskStartedMessage): boolean {
    logger.info(
      `[MessageHandler] Task started: task_id=${msg.task_id}, ` +
      `tool_use_id=${msg.tool_use_id ?? "none"}, ` +
      `description="${msg.description}"`
    );

    // Update child thread metadata to "running" if we can correlate via tool_use_id
    if (msg.tool_use_id && this.mortDir) {
      const childThreadId = getChildThreadId(msg.tool_use_id);
      if (childThreadId) {
        this.updateChildMetadataField(childThreadId, { status: "running" });
      }
    }

    // Emit event for frontend
    emitEvent(EventName.THREAD_UPDATED, {
      threadId: msg.tool_use_id ?? msg.task_id,
    });

    return true;
  }

  private handleTaskProgress(msg: SDKTaskProgressMessage): boolean {
    logger.debug(
      `[MessageHandler] Background task progress: task_id=${msg.task_id}, ` +
      `last_tool=${msg.last_tool_name ?? "none"}, ` +
      `tokens=${msg.usage.total_tokens}, tools=${msg.usage.tool_uses}, ` +
      `duration=${msg.usage.duration_ms}ms`
    );
    return true;
  }

  private handleTaskNotification(msg: SDKTaskNotificationMessage): boolean {
    logger.info(
      `[MessageHandler] Task ${msg.status}: task_id=${msg.task_id}, ` +
      `tool_use_id=${msg.tool_use_id ?? "none"}, ` +
      `summary="${msg.summary}"`
    );

    // Update child thread metadata with final status
    if (msg.tool_use_id && this.mortDir) {
      const childThreadId = getChildThreadId(msg.tool_use_id);
      if (childThreadId) {
        const metadataStatus = msg.status === "completed" ? "completed"
          : msg.status === "failed" ? "error"
          : "completed"; // "stopped" → treat as completed

        this.updateChildMetadataField(childThreadId, {
          status: metadataStatus,
          updatedAt: Date.now(),
        });

        emitEvent(EventName.THREAD_STATUS_CHANGED, {
          threadId: childThreadId,
          status: metadataStatus,
        });
      }
    }

    return true;
  }

  /**
   * Update specific fields on a child thread's metadata.json.
   */
  private updateChildMetadataField(
    childThreadId: string,
    fields: Record<string, unknown>,
  ): void {
    const metadataPath = join(this.mortDir!, "threads", childThreadId, "metadata.json");
    try {
      if (!existsSync(metadataPath)) return;
      const metadata = JSON.parse(readFileSync(metadataPath, "utf-8"));
      Object.assign(metadata, fields);
      if (!fields.updatedAt) metadata.updatedAt = Date.now();
      writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));
    } catch (err) {
      logger.warn(`[MessageHandler] Failed to update child metadata ${childThreadId}: ${err}`);
    }
  }

  /** Count content blocks of a given type in an assistant message */
  private countBlocks(msg: SDKAssistantMessage, blockType: string): number {
    return msg.message.content.filter((b) => b.type === blockType).length;
  }

  /** Check if context pressure thresholds have been crossed and emit events */
  private checkContextPressure(): void {
    if (!this.drainManager || !this.contextWindow || this.contextWindow <= 0) return;

    const thresholds = [50, 75, 90, 95];
    const utilization = (this.cumulativeInputTokens / this.contextWindow) * 100;

    for (const threshold of thresholds) {
      if (utilization >= threshold && !this.crossedThresholds.has(threshold)) {
        this.crossedThresholds.add(threshold);
        this.drainManager.emit(DrainEventName.CONTEXT_PRESSURE, {
          utilization,
          threshold,
          inputTokens: this.cumulativeInputTokens,
          contextWindow: this.contextWindow,
          turnIndex: this.turnIndex,
        });
      }
    }
  }

  private extractToolResult(msg: SDKUserMessage): string {
    if (msg.tool_use_result !== undefined) {
      return typeof msg.tool_use_result === "string"
        ? msg.tool_use_result
        : JSON.stringify(msg.tool_use_result);
    }

    const messageParam = msg.message;
    if (!messageParam) return "";

    const content = messageParam.content;
    if (typeof content === "string") return content;
    if (Array.isArray(content)) {
      for (const block of content) {
        if (typeof block === "object" && block !== null && "type" in block) {
          if (block.type === "tool_result" && "content" in block) {
            const resultContent = block.content;
            return typeof resultContent === "string"
              ? resultContent
              : JSON.stringify(resultContent);
          }
        }
      }
    }
    return "";
  }

  private detectToolError(msg: SDKUserMessage): boolean {
    const result = msg.tool_use_result;
    if (typeof result === "object" && result !== null && "is_error" in result) {
      return Boolean(result.is_error);
    }

    const messageParam = msg.message;
    if (!messageParam) return false;

    const content = messageParam.content;
    if (Array.isArray(content)) {
      for (const block of content) {
        if (
          typeof block === "object" &&
          block !== null &&
          "type" in block &&
          block.type === "tool_result" &&
          "is_error" in block
        ) {
          return Boolean(block.is_error);
        }
      }
    }

    return false;
  }

  /**
   * Extract the tool_use_id from a tool_result block in the message content.
   * This is needed for sub-agent messages where parent_tool_use_id is the Task tool's ID,
   * not the actual tool's ID.
   */
  private extractToolUseIdFromResult(msg: SDKUserMessage): string | null {
    const messageParam = msg.message;
    if (!messageParam) return null;

    const content = messageParam.content;
    if (Array.isArray(content)) {
      for (const block of content) {
        if (
          typeof block === "object" &&
          block !== null &&
          "type" in block &&
          block.type === "tool_result" &&
          "tool_use_id" in block
        ) {
          return block.tool_use_id as string;
        }
      }
    }

    return null;
  }

  // ============================================================================
  // Sub-agent Message Routing
  // ============================================================================

  /**
   * Extract parent_tool_use_id from an SDK message.
   * Returns null if not a sub-agent message.
   */
  private getParentToolUseId(message: SDKMessage): string | null {
    if (message.type === "assistant" || message.type === "user") {
      const parentId = (message as SDKAssistantMessage | SDKUserMessage).parent_tool_use_id;
      return parentId ?? null;
    }
    if (message.type === "tool_progress") {
      const parentId = (message as SDKToolProgressMessage).parent_tool_use_id;
      return parentId ?? null;
    }
    return null;
  }

  /**
   * Get or initialize state for a child thread.
   */
  private getChildThreadState(childThreadId: string): ThreadState {
    // Check in-memory cache first
    let state = this.childThreadStates.get(childThreadId);
    if (state) return state;

    // Try to load from disk
    const statePath = join(this.mortDir!, "threads", childThreadId, "state.json");
    if (existsSync(statePath)) {
      try {
        state = JSON.parse(readFileSync(statePath, "utf-8")) as ThreadState;
        this.childThreadStates.set(childThreadId, state);
        return state;
      } catch {
        // Fall through to create new state
      }
    }

    // Initialize new state for child thread
    state = {
      messages: [],
      fileChanges: [],
      workingDirectory: "", // Will be set from parent context if needed
      status: "running",
      timestamp: Date.now(),
      toolStates: {},
    };
    this.childThreadStates.set(childThreadId, state);
    return state;
  }

  /**
   * Write child thread state to disk and emit event.
   */
  private async emitChildThreadState(childThreadId: string, state: ThreadState): Promise<void> {
    state.timestamp = Date.now();
    const statePath = join(this.mortDir!, "threads", childThreadId, "state.json");
    writeFileSync(statePath, JSON.stringify(state, null, 2));

    // Emit THREAD_UPDATED so frontend refreshes this child's metadata
    emitEvent(EventName.THREAD_UPDATED, { threadId: childThreadId });
  }

  /**
   * Handle a message for a child (sub-agent) thread.
   * Routes the message to the child's state file instead of parent's.
   */
  private async handleForChildThread(childThreadId: string, message: SDKMessage): Promise<boolean> {
    const state = this.getChildThreadState(childThreadId);

    switch (message.type) {
      case "assistant": {
        const msg = message as SDKAssistantMessage;
        const blockTypes = msg.message.content.map(b => b.type);
        logger.debug(
          `[MessageHandler] handleForChildThread(${childThreadId}): assistant blocks=[${blockTypes.join(",")}]`
        );

        // Mark tool_use blocks as running
        for (const block of msg.message.content) {
          if (block.type === "tool_use") {
            state.toolStates[block.id] = { status: "running", toolName: block.name };
          }
        }

        // Extract usage for child thread
        if (msg.message.usage) {
          const turnUsage = {
            inputTokens: msg.message.usage.input_tokens,
            outputTokens: msg.message.usage.output_tokens,
            cacheCreationTokens: msg.message.usage.cache_creation_input_tokens ?? 0,
            cacheReadTokens: msg.message.usage.cache_read_input_tokens ?? 0,
          };
          state.lastCallUsage = turnUsage;

          const prev = state.cumulativeUsage;
          state.cumulativeUsage = {
            inputTokens: (prev?.inputTokens ?? 0) + turnUsage.inputTokens,
            outputTokens: (prev?.outputTokens ?? 0) + turnUsage.outputTokens,
            cacheCreationTokens: (prev?.cacheCreationTokens ?? 0) + turnUsage.cacheCreationTokens,
            cacheReadTokens: (prev?.cacheReadTokens ?? 0) + turnUsage.cacheReadTokens,
          };
        }

        // Append message
        state.messages.push({
          role: "assistant",
          content: msg.message.content as Parameters<typeof appendAssistantMessage>[0]["content"],
        });

        // Write usage to child's metadata.json BEFORE emitting event
        // so the frontend reads updated metadata when it refreshes
        if (state.lastCallUsage || state.cumulativeUsage) {
          const childMetadataPath = join(this.mortDir!, "threads", childThreadId, "metadata.json");
          await writeUsageToMetadata(childMetadataPath, state.lastCallUsage, state.cumulativeUsage);
        }

        await this.emitChildThreadState(childThreadId, state);

        return true;
      }

      case "user": {
        const msg = message as SDKUserMessage;
        // Tool result handling for child thread
        // For sub-agent messages:
        // - msg.parent_tool_use_id = Task tool's ID (identifies the sub-agent)
        // - The actual tool's tool_use_id is in the tool_result block within msg.message.content
        const toolUseId = this.extractToolUseIdFromResult(msg);
        if (toolUseId) {
          const result = this.extractToolResult(msg);
          const isError = this.detectToolError(msg);

          const existingState = state.toolStates[toolUseId];
          state.toolStates[toolUseId] = {
            status: isError ? "error" : "complete",
            result,
            isError,
            toolName: existingState?.toolName,
          };

          logger.debug(
            `[MessageHandler] handleForChildThread(${childThreadId}): tool_result toolUseId=${toolUseId}`
          );
        }
        await this.emitChildThreadState(childThreadId, state);
        return true;
      }

      case "tool_progress": {
        // Just log, no state change needed
        const msg = message as SDKToolProgressMessage;
        logger.debug(
          `[MessageHandler] handleForChildThread(${childThreadId}): tool ${msg.tool_name} running`
        );
        return true;
      }

      default:
        logger.debug(
          `[MessageHandler] handleForChildThread(${childThreadId}): ignoring ${message.type}`
        );
        return true;
    }
  }
}
