import { EventEmitter } from "events";
import WebSocket from "ws";
import type { SocketMessage } from "./types.js";

/** Connection health derived from write failure pattern. */
export type ConnectionHealth = "healthy" | "degraded" | "disconnected";

const MAX_CONSECUTIVE_FAILURES = 3;

/**
 * Low-level hub connection over WebSocket transport.
 */
export class HubConnection extends EventEmitter {
  private ws: WebSocket | null = null;
  private isClosing = false;

  /** Consecutive write failures — reset on success. */
  private consecutiveWriteFailures = 0;

  connect(endpoint: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(endpoint);

      const onOpen = () => {
        cleanup();
        this.setupHandlers();
        resolve();
      };

      const onError = (err: Error) => {
        cleanup();
        reject(err);
      };

      const cleanup = () => {
        this.ws?.removeListener("open", onOpen);
        this.ws?.removeListener("error", onError);
      };

      this.ws.once("open", onOpen);
      this.ws.once("error", onError);
    });
  }

  private setupHandlers(): void {
    if (!this.ws) return;

    this.ws.on("message", (data) => {
      try {
        const msg = JSON.parse(String(data)) as SocketMessage;
        this.emit("message", msg);
      } catch {
        // Invalid JSON, skip
      }
    });

    this.ws.on("close", () => this.emit("disconnect"));
    this.ws.on("error", (err) => this.emit("error", err));
  }

  write(msg: SocketMessage): boolean {
    if (this.isClosing) {
      this.recordWriteFailure();
      return false;
    }

    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      this.recordWriteFailure();
      return false;
    }

    try {
      this.ws.send(JSON.stringify(msg));
      this.consecutiveWriteFailures = 0;
      return true;
    } catch {
      this.recordWriteFailure();
      return false;
    }
  }

  private recordWriteFailure(): void {
    this.consecutiveWriteFailures++;
    this.emit("write-failure", {
      consecutiveFailures: this.consecutiveWriteFailures,
    });
    if (this.consecutiveWriteFailures >= MAX_CONSECUTIVE_FAILURES) {
      this.emit("unhealthy");
    }
  }

  /** Derived connection health based on write failure pattern. */
  get connectionHealth(): ConnectionHealth {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return "disconnected";
    if (this.consecutiveWriteFailures >= MAX_CONSECUTIVE_FAILURES) return "degraded";
    return "healthy";
  }

  get isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }

  destroy(): void {
    this.ws?.terminate();
    this.ws = null;
    this.isClosing = false;
    this.consecutiveWriteFailures = 0;
  }

  /**
   * Gracefully close the connection.
   * Returns a promise that resolves when the connection is closed.
   */
  async gracefulClose(): Promise<void> {
    if (this.isClosing) return;
    this.isClosing = true;

    if (!this.ws) return;
    return new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        this.ws?.terminate();
        resolve();
      }, 1000);

      this.ws!.once("close", () => {
        clearTimeout(timeout);
        resolve();
      });

      this.ws!.close();
    });
  }
}
