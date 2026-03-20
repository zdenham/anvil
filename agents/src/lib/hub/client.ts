import { EventEmitter } from "events";
import { getHubEndpoint } from "@core/lib/socket.js";
import type { PipelineStamp } from "@core/types/pipeline.js";
import type { DiagnosticLoggingConfig } from "@core/types/diagnostic-logging.js";
import { HubConnection } from "./connection.js";
import { HeartbeatEmitter } from "./heartbeat.js";
import { VisibilityWatcher } from "./visibility-watcher.js";
import { withRetry, type RetryOptions, DEFAULT_RETRY_OPTIONS } from "./retry.js";
import { parseDiagnosticConfig } from "./diagnostic-config.js";
import type { SocketMessage } from "./types.js";

/** High-level connection lifecycle state. */
export type ConnectionState = "connected" | "reconnecting" | "disconnected";

const RECONNECT_RETRY: RetryOptions = { maxRetries: 5, baseDelayMs: 500 };
const STATS_INTERVAL_MS = 30_000;

export class HubClient extends EventEmitter {
  private connection: HubConnection;
  private endpoint: string;
  private heartbeat: HeartbeatEmitter;
  private visibilityWatcher: VisibilityWatcher;
  private diagnosticConfig: DiagnosticLoggingConfig;
  private statsTimer: ReturnType<typeof setInterval> | null = null;

  /** Monotonic sequence number stamped on every outgoing message. */
  private seq = 0;

  // --- Counters (always-on for session summary) ---
  private totalSent = 0;
  private totalWriteFailures = 0;
  private totalEventsGated = 0;

  /** Current high-level connection state. */
  connectionState: ConnectionState = "disconnected";

  constructor(
    private threadId: string,
    private parentId?: string
  ) {
    super();
    this.endpoint = getHubEndpoint();
    this.connection = new HubConnection();
    this.diagnosticConfig = parseDiagnosticConfig();
    this.heartbeat = new HeartbeatEmitter((msg) => this.send(msg));
    this.visibilityWatcher = new VisibilityWatcher();
    this.wireConnectionEvents();
  }

  /** Wire event handlers from the underlying HubConnection. */
  private wireConnectionEvents(): void {
    this.connection.on("message", (msg) => this.emit("message", msg));
    this.connection.on("disconnect", () => {
      if (this.connectionState === "reconnecting") return;
      this.handleDisconnect();
    });
    this.connection.on("error", (err) => this.emit("error", err));
    this.connection.on("write-failure", ({ consecutiveFailures }) => {
      this.totalWriteFailures++;
      if (this.diagnosticConfig.socketHealth) {
        this.emit("log", "WARN", `[hub] write failure #${consecutiveFailures}`);
      }
    });
  }

  async connect(options: Partial<RetryOptions> = {}): Promise<void> {
    this.visibilityWatcher.start();

    const retryOptions = { ...DEFAULT_RETRY_OPTIONS, ...options };
    await withRetry(() => this.connection.connect(this.endpoint), retryOptions);
    this.connectionState = "connected";
    this.startStatsTimer();

    this.send({
      type: "register",
      ...(this.parentId && { parentId: this.parentId }),
      pid: process.pid,
    });
  }

  /** Send a message through the hub with pipeline stamping. Drops when not connected. */
  send(msg: Omit<SocketMessage, "senderId" | "threadId" | "pipeline">): void {
    const stamp: PipelineStamp = {
      stage: "agent:sent",
      seq: ++this.seq,
      ts: Date.now(),
    };

    const fullMsg = {
      ...msg,
      senderId: this.threadId,
      threadId: this.threadId,
      pipeline: [stamp],
    } as SocketMessage;

    if (this.diagnosticConfig.pipeline) {
      this.emit("log", "DEBUG", `[hub] send seq=${stamp.seq} type=${msg.type}`);
    }

    if (this.connectionState !== "connected") {
      return; // silently drop — client recovers from disk on seq gap
    }

    const ok = this.connection.write(fullMsg);
    if (ok) {
      this.totalSent++;
    } else {
      this.totalWriteFailures++;
    }
  }

  private handleDisconnect(): void {
    this.heartbeat.stop();
    this.stopStatsTimer();
    this.reconnect().catch(() => {
      // reconnect() handles state transitions internally
    });
  }

  /** Attempt to reconnect to the hub with exponential backoff. */
  async reconnect(): Promise<boolean> {
    if (this.connectionState === "reconnecting") return false;
    this.connectionState = "reconnecting";
    this.heartbeat.stop();
    this.connection.destroy();

    this.connection = new HubConnection();
    this.wireConnectionEvents();

    try {
      await withRetry(
        () => this.connection.connect(this.endpoint),
        RECONNECT_RETRY,
      );
      this.send({
        type: "register",
        ...(this.parentId && { parentId: this.parentId }),
      });
      this.connectionState = "connected";
      this.heartbeat.start();
      this.startStatsTimer();
      this.emit("reconnected");
      return true;
    } catch {
      this.connectionState = "disconnected";
      this.emit("disconnect");
      return false;
    }
  }

  /** Update diagnostic config at runtime (e.g. from relay message). */
  updateDiagnosticConfig(config: DiagnosticLoggingConfig): void {
    this.diagnosticConfig = config;
  }

  getDiagnosticConfig(): DiagnosticLoggingConfig {
    return this.diagnosticConfig;
  }

  // --- Public send helpers ---

  /** Send a message on behalf of a different thread (e.g., child sub-agent). */
  sendForThread(threadId: string, msg: Omit<SocketMessage, "senderId" | "threadId" | "pipeline">): void {
    const stamp: PipelineStamp = {
      stage: "agent:sent",
      seq: ++this.seq,
      ts: Date.now(),
    };

    const fullMsg = {
      ...msg,
      senderId: this.threadId,
      threadId,
      pipeline: [stamp],
    } as SocketMessage;

    if (this.diagnosticConfig.pipeline) {
      this.emit("log", "DEBUG", `[hub] sendForThread seq=${stamp.seq} type=${msg.type} child=${threadId}`);
    }

    if (this.connectionState !== "connected") {
      return;
    }

    const ok = this.connection.write(fullMsg);
    if (ok) {
      this.totalSent++;
    } else {
      this.totalWriteFailures++;
    }
  }

  /** Send a ThreadAction scoped to a specific thread (e.g., child sub-agent). */
  sendActionForThread(threadId: string, action: unknown): void {
    this.sendForThread(threadId, { type: "thread_action", action });
  }

  sendEvent(name: string, payload: unknown, source?: string): void {
    if (!this.visibilityWatcher.shouldSendEvent(name, this.threadId)) {
      this.totalEventsGated++;
      return;
    }
    this.send({ type: "event", name, payload, ...(source && { source }) });
  }

  sendLog(level: string, message: string): void {
    this.send({ type: "log", level, message });
  }

  relay(targetThreadId: string, payload: Record<string, unknown>): void {
    this.send({ type: "relay", targetThreadId, payload });
  }

  sendDrain(event: string, properties: Record<string, string | number | boolean>, source?: string): void {
    this.send({ type: "drain", event, properties, ...(source && { source }) });
  }

  // --- Heartbeat ---

  startHeartbeat(): void {
    this.heartbeat.start();
  }

  stopHeartbeat(): void {
    this.heartbeat.stop();
  }

  // --- Stats timer ---

  private startStatsTimer(): void {
    this.stopStatsTimer();
    if (!this.diagnosticConfig.socketHealth) return;
    this.statsTimer = setInterval(() => {
      this.emit(
        "log", "DEBUG",
        `[hub] stats: sent=${this.totalSent}, writeFailures=${this.totalWriteFailures}`,
      );
    }, STATS_INTERVAL_MS);
  }

  private stopStatsTimer(): void {
    if (this.statsTimer) {
      clearInterval(this.statsTimer);
      this.statsTimer = null;
    }
  }

  // --- Accessors ---

  get isConnected(): boolean {
    return this.connection.isConnected;
  }

  /** Session summary string for always-on completion logging. */
  get sessionSummary(): string {
    return (
      `[hub] session summary: totalSent=${this.totalSent}, ` +
      `writeFailures=${this.totalWriteFailures}, ` +
      `eventsGated=${this.totalEventsGated}`
    );
  }

  // --- Teardown ---

  disconnect(): void {
    this.heartbeat.stop();
    this.visibilityWatcher.stop();
    this.stopStatsTimer();
    this.connection.destroy();
    this.connectionState = "disconnected";
  }

  async gracefulDisconnect(): Promise<void> {
    this.heartbeat.stop();
    this.visibilityWatcher.stop();
    this.stopStatsTimer();
    this.connectionState = "disconnected";
    await this.connection.gracefulClose();
  }
}
