import { randomUUID, type UUID } from "crypto";
import type { SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import { logger } from "../logger.js";

// Event emitter callback type - avoids circular dependency with shared.ts
type EventEmitter = (name: string, payload: Record<string, unknown>) => void;

// Callback to append user message to state
type AppendUserMessage = (id: string, content: string) => Promise<void>;

/**
 * A message stream that bridges socket messages to the SDK's async iterable interface.
 *
 * The SDK's query() function accepts either a string prompt OR an AsyncIterable<SDKUserMessage>.
 * This class creates an async iterable that:
 * 1. Yields the initial prompt first
 * 2. Then yields queued messages as they arrive via push()
 *
 * This enables mid-conversation message injection from the socket IPC.
 */
export class SocketMessageStream {
  private messageQueue: Array<{ id: UUID; content: string }> = [];
  private resolveNext: ((msg: { id: UUID; content: string } | null) => void) | null = null;
  private closed = false;
  private sessionId: string;
  private eventEmitter: EventEmitter | null = null;
  private appendUserMessage: AppendUserMessage | null = null;

  constructor() {
    // Pre-generate session ID (will be updated when SDK provides one)
    this.sessionId = randomUUID();
  }

  /**
   * Set the event emitter callback.
   * This is used to emit queued-message:ack events when messages are yielded.
   */
  setEventEmitter(emitter: EventEmitter): void {
    this.eventEmitter = emitter;
  }

  /**
   * Set the appendUserMessage callback.
   * This is used to add queued messages to the thread state.
   * Note: The SDK does NOT return injected user messages, so we must append them manually.
   */
  setAppendUserMessage(fn: AppendUserMessage): void {
    this.appendUserMessage = fn;
  }

  /**
   * Set the SDK session ID after receiving it from the init message.
   */
  setSessionId(sessionId: string): void {
    this.sessionId = sessionId;
  }

  /**
   * Get the current session ID.
   */
  getSessionId(): string {
    return this.sessionId;
  }

  /**
   * Create an async generator that yields SDKUserMessage objects.
   * First yields the initial prompt, then yields queued messages as they arrive.
   */
  async *createStream(initialPrompt: string): AsyncGenerator<SDKUserMessage> {
    // Initial prompt is marked synthetic because runAgentLoop already calls
    // appendUserMessage for it. Only queued messages should be non-synthetic.
    yield this.formatUserMessage(initialPrompt, true);

    try {
      while (!this.closed) {
        const msg = await this.waitForMessage();
        if (msg === null) break;
        logger.info(`[SocketMessageStream] Processing queued message: ${msg.id}`);

        // Emit ack event when we yield the message to the SDK.
        // Note: The SDK does NOT return injected user messages back to the stream,
        // so we emit the ack here at yield time instead of waiting for the SDK.
        if (this.eventEmitter) {
          this.eventEmitter("queued-message:ack", { messageId: msg.id });
          logger.info(`[SocketMessageStream] Emitted ack for queued message: ${msg.id}`);
        }

        // Append the user message to thread state.
        // Note: The SDK does NOT return injected user messages, so we must append manually.
        if (this.appendUserMessage) {
          await this.appendUserMessage(msg.id, msg.content);
          logger.info(`[SocketMessageStream] Appended user message to state`);
        }

        // Yield the message to the SDK for processing
        yield this.formatUserMessage(msg.content, false, msg.id);
      }
    } finally {
      this.close();
    }
  }

  /**
   * Push a queued message into the stream.
   * Called when a queued_message arrives via socket IPC.
   */
  push(id: UUID, content: string): void {
    if (this.closed) {
      logger.warn(`[SocketMessageStream] Ignoring message ${id} - stream is closed`);
      return;
    }

    // If someone is waiting for a message, resolve immediately
    if (this.resolveNext) {
      const resolve = this.resolveNext;
      this.resolveNext = null;
      resolve({ id, content });
    } else {
      // Otherwise queue it
      this.messageQueue.push({ id, content });
    }
  }

  /**
   * Close the stream. No more messages will be yielded.
   */
  close(): void {
    if (this.closed) return;
    this.closed = true;
    logger.debug("[SocketMessageStream] Closing");

    // Resolve any pending waiter with null to signal end
    if (this.resolveNext) {
      this.resolveNext(null);
      this.resolveNext = null;
    }

    // Clear the queue
    this.messageQueue = [];
  }

  /**
   * Wait for the next message from the queue or a push.
   */
  private waitForMessage(): Promise<{ id: UUID; content: string } | null> {
    if (this.closed) return Promise.resolve(null);

    // Return from queue if available
    if (this.messageQueue.length > 0) {
      return Promise.resolve(this.messageQueue.shift()!);
    }

    // Otherwise wait for push()
    return new Promise((resolve) => {
      this.resolveNext = resolve;
    });
  }

  /**
   * Format a message as an SDKUserMessage.
   */
  private formatUserMessage(content: string, isSynthetic: boolean, uuid?: UUID): SDKUserMessage {
    return {
      type: "user",
      message: { role: "user", content },
      parent_tool_use_id: null,
      session_id: this.sessionId,
      isSynthetic,
      // Include UUID for queued messages so MessageHandler can emit ack event
      ...(uuid && { uuid }),
    };
  }
}

/**
 * Create a socket message stream for the SDK.
 *
 * @param initialPrompt - The initial user prompt
 * @returns Object containing the async iterable stream and the controller for pushing messages
 */
export function createSocketMessageStream(
  initialPrompt: string
): { stream: AsyncGenerator<SDKUserMessage>; controller: SocketMessageStream } {
  const controller = new SocketMessageStream();
  const stream = controller.createStream(initialPrompt);
  return { stream, controller };
}
