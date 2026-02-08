# 03: Node.js Hub Client

Implement the client library for agents to communicate with the Tauri AgentHub via Unix socket.

## Context

The HubClient is a Node.js library that:
- Connects to the hub socket with retry/backoff
- Handles registration (including parentId for sub-agents)
- Provides high-level API for sending state/events
- Emits incoming messages from Tauri

## Phases

- [x] Create `agents/src/lib/hub/types.ts` with message definitions
- [x] Create `agents/src/lib/hub/retry.ts` with backoff logic
- [x] Create `agents/src/lib/hub/connection.ts` for low-level socket I/O
- [x] Create `agents/src/lib/hub/client.ts` with high-level API
- [x] Create `agents/src/lib/hub/index.ts` with exports
- [x] Add tests for retry logic and message parsing

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## File Structure

```
agents/src/lib/hub/
├── index.ts           # Re-exports public API
├── types.ts           # Message type definitions
├── connection.ts      # Low-level socket connection management
├── client.ts          # High-level HubClient API
└── retry.ts           # Connection retry logic with backoff
```

## Implementation

### `types.ts`

```typescript
/**
 * Base message structure for all socket communication.
 */
export interface SocketMessage {
  senderId: string;
  threadId: string;
  type: string;
  [key: string]: unknown;
}

export interface RegisterMessage extends SocketMessage {
  type: "register";
  parentId?: string;
}

export interface StateMessage extends SocketMessage {
  type: "state";
  state: unknown;
}

export interface EventMessage extends SocketMessage {
  type: "event";
  name: string;
  payload: unknown;
}

export type TauriToAgentMessage =
  | { type: "permission_response"; payload: { requestId: string; decision: string } }
  | { type: "queued_message"; payload: { content: string } }
  | { type: "cancel" };
```

### `retry.ts`

```typescript
export interface RetryOptions {
  maxRetries: number;
  baseDelayMs: number;
}

export const DEFAULT_RETRY_OPTIONS: RetryOptions = {
  maxRetries: 10,
  baseDelayMs: 100,
};

export async function withRetry<T>(
  operation: () => Promise<T>,
  options: RetryOptions = DEFAULT_RETRY_OPTIONS
): Promise<T> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < options.maxRetries; attempt++) {
    try {
      return await operation();
    } catch (err) {
      lastError = err as Error;
      if (attempt < options.maxRetries - 1) {
        const delay = options.baseDelayMs * Math.pow(2, attempt);
        await sleep(delay);
      }
    }
  }

  throw new Error(
    `Operation failed after ${options.maxRetries} attempts: ${lastError?.message}`
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
```

### `connection.ts`

```typescript
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
```

### `client.ts`

```typescript
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
    const fullMsg: SocketMessage = {
      senderId: this.threadId,
      threadId: this.threadId,
      ...msg,
    };
    this.connection.write(fullMsg);
  }

  sendState(state: unknown): void {
    this.send({ type: "state", state });
  }

  sendEvent(name: string, payload: unknown): void {
    this.send({ type: "event", name, payload });
  }

  get isConnected(): boolean {
    return this.connection.isConnected;
  }

  disconnect(): void {
    this.connection.destroy();
  }
}
```

### `index.ts`

```typescript
export { HubClient } from "./client.js";
export { HubConnection } from "./connection.js";
export { withRetry, DEFAULT_RETRY_OPTIONS } from "./retry.js";
export type {
  SocketMessage,
  RegisterMessage,
  StateMessage,
  EventMessage,
  TauriToAgentMessage,
} from "./types.js";
export type { RetryOptions } from "./retry.js";
```

## Acceptance Criteria

- [ ] `HubClient` connects to socket with exponential backoff retry
- [ ] Registration message sent immediately after connection
- [ ] `sendState()` and `sendEvent()` format messages correctly
- [ ] Incoming messages emitted via EventEmitter
- [ ] `parentId` included in registration when provided
- [ ] Connection errors and disconnects properly emitted
- [ ] Clean disconnect via `disconnect()` method

## Verification

### Unit Test Approaches

#### `retry.ts` Tests
Create `agents/src/lib/hub/retry.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { withRetry, DEFAULT_RETRY_OPTIONS } from "./retry.js";

describe("withRetry", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns result on first success", async () => {
    const operation = vi.fn().mockResolvedValue("success");
    const result = await withRetry(operation);
    expect(result).toBe("success");
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it("retries on failure with exponential backoff", async () => {
    const operation = vi.fn()
      .mockRejectedValueOnce(new Error("fail 1"))
      .mockRejectedValueOnce(new Error("fail 2"))
      .mockResolvedValue("success");

    const promise = withRetry(operation, { maxRetries: 5, baseDelayMs: 100 });

    // First attempt fails immediately
    await vi.advanceTimersByTimeAsync(0);
    expect(operation).toHaveBeenCalledTimes(1);

    // Wait for first backoff (100ms)
    await vi.advanceTimersByTimeAsync(100);
    expect(operation).toHaveBeenCalledTimes(2);

    // Wait for second backoff (200ms)
    await vi.advanceTimersByTimeAsync(200);
    expect(operation).toHaveBeenCalledTimes(3);

    const result = await promise;
    expect(result).toBe("success");
  });

  it("throws after max retries exhausted", async () => {
    const operation = vi.fn().mockRejectedValue(new Error("always fails"));

    const promise = withRetry(operation, { maxRetries: 3, baseDelayMs: 10 });

    // Advance through all retries
    for (let i = 0; i < 3; i++) {
      await vi.advanceTimersByTimeAsync(10 * Math.pow(2, i));
    }

    await expect(promise).rejects.toThrow("Operation failed after 3 attempts");
    expect(operation).toHaveBeenCalledTimes(3);
  });

  it("uses default options when none provided", async () => {
    expect(DEFAULT_RETRY_OPTIONS.maxRetries).toBe(10);
    expect(DEFAULT_RETRY_OPTIONS.baseDelayMs).toBe(100);
  });
});
```

#### `connection.ts` Tests
Create `agents/src/lib/hub/connection.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { HubConnection } from "./connection.js";
import { EventEmitter } from "events";

// Mock the net module
vi.mock("net", () => ({
  connect: vi.fn(),
}));

describe("HubConnection", () => {
  let connection: HubConnection;
  let mockSocket: EventEmitter & { write: ReturnType<typeof vi.fn>; destroyed: boolean; destroy: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    const { connect } = await import("net");
    mockSocket = Object.assign(new EventEmitter(), {
      write: vi.fn(),
      destroyed: false,
      destroy: vi.fn(),
    });
    vi.mocked(connect).mockReturnValue(mockSocket as any);
    connection = new HubConnection();
  });

  describe("connect", () => {
    it("resolves on successful connection", async () => {
      const connectPromise = connection.connect("/tmp/test.sock");
      mockSocket.emit("connect");
      await expect(connectPromise).resolves.toBeUndefined();
    });

    it("rejects on connection error", async () => {
      const connectPromise = connection.connect("/tmp/test.sock");
      mockSocket.emit("error", new Error("ENOENT"));
      await expect(connectPromise).rejects.toThrow("ENOENT");
    });
  });

  describe("message parsing", () => {
    it("parses newline-delimited JSON messages", async () => {
      const messageHandler = vi.fn();
      connection.on("message", messageHandler);

      const connectPromise = connection.connect("/tmp/test.sock");
      mockSocket.emit("connect");
      await connectPromise;

      mockSocket.emit("data", Buffer.from('{"type":"test","senderId":"a","threadId":"b"}\n'));

      expect(messageHandler).toHaveBeenCalledWith({
        type: "test",
        senderId: "a",
        threadId: "b",
      });
    });

    it("handles partial messages across multiple data events", async () => {
      const messageHandler = vi.fn();
      connection.on("message", messageHandler);

      const connectPromise = connection.connect("/tmp/test.sock");
      mockSocket.emit("connect");
      await connectPromise;

      mockSocket.emit("data", Buffer.from('{"type":"te'));
      mockSocket.emit("data", Buffer.from('st","senderId":"a","threadId":"b"}\n'));

      expect(messageHandler).toHaveBeenCalledTimes(1);
      expect(messageHandler).toHaveBeenCalledWith({
        type: "test",
        senderId: "a",
        threadId: "b",
      });
    });

    it("handles multiple messages in single data event", async () => {
      const messageHandler = vi.fn();
      connection.on("message", messageHandler);

      const connectPromise = connection.connect("/tmp/test.sock");
      mockSocket.emit("connect");
      await connectPromise;

      mockSocket.emit("data", Buffer.from(
        '{"type":"first","senderId":"a","threadId":"b"}\n{"type":"second","senderId":"a","threadId":"b"}\n'
      ));

      expect(messageHandler).toHaveBeenCalledTimes(2);
    });

    it("skips invalid JSON lines", async () => {
      const messageHandler = vi.fn();
      connection.on("message", messageHandler);

      const connectPromise = connection.connect("/tmp/test.sock");
      mockSocket.emit("connect");
      await connectPromise;

      mockSocket.emit("data", Buffer.from('not-json\n{"type":"valid","senderId":"a","threadId":"b"}\n'));

      expect(messageHandler).toHaveBeenCalledTimes(1);
      expect(messageHandler).toHaveBeenCalledWith({
        type: "valid",
        senderId: "a",
        threadId: "b",
      });
    });
  });

  describe("write", () => {
    it("writes JSON with newline terminator", async () => {
      const connectPromise = connection.connect("/tmp/test.sock");
      mockSocket.emit("connect");
      await connectPromise;

      connection.write({ type: "test", senderId: "a", threadId: "b" });

      expect(mockSocket.write).toHaveBeenCalledWith('{"type":"test","senderId":"a","threadId":"b"}\n');
    });

    it("does not write to destroyed socket", async () => {
      const connectPromise = connection.connect("/tmp/test.sock");
      mockSocket.emit("connect");
      await connectPromise;

      mockSocket.destroyed = true;
      connection.write({ type: "test", senderId: "a", threadId: "b" });

      expect(mockSocket.write).not.toHaveBeenCalled();
    });
  });
});
```

#### `client.ts` Tests
Create `agents/src/lib/hub/client.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { HubClient } from "./client.js";

vi.mock("@core/lib/socket.js", () => ({
  getHubSocketPath: vi.fn().mockReturnValue("/tmp/mort-hub.sock"),
}));

vi.mock("./connection.js", () => ({
  HubConnection: vi.fn().mockImplementation(() => ({
    connect: vi.fn().mockResolvedValue(undefined),
    write: vi.fn(),
    on: vi.fn(),
    destroy: vi.fn(),
    isConnected: true,
  })),
}));

describe("HubClient", () => {
  let client: HubClient;

  beforeEach(() => {
    client = new HubClient("thread-123");
  });

  describe("connect", () => {
    it("sends register message after connecting", async () => {
      await client.connect();
      // Verify registration was sent (check mock calls)
    });

    it("includes parentId in registration when provided", async () => {
      const childClient = new HubClient("child-thread", "parent-thread");
      await childClient.connect();
      // Verify parentId in registration message
    });
  });

  describe("sendState", () => {
    it("formats state message correctly", async () => {
      await client.connect();
      client.sendState({ status: "running", progress: 50 });
      // Verify message format includes threadId, senderId, type: "state"
    });
  });

  describe("sendEvent", () => {
    it("formats event message correctly", async () => {
      await client.connect();
      client.sendEvent("tool_call", { tool: "read", path: "/test" });
      // Verify message format includes name and payload
    });
  });
});
```

#### Edge Cases to Test
- Empty messages / empty lines in buffer
- Very large messages (memory handling)
- Rapid connect/disconnect cycles
- Messages arriving during reconnection
- Socket path with special characters
- Concurrent write operations

### Integration Test Approaches

#### Mock Server for Testing
Create `agents/src/lib/hub/__tests__/mock-hub-server.ts`:

```typescript
import { createServer, Server, Socket } from "net";
import { EventEmitter } from "events";

export class MockHubServer extends EventEmitter {
  private server: Server | null = null;
  private clients: Socket[] = [];
  public receivedMessages: unknown[] = [];

  async start(socketPath: string): Promise<void> {
    return new Promise((resolve) => {
      this.server = createServer((socket) => {
        this.clients.push(socket);
        let buffer = "";

        socket.on("data", (data) => {
          buffer += data.toString();
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const line of lines) {
            if (line.trim()) {
              const msg = JSON.parse(line);
              this.receivedMessages.push(msg);
              this.emit("message", msg, socket);
            }
          }
        });

        socket.on("close", () => {
          this.clients = this.clients.filter((c) => c !== socket);
        });
      });

      this.server.listen(socketPath, resolve);
    });
  }

  broadcast(msg: unknown): void {
    const data = JSON.stringify(msg) + "\n";
    for (const client of this.clients) {
      client.write(data);
    }
  }

  async stop(): Promise<void> {
    for (const client of this.clients) {
      client.destroy();
    }
    return new Promise((resolve) => {
      this.server?.close(() => resolve());
    });
  }
}
```

#### Integration Test Example
```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { MockHubServer } from "./__tests__/mock-hub-server.js";
import { HubClient } from "./client.js";
import { tmpdir } from "os";
import { join } from "path";
import { unlinkSync } from "fs";

describe("HubClient Integration", () => {
  let server: MockHubServer;
  let socketPath: string;

  beforeEach(async () => {
    socketPath = join(tmpdir(), `test-hub-${Date.now()}.sock`);
    server = new MockHubServer();
    await server.start(socketPath);
  });

  afterEach(async () => {
    await server.stop();
    try { unlinkSync(socketPath); } catch {}
  });

  it("registers with server on connect", async () => {
    const client = new HubClient("test-thread");
    // Override socket path for test
    await client.connect();

    expect(server.receivedMessages).toContainEqual(
      expect.objectContaining({
        type: "register",
        threadId: "test-thread",
      })
    );

    client.disconnect();
  });

  it("receives messages from server", async () => {
    const client = new HubClient("test-thread");
    const messages: unknown[] = [];
    client.on("message", (msg) => messages.push(msg));

    await client.connect();

    server.broadcast({ type: "cancel" });

    // Wait for message propagation
    await new Promise((r) => setTimeout(r, 50));

    expect(messages).toContainEqual({ type: "cancel" });
    client.disconnect();
  });
});
```

### Manual Verification Commands

#### 1. Build and Type Check
```bash
cd /Users/zac/Documents/juice/mort/mortician/agents
npm run build
# Expected: No TypeScript errors in hub/ directory
```

#### 2. Run Unit Tests
```bash
cd /Users/zac/Documents/juice/mort/mortician/agents
npm test -- --grep "hub"
# or
npx vitest run src/lib/hub/
# Expected: All tests pass
```

#### 3. Verify Module Exports
```bash
cd /Users/zac/Documents/juice/mort/mortician/agents
node -e "
const hub = require('./dist/lib/hub/index.js');
console.log('Exports:', Object.keys(hub));
console.log('HubClient:', typeof hub.HubClient);
console.log('withRetry:', typeof hub.withRetry);
"
# Expected output:
# Exports: ['HubClient', 'HubConnection', 'withRetry', 'DEFAULT_RETRY_OPTIONS']
# HubClient: function
# withRetry: function
```

#### 4. Test Retry Logic Manually
```bash
node -e "
const { withRetry } = require('./dist/lib/hub/retry.js');

let attempts = 0;
withRetry(
  async () => {
    attempts++;
    console.log('Attempt', attempts);
    if (attempts < 3) throw new Error('Not yet');
    return 'success';
  },
  { maxRetries: 5, baseDelayMs: 100 }
).then(r => console.log('Result:', r));
"
# Expected: Shows 3 attempts with delays, then "Result: success"
```

#### 5. Test Connection to Real Hub (when Rust hub is running)
```bash
# First, ensure Tauri app is running with hub enabled
# Then test connection:
node -e "
const { HubClient } = require('./dist/lib/hub/client.js');

const client = new HubClient('manual-test-' + Date.now());
client.on('message', msg => console.log('Received:', msg));
client.on('error', err => console.log('Error:', err.message));
client.on('disconnect', () => console.log('Disconnected'));

client.connect({ maxRetries: 3, baseDelayMs: 500 })
  .then(() => {
    console.log('Connected!');
    client.sendState({ status: 'testing' });
    setTimeout(() => client.disconnect(), 2000);
  })
  .catch(err => console.log('Failed to connect:', err.message));
"
# Expected when hub is running: "Connected!" and state sent
# Expected when hub not running: "Failed to connect" after retries
```

### Expected Outputs/Behaviors

| Component | Success Indicator |
|-----------|-------------------|
| `types.ts` | TypeScript compiles without errors; types are importable |
| `retry.ts` | Operations retry with exponential backoff; throws after max retries |
| `connection.ts` | Connects to socket; parses newline-delimited JSON; buffers partial messages |
| `client.ts` | Auto-registers on connect; `sendState`/`sendEvent` format messages with threadId |
| Integration | Client receives messages broadcast from hub; registration message received by hub |

### Failure Indicators

- **Connection fails immediately without retry**: Check `withRetry` is being called
- **Messages not parsed**: Check newline delimiter handling in `processBuffer`
- **Registration not sent**: Verify `connect()` calls `send({ type: "register" })`
- **parentId missing for sub-agents**: Verify conditional spread in registration message
- **Type errors on import**: Check `index.ts` exports match implementation
