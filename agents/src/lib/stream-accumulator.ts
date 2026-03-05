import { type HubClient } from "./hub/client.js";
import type { BetaRawMessageStreamEvent } from "@anthropic-ai/sdk/resources/beta/messages/messages.mjs";
import { nanoid } from "nanoid";
import { logger } from "./logger.js";

interface StreamBlock {
  type: "text" | "thinking";
  content: string;
  id: string;
}

/**
 * Accumulates SDK stream deltas and emits append-only deltas via hub socket.
 * Each block gets a stable UUID at content_block_start.
 * messageId is captured from message_start for WIP correlation.
 *
 * Usage:
 *   Feed each SDKPartialAssistantMessage.event into handleDelta().
 *   On message_stop, call flush() then reset().
 */
export class StreamAccumulator {
  private blocks: StreamBlock[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private dirty = false;
  private lastEmittedLengths: number[] = [];
  private messageId: string | null = null;
  private hasEmitted = false;

  constructor(
    private hubClient: HubClient,
    private threadId: string,
    private throttleMs = 50,
  ) {}

  handleDelta(event: BetaRawMessageStreamEvent): void {
    if (event.type === "message_start") {
      this.messageId = (event as unknown as { message: { id: string } }).message.id;
      return;
    }

    if (event.type === "content_block_start") {
      const blockType = event.content_block.type;
      if (blockType === "text" || blockType === "thinking") {
        this.blocks[event.index] = { type: blockType, content: "", id: nanoid() };
        this.scheduleFlush();
      }
    } else if (event.type === "content_block_delta") {
      const block = this.blocks[event.index];
      if (!block) return;

      if (event.delta.type === "text_delta") {
        block.content += event.delta.text;
      } else if (event.delta.type === "thinking_delta") {
        block.content += event.delta.thinking;
      }
      this.scheduleFlush();
    }
  }

  flush(): void {
    this.cancelPendingFlush();
    this.emitSnapshot();
  }

  reset(): void {
    this.cancelPendingFlush();
    this.blocks = [];
    this.dirty = false;
    this.lastEmittedLengths = [];
    this.messageId = null;
    this.hasEmitted = false;
  }

  private scheduleFlush(): void {
    this.dirty = true;
    if (!this.flushTimer) {
      this.flushTimer = setTimeout(() => {
        this.flushTimer = null;
        if (this.dirty) {
          this.emitSnapshot();
        }
      }, this.throttleMs);
    }
  }

  private cancelPendingFlush(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
  }

  private emitSnapshot(): void {
    this.dirty = false;

    if (!this.hubClient.isConnected) {
      logger.debug("[StreamAccumulator] Hub not connected, skipping delta");
      return;
    }

    // Compute deltas from all blocks
    const deltas: Array<{
      index: number;
      type: "text" | "thinking";
      append: string;
      blockId: string;
    }> = [];

    for (let i = 0; i < this.blocks.length; i++) {
      const block = this.blocks[i];
      if (!block) continue;
      const prevLen = this.lastEmittedLengths[i] ?? 0;
      const currentLen = block.content.length;
      if (currentLen > prevLen) {
        deltas.push({
          index: i,
          type: block.type,
          append: block.content.slice(prevLen),
          blockId: block.id,
        });
      }
    }

    if (deltas.length > 0 || !this.hasEmitted) {
      this.hubClient.send({
        type: "stream_delta",
        threadId: this.threadId,
        messageId: this.messageId,
        deltas,
      });
      this.lastEmittedLengths = this.blocks.map((b) => b?.content.length ?? 0);
      this.hasEmitted = true;
    }
  }
}
