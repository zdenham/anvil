# 05: Frontend Integration

Update the frontend to receive agent messages via Tauri events and send messages via Tauri commands.

## Context

Currently the frontend:
- Parses agent stdout for state/events
- Writes to agent stdin for permissions/messages/cancel

This phase changes it to:
- Listen to Tauri `agent:message` events
- Invoke `send_to_agent` Tauri command

## Dependencies

- [02-rust-agent-hub](./02-rust-agent-hub.md) must be complete (Tauri emits events, exposes command)

## Phases

- [x] Add Tauri event listener for `agent:message`
- [x] Route incoming messages to eventBus by type
- [x] Replace stdin writes with `invoke("send_to_agent")`
- [x] Update permission response flow
- [x] Update cancel flow
- [x] Update queued message flow
- [x] Keep stdout parsing for debug logs only

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Implementation

### Event Listener Setup

```typescript
// src/lib/agent-service.ts

import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";

interface AgentMessage {
  senderId: string;
  threadId: string;
  type: string;
  state?: unknown;
  name?: string;
  payload?: unknown;
}

// Set up listener on module load
let unlistenFn: (() => void) | null = null;

export async function initAgentMessageListener(): Promise<void> {
  if (unlistenFn) return; // Already initialized

  unlistenFn = await listen<AgentMessage>("agent:message", (event) => {
    const msg = event.payload;

    switch (msg.type) {
      case "state":
        eventBus.emit(AGENT_EVENTS.STATE_UPDATE, {
          threadId: msg.threadId,
          state: msg.state,
        });
        break;

      case "event":
        // Route named events
        if (msg.name === "permission:request") {
          eventBus.emit(AGENT_EVENTS.PERMISSION_REQUEST, {
            threadId: msg.threadId,
            payload: msg.payload,
          });
        } else {
          eventBus.emit(msg.name, {
            threadId: msg.threadId,
            payload: msg.payload,
          });
        }
        break;

      case "log":
        // Handle log messages if needed
        console.log(`[Agent ${msg.threadId}]`, msg.payload);
        break;
    }
  });
}

export function cleanupAgentMessageListener(): void {
  unlistenFn?.();
  unlistenFn = null;
}
```

### Send to Agent

```typescript
// src/lib/agent-service.ts

export async function sendToAgent(threadId: string, message: unknown): Promise<void> {
  const payload = JSON.stringify({
    senderId: "tauri",
    threadId,
    ...message,
  });

  await invoke("send_to_agent", {
    threadId,
    message: payload,
  });
}

// Permission response
export async function sendPermissionResponse(
  threadId: string,
  requestId: string,
  decision: "approve" | "deny"
): Promise<void> {
  await sendToAgent(threadId, {
    type: "permission_response",
    payload: { requestId, decision },
  });
}

// Cancel
export async function cancelAgent(threadId: string): Promise<void> {
  await sendToAgent(threadId, { type: "cancel" });
}

// Queued message
export async function sendQueuedMessage(threadId: string, content: string): Promise<void> {
  await sendToAgent(threadId, {
    type: "queued_message",
    payload: { content },
  });
}
```

### App Initialization

```typescript
// src/App.tsx or main entry point

import { initAgentMessageListener } from "./lib/agent-service";

// On app mount
useEffect(() => {
  initAgentMessageListener();

  return () => {
    cleanupAgentMessageListener();
  };
}, []);
```

### Stdout Handling (Debug Only)

Keep stdout handling but only for debug logs:

```typescript
// src/lib/agent-service.ts

// When spawning agent process
process.stdout.on("data", (data) => {
  // Only log to console for debugging, don't parse as events
  console.debug(`[Agent stdout] ${data}`);
});

process.stderr.on("data", (data) => {
  console.error(`[Agent stderr] ${data}`);
});
```

## Files to Modify

1. `src/lib/agent-service.ts` - Main changes
2. `src/lib/tauri-commands.ts` - Add `send_to_agent` type
3. Components that call permission/cancel functions - Update to use new API
4. App entry point - Initialize listener

## Acceptance Criteria

- [ ] `agent:message` events received and routed to eventBus
- [ ] State updates trigger UI re-renders
- [ ] Permission requests displayed correctly
- [ ] Permission responses sent via Tauri command
- [ ] Cancel sent via Tauri command
- [ ] Queued messages sent via Tauri command
- [ ] Debug logs still visible from stdout/stderr
- [ ] No regression in existing functionality

## Verification

### Unit Test Approaches

**1. Event Listener Setup Tests** (`src/lib/agent-service.test.ts`)

```typescript
import { listen } from "@tauri-apps/api/event";
import { initAgentMessageListener, cleanupAgentMessageListener } from "./agent-service";
import { eventBus, AGENT_EVENTS } from "./event-bus";

vi.mock("@tauri-apps/api/event");
vi.mock("@tauri-apps/api/core");

describe("initAgentMessageListener", () => {
  it("should register listener for agent:message event", async () => {
    const mockUnlisten = vi.fn();
    vi.mocked(listen).mockResolvedValue(mockUnlisten);

    await initAgentMessageListener();

    expect(listen).toHaveBeenCalledWith("agent:message", expect.any(Function));
  });

  it("should not register duplicate listeners", async () => {
    const mockUnlisten = vi.fn();
    vi.mocked(listen).mockResolvedValue(mockUnlisten);

    await initAgentMessageListener();
    await initAgentMessageListener();

    expect(listen).toHaveBeenCalledTimes(1);
  });

  it("should call unlisten on cleanup", async () => {
    const mockUnlisten = vi.fn();
    vi.mocked(listen).mockResolvedValue(mockUnlisten);

    await initAgentMessageListener();
    cleanupAgentMessageListener();

    expect(mockUnlisten).toHaveBeenCalled();
  });
});
```

**2. Message Routing Tests**

```typescript
describe("agent message routing", () => {
  let capturedHandler: (event: { payload: AgentMessage }) => void;

  beforeEach(async () => {
    vi.mocked(listen).mockImplementation(async (eventName, handler) => {
      capturedHandler = handler;
      return vi.fn();
    });
    await initAgentMessageListener();
  });

  it("should emit STATE_UPDATE for state messages", () => {
    const emitSpy = vi.spyOn(eventBus, "emit");

    capturedHandler({
      payload: {
        senderId: "agent-1",
        threadId: "thread-123",
        type: "state",
        state: { status: "running" },
      },
    });

    expect(emitSpy).toHaveBeenCalledWith(AGENT_EVENTS.STATE_UPDATE, {
      threadId: "thread-123",
      state: { status: "running" },
    });
  });

  it("should emit PERMISSION_REQUEST for permission events", () => {
    const emitSpy = vi.spyOn(eventBus, "emit");

    capturedHandler({
      payload: {
        senderId: "agent-1",
        threadId: "thread-123",
        type: "event",
        name: "permission:request",
        payload: { tool: "Bash", command: "ls" },
      },
    });

    expect(emitSpy).toHaveBeenCalledWith(AGENT_EVENTS.PERMISSION_REQUEST, {
      threadId: "thread-123",
      payload: { tool: "Bash", command: "ls" },
    });
  });

  it("should emit named events for other event types", () => {
    const emitSpy = vi.spyOn(eventBus, "emit");

    capturedHandler({
      payload: {
        senderId: "agent-1",
        threadId: "thread-123",
        type: "event",
        name: "custom:event",
        payload: { data: "test" },
      },
    });

    expect(emitSpy).toHaveBeenCalledWith("custom:event", {
      threadId: "thread-123",
      payload: { data: "test" },
    });
  });
});
```

**3. Send Functions Tests**

```typescript
import { invoke } from "@tauri-apps/api/core";
import { sendToAgent, sendPermissionResponse, cancelAgent, sendQueuedMessage } from "./agent-service";

describe("sendToAgent", () => {
  it("should invoke send_to_agent with correct payload", async () => {
    await sendToAgent("thread-123", { type: "test", data: "value" });

    expect(invoke).toHaveBeenCalledWith("send_to_agent", {
      threadId: "thread-123",
      message: expect.stringContaining('"type":"test"'),
    });
  });

  it("should include senderId in payload", async () => {
    await sendToAgent("thread-123", { type: "test" });

    const call = vi.mocked(invoke).mock.calls[0];
    const message = JSON.parse(call[1].message);
    expect(message.senderId).toBe("tauri");
  });
});

describe("sendPermissionResponse", () => {
  it("should send approve decision", async () => {
    await sendPermissionResponse("thread-123", "req-456", "approve");

    expect(invoke).toHaveBeenCalledWith("send_to_agent", {
      threadId: "thread-123",
      message: expect.stringContaining('"decision":"approve"'),
    });
  });

  it("should send deny decision", async () => {
    await sendPermissionResponse("thread-123", "req-456", "deny");

    expect(invoke).toHaveBeenCalledWith("send_to_agent", {
      threadId: "thread-123",
      message: expect.stringContaining('"decision":"deny"'),
    });
  });
});

describe("cancelAgent", () => {
  it("should send cancel message type", async () => {
    await cancelAgent("thread-123");

    expect(invoke).toHaveBeenCalledWith("send_to_agent", {
      threadId: "thread-123",
      message: expect.stringContaining('"type":"cancel"'),
    });
  });
});

describe("sendQueuedMessage", () => {
  it("should send queued_message with content", async () => {
    await sendQueuedMessage("thread-123", "Hello agent");

    expect(invoke).toHaveBeenCalledWith("send_to_agent", {
      threadId: "thread-123",
      message: expect.stringContaining('"content":"Hello agent"'),
    });
  });
});
```

**Edge Cases to Test:**
- Empty message payloads
- Messages with missing optional fields (name, state, payload)
- Unicode content in messages
- Large payload handling
- Rapid successive messages
- Messages for non-existent thread IDs
- Cleanup called before initialization
- Multiple rapid init/cleanup cycles

### Integration Test Approaches

**1. Tauri Event Integration Test**

Create a test that simulates Tauri events using the Tauri test utilities:

```typescript
// src/lib/agent-service.integration.test.ts
import { mockIPC, mockWindows } from "@tauri-apps/api/mocks";

describe("Frontend Integration with Tauri Events", () => {
  beforeAll(() => {
    mockWindows("main");
  });

  it("should receive and process agent:message event", async () => {
    const stateUpdateReceived = vi.fn();
    eventBus.on(AGENT_EVENTS.STATE_UPDATE, stateUpdateReceived);

    await initAgentMessageListener();

    // Simulate Tauri emitting an event
    // This requires @tauri-apps/api/mocks or a custom mock
    await simulateTauriEvent("agent:message", {
      senderId: "agent-1",
      threadId: "thread-123",
      type: "state",
      state: { status: "completed" },
    });

    expect(stateUpdateReceived).toHaveBeenCalled();
  });

  it("should invoke Tauri command when sending messages", async () => {
    mockIPC((cmd, args) => {
      if (cmd === "send_to_agent") {
        expect(args.threadId).toBe("thread-123");
        expect(JSON.parse(args.message)).toMatchObject({
          type: "cancel",
          senderId: "tauri",
        });
        return null;
      }
    });

    await cancelAgent("thread-123");
  });
});
```

**2. Component Integration Test**

Test that UI components correctly receive and display messages:

```typescript
// src/components/thread/thread-content.integration.test.tsx
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ThreadContent } from "./thread-content";

describe("ThreadContent with agent messages", () => {
  it("should update UI when state message received", async () => {
    render(<ThreadContent threadId="thread-123" />);

    // Simulate receiving a state update via eventBus
    eventBus.emit(AGENT_EVENTS.STATE_UPDATE, {
      threadId: "thread-123",
      state: { status: "running", currentTool: "Bash" },
    });

    await waitFor(() => {
      expect(screen.getByText(/running/i)).toBeInTheDocument();
    });
  });

  it("should show permission dialog on permission request", async () => {
    render(<ThreadContent threadId="thread-123" />);

    eventBus.emit(AGENT_EVENTS.PERMISSION_REQUEST, {
      threadId: "thread-123",
      payload: {
        requestId: "perm-1",
        tool: "Bash",
        command: "rm -rf /tmp/test",
      },
    });

    await waitFor(() => {
      expect(screen.getByText(/permission/i)).toBeInTheDocument();
      expect(screen.getByText(/rm -rf/i)).toBeInTheDocument();
    });
  });
});
```

### Manual Verification Steps

**Step 1: Verify Event Listener Registration**

1. Open browser DevTools (F12) in the Tauri app
2. In Console, run:
   ```javascript
   // Check if listener is registered
   window.__TAURI__.event.listen("agent:message", (e) => console.log("Test:", e))
   ```
3. Expected: Should log received messages when agent sends data

**Step 2: Verify State Updates Flow**

1. Start the app with `pnpm tauri dev`
2. Create a new thread and start an agent task
3. Open DevTools Console
4. Add eventBus listener:
   ```javascript
   eventBus.on("agent:state-update", (data) => console.log("State:", data))
   ```
5. Expected: Console shows state updates as agent runs, UI updates in real-time

**Step 3: Verify Permission Flow**

1. Configure agent to require permission for Bash commands
2. Start a task that uses Bash
3. Expected: Permission dialog appears
4. Click Approve or Deny
5. Verify in DevTools Network/Console that `send_to_agent` command was invoked
6. Expected: Agent continues (approve) or stops the tool (deny)

**Step 4: Verify Cancel Flow**

1. Start a long-running agent task
2. Click the Cancel button in the UI
3. Check DevTools Console for the invoke call:
   ```
   invoke("send_to_agent", { threadId: "...", message: '{"type":"cancel",...}' })
   ```
4. Expected: Agent acknowledges cancellation, task stops

**Step 5: Verify Queued Message Flow**

1. While agent is running, type a message in the input field
2. Submit the message
3. Expected: Message is queued and sent to agent
4. Check Console for `send_to_agent` with `type: "queued_message"`

**Step 6: Verify Debug Logs Still Work**

1. Run agent with verbose logging enabled
2. Check DevTools Console
3. Expected: `[Agent stdout]` and `[Agent stderr]` prefixed logs appear
4. Verify these are for debugging only, not parsed as events

### Expected Outputs/Behaviors

| Scenario | Expected Behavior |
|----------|-------------------|
| App startup | `initAgentMessageListener()` called, no errors in console |
| Agent sends state | eventBus emits `STATE_UPDATE`, UI reflects new state within 100ms |
| Agent requests permission | Permission dialog appears with tool name and details |
| User approves permission | `send_to_agent` invoked with `decision: "approve"`, agent proceeds |
| User denies permission | `send_to_agent` invoked with `decision: "deny"`, agent skips tool |
| User clicks cancel | `send_to_agent` invoked with `type: "cancel"`, agent stops gracefully |
| User sends queued message | `send_to_agent` invoked with `type: "queued_message"` and content |
| Agent logs to stdout | `[Agent stdout]` appears in DevTools, no eventBus emission |
| App unmount | `cleanupAgentMessageListener()` called, listener removed |
| Duplicate init calls | Only one listener registered (no duplicate events) |

### Run Tests Command

```bash
# Run unit tests for agent-service
pnpm test src/lib/agent-service.test.ts

# Run integration tests
pnpm test src/lib/agent-service.integration.test.ts

# Run all related component tests
pnpm test src/components/thread/

# Run with coverage
pnpm test --coverage src/lib/agent-service
```
