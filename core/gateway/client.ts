/**
 * Platform-agnostic, fetch-based SSE client for the gateway event stream.
 *
 * Uses constructor-injected callbacks for persistence and event dispatch
 * so it works identically in browser (Tauri) and Node.js environments.
 * No platform-specific imports (`fs`, `localStorage`, `window`).
 */

import { GatewayEventSchema, type GatewayEvent } from "../types/gateway-events.js";
import { parseSSEFrames } from "./sse-parser.js";

export type ConnectionStatus = "connecting" | "connected" | "disconnected";

export interface GatewayClientOptions {
  /** Gateway base URL (e.g. "https://mort-server.fly.dev") */
  baseUrl: string;
  /** Device ID for SSE stream subscription */
  deviceId: string;
  /** Load the last acknowledged Redis stream ID (platform-specific) */
  loadLastEventId: () => Promise<string | null>;
  /** Persist the last acknowledged Redis stream ID */
  saveLastEventId: (id: string) => Promise<void>;
  /** Called for each validated incoming event */
  onEvent: (event: GatewayEvent) => void;
  /** Called on connection state changes */
  onStatus?: (status: ConnectionStatus) => void;
  /** Custom fetch implementation (e.g. Tauri HTTP plugin). Defaults to globalThis.fetch. */
  fetch?: typeof globalThis.fetch;
}

/** Backoff config: 1s, 2s, 4s, 8s, 16s, 30s cap */
const INITIAL_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 30_000;

/**
 * Fetch-based SSE client with automatic reconnect and exponential backoff.
 *
 * Connect flow:
 * 1. Load `lastEventId` via injected callback
 * 2. Open streaming `fetch` to the device's SSE endpoint
 * 3. Parse SSE frames incrementally from the response body
 * 4. Validate and dispatch each event, persisting the stream ID
 *
 * On disconnect or error, reconnects with capped exponential backoff.
 * Backoff resets when the first event is received on a new connection.
 */
export class GatewayClient {
  private abortController: AbortController | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private backoffMs = INITIAL_BACKOFF_MS;
  private running = false;

  constructor(private readonly options: GatewayClientOptions) {}

  /**
   * Open the SSE connection. Replays missed events, then streams live.
   * Resolves once the stream loop starts (not when the first event arrives).
   */
  async connect(): Promise<void> {
    if (this.running) return;
    this.running = true;
    await this.startStream();
  }

  /**
   * Close the connection and cancel any pending reconnect.
   */
  disconnect(): void {
    this.running = false;
    this.clearReconnect();
    this.abortController?.abort();
    this.abortController = null;
    this.options.onStatus?.("disconnected");
  }

  private async startStream(): Promise<void> {
    if (!this.running) return;

    this.options.onStatus?.("connecting");
    this.abortController = new AbortController();

    try {
      const lastEventId = await this.options.loadLastEventId();
      const url = this.buildUrl();
      const headers: Record<string, string> = { Accept: "text/event-stream" };
      if (lastEventId) headers["Last-Event-ID"] = lastEventId;

      const fetchFn = this.options.fetch ?? globalThis.fetch;
      const response = await fetchFn(url, {
        headers,
        signal: this.abortController.signal,
      });

      if (!response.ok) {
        throw new Error(`SSE connect failed: ${response.status} ${response.statusText}`);
      }

      if (!response.body) {
        throw new Error("SSE response has no body stream");
      }

      this.options.onStatus?.("connected");
      await this.readStream(response.body);
    } catch (error: unknown) {
      if (!this.isAbortError(error)) {
        this.scheduleReconnect();
      }
    }
  }

  private async readStream(body: ReadableStream<Uint8Array>): Promise<void> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    try {
      while (this.running) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const { frames, remainder } = parseSSEFrames(buffer);
        buffer = remainder;

        for (const frame of frames) {
          await this.handleFrame(frame);
        }
      }
    } finally {
      reader.releaseLock();
    }

    // Stream ended normally — reconnect if still running
    if (this.running) {
      this.options.onStatus?.("disconnected");
      this.scheduleReconnect();
    }
  }

  private async handleFrame(frame: { id?: string; event?: string; data?: string }): Promise<void> {
    if (!frame.data) return;

    const parsed = this.parseEventData(frame.data);
    if (!parsed) return;

    this.options.onEvent(parsed);

    // Persist the Redis stream ID (the SSE `id:` field) for replay on reconnect
    if (frame.id) {
      await this.options.saveLastEventId(frame.id);
    }

    // First event received — reset backoff
    this.backoffMs = INITIAL_BACKOFF_MS;
  }

  /**
   * Parse and validate the JSON data field against the GatewayEvent schema.
   * Returns null if parsing or validation fails (malformed frames are skipped).
   */
  private parseEventData(data: string): GatewayEvent | null {
    try {
      const json: unknown = JSON.parse(data);
      const result = GatewayEventSchema.safeParse(json);
      return result.success ? result.data : null;
    } catch {
      return null;
    }
  }

  private scheduleReconnect(): void {
    if (!this.running) return;
    this.clearReconnect();

    this.options.onStatus?.("disconnected");
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.backoffMs = Math.min(this.backoffMs * 2, MAX_BACKOFF_MS);
      this.startStream();
    }, this.backoffMs);
  }

  private clearReconnect(): void {
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private buildUrl(): string {
    const base = this.options.baseUrl.replace(/\/$/, "");
    return `${base}/gateway/devices/${this.options.deviceId}/events`;
  }

  private isAbortError(error: unknown): boolean {
    return error instanceof DOMException && error.name === "AbortError";
  }
}
