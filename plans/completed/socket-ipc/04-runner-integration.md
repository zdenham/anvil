# 04: Runner Integration

Integrate the HubClient into the agent runner, replacing stdout-based communication.

## Context

The agent runner currently emits state and events via stdout. This phase replaces that with socket-based communication while keeping disk writes as the source of truth.

## Dependencies

- [03-node-hub-client](./03-node-hub-client.md) must be complete

## Phases

- [x] Add HubClient initialization to runner startup
- [x] Replace `emitState()` to use socket instead of stdout
- [x] Replace `emitEvent()` to use socket instead of stdout
- [x] Add message handler for incoming Tauri messages (permissions, cancel, queued)
- [x] Handle `--parent-id` CLI argument for sub-agents
- [x] Add cleanup on process exit

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Implementation

### Runner Startup Changes

```typescript
// agents/src/runner.ts

import { HubClient } from "./lib/hub/index.js";

// Parse CLI args
const threadId = args["thread-id"];
const parentId = args["parent-id"]; // Optional, for bash-based sub-agents

// Initialize hub client
const hub = new HubClient(threadId, parentId);

try {
  await hub.connect();
} catch (err) {
  console.error("Failed to connect to AgentHub:", err);
  process.exit(1);
}

// Handle incoming messages from Tauri
hub.on("message", (msg: SocketMessage) => {
  switch (msg.type) {
    case "permission_response":
      permissionResolver.resolve(msg.payload.requestId, msg.payload.decision);
      break;
    case "queued_message":
      queuedMessages.enqueue(msg.payload);
      break;
    case "cancel":
      abortController.abort();
      break;
  }
});

hub.on("disconnect", () => {
  console.error("Disconnected from AgentHub");
  process.exit(1);
});

hub.on("error", (err) => {
  console.error("AgentHub error:", err);
});
```

### Replace emitState()

```typescript
// agents/src/output.ts

import { HubClient } from "./lib/hub/index.js";

let hubClient: HubClient | null = null;

export function setHubClient(client: HubClient): void {
  hubClient = client;
}

export async function emitState(state: ThreadState, statePath: string): Promise<void> {
  // Disk write unchanged (source of truth)
  writeFileSync(statePath, JSON.stringify(state, null, 2));

  // Socket instead of stdout
  if (hubClient?.isConnected) {
    hubClient.sendState(state);
  }
}

export function emitEvent(name: string, payload: unknown): void {
  if (hubClient?.isConnected) {
    hubClient.sendEvent(name, payload);
  }
}
```

### Sub-Agent Spawning

When an agent spawns a bash-based sub-agent, it passes its threadId as `--parent-id`:

```typescript
// In bash tool or wherever sub-agents are spawned
const command = `node ${runnerPath} --thread-id=${newThreadId} --parent-id=${currentThreadId} --prompt="${prompt}"`;
```

### Process Cleanup

```typescript
// agents/src/runner.ts

function cleanup() {
  hub.disconnect();
}

process.on("SIGTERM", () => {
  cleanup();
  process.exit(0);
});

process.on("SIGINT", () => {
  cleanup();
  process.exit(0);
});

process.on("exit", cleanup);
```

## Files to Modify

1. `agents/src/runner.ts` - Add hub initialization and message handling
2. `agents/src/output.ts` - Replace stdout with socket calls
3. `agents/src/runners/simple-runner-strategy.ts` - Update to use new output methods
4. CLI argument parsing - Add `--parent-id` support

## Acceptance Criteria

- [ ] Agent connects to hub on startup
- [ ] State updates sent via socket (disk write still happens)
- [ ] Events sent via socket
- [ ] Permission responses received and resolved
- [ ] Cancel messages trigger abort
- [ ] Queued messages received and processed
- [ ] Sub-agents receive `--parent-id` and register with it
- [ ] Clean disconnect on process exit
- [ ] Graceful handling of hub connection failure

## Verification

### Unit Test Approaches

**File: `agents/src/output.test.ts`**

1. **emitState() with connected hub client**
   - Mock HubClient with `isConnected: true`
   - Call `emitState()` with a sample ThreadState
   - Verify `hubClient.sendState()` was called with the state
   - Verify file was written to disk (mock writeFileSync)

2. **emitState() with disconnected hub client**
   - Mock HubClient with `isConnected: false`
   - Call `emitState()`
   - Verify `hubClient.sendState()` was NOT called
   - Verify file was still written to disk

3. **emitState() with no hub client set**
   - Do not call `setHubClient()`
   - Call `emitState()`
   - Verify no error thrown
   - Verify file was written to disk

4. **emitEvent() with connected hub client**
   - Mock HubClient with `isConnected: true`
   - Call `emitEvent("tool_start", { name: "bash" })`
   - Verify `hubClient.sendEvent()` was called with correct name and payload

5. **emitEvent() when disconnected**
   - Mock HubClient with `isConnected: false`
   - Call `emitEvent()`
   - Verify no error thrown, no call made

**Edge Cases to Test:**
- `emitState()` when disk write fails (should still attempt socket send, or vice versa)
- Very large state objects (verify no truncation)
- Rapid successive calls to `emitState()` (no race conditions)
- `emitEvent()` with undefined/null payloads

### Integration Test Approaches

**File: `agents/src/runner.integration.test.ts`**

1. **Runner startup connects to hub**
   ```typescript
   // Start a mock socket server on the expected path
   const mockServer = createMockHubServer();

   // Spawn runner process
   const runner = spawn("node", ["runner.js", "--thread-id=test-123"]);

   // Verify connection received with correct threadId
   await expect(mockServer.waitForConnection()).resolves.toMatchObject({
     type: "register",
     payload: { threadId: "test-123" }
   });
   ```

2. **Runner with parent-id registers correctly**
   ```typescript
   const runner = spawn("node", [
     "runner.js",
     "--thread-id=child-456",
     "--parent-id=parent-123"
   ]);

   await expect(mockServer.waitForConnection()).resolves.toMatchObject({
     type: "register",
     payload: { threadId: "child-456", parentId: "parent-123" }
   });
   ```

3. **Permission request/response flow**
   ```typescript
   // Runner sends permission request
   const permRequest = await mockServer.waitForMessage("permission_request");
   expect(permRequest.payload.requestId).toBeDefined();

   // Send permission response
   mockServer.send({
     type: "permission_response",
     payload: { requestId: permRequest.payload.requestId, decision: "allow" }
   });

   // Verify runner continues execution (check next state update)
   const stateUpdate = await mockServer.waitForMessage("state");
   expect(stateUpdate).toBeDefined();
   ```

4. **Cancel message triggers abort**
   ```typescript
   // Start runner with a long-running task
   const runner = spawn("node", ["runner.js", "--thread-id=test"]);
   await mockServer.waitForConnection();

   // Send cancel
   mockServer.send({ type: "cancel" });

   // Verify process exits
   await expect(waitForExit(runner)).resolves.toBe(0);
   ```

5. **Hub connection failure handling**
   ```typescript
   // Don't start mock server
   const runner = spawn("node", ["runner.js", "--thread-id=test"]);

   // Verify runner exits with error
   const { code, stderr } = await waitForExit(runner);
   expect(code).toBe(1);
   expect(stderr).toContain("Failed to connect to AgentHub");
   ```

6. **Disconnection during execution**
   ```typescript
   const runner = spawn("node", ["runner.js", "--thread-id=test"]);
   await mockServer.waitForConnection();

   // Forcibly close connection
   mockServer.closeConnection("test");

   // Verify runner exits
   const { code, stderr } = await waitForExit(runner);
   expect(code).toBe(1);
   expect(stderr).toContain("Disconnected from AgentHub");
   ```

### Manual Verification Steps

1. **Verify hub client initialization**
   ```bash
   # Start the Tauri app (which runs the AgentHub)
   cd /Users/zac/Documents/juice/anvil/anvil
   pnpm tauri dev

   # In another terminal, manually run the agent runner
   cd agents
   node dist/runner.js --thread-id=manual-test-$(date +%s) --prompt="Say hello"

   # Expected: Runner should connect without errors
   # Check Tauri logs for "Agent registered: manual-test-*"
   ```

2. **Verify state updates over socket**
   ```bash
   # With Tauri app running, create a new thread via UI
   # Open browser devtools Network tab, filter for WebSocket
   # Observe state messages being received

   # Alternatively, check Tauri logs:
   # Expected output: "Received state update for thread: <id>"
   ```

3. **Verify event emission**
   ```bash
   # Run a thread that uses tools (e.g., bash command)
   # Check Tauri logs for event messages like:
   # "Received event: tool_start for thread: <id>"
   # "Received event: tool_end for thread: <id>"
   ```

4. **Verify permission flow**
   ```bash
   # Run a thread that requires permission (e.g., file write)
   # UI should show permission dialog
   # Approve the permission
   # Expected: Agent continues execution
   # Deny the permission
   # Expected: Agent handles denial gracefully
   ```

5. **Verify cancel functionality**
   ```bash
   # Start a long-running thread (e.g., "Count from 1 to 1000 slowly")
   # Click cancel button in UI
   # Expected: Thread stops, final state shows cancellation
   ```

6. **Verify sub-agent parent-id passing**
   ```bash
   # Run a thread that spawns a sub-agent via bash tool
   # Check process list:
   ps aux | grep runner

   # Expected: Child process has --parent-id argument matching parent's thread-id
   ```

7. **Verify cleanup on exit**
   ```bash
   # Start a thread
   # Kill the runner process: kill -TERM <pid>
   # Check Tauri logs for "Agent disconnected: <thread-id>"
   # Verify no orphaned socket connections
   ```

### Expected Outputs/Behaviors

| Scenario | Expected Behavior |
|----------|-------------------|
| Runner startup | Connects to hub within 1 second, logs "Connected to AgentHub" |
| State update | State written to disk AND sent via socket (both must happen) |
| Event emission | Events appear in Tauri logs within 100ms of occurrence |
| Permission request | UI shows dialog within 500ms of request |
| Permission response | Agent continues within 100ms of user decision |
| Cancel received | AbortController triggers, agent stops current operation |
| Hub unavailable | Runner exits with code 1 and clear error message |
| Hub disconnect | Runner exits with code 1, cleanup called |
| SIGTERM/SIGINT | `hub.disconnect()` called before exit |
| Sub-agent spawn | New process includes `--parent-id` in arguments |

### Test Commands

```bash
# Run unit tests
cd agents
pnpm test output.test.ts

# Run integration tests
pnpm test runner.integration.test.ts

# Run all socket-ipc related tests
pnpm test --grep "hub|socket"

# Manual smoke test
pnpm tauri dev &
sleep 5
node dist/runner.js --thread-id=smoke-test --prompt="Hello world"
```
