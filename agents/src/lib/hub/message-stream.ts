import { randomUUID, type UUID } from "crypto";
import type { SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import { logger } from "../logger.js";
import type { QueuedAckManager } from "./queued-ack-manager.js";

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
  private appendUserMessage: AppendUserMessage | null = null;

  constructor() {
    // Pre-generate session ID (will be updated when SDK provides one)
    this.sessionId = randomUUID();
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

        // Append the user message to thread state BEFORE emitting ack.
        // This ensures the message is durably on disk before the frontend
        // receives confirmation — if the ack arrives, the message is in state.json.
        if (this.appendUserMessage) {
          await this.appendUserMessage(msg.id, msg.content);
          logger.info(`[SocketMessageStream] Appended user message to state`);
        }

        // Ack is deferred to MessageHandler after 2 assistant turns.
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
   * Returns the stream wrapped so consumed messages are registered
   * with the ack manager for deferred ack after 2 assistant turns.
   */
  createWrappedStream(
    initialPrompt: string,
    ackManager: QueuedAckManager,
  ): AsyncGenerator<SDKUserMessage> {
    const inner = this.createStream(initialPrompt);
    return withAckOnConsume(inner, (messageId) => {
      ackManager.register(messageId);
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
 * Wraps an async generator so that when the SDK calls .next(),
 * the previously yielded message's ID is registered as consumed.
 */
function withAckOnConsume(
  inner: AsyncGenerator<SDKUserMessage>,
  onConsumed: (messageId: string) => void,
): AsyncGenerator<SDKUserMessage> {
  let pendingId: string | null = null;

  const wrapper: AsyncGenerator<SDKUserMessage> = {
    async next(...args: [] | [unknown]) {
      // SDK calling .next() proves it consumed the previous yield
      if (pendingId) {
        onConsumed(pendingId);
        pendingId = null;
      }
      const result = await inner.next(...args);
      if (!result.done && result.value.uuid) {
        pendingId = result.value.uuid;
      }
      return result;
    },

    async return(value?: unknown) {
      // Generator closing — register last consumed message
      if (pendingId) {
        onConsumed(pendingId);
        pendingId = null;
      }
      return inner.return(value);
    },

    async throw(err?: unknown) {
      pendingId = null; // Don't register on error
      return inner.throw(err);
    },

    [Symbol.asyncIterator]() { return wrapper; },
  };

  return wrapper;
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
