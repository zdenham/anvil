import { type HubClient } from "./hub/client.js";
import type { BetaRawMessageStreamEvent } from "@anthropic-ai/sdk/resources/beta/messages/messages.mjs";
import { logger } from "./logger.js";

interface StreamBlock {
  type: "text" | "thinking";
  content: string;
}

/**
 * Accumulates SDK stream deltas into full content block snapshots.
 * Emits throttled optimistic_stream messages via the hub socket.
 *
 * Usage:
 *   Feed each SDKPartialAssistantMessage.event into handleDelta().
 *   On message_stop, call flush() then reset().
 */
export class StreamAccumulator {
  private blocks: StreamBlock[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private dirty = false;

  constructor(
    private hubClient: HubClient,
    private threadId: string,
    private throttleMs = 50,
  ) {}

  handleDelta(event: BetaRawMessageStreamEvent): void {
    if (event.type === "content_block_start") {
      const blockType = event.content_block.type;
      if (blockType === "text" || blockType === "thinking") {
        this.blocks[event.index] = { type: blockType, content: "" };
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
    const blocks = this.blocks.filter(Boolean);

    if (!this.hubClient.isConnected) {
      logger.debug("[StreamAccumulator] Hub not connected, skipping snapshot");
      return;
    }

    this.hubClient.send({
      type: "optimistic_stream",
      threadId: this.threadId,
      blocks,
    });
  }
}
