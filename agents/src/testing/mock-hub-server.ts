import { createServer } from "http";
import { WebSocketServer, WebSocket } from "ws";
import type { Server as HttpServer } from "http";
import type {
  SocketMessage,
  TauriToAgentMessage,
  RegisterMessage,
} from "../lib/hub/types.js";

/**
 * A mock hub server for testing agents via WebSocket IPC.
 *
 * This server:
 * - Creates a WebSocket server on a configurable port
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
 * // Spawn agent with ANVIL_AGENT_HUB_WS_URL=hub.getEndpoint()
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
  private httpServer: HttpServer | null = null;
  private wss: WebSocketServer | null = null;
  private port: number;
  private connections: Map<string, WebSocket> = new Map(); // threadId -> ws
  private pendingConnections: Set<WebSocket> = new Set(); // connections not yet registered
  private receivedMessages: SocketMessage[] = [];
  private messageListeners: Array<(msg: SocketMessage) => void> = [];

  /**
   * Create a new MockHubServer.
   *
   * @param port - Port to listen on. Defaults to 0 (OS-assigned random port).
   */
  constructor(port = 0) {
    this.port = port;
  }

  /**
   * Start the server and begin accepting connections.
   */
  async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.httpServer = createServer();
      this.wss = new WebSocketServer({ server: this.httpServer });

      this.wss.on("connection", (ws) => {
        this.handleConnection(ws);
      });

      this.httpServer.on("error", (err) => {
        reject(err);
      });

      this.httpServer.listen(this.port, "127.0.0.1", () => {
        const addr = this.httpServer!.address();
        if (addr && typeof addr === "object") {
          this.port = addr.port;
        }
        resolve();
      });
    });
  }

  /**
   * Stop the server and clean up all connections.
   */
  async stop(): Promise<void> {
    // Close all WebSocket connections
    for (const ws of this.connections.values()) {
      ws.terminate();
    }
    for (const ws of this.pendingConnections) {
      ws.terminate();
    }
    this.connections.clear();
    this.pendingConnections.clear();

    // Close the WebSocket server
    if (this.wss) {
      this.wss.close();
      this.wss = null;
    }

    // Close the HTTP server
    if (this.httpServer) {
      await new Promise<void>((resolve) => {
        this.httpServer!.close(() => resolve());
      });
      this.httpServer = null;
    }
  }

  /**
   * Handle a new WebSocket connection.
   */
  private handleConnection(ws: WebSocket): void {
    this.pendingConnections.add(ws);

    ws.on("message", (data) => {
      try {
        const msg = JSON.parse(String(data)) as SocketMessage;
        this.handleMessage(ws, msg);
      } catch {
        // Invalid JSON, skip
      }
    });

    ws.on("close", () => {
      this.handleDisconnect(ws);
    });

    ws.on("error", () => {
      this.handleDisconnect(ws);
    });
  }

  /**
   * Handle a parsed message from a WebSocket.
   */
  private handleMessage(ws: WebSocket, msg: SocketMessage): void {
    // Store the message
    this.receivedMessages.push(msg);

    // Handle registration messages
    if (msg.type === "register") {
      const registerMsg = msg as RegisterMessage;
      const threadId = registerMsg.threadId;

      // Move from pending to registered
      this.pendingConnections.delete(ws);
      this.connections.set(threadId, ws);
    }

    // Notify listeners
    for (const listener of this.messageListeners) {
      listener(msg);
    }
  }

  /**
   * Handle WebSocket disconnection.
   */
  private handleDisconnect(ws: WebSocket): void {
    this.pendingConnections.delete(ws);

    // Remove from connections map
    for (const [threadId, s] of this.connections.entries()) {
      if (s === ws) {
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
    const ws = this.connections.get(threadId);
    if (!ws) {
      throw new Error(`No connection found for threadId: ${threadId}`);
    }

    if (ws.readyState !== WebSocket.OPEN) {
      throw new Error(`Connection for threadId ${threadId} is not open`);
    }

    ws.send(JSON.stringify(message));
  }

  /**
   * Send a cancel message to an agent.
   */
  sendCancel(threadId: string): void {
    this.sendToAgent(threadId, { type: "cancel" });
  }

  /**
   * Send a permission response to an agent.
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
   */
  getMessagesForThread(threadId: string): SocketMessage[] {
    return this.receivedMessages.filter((msg) => msg.threadId === threadId);
  }

  /**
   * Wait for a message matching a predicate.
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
   * Get the WebSocket endpoint URL for this server.
   */
  getEndpoint(): string {
    return `ws://127.0.0.1:${this.port}/ws/agent`;
  }

  /**
   * Get all currently connected thread IDs.
   */
  getConnectedThreadIds(): string[] {
    return [...this.connections.keys()];
  }

  /**
   * Check if a specific thread is connected.
   */
  isConnected(threadId: string): boolean {
    const ws = this.connections.get(threadId);
    return ws !== undefined && ws.readyState === WebSocket.OPEN;
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
