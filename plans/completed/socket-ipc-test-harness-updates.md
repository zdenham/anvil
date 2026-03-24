# Socket IPC Test Harness Updates

Plan for updating the agent test harness to support Unix socket-based IPC.

## Problem Summary

The current test harness (`AgentTestHarness`) spawns agents as child processes and communicates via stdin/stdout:
- **stdout**: Reads JSON lines (log/event/state messages)
- **stdin**: Writes queued messages as JSON

After the socket-ipc migration, agents will communicate via `~/.anvil/agent-hub.sock` instead. Tests need to either:
1. Spin up a mock hub server, OR
2. Use the real Rust hub with test isolation

## Current Test Infrastructure

### Test Files Affected

| Location | Purpose | Impact |
|----------|---------|--------|
| `agents/src/testing/agent-harness.ts` | Main harness, spawns agents and collects stdout | **High** - core communication |
| `agents/src/runners/stdin-message-stream.ts` | Reads queued messages from stdin | **Replaced** by socket |
| `agents/src/runners/stdin-message-schema.ts` | Validates stdin message format | May be reusable |
| `agents/src/output.ts` | Emits state/events to stdout | **Replaced** by socket |
| Integration tests in `agents/src/testing/__tests__/` | All rely on harness | Need harness update |
| Runner tests in `agents/src/runners/*.test.ts` | Some test stdin/stdout directly | Need socket mocks |

### Current Communication Flow

```
AgentTestHarness
    │
    ├──spawn()──> Agent Process
    │             ├── stdin: readline for queued messages
    │             └── stdout: JSON lines (log/event/state)
    │
    └──collect()──> Parse stdout into logs[], events[], states[]
```

### Post-Migration Communication Flow

```
AgentTestHarness
    │
    ├──spawn()──> Agent Process
    │             └── HubClient.connect() ──> Mock Hub Server
    │                                              │
    └──────────────────────────────────────────────┘
                  Socket messages (JSON)
```

## Approach: Mock Hub Server

Create a `MockHubServer` that the test harness controls. This approach:
- Doesn't require Tauri/Rust at test time
- Provides full control over message timing
- Enables testing of error conditions (connection failures, timeouts)
- Isolates tests from each other via unique socket paths

### Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    AgentTestHarness                         │
│  ┌─────────────────┐     ┌──────────────────────────────┐  │
│  │  MockHubServer  │◄───►│  Agent Process (HubClient)   │  │
│  │  (Node.js)      │     │                              │  │
│  │                 │     │  - Connects on startup       │  │
│  │  - Listen on    │     │  - Sends register/state/event│  │
│  │    temp socket  │     │  - Receives cancel/permission│  │
│  │  - Collect msgs │     │                              │  │
│  │  - Send test    │     │                              │  │
│  │    messages     │     │                              │  │
│  └─────────────────┘     └──────────────────────────────┘  │
│                                                             │
│  Output: { logs, events, states, exitCode, duration }      │
└─────────────────────────────────────────────────────────────┘
```

## Implementation Plan

### Phase 1: Create MockHubServer

**File:** `agents/src/testing/mock-hub-server.ts`

```typescript
export class MockHubServer {
  private server: Server;
  private socketPath: string;
  private connections: Map<string, Socket>; // threadId -> socket
  private receivedMessages: SocketMessage[];

  constructor(socketPath?: string);

  async start(): Promise<void>;
  async stop(): Promise<void>;

  // Sending messages to agents
  sendToAgent(threadId: string, message: TauriToAgentMessage): void;
  sendCancel(threadId: string): void;
  sendPermissionResponse(threadId: string, allowed: boolean): void;
  sendQueuedMessage(threadId: string, content: string): void;

  // Collecting received messages
  getMessages(): SocketMessage[];
  getMessagesForThread(threadId: string): SocketMessage[];
  waitForMessage(predicate: (msg: SocketMessage) => boolean, timeout?: number): Promise<SocketMessage>;
  waitForRegistration(threadId: string, timeout?: number): Promise<void>;

  // Test utilities
  getSocketPath(): string;
  getConnectedThreadIds(): string[];
}
```

### Phase 2: Update AgentTestHarness

**File:** `agents/src/testing/agent-harness.ts`

Changes needed:
1. Create `MockHubServer` before spawning agent
2. Pass socket path via environment variable
3. Collect messages from mock hub instead of stdout
4. Maintain backward compatibility with stdout for logs (optional)

```typescript
interface AgentTestHarnessOptions {
  // ... existing options
  useSocketIpc?: boolean; // Default true after migration
}

class AgentTestHarness {
  private mockHub: MockHubServer | null = null;

  async run(opts: AgentTestOptions): Promise<AgentRunOutput> {
    // Create mock hub with unique socket path per test
    this.mockHub = new MockHubServer(this.getTestSocketPath());
    await this.mockHub.start();

    // Spawn agent with socket path in env
    const proc = spawn("tsx", args, {
      env: {
        ...process.env,
        ANVIL_HUB_SOCKET_PATH: this.mockHub.getSocketPath(),
      },
      stdio: ['pipe', 'pipe', 'pipe'], // Keep stderr for debugging
    });

    // Wait for registration
    await this.mockHub.waitForRegistration(this.threadId);

    // Handle queued messages via socket instead of stdin
    for (const qm of opts.queuedMessages) {
      setTimeout(() => {
        this.mockHub.sendQueuedMessage(this.threadId, qm.content);
      }, qm.delayMs);
    }

    // Collect messages from mock hub
    // ... rest of implementation
  }

  private getTestSocketPath(): string {
    // Unique per-test socket in temp dir
    return path.join(this.tempDirPath, `test-hub-${this.threadId}.sock`);
  }
}
```

### Phase 3: Update Message Collection

The harness currently parses stdout into `logs`, `events`, `states`. With socket IPC:

```typescript
// Current (stdout parsing)
rl.on("line", (line) => {
  const msg = JSON.parse(line);
  switch (msg.type) {
    case "log": logs.push(msg);
    case "event": events.push(msg);
    case "state": states.push(msg);
  }
});

// New (socket message collection)
const allMessages = this.mockHub.getMessagesForThread(this.threadId);
const states = allMessages.filter(m => m.type === "state").map(m => m.state);
const events = allMessages.filter(m => m.type === "event").map(m => ({name: m.name, payload: m.payload}));
// Logs may still come from stderr or a dedicated log message type
```

### Phase 4: Update/Create Test Utilities

**New helpers for socket-based testing:**

```typescript
// In agents/src/testing/index.ts (exports)
export { MockHubServer } from './mock-hub-server';

// New assertion helpers
export function assertReceivedState(hub: MockHubServer, threadId: string, predicate: (s: State) => boolean): void;
export function assertReceivedEvent(hub: MockHubServer, threadId: string, eventName: string): void;
```

### Phase 5: Migrate Existing Tests

Most tests should work with minimal changes since they use the `AgentTestHarness` abstraction. Tests that directly manipulate stdin/stdout need updates:

| Test File | Changes Needed |
|-----------|----------------|
| `stdin-message-stream.test.ts` | **Deprecate or remove** - stdin no longer used |
| `stdin-message-schema.test.ts` | Keep for schema validation (reused in socket messages) |
| `queued-messages.integration.test.ts` | Update to use `mockHub.sendQueuedMessage()` |
| All other integration tests | Should work via harness abstraction |

### Phase 6: Test the Mock Hub Itself

**File:** `agents/src/testing/__tests__/mock-hub-server.test.ts`

```typescript
describe("MockHubServer", () => {
  it("accepts agent connections", async () => { ... });
  it("routes messages by threadId", async () => { ... });
  it("handles multiple concurrent agents", async () => { ... });
  it("times out on missing registration", async () => { ... });
  it("cleans up socket file on stop", async () => { ... });
});
```

## Phases

- [x] Create MockHubServer class with basic socket handling
- [x] Add message sending/receiving to MockHubServer
- [x] Update AgentTestHarness to use MockHubServer
- [x] Update message collection to use socket messages
- [x] Add test utilities and assertion helpers
- [x] Migrate stdin-specific tests
- [x] Add MockHubServer unit tests

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Environment Variable

Agents will check for socket path in this order:
1. `ANVIL_HUB_SOCKET_PATH` env var (for tests)
2. Default: `~/.anvil/agent-hub.sock` (production)

This allows tests to use isolated mock hubs without affecting production socket.

## Backward Compatibility

During migration, support both modes:
1. **Legacy mode**: stdout/stdin (current behavior)
2. **Socket mode**: HubClient connection

Harness option `useSocketIpc: boolean` controls which mode.

After migration complete, remove legacy mode support.

## Dependencies

This plan depends on:
- `03-node-hub-client.md` - HubClient implementation that agents use
- `04-runner-integration.md` - Runner changes to use HubClient

This plan should be executed **after** the HubClient is implemented but **before** or **in parallel with** frontend integration.

## File Changes Summary

| Action | File |
|--------|------|
| **Create** | `agents/src/testing/mock-hub-server.ts` |
| **Create** | `agents/src/testing/__tests__/mock-hub-server.test.ts` |
| **Modify** | `agents/src/testing/agent-harness.ts` |
| **Modify** | `agents/src/testing/index.ts` (exports) |
| **Modify** | `agents/src/testing/assertions.ts` (new helpers) |
| **Deprecate** | `agents/src/runners/stdin-message-stream.ts` |
| **Keep** | `agents/src/runners/stdin-message-schema.ts` (schema reuse) |
