import { EventEmitter } from "events";
import { getHubSocketPath } from "@core/lib/socket.js";
import { HubConnection } from "./connection.js";
import { withRetry, type RetryOptions, DEFAULT_RETRY_OPTIONS } from "./retry.js";
import type { SocketMessage } from "./types.js";

export class HubClient extends EventEmitter {
  private connection: HubConnection;
  private socketPath: string;

  constructor(
    private threadId: string,
    private parentId?: string
  ) {
    super();
    this.socketPath = getHubSocketPath();
    this.connection = new HubConnection();

    this.connection.on("message", (msg) => this.emit("message", msg));
    this.connection.on("disconnect", () => this.emit("disconnect"));
    this.connection.on("error", (err) => this.emit("error", err));
  }

  async connect(options: Partial<RetryOptions> = {}): Promise<void> {
    const retryOptions = { ...DEFAULT_RETRY_OPTIONS, ...options };

    await withRetry(() => this.connection.connect(this.socketPath), retryOptions);

    // Register with hub
    this.send({
      type: "register",
      ...(this.parentId && { parentId: this.parentId }),
    });
  }

  send(msg: Omit<SocketMessage, "senderId" | "threadId">): void {
    const fullMsg = {
      ...msg,
      senderId: this.threadId,
      threadId: this.threadId,
    } as SocketMessage;
    this.connection.write(fullMsg);
  }

  sendState(state: unknown): void {
    this.send({ type: "state", state });
  }

  sendEvent(name: string, payload: unknown): void {
    this.send({ type: "event", name, payload });
  }

  sendLog(level: string, message: string): void {
    this.send({ type: "log", level, message });
  }

  /** Relay a message to another agent through the hub */
  relay(targetThreadId: string, payload: Record<string, unknown>): void {
    this.send({ type: "relay", targetThreadId, payload });
  }

  get isConnected(): boolean {
    return this.connection.isConnected;
  }

  disconnect(): void {
    this.connection.destroy();
  }

  /**
   * Gracefully disconnect after flushing pending writes.
   */
  async gracefulDisconnect(): Promise<void> {
    await this.connection.gracefulClose();
  }
}
