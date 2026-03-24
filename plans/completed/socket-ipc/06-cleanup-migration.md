# 06: Cleanup and Migration

Remove stdin/stdout-based communication code after socket-based IPC is fully working.

## Context

After phases 01-05 are complete and verified, this phase removes the legacy communication code.

## Dependencies

- [04-runner-integration](./04-runner-integration.md) must be complete
- [05-frontend-integration](./05-frontend-integration.md) must be complete
- Socket-based IPC must be verified working end-to-end

## Phases

- [x] Remove stdout event emission from agents
- [x] Remove stdout JSONL parsing from frontend
- [x] Remove stdin reading from agents
- [x] Remove stdin writing from frontend
- [x] Remove StdinMessageStream class
- [x] Clean up HMR workarounds (window.__agentServiceProcessMaps)
- [x] Update documentation

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Files to Remove or Modify

### Agent Side

**Remove:**
- `agents/src/runners/stdin-message-stream.ts` (if exists)
- Any stdin reading logic in runner

**Modify:**
- `agents/src/output.ts` - Remove stdout writes for events/state (keep for debug logs)
- `agents/src/runner.ts` - Remove stdin setup

### Frontend Side

**Remove:**
- stdout JSONL parsing in `agent-service.ts`
- stdin write functions
- `window.__agentServiceProcessMaps` (HMR workaround no longer needed)

**Modify:**
- `src/lib/agent-service.ts` - Remove legacy communication code
- Process spawn handling - Remove stdout event parsing

## Migration Checklist

Before removing legacy code, verify:

- [ ] All agent types connect to socket successfully
- [ ] State updates flow through socket → Tauri event → UI
- [ ] Permission requests/responses work via socket
- [ ] Cancel signals delivered via socket
- [ ] Queued messages delivered via socket
- [ ] Bash-based sub-agents receive messages
- [ ] HMR reload doesn't break communication
- [ ] Multiple windows receive updates
- [ ] Agent disconnect is detected and handled

## Code to Remove

### stdout Event Emission

```typescript
// REMOVE from agents/src/output.ts
process.stdout.write(JSON.stringify({ type: "state", state }) + "\n");
process.stdout.write(JSON.stringify({ type: "event", name, payload }) + "\n");
```

### stdin Reading

```typescript
// REMOVE from agents
process.stdin.on("data", (chunk) => {
  // ...
});
```

### stdout Parsing

```typescript
// REMOVE from src/lib/agent-service.ts
process.stdout.on("data", (data) => {
  const lines = data.toString().split("\n");
  for (const line of lines) {
    try {
      const msg = JSON.parse(line);
      // route message...
    } catch {}
  }
});
```

### stdin Writing

```typescript
// REMOVE from src/lib/agent-service.ts
function sendToAgent(threadId: string, message: any) {
  const process = processMap.get(threadId);
  process.write(JSON.stringify(message) + "\n");
}
```

### HMR Workaround

```typescript
// REMOVE - no longer needed
declare global {
  interface Window {
    __agentServiceProcessMaps?: Map<string, ChildProcess>;
  }
}
```

## Acceptance Criteria

- [x] No stdout parsing for events (only debug logs)
- [x] No stdin communication
- [x] StdinMessageStream removed
- [x] HMR workarounds removed
- [x] All communication goes through socket
- [ ] No regression in functionality
- [ ] Tests pass
- [x] Documentation updated

## Verification

### 1. Verify Old Code Has Been Removed

Run these grep commands to confirm legacy code is removed:

**Check StdinMessageStream is removed:**
```bash
# Should return NO results
grep -r "StdinMessageStream" /Users/zac/Documents/juice/anvil/anvil/agents/src/

# These files should NOT exist
ls /Users/zac/Documents/juice/anvil/anvil/agents/src/runners/stdin-message-stream.ts 2>/dev/null && echo "FAIL: File still exists" || echo "PASS: File removed"
ls /Users/zac/Documents/juice/anvil/anvil/agents/src/runners/stdin-message-stream.test.ts 2>/dev/null && echo "FAIL: Test file still exists" || echo "PASS: Test file removed"
```

**Check stdout event emission is removed (agents):**
```bash
# Should return NO results for JSON event/state writes to stdout
grep -r "process\.stdout\.write.*JSON\.stringify" /Users/zac/Documents/juice/anvil/anvil/agents/src/

# Check output.ts specifically - should NOT have stdout writes for state/events
grep -n "stdout" /Users/zac/Documents/juice/anvil/anvil/agents/src/output.ts
# Expected: Empty or only debug-related logs
```

**Check stdin reading is removed (agents):**
```bash
# Should return NO results for stdin.on("data") handlers
grep -r "process\.stdin\.on" /Users/zac/Documents/juice/anvil/anvil/agents/src/
grep -r "process\.stdin" /Users/zac/Documents/juice/anvil/anvil/agents/src/
# Expected: No matches (or only comments/docs)
```

**Check stdout JSONL parsing is removed (frontend):**
```bash
# Should NOT find event parsing from stdout
grep -n "JSON\.parse.*line" /Users/zac/Documents/juice/anvil/anvil/src/lib/agent-service.ts
grep -n "parseAgentOutput" /Users/zac/Documents/juice/anvil/anvil/src/lib/agent-service.ts
# Expected: No matches or only imports that are no longer used
```

**Check stdin writing is removed (frontend):**
```bash
# Should NOT find stdin.write patterns
grep -r "\.write.*JSON\.stringify" /Users/zac/Documents/juice/anvil/anvil/src/lib/agent-service.ts
grep -n "stdin" /Users/zac/Documents/juice/anvil/anvil/src/lib/agent-service.ts
# Expected: No matches
```

**Check HMR workaround is removed:**
```bash
# Should return NO results
grep -r "__agentServiceProcessMaps" /Users/zac/Documents/juice/anvil/anvil/src/
# Expected: No matches
```

**Verify socket-based code is present:**
```bash
# Should find HubClient usage in agents
grep -r "HubClient" /Users/zac/Documents/juice/anvil/anvil/agents/src/
# Expected: Matches in runner.ts, output.ts

# Should find Tauri event listener in frontend
grep -n "agent:message" /Users/zac/Documents/juice/anvil/anvil/src/lib/agent-service.ts
grep -n "send_to_agent" /Users/zac/Documents/juice/anvil/anvil/src/lib/agent-service.ts
# Expected: Matches showing socket-based communication
```

### 2. Integration Test Approaches

**End-to-End Test Script:**
```bash
#!/bin/bash
# Save as: test-socket-migration.sh

echo "=== Socket IPC Migration Integration Test ==="

# 1. Start the Tauri app in the background
cd /Users/zac/Documents/juice/anvil/anvil
pnpm tauri dev &
TAURI_PID=$!
sleep 10  # Wait for app to start

# 2. Verify the socket exists
SOCKET_PATH="$HOME/.anvil/agent-hub.sock"
if [ -S "$SOCKET_PATH" ]; then
    echo "PASS: Socket exists at $SOCKET_PATH"
else
    echo "FAIL: Socket not found at $SOCKET_PATH"
    kill $TAURI_PID 2>/dev/null
    exit 1
fi

# 3. Run agent tests
cd /Users/zac/Documents/juice/anvil/anvil/agents
pnpm test --passWithNoTests
TEST_RESULT=$?

# 4. Run frontend tests
cd /Users/zac/Documents/juice/anvil/anvil
pnpm test --passWithNoTests
FRONTEND_TEST_RESULT=$?

# Cleanup
kill $TAURI_PID 2>/dev/null

if [ $TEST_RESULT -eq 0 ] && [ $FRONTEND_TEST_RESULT -eq 0 ]; then
    echo "PASS: All tests passed"
    exit 0
else
    echo "FAIL: Some tests failed"
    exit 1
fi
```

**Component-Level Integration Tests:**
```bash
# Run all agent-related tests
cd /Users/zac/Documents/juice/anvil/anvil/agents
pnpm test

# Run frontend agent service tests
cd /Users/zac/Documents/juice/anvil/anvil
pnpm test src/lib/agent-service

# Run socket/hub-related tests specifically
pnpm test --grep "hub|socket|agent"
```

### 3. Manual Verification Steps

**Step 1: Verify No Stdout Event Parsing**
```bash
# 1. Start the Tauri app
cd /Users/zac/Documents/juice/anvil/anvil
pnpm tauri dev

# 2. Open DevTools in the app (Cmd+Option+I or right-click > Inspect)
# 3. Filter console for "[Agent stdout]" or parseAgentOutput
# 4. Create a new thread and run an agent task
# 5. Expected: NO state/event messages from stdout parsing
#    Should only see: "[Agent stdout] <debug logs>" or nothing
```

**Step 2: Verify Socket Communication**
```bash
# 1. With the app running, check the socket file:
ls -la ~/.anvil/agent-hub.sock
# Expected: Socket file exists with srwxr-xr-x permissions

# 2. Monitor socket connections (requires socat or similar):
# In a separate terminal:
lsof -U | grep agent-hub
# Expected: Shows Tauri process and agent processes connected

# 3. Start a thread and verify in Tauri logs:
# Look for: "Agent registered: <thread-id>"
# Look for: "Received state update for thread: <thread-id>"
```

**Step 3: Verify Permission Flow Over Socket**
```bash
# 1. Configure agent to require permission (in settings)
# 2. Run a task that triggers a Bash command
# 3. Permission dialog should appear
# 4. In DevTools Network tab, verify NO stdin.write calls
# 5. Instead verify invoke("send_to_agent") is called with permission_response
# 6. Approve/deny and verify agent responds correctly
```

**Step 4: Verify Cancel Flow Over Socket**
```bash
# 1. Start a long-running agent task
# 2. Click Cancel button
# 3. In DevTools Console, verify:
#    - invoke("send_to_agent", { threadId: "...", message: '{"type":"cancel",...}' })
#    - NO process.stdin.write calls
# 4. Agent should stop gracefully
```

**Step 5: Verify Queued Messages Over Socket**
```bash
# 1. While an agent is running, type a follow-up message
# 2. Submit the message
# 3. In DevTools, verify invoke("send_to_agent") with type: "queued_message"
# 4. NO stdin.write to the agent process
```

**Step 6: Verify HMR Doesn't Break Communication**
```bash
# 1. Start the app in dev mode: pnpm tauri dev
# 2. Start an agent task
# 3. Modify a frontend file to trigger HMR reload
# 4. Expected: Agent continues running, state updates still appear
# 5. Verify in console: No "process maps" re-initialization messages
#    (since __agentServiceProcessMaps should be removed)
```

**Step 7: Verify Sub-Agent Communication**
```bash
# 1. Run a task that spawns a sub-agent via bash tool
# 2. Check process list:
ps aux | grep runner

# 3. Verify child process has --parent-id argument
# 4. In Tauri logs, verify both parent and child register with the hub
# 5. Send cancel to parent - verify child also receives it (via socket)
```

**Step 8: Verify Build and Test Suite**
```bash
# Build the project
cd /Users/zac/Documents/juice/anvil/anvil
pnpm build

# Build agents
cd agents
pnpm build

# Run full test suite
cd /Users/zac/Documents/juice/anvil/anvil
pnpm test

# Run agent tests
cd agents
pnpm test
```

### 4. Expected Outputs/Behaviors

| Verification | Expected Result |
|--------------|-----------------|
| `grep StdinMessageStream agents/src/` | No matches |
| `grep process.stdin agents/src/` | No matches |
| `grep __agentServiceProcessMaps src/` | No matches |
| `ls ~/.anvil/agent-hub.sock` | Socket file exists |
| Agent startup logs | "Connected to AgentHub" |
| Tauri logs on agent connect | "Agent registered: <thread-id>" |
| State update in UI | Received via Tauri event, not stdout |
| Permission request/response | Via invoke("send_to_agent"), not stdin |
| Cancel signal | Via invoke("send_to_agent"), not stdin |
| HMR reload | No communication disruption |
| `pnpm test` (root) | All tests pass |
| `pnpm test` (agents) | All tests pass |
| `pnpm build` | No build errors |

### Summary Checklist

Run this final verification checklist after migration:

```bash
#!/bin/bash
echo "=== Migration Verification Checklist ==="

cd /Users/zac/Documents/juice/anvil/anvil

# Check 1: StdinMessageStream removed
echo -n "1. StdinMessageStream removed: "
if grep -rq "StdinMessageStream" agents/src/ 2>/dev/null; then echo "FAIL"; else echo "PASS"; fi

# Check 2: stdin-message-stream.ts removed
echo -n "2. stdin-message-stream.ts removed: "
if [ -f "agents/src/runners/stdin-message-stream.ts" ]; then echo "FAIL"; else echo "PASS"; fi

# Check 3: No stdin reading in agents
echo -n "3. No stdin reading in agents: "
if grep -rq "process\.stdin" agents/src/ 2>/dev/null; then echo "FAIL"; else echo "PASS"; fi

# Check 4: No HMR workaround
echo -n "4. HMR workaround removed: "
if grep -rq "__agentServiceProcessMaps" src/ 2>/dev/null; then echo "FAIL"; else echo "PASS"; fi

# Check 5: HubClient is used
echo -n "5. HubClient is used: "
if grep -rq "HubClient" agents/src/runner.ts 2>/dev/null; then echo "PASS"; else echo "FAIL"; fi

# Check 6: Tauri events are used
echo -n "6. Tauri events are used: "
if grep -rq "agent:message" src/lib/agent-service.ts 2>/dev/null; then echo "PASS"; else echo "FAIL"; fi

# Check 7: send_to_agent command is used
echo -n "7. send_to_agent command is used: "
if grep -rq "send_to_agent" src/lib/agent-service.ts 2>/dev/null; then echo "PASS"; else echo "FAIL"; fi

# Check 8: Tests pass
echo -n "8. Agent tests pass: "
cd agents && pnpm test --passWithNoTests > /dev/null 2>&1 && echo "PASS" || echo "FAIL"
cd ..

echo -n "9. Frontend tests pass: "
pnpm test --passWithNoTests > /dev/null 2>&1 && echo "PASS" || echo "FAIL"

# Check 10: Build succeeds
echo -n "10. Build succeeds: "
pnpm build > /dev/null 2>&1 && echo "PASS" || echo "FAIL"

echo "=== Verification Complete ==="
```
