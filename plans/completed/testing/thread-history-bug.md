# Thread History Bug Diagnosis

## Problem Statement
When responding to a message in the thread panel, the agent doesn't seem to have the previous conversation history.

## Investigation Status: FIXED

### Unit Tests: ALL PASS
Created comprehensive tests in `agents/src/runners/thread-history.test.ts`:
- `loadPriorMessages` correctly reads state.json and extracts messages
- Path construction is consistent between frontend and backend
- Message format is correct for the SDK
- History loading works end-to-end in mocked scenarios

### Key Finding
**The code flow appears correct.** All unit tests pass, suggesting the bug is one of:

1. **UI-side issue**: Messages display incorrectly in frontend (state management)
2. **Timing issue**: Race condition where file doesn't exist when read
3. **Model behavior**: Agent has history but doesn't explicitly reference it
4. **Edge case**: Specific scenario not covered by tests

## Detailed Code Trace

### Resume Flow (Working As Expected)

1. **User sends follow-up message**
   - `SimpleTaskWindow.handleSubmit()` → `resumeSimpleAgent(taskId, threadId, prompt, workingDirectory)`

2. **Frontend constructs history path**
   ```typescript
   // agent-service.ts:710
   const stateFilePath = await join(anvilDir, "tasks", taskId, "threads", `simple-${threadId}`, "state.json");
   ```

3. **Runner spawned with history**
   ```
   --history-file /path/to/tasks/{taskId}/threads/simple-{threadId}/state.json
   ```

4. **Runner loads prior messages**
   ```typescript
   // runner.ts:135
   const priorMessages = loadPriorMessages(config.historyFile);
   ```

5. **SDK receives full context**
   ```typescript
   // shared.ts:240
   ...(priorMessages.length > 0 && { messages: priorMessages }),
   ```

### Path Consistency Verified
- **Frontend**: `{anvilDir}/tasks/{taskId}/threads/simple-{threadId}/state.json`
- **Runner**: `{anvilDir}/tasks/{taskId}/threads/simple-{threadId}/state.json`
- Both use same anvilDir (passed via `--anvil-dir`)
- Both use same taskId/threadId (consistent IDs from backend)

## Test Results

```
✓ Thread History - loadPriorMessages
  ✓ should pass prior messages to SDK when resuming a thread
✓ Thread History - End-to-End Resume Flow
  ✓ CRITICAL: agent should receive previous conversation when resuming
  ✓ messages should be in correct SDK format
✓ Thread History - Path Construction
  ✓ should construct correct history file path for simple agents
  ✓ context.threadPath should match state.json location
```

## Possible Root Causes (To Investigate Further)

### 1. Race Condition
The state.json might not be written/flushed before resume is called:
- User rapidly sends messages
- First message completes but state.json not yet written
- Resume called before file exists

**Mitigation**: Add file existence check with retry/wait logic

### 2. UI State Not Updating
The Zustand store might not be updating messages correctly:
- `activeState?.messages` could be stale
- `loadThreadState` might fail silently
- Event listener for AGENT_STATE might not trigger refresh

**Debug**: Add logging to `src/entities/threads/listeners.ts` AGENT_STATE handler

### 3. Model Behavior (Not A Bug)
The agent might have history but choose not to reference it:
- Complex prompts where history context isn't relevant
- Tool-heavy responses where agent focuses on current task
- System prompt instructions that override context usage

**Test**: Check raw API messages in state.json to verify history was sent

## Recommended Next Steps

### 0. Multi-Turn Live Agent Test (Highest Priority)

Create an integration test that uses a real agent to verify context persistence:

```typescript
// agents/src/runners/thread-history-live.test.ts

it('agent should remember previous message context across turns', async () => {
  const testUuid = crypto.randomUUID();

  // Turn 1: Send message containing the UUID
  const turn1Response = await runAgent({
    prompt: `Remember this code: ${testUuid}. Just acknowledge you received it.`,
    // ... config
  });

  // Wait for completion
  await waitForAgentComplete(turn1Response.threadId);

  // Turn 2: Resume and ask about previous message
  const turn2Response = await resumeAgent({
    threadId: turn1Response.threadId,
    prompt: 'What did I say in the previous message? Reply with just the code I gave you.',
  });

  await waitForAgentComplete(turn2Response.threadId);

  // Parse response and verify UUID is present
  const responseText = getAgentResponseText(turn2Response);
  expect(responseText).toContain(testUuid);
});
```

**Why this test is valuable:**
- Tests the **actual** flow end-to-end with a real LLM
- UUID ensures we're testing actual context, not coincidental matches
- Failure definitively proves history isn't being passed
- Success proves the full pipeline works (file write → file read → SDK → model)

**Implementation notes:**
- May need to use a fast/cheap model for CI (e.g., haiku)
- Consider timeout handling for flaky network
- Could run as a separate "integration" test suite (not unit tests)

### TEST IMPLEMENTED AND RUN - BUG CONFIRMED

**Test file:** `agents/src/runners/thread-history-live.test.ts`

**Results (2025-01-10):**
```
✗ agent should remember UUID from previous turn (LIVE LLM) - FAILED
✓ agent should NOT know UUID without prior messages (control test) - PASSED
```

**Output from failed test:**
```
Prior messages from turn 1: 2
Prior message roles: user, assistant
Prior messages content preview:
  [user]: Remember this exact code: 05fe64c8-24c9-4948-8040-f24d77be1209...
  [assistant]: [{"type":"text","text":"Acknowledged, I will remember the code."}]
Turn 2 response: "I don't have access to any previous messages..."
```

**Root cause identified:** Messages ARE being loaded from state.json correctly, but the SDK is NOT receiving them. The bug is in `shared.ts:305` where messages are passed to the query:
```typescript
...(priorMessages.length > 0 && { messages: priorMessages }),
```

**Likely fix:** Check if the claude-agent-sdk expects `messages` at the top level of `query()` instead of inside `options`

## FIX ATTEMPT 1: Session-based (REVERTED - causes vendor lock-in)

**Date:** 2025-01-10

The session-based approach (`resume: sessionId`) was implemented and worked, but was reverted because it causes vendor lock-in to the SDK's session management.

---

## FIX ATTEMPT 2: Stateless Message Passing - COMPLETED

### Goal
Pass conversation history explicitly to the SDK without relying on session IDs.

### SDK Analysis

The `query` function signature is:
```typescript
query({ prompt: string | AsyncIterable<SDKUserMessage>, options?: Options }): Query
```

**Key findings from SDK source (`sdk.mjs`):**

1. **The `messages` option in SDK types** - The `Options` type does NOT have a `messages` field. Passing `messages: priorMessages` via options was being silently ignored.

2. **Two ways to pass input:**
   - `prompt: string` → SDK wraps it as a single user message
   - `prompt: AsyncIterable<SDKUserMessage>` → SDK streams messages via `queryInstance.streamInput(prompt)`

3. **SDK limitation:** The `AsyncIterable<SDKUserMessage>` approach only supports USER messages (type: 'user'). The CLI subprocess rejects assistant messages sent via stdin.

### Solution Implemented: History Context Embedding

Since the SDK doesn't support passing a full message array (user + assistant), we embed the conversation history as text context in the user message.

**Implementation in `shared.ts`:**

```typescript
function formatPromptWithHistory(
  priorMessages: MessageParam[],
  newPrompt: string
): string {
  if (priorMessages.length === 0) {
    return newPrompt;
  }

  // Format conversation history as readable context
  const historyLines: string[] = [
    "<conversation_history>",
    "The following is the conversation history from this thread...",
    "",
  ];

  for (const msg of priorMessages) {
    const role = msg.role === "user" ? "User" : "Assistant";
    historyLines.push(`[${role}]:`);
    historyLines.push(extractTextContent(msg.content));
    historyLines.push("");
  }

  historyLines.push("</conversation_history>");
  historyLines.push("");
  historyLines.push("[Current user message]:");
  historyLines.push(newPrompt);

  return historyLines.join("\n");
}
```

### Test Results (2025-01-10)

```
✓ agent should remember UUID from previous turn (LIVE LLM) - PASSED
✓ agent should NOT know UUID without prior messages (control test) - PASSED
✓ Thread History - loadPriorMessages (5 tests) - PASSED
✓ Thread History - End-to-End Resume Flow (5 tests) - PASSED
```

### Trade-offs

**Pros:**
- No vendor lock-in to SDK session management
- Works with any LLM that follows instructions
- Portable - conversation history is self-contained
- No dependency on Claude Code's internal session storage

**Cons:**
- Slightly more tokens used (history is formatted as text, not native messages)
- Model must follow the `<conversation_history>` format instructions
- Not as semantically clear to the model as native message alternation

### Files Changed
- `agents/src/runners/shared.ts` - Added `formatPromptWithHistory()` function
- `agents/src/runners/thread-history-live.test.ts` - Live multi-turn test

---

## Debugging Notes (for reference)

1. **Add Debug Logging**
   Add logging in `loadPriorMessages` to always log the historyFile path and existence:
   ```typescript
   logger.info(`[runner] historyFile=${historyFile}, exists=${existsSync(historyFile)}`);
   ```

2. **Verify in Production**
   After a failed resume scenario:
   - Check state.json exists at expected path
   - Verify state.json contains prior messages
   - Check runner logs for "Loaded N prior messages" message

3. **Frontend Debug**
   In `SimpleTaskWindow`:
   - Log `activeState?.messages` before and after submit
   - Verify messages aren't being cleared

4. **Consider Race Condition Fix**
   If timing is the issue, add a small delay or file existence check before spawning runner

## Files Involved

| File | Purpose |
|------|---------|
| `src/lib/agent-service.ts` | Spawns runner, constructs history path |
| `agents/src/runner.ts` | Entry point, loads prior messages |
| `agents/src/runners/shared.ts` | Passes messages to SDK query |
| `agents/src/output.ts` | Writes state.json |
| `src/entities/threads/listeners.ts` | Handles AGENT_STATE events |
| `src/components/simple-task/simple-task-window.tsx` | UI component |

## Test File
Tests created at: `agents/src/runners/thread-history.test.ts`

Run with: `cd agents && pnpm test thread-history.test.ts`
