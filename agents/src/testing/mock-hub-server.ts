import { createServer, Server, Socket } from "net";
import { tmpdir } from "os";
import { join } from "path";
import { unlinkSync, existsSync } from "fs";
import type {
  SocketMessage,
  TauriToAgentMessage,
  RegisterMessage,
} from "../lib/hub/types.js";

/**
 * A mock hub server for testing agents via Unix socket IPC.
 *
 * This server:
 * - Creates a Unix socket server at a configurable path
 * - Accepts connections from agents
 * - Tracks connections by threadId (extracted from registration messages)
 * - Collects all received messages
 * - Allows sending messages to specific agents
 *
 * @example
 * ```typescript
 * const hub = new MockHubServer();
 * await hub.start();
 *
 * // Spawn agent with MORT_HUB_SOCKET_PATH=hub.getSocketPath()
 * await hub.waitForRegistration("thread-123");
 *
 * // Send messages to the agent
 * hub.sendQueuedMessage("thread-123", "User input");
 *
 * // Check received messages
 * const messages = hub.getMessagesForThread("thread-123");
 *
 * await hub.stop();
 * ```
 */
export class MockHubServer {
  private server: Server | null = null;
  private socketPath: string;
  private connections: Map<string, Socket> = new Map(); // threadId -> socket
  private pendingConnections: Set<Socket> = new Set(); // connections not yet registered
  private receivedMessages: SocketMessage[] = [];
  private messageListeners: Array<(msg: SocketMessage) => void> = [];
  private buffers: Map<Socket, string> = new Map(); // socket -> partial message buffer

  /**
   * Create a new MockHubServer.
   *
   * @param socketPath - Path for the Unix socket. Defaults to a unique path in the temp directory.
   */
  constructor(socketPath?: string) {
    this.socketPath =
      socketPath ?? join(tmpdir(), `mock-hub-${Date.now()}-${Math.random().toString(36).slice(2)}.sock`);
  }

  /**
   * Start the server and begin accepting connections.
   */
  async start(): Promise<void> {
    // Clean up any stale socket file
    if (existsSync(this.socketPath)) {
      unlinkSync(this.socketPath);
    }

    return new Promise((resolve, reject) => {
      this.server = createServer((socket) => {
        this.handleConnection(socket);
      });

      this.server.on("error", (err) => {
        reject(err);
      });

      this.server.listen(this.socketPath, () => {
        resolve();
      });
    });
  }

  /**
   * Stop the server and clean up all connections.
   */
  async stop(): Promise<void> {
    // Close all connections
    for (const socket of this.connections.values()) {
      socket.destroy();
    }
    for (const socket of this.pendingConnections) {
      socket.destroy();
    }
    this.connections.clear();
    this.pendingConnections.clear();
    this.buffers.clear();

    // Close the server
    if (this.server) {
      await new Promise<void>((resolve) => {
        this.server!.close(() => resolve());
      });
      this.server = null;
    }

    // Clean up socket file
    if (existsSync(this.socketPath)) {
      try {
        unlinkSync(this.socketPath);
      } catch {
        // Ignore cleanup errors
      }
    }
  }

  /**
   * Handle a new socket connection.
   */
  private handleConnection(socket: Socket): void {
    this.pendingConnections.add(socket);
    this.buffers.set(socket, "");

    socket.on("data", (data) => {
      this.processData(socket, data);
    });

    socket.on("close", () => {
      this.handleDisconnect(socket);
    });

    socket.on("error", () => {
      this.handleDisconnect(socket);
    });
  }

  /**
   * Process incoming data from a socket using newline-delimited JSON.
   */
  private processData(socket: Socket, data: Buffer): void {
    const buffer = (this.buffers.get(socket) ?? "") + data.toString();
    const lines = buffer.split("\n");

    // Keep the last incomplete line in the buffer
    this.buffers.set(socket, lines.pop() ?? "");

    for (const line of lines) {
      if (!line.trim()) continue;

      try {
        const msg = JSON.parse(line) as SocketMessage;
        this.handleMessage(socket, msg);
      } catch {
        // Invalid JSON, skip
      }
    }
  }

  /**
   * Handle a parsed message from a socket.
   */
  private handleMessage(socket: Socket, msg: SocketMessage): void {
    // Store the message
    this.receivedMessages.push(msg);

    // Handle registration messages
    if (msg.type === "register") {
      const registerMsg = msg as RegisterMessage;
      const threadId = registerMsg.threadId;

      // Move from pending to registered
      this.pendingConnections.delete(socket);
      this.connections.set(threadId, socket);
    }

    // Notify listeners
    for (const listener of this.messageListeners) {
      listener(msg);
    }
  }

  /**
   * Handle socket disconnection.
   */
  private handleDisconnect(socket: Socket): void {
    this.pendingConnections.delete(socket);
    this.buffers.delete(socket);

    // Remove from connections map
    for (const [threadId, s] of this.connections.entries()) {
      if (s === socket) {
        this.connections.delete(threadId);
        break;
      }
    }
  }

  /**
   * Send a message to a specific agent by threadId.
   *
   * @param threadId - The thread ID of the agent to send to
   * @param message - The message to send
   * @throws Error if no connection exists for the threadId
   */
  sendToAgent(threadId: string, message: TauriToAgentMessage): void {
    const socket = this.connections.get(threadId);
    if (!socket) {
      throw new Error(`No connection found for threadId: ${threadId}`);
    }

    if (socket.destroyed) {
      throw new Error(`Connection for threadId ${threadId} is destroyed`);
    }

    socket.write(JSON.stringify(message) + "\n");
  }

  /**
   * Send a cancel message to an agent.
   *
   * @param threadId - The thread ID of the agent to cancel
   */
  sendCancel(threadId: string): void {
    this.sendToAgent(threadId, { type: "cancel" });
  }

  /**
   * Send a permission response to an agent.
   *
   * @param threadId - The thread ID of the agent
   * @param allowed - Whether the permission is granted
   * @param requestId - Optional request ID (defaults to "test-request")
   */
  sendPermissionResponse(
    threadId: string,
    allowed: boolean,
    requestId: string = "test-request"
  ): void {
    this.sendToAgent(threadId, {
      type: "permission_response",
      payload: {
        requestId,
        decision: allowed ? "approve" : "deny",
      },
    });
  }

  /**
   * Send a queued message to an agent.
   *
   * @param threadId - The thread ID of the agent
   * @param content - The message content
   */
  sendQueuedMessage(threadId: string, content: string): void {
    this.sendToAgent(threadId, {
      type: "queued_message",
      payload: { content },
    });
  }

  /**
   * Get all received messages from all agents.
   */
  getMessages(): SocketMessage[] {
    return [...this.receivedMessages];
  }

  /**
   * Get all messages received from a specific thread.
   *
   * @param threadId - The thread ID to filter by
   */
  getMessagesForThread(threadId: string): SocketMessage[] {
    return this.receivedMessages.filter((msg) => msg.threadId === threadId);
  }

  /**
   * Wait for a message matching a predicate.
   *
   * @param predicate - Function to test each message
   * @param timeout - Maximum time to wait in milliseconds (default: 5000)
   * @returns The matching message
   * @throws Error if timeout is reached without finding a matching message
   */
  waitForMessage(
    predicate: (msg: SocketMessage) => boolean,
    timeout: number = 5000
  ): Promise<SocketMessage> {
    // Check existing messages first
    const existing = this.receivedMessages.find(predicate);
    if (existing) {
      return Promise.resolve(existing);
    }

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error(`Timeout waiting for message after ${timeout}ms`));
      }, timeout);

      const listener = (msg: SocketMessage) => {
        if (predicate(msg)) {
          cleanup();
          resolve(msg);
        }
      };

      const cleanup = () => {
        clearTimeout(timer);
        const idx = this.messageListeners.indexOf(listener);
        if (idx !== -1) {
          this.messageListeners.splice(idx, 1);
        }
      };

      this.messageListeners.push(listener);
    });
  }

  /**
   * Wait for an agent to register with the hub.
   *
   * @param threadId - The thread ID to wait for
   * @param timeout - Maximum time to wait in milliseconds (default: 5000)
   */
  async waitForRegistration(
    threadId: string,
    timeout: number = 5000
  ): Promise<void> {
    // Check if already registered
    if (this.connections.has(threadId)) {
      return;
    }

    await this.waitForMessage(
      (msg) => msg.type === "register" && msg.threadId === threadId,
      timeout
    );
  }

  /**
   * Get the socket path for this server.
   */
  getSocketPath(): string {
    return this.socketPath;
  }

  /**
   * Get all currently connected thread IDs.
   */
  getConnectedThreadIds(): string[] {
    return [...this.connections.keys()];
  }

  /**
   * Check if a specific thread is connected.
   *
   * @param threadId - The thread ID to check
   */
  isConnected(threadId: string): boolean {
    const socket = this.connections.get(threadId);
    return socket !== undefined && !socket.destroyed;
  }

  /**
   * Clear all received messages. Useful for test isolation.
   */
  clearMessages(): void {
    this.receivedMessages = [];
  }

  /**
   * Get the number of currently connected agents.
   */
  getConnectionCount(): number {
    return this.connections.size;
  }
}
