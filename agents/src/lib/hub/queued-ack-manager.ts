import { logger } from "../logger.js";

type EmitEvent = (name: string, payload: Record<string, unknown>, source?: string) => void;
type MoveMessageToEnd = (id: string) => Promise<void>;

/**
 * Manages the deferred ack lifecycle for queued messages.
 *
 * A queued message is only acked after 2 assistant turns have passed
 * since SDK consumption — proving the LLM actually processed it.
 * Messages that don't reach the threshold before agent exit get nacked.
 */
export class QueuedAckManager {
  private pendingAcks = new Map<string, number>(); // messageId → turns seen
  private emitEvent: EmitEvent;
  private moveMessageToEnd: MoveMessageToEnd;

  constructor(emitEvent: EmitEvent, moveMessageToEnd: MoveMessageToEnd) {
    this.emitEvent = emitEvent;
    this.moveMessageToEnd = moveMessageToEnd;
  }

  /** Register a message as consumed by the SDK, starting turn counting. */
  register(messageId: string): void {
    this.pendingAcks.set(messageId, 0);
    logger.info(`[QueuedAckManager] Registered: ${messageId}`);
  }

  /**
   * Called on each assistant turn (from MessageHandler.handleAssistant).
   * Increments counters and emits acks for messages that hit the threshold.
   */
  async onAssistantTurn(): Promise<void> {
    for (const [messageId, turns] of this.pendingAcks) {
      const newTurns = turns + 1;
      if (newTurns >= 2) {
        await this.moveMessageToEnd(messageId);
        this.emitEvent("queued-message:ack", { messageId }, "QueuedAckManager:ack");
        this.pendingAcks.delete(messageId);
        logger.info(`[QueuedAckManager] Acked ${messageId} after ${newTurns} turns`);
      } else {
        this.pendingAcks.set(messageId, newTurns);
      }
    }
  }

  /**
   * Called on agent exit (from MessageHandler.handleResult).
   * Nacks any messages that didn't reach the 2-turn threshold.
   */
  drainNacks(): void {
    for (const [messageId] of this.pendingAcks) {
      this.emitEvent("queued-message:nack", { messageId }, "QueuedAckManager:nack");
      logger.warn(`[QueuedAckManager] Nack for ${messageId} — agent exited before threshold`);
    }
    this.pendingAcks.clear();
  }

  /** Number of messages awaiting ack (for testing). */
  get size(): number {
    return this.pendingAcks.size;
  }
}
