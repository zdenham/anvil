import { connect, Socket } from "net";
import { EventEmitter } from "events";
import type { SocketMessage } from "./types.js";

export class HubConnection extends EventEmitter {
  private socket: Socket | null = null;
  private buffer = "";
  private isClosing = false;
  private writeQueue: SocketMessage[] = [];
  private draining = false;

  connect(socketPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.socket = connect(socketPath);

      const onConnect = () => {
        cleanup();
        this.setupDataHandler();
        resolve();
      };

      const onError = (err: Error) => {
        cleanup();
        reject(err);
      };

      const cleanup = () => {
        this.socket?.removeListener("connect", onConnect);
        this.socket?.removeListener("error", onError);
      };

      this.socket.once("connect", onConnect);
      this.socket.once("error", onError);
    });
  }

  private setupDataHandler(): void {
    if (!this.socket) return;

    this.socket.on("data", (data) => {
      this.buffer += data.toString();
      this.processBuffer();
    });

    this.socket.on("close", () => this.emit("disconnect"));
    this.socket.on("error", (err) => this.emit("error", err));
  }

  private processBuffer(): void {
    const lines = this.buffer.split("\n");
    this.buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const msg = JSON.parse(line) as SocketMessage;
        this.emit("message", msg);
      } catch {
        // Invalid JSON, skip
      }
    }
  }

  write(msg: SocketMessage): boolean {
    if (!this.socket || this.socket.destroyed || this.isClosing) {
      return false;
    }

    // If already draining, queue the message
    if (this.draining) {
      this.writeQueue.push(msg);
      return true;
    }

    try {
      const data = JSON.stringify(msg) + "\n";
      const flushed = this.socket.write(data);

      if (!flushed) {
        // Buffer is full, wait for drain
        this.draining = true;
        this.socket.once("drain", () => this.flushQueue());
      }

      return true;
    } catch {
      // EPIPE or other write errors - socket is closing/closed
      // Don't emit error here to avoid recursive EPIPE when logging
      return false;
    }
  }

  private flushQueue(): void {
    this.draining = false;

    while (this.writeQueue.length > 0 && !this.draining) {
      const msg = this.writeQueue.shift()!;
      this.write(msg);
    }
  }

  get isConnected(): boolean {
    return this.socket !== null && !this.socket.destroyed;
  }

  destroy(): void {
    this.socket?.destroy();
    this.socket = null;
    this.buffer = "";
    this.writeQueue = [];
    this.draining = false;
    this.isClosing = false;
  }

  /**
   * Gracefully close the connection after flushing pending writes.
   * Returns a promise that resolves when the connection is closed.
   */
  async gracefulClose(): Promise<void> {
    if (!this.socket || this.isClosing) return;

    this.isClosing = true;

    return new Promise<void>((resolve) => {
      if (!this.socket) {
        resolve();
        return;
      }

      // Wait for write buffer to drain, with timeout
      const timeout = setTimeout(() => {
        this.socket?.destroy();
        resolve();
      }, 1000);

      this.socket.once("drain", () => {
        clearTimeout(timeout);
        this.socket?.end();
        resolve();
      });

      // If already drained, end immediately
      if (this.socket.writableLength === 0) {
        clearTimeout(timeout);
        this.socket.end();
        resolve();
      }
    });
  }
}
