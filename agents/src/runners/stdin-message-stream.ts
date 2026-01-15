import * as readline from "readline";
import { randomUUID } from "crypto";
import type { SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import { parseStdinMessage, type StdinMessage } from "./stdin-message-schema.js";
import { logger } from "../lib/logger.js";

const MAX_QUEUE_SIZE = 50;

/**
 * StdinMessageStream listens for queued messages on stdin and yields them
 * as SDK-compatible user messages.
 *
 * This enables users to queue additional messages while the agent is running.
 * The stream yields the initial prompt first, then listens for queued messages
 * and yields them as they arrive.
 *
 * Only used by simple agent - task-based agents don't support queued messages.
 */
export class StdinMessageStream {
  private rl: readline.Interface | null = null;
  private messageQueue: StdinMessage[] = [];
  private resolveNext: ((msg: StdinMessage | null) => void) | null = null;
  private closed = false;
  private sessionId: string;

  constructor(private abortSignal?: AbortSignal) {
    this.sessionId = randomUUID();
  }

  setSessionId(sessionId: string): void {
    this.sessionId = sessionId;
  }

  getSessionId(): string {
    return this.sessionId;
  }

  /**
   * Create an async generator that yields user messages.
   *
   * The initial prompt is yielded first with isSynthetic: true because
   * runAgentLoop already calls appendUserMessage for it.
   *
   * Queued messages are yielded with isSynthetic: false so MessageHandler
   * will append them to the thread state.
   */
  async *createStream(initialPrompt: string): AsyncGenerator<SDKUserMessage> {
    // Initial prompt is marked synthetic because runAgentLoop already calls
    // appendUserMessage for it. Only queued messages should be non-synthetic.
    yield this.formatUserMessage(initialPrompt, true);
    this.startListening();

    if (this.abortSignal) {
      this.abortSignal.addEventListener("abort", () => this.close());
    }

    try {
      while (!this.closed) {
        const msg = await this.waitForMessage();
        if (msg === null) break;
        logger.info(`[StdinMessageStream] Processing queued message: ${msg.id}`);
        // Queued messages are non-synthetic so MessageHandler will append them
        yield this.formatUserMessage(msg.content, false);
      }
    } finally {
      this.close();
    }
  }

  private formatUserMessage(content: string, isSynthetic: boolean): SDKUserMessage {
    return {
      type: "user",
      message: { role: "user", content },
      parent_tool_use_id: null,
      session_id: this.sessionId,
      isSynthetic,
    };
  }

  private startListening(): void {
    if (this.rl) return;

    this.rl = readline.createInterface({
      input: process.stdin,
      terminal: false,
    });

    this.rl.on("line", (line) => {
      if (this.closed) return;
      const msg = parseStdinMessage(line);
      if (!msg) return;

      if (this.messageQueue.length >= MAX_QUEUE_SIZE) {
        logger.warn(`[StdinMessageStream] Queue full, dropping message: ${msg.id}`);
        return;
      }

      if (this.resolveNext) {
        const resolve = this.resolveNext;
        this.resolveNext = null;
        resolve(msg);
      } else {
        this.messageQueue.push(msg);
      }
    });

    this.rl.on("close", () => this.close());
    this.rl.on("error", (err) => {
      logger.error("[StdinMessageStream] Readline error:", err);
      this.close();
    });
  }

  private waitForMessage(): Promise<StdinMessage | null> {
    if (this.closed) return Promise.resolve(null);
    if (this.messageQueue.length > 0) {
      return Promise.resolve(this.messageQueue.shift()!);
    }
    return new Promise((resolve) => {
      this.resolveNext = resolve;
    });
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    logger.debug("[StdinMessageStream] Closing");

    if (this.rl) {
      this.rl.close();
      this.rl = null;
    }

    if (this.resolveNext) {
      this.resolveNext(null);
      this.resolveNext = null;
    }

    this.messageQueue = [];
  }
}

/**
 * Create a stdin message stream for processing queued user messages.
 *
 * @param initialPrompt - The initial user prompt to yield first
 * @param abortSignal - Optional abort signal for cancellation
 * @returns The async generator stream and its controller
 */
export function createStdinMessageStream(
  initialPrompt: string,
  abortSignal?: AbortSignal
): { stream: AsyncGenerator<SDKUserMessage>; controller: StdinMessageStream } {
  const controller = new StdinMessageStream(abortSignal);
  const stream = controller.createStream(initialPrompt);
  return { stream, controller };
}
