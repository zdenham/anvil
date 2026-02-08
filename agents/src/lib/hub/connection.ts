import { connect, Socket } from "net";
import { EventEmitter } from "events";
import type { SocketMessage } from "./types.js";

export class HubConnection extends EventEmitter {
  private socket: Socket | null = null;
  private buffer = "";

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

  write(msg: SocketMessage): void {
    if (this.socket && !this.socket.destroyed) {
      this.socket.write(JSON.stringify(msg) + "\n");
    }
  }

  get isConnected(): boolean {
    return this.socket !== null && !this.socket.destroyed;
  }

  destroy(): void {
    this.socket?.destroy();
    this.socket = null;
    this.buffer = "";
  }
}
