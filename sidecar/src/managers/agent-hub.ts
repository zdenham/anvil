/**
 * Agent hub manager.
 *
 * Accepts WebSocket connections from agents on /ws/agent, tracks registrations,
 * stamps pipeline metadata, and routes messages bidirectionally between agents
 * and frontend clients.
 */

import type { WebSocket } from "ws";
import type { EventBroadcaster } from "../push.js";

interface PipelineStamp {
  stage: string;
  seq: number;
  ts: number;
}

interface AgentMessage {
  senderId: string;
  threadId: string;
  type: string;
  parentId?: string;
  pipeline?: PipelineStamp[];
  [key: string]: unknown;
}

interface AgentEntry {
  threadId: string;
  parentId?: string;
  socket: WebSocket;
  /** Last seen sequence number for gap detection. */
  lastSeq: number;
}

export class AgentHub {
  private agents = new Map<string, AgentEntry>();

  constructor(private broadcaster: EventBroadcaster) {}

  /** Handle a new agent WebSocket connection. */
  handleConnection(socket: WebSocket): void {
    let registeredThreadId: string | null = null;

    socket.on("message", (data) => {
      let msg: AgentMessage;
      try {
        msg = JSON.parse(String(data));
      } catch {
        return;
      }

      if (msg.type === "register") {
        registeredThreadId = msg.threadId ?? msg.senderId;
        this.register(registeredThreadId, msg.parentId, socket);
        return;
      }

      // All other messages require a registered agent
      if (!registeredThreadId) return;

      if (msg.type === "relay") {
        this.handleRelay(msg);
        return;
      }

      // Forward to frontend: stamp pipeline and broadcast
      this.forwardToFrontend(msg);
    });

    socket.on("close", () => {
      if (registeredThreadId) {
        this.agents.delete(registeredThreadId);
      }
    });

    socket.on("error", () => {
      if (registeredThreadId) {
        this.agents.delete(registeredThreadId);
      }
    });
  }

  /** Register an agent connection. */
  private register(
    threadId: string,
    parentId: string | undefined,
    socket: WebSocket,
  ): void {
    this.agents.set(threadId, {
      threadId,
      parentId,
      socket,
      lastSeq: 0,
    });
  }

  /** Forward an agent message to frontend clients via broadcaster. */
  private forwardToFrontend(msg: AgentMessage): void {
    const now = Date.now();

    // Pipeline stamping
    const pipeline = msg.pipeline ?? [];
    pipeline.push({ stage: "hub:received", seq: pipeline[0]?.seq ?? 0, ts: now });

    // Sequence gap detection
    const entry = this.agents.get(msg.threadId);
    if (entry) {
      const seq = pipeline[0]?.seq ?? 0;
      if (entry.lastSeq > 0 && seq > entry.lastSeq + 1) {
        const gap = seq - entry.lastSeq - 1;
        console.warn(
          `[agent-hub] seq gap: thread=${msg.threadId} expected=${entry.lastSeq + 1} got=${seq} gap=${gap}`,
        );
      }
      if (seq > 0) entry.lastSeq = seq;
    }

    pipeline.push({ stage: "hub:emitted", seq: pipeline[0]?.seq ?? 0, ts: Date.now() });

    const stamped = { ...msg, pipeline };
    this.broadcaster.broadcast("agent:message", stamped);
  }

  /** Handle relay messages (agent-to-agent forwarding). */
  private handleRelay(msg: AgentMessage): void {
    const targetThreadId = msg.targetThreadId as string | undefined;
    if (!targetThreadId) return;

    const target = this.agents.get(targetThreadId);
    if (!target || target.socket.readyState !== 1) return;

    target.socket.send(JSON.stringify({
      senderId: msg.senderId,
      threadId: msg.threadId,
      type: "relay",
      payload: msg.payload,
    }));
  }

  /** Send a message from the frontend to a specific agent. */
  sendToAgent(threadId: string, message: string): void {
    const entry = this.agents.get(threadId);
    if (!entry) {
      throw new Error(`Agent not connected: ${threadId}`);
    }
    if (entry.socket.readyState !== 1) {
      throw new Error(`Agent socket not open: ${threadId}`);
    }
    entry.socket.send(message);
  }

  /** List all connected agent thread IDs. */
  list(): string[] {
    return Array.from(this.agents.keys());
  }

}
