# Sub-Agent Display Issues: Investigation & Hypothesis

## Issue Summary

When running the query "Can you spawn a general purpose sub agent that simply responds with 'hello'":

1. **Three sub-agents are created** (Explore, Plan, hello) instead of just one
2. **Only the "hello" sub-agent has a block in the parent chat UI**
3. **When opening the sub-agent, no assistant messages are visible**

---

## Verified Findings from Thread Data

**Test conducted**: `~/.mort-dev/threads/` on 2026-02-04

### Thread Structure Created

| Thread ID | Type | parentToolUseId | Has state.json | Messages |
|-----------|------|-----------------|----------------|----------|
| `816f5bfb-...` | Parent | N/A | Yes | 3 messages (user, tool_use, assistant) |
| `c0e342c0-...` | Explore | `a75eb2f` (short) | **NO** | N/A |
| `d52a3b4b-...` | Plan | `a0b987c` (short) | **NO** | N/A |
| `42a4cd63-...` | general-purpose (hello) | `toolu_01XxjUJsaSLvEf9eMP2qkPfy` (full) | Yes | **EMPTY** `[]` |

### Key Observations

1. **Explore and Plan sub-agents have NO state.json files** - only metadata.json
2. **The "hello" sub-agent has a state.json but messages array is EMPTY**
3. **parentToolUseId format differs**:
   - Explore/Plan: Short hex format (`a75eb2f`, `a0b987c`)
   - hello (general-purpose): Full Anthropic format (`toolu_01XxjUJsaSLvEf9eMP2qkPfy`)

4. **Parent thread's toolStates contains the result**:
   ```json
   "toolu_01XxjUJsaSLvEf9eMP2qkPfy": {
     "status": "complete",
     "result": "{...\"content\":[{\"type\":\"text\",\"text\":\"hello\"}]...}"
   }
   ```
   The sub-agent DID respond with "hello" - the result is in the parent's toolStates, but NOT in the child's messages.

5. **Child thread status is wrong**: `"status": "running"` even though the agent completed

---

## Root Cause Analysis

### Issue 1: Multiple Sub-Agents Created (Explore, Plan, hello)

**CONFIRMED**: The SDK spawns internal Explore/Plan agents automatically as part of its workflow.

**Evidence from metadata**:
- Explore started at `1770258473315`, completed at `1770258476124` (~2.8s)
- Plan started at `1770258473316`, completed at `1770258480151` (~6.8s)
- hello started at `1770258476423`, completed at `1770258478501` (~2s)

The Explore and Plan agents ran **in parallel** (both started at nearly the same time), then hello ran after Explore completed.

**Observation**: These internal agents are NOT user-initiated Task tool calls - they're SDK internals. They have short-form `parentToolUseId` (agent_id format) instead of full `toolu_01...` format.

### Issue 2: Only One Block in Parent UI

**CONFIRMED**: The `parentToolUseId` format mismatch explains this.

- **Parent's Task tool_use_id**: `toolu_01XxjUJsaSLvEf9eMP2qkPfy`
- **hello's parentToolUseId**: `toolu_01XxjUJsaSLvEf9eMP2qkPfy` ✅ MATCHES
- **Explore's parentToolUseId**: `a75eb2f` ❌ No matching tool block
- **Plan's parentToolUseId**: `a0b987c` ❌ No matching tool block

The frontend's `getChildThreadByParentToolUseId()` only finds the "hello" thread because only it has a matching full-format ID.

### Issue 3: No Assistant Messages in Sub-Agent View

**CONFIRMED**: The "hello" sub-agent's state.json has `"messages": []`.

The response content **IS captured** - but in the wrong place:
- **Where it IS**: Parent thread's `toolStates["toolu_01..."].result` contains `{"content":[{"type":"text","text":"hello"}]}`
- **Where it should ALSO be**: Child thread's `state.messages` array

**Root Cause**: The message handler is NOT writing assistant messages to child thread state files.

Looking at the child's state.json:
```json
{
  "messages": [],
  "status": "running",  // <-- Wrong! Should be "complete"
  "toolStates": {
    "toolu_01XxjUJsaSLvEf9eMP2qkPfy": {
      "status": "complete",
      "result": "",  // <-- Empty string, not the actual result
      "isError": false
    }
  }
}
```

**Critical Finding**: The child thread's `toolStates` has the wrong tool_use_id (same as parent's) and an empty result. This suggests the message handler may be confused about which thread to write to.

---

## Technical Deep Dive

### Message Routing Architecture

The SDK message flow:
1. SDK emits messages with `parent_tool_use_id` field
2. `MessageHandler.handle()` checks for `parent_tool_use_id` via `getParentToolUseId()`
3. `getChildThreadId()` looks up both maps:
   - `toolUseIdToChildThreadId` (full `toolu_01...` format)
   - `agentIdToChildThreadId` (short hex format like `a59b585`)
4. If found, routes to `handleForChildThread()`; otherwise routes to parent

**Code Location**: `message-handler.ts:50-59`
```typescript
const parentToolUseId = this.getParentToolUseId(message);
if (parentToolUseId && this.mortDir) {
  const childThreadId = getChildThreadId(parentToolUseId);
  if (childThreadId) {
    return this.handleForChildThread(childThreadId, message);
  }
}
```

### What the Evidence Shows

From the actual thread data:

1. **Child thread (hello) state.json EXISTS** with `toolStates` populated
2. **But `messages: []` is empty** - no assistant messages stored
3. **The result IS in parent's toolStates** with the actual "hello" response
4. **Child thread status is "running"** even though it completed

### Hypothesis: Race Condition in Message Routing

The `getChildThreadId()` function needs the mapping to exist. Looking at the timeline:

| Time | Event | agentIdToChildThreadId |
|------|-------|----------------------|
| T0 | PreToolUse:Task fires | (queues task info) |
| T1 | SDK streams assistant message | **Empty** - no mapping yet! |
| T2 | SubagentStart fires | Sets `agentIdToChildThreadId.set(agentId, childThreadId)` |
| T3 | More SDK messages... | Now has mapping |
| T4 | SubagentStop fires | Mapping still exists (not cleaned up yet) |
| T5 | PostToolUse:Task fires | Cleans up mapping |

**Critical**: If SDK streams assistant messages (T1) BEFORE SubagentStart (T2), those messages will:
1. Have `parent_tool_use_id` set (the agent's ID)
2. Call `getChildThreadId()` which returns `undefined` (no mapping yet)
3. Fall through to parent thread handling

This explains why:
- **state.json exists** (created at T2 during SubagentStart)
- **toolStates has entries** (populated by later messages after mapping exists)
- **messages is empty** (assistant message routed to parent before mapping)

### Why Explore/Plan Have No state.json

These agents are internal SDK agents that:
1. Don't have a corresponding Task tool call from the parent
2. Their `parentToolUseId` is the short hex format (SDK-assigned agent_id)
3. The `handleForChildThread()` code creates state.json lazily in `getChildThreadState()`

Looking at `getChildThreadState()`:
```typescript
private getChildThreadState(childThreadId: string): ThreadState {
  // Try cache first
  let state = this.childThreadStates.get(childThreadId);
  if (state) return state;

  // Load from disk if exists
  const statePath = join(this.mortDir!, "threads", childThreadId, "state.json");
  if (existsSync(statePath)) {
    state = JSON.parse(readFileSync(statePath, "utf-8"));
    this.childThreadStates.set(childThreadId, state);
    return state;
  }

  // Create new state
  state = { ... };
  this.childThreadStates.set(childThreadId, state);
  return state;
}
```

The state.json is only created when a message is successfully routed to `handleForChildThread()`. If the mapping doesn't exist, no messages route, no state.json created.

**For Explore/Plan**: Their messages never route successfully because the mapping uses their internal agent_id but the frontend can't find them (no matching Task tool block).

## Recommended Fixes

### Fix 1: Buffer Messages Until Mapping Established (PRIMARY FIX)

Add message buffering in MessageHandler to hold sub-agent messages until the mapping exists:

```typescript
// In MessageHandler class
private pendingSubagentMessages = new Map<string, SDKMessage[]>();

async handle(message: SDKMessage): Promise<boolean> {
  const parentToolUseId = this.getParentToolUseId(message);
  if (parentToolUseId && this.mortDir) {
    const childThreadId = getChildThreadId(parentToolUseId);
    if (childThreadId) {
      return this.handleForChildThread(childThreadId, message);
    } else {
      // Buffer the message - mapping doesn't exist yet
      const pending = this.pendingSubagentMessages.get(parentToolUseId) ?? [];
      pending.push(message);
      this.pendingSubagentMessages.set(parentToolUseId, pending);
      logger.debug(`[MessageHandler] Buffered message for ${parentToolUseId}, queue size: ${pending.length}`);
      return true; // Continue processing
    }
  }
  // ... rest of normal handling
}

// New method to flush buffered messages (called from SubagentStart)
async flushPendingMessages(agentId: string, childThreadId: string): Promise<void> {
  const pending = this.pendingSubagentMessages.get(agentId);
  if (pending && pending.length > 0) {
    logger.info(`[MessageHandler] Flushing ${pending.length} buffered messages for ${agentId}`);
    for (const msg of pending) {
      await this.handleForChildThread(childThreadId, msg);
    }
    this.pendingSubagentMessages.delete(agentId);
  }
}
```

Then call `messageHandler.flushPendingMessages(agentId, childThreadId)` at the end of SubagentStart hook.

### Fix 2: Populate Child Messages from PostToolUse:Task Result

As a fallback, when PostToolUse:Task fires with the result, extract the content and write to child:

```typescript
// In PostToolUse:Task handler (shared.ts)
if (taskResponse?.content && childThreadId) {
  const statePath = join(config.mortDir, "threads", childThreadId, "state.json");
  const state = existsSync(statePath)
    ? JSON.parse(readFileSync(statePath, "utf-8"))
    : { messages: [], fileChanges: [], workingDirectory: "", status: "running", timestamp: Date.now(), toolStates: {} };

  // Add assistant message if not already present
  if (!state.messages.some(m => m.role === "assistant")) {
    state.messages.push({
      role: "assistant",
      content: taskResponse.content,
    });
  }
  state.status = "complete";
  writeFileSync(statePath, JSON.stringify(state, null, 2));
}
```

### Fix 3: Filter or Mark Internal Sub-Agents (OPTIONAL)

The Explore/Plan agents are SDK internals. Options:
1. **Filter**: Don't create threads for agents without matching Task tool_use_id
2. **Mark**: Add `isInternal: true` flag to metadata for UI hiding/styling

```typescript
// In SubagentStart hook
const isInternal = !fullToolUseId; // No Task tool call = internal agent
if (isInternal) {
  // Either skip thread creation entirely:
  return { continue: true };
  // Or mark as internal:
  childMetadata.isInternal = true;
}
```

### Fix 4: Update Child Thread Status in state.json

The status in state.json stays "running". Need to update it when complete:

```typescript
// In PostToolUse:Task or SubagentStop
const statePath = join(config.mortDir, "threads", childThreadId, "state.json");
if (existsSync(statePath)) {
  const state = JSON.parse(readFileSync(statePath, "utf-8"));
  state.status = "complete";
  writeFileSync(statePath, JSON.stringify(state, null, 2));
}
```

## Files to Modify

| File | Change |
|------|--------|
| `agents/src/runners/message-handler.ts` | Add message buffering for sub-agents |
| `agents/src/runners/shared.ts` | Call flush after SubagentStart; populate messages in PostToolUse:Task |

## Summary of Issues

| Issue | Status | Root Cause | Fix |
|-------|--------|------------|-----|
| 3 sub-agents created | Expected | SDK internal workflow | Filter or mark internal agents (optional) |
| Only 1 UI block | Expected | Only user Task calls have blocks | Correct behavior |
| No assistant messages | **BUG** | **Race condition**: Messages arrive before mapping | Buffer messages; flush on SubagentStart |
| Status stays "running" | **BUG** | state.json status not updated | Update in PostToolUse:Task |
| Explore/Plan have no state.json | Expected | Messages never routed (no mapping at message time) | Same fix as above |

## Phases

- [x] Investigate sub-agent creation and message routing
- [x] Analyze actual thread data from `.mort-dev/threads/`
- [x] Identify root cause: race condition in message routing
- [ ] Implement fix: add message buffering in MessageHandler
- [ ] Implement fix: call flushPendingMessages() in SubagentStart
- [ ] Implement fix: populate messages/status in PostToolUse:Task as fallback
- [ ] Optional: filter or mark internal SDK agents
- [ ] Verify fixes with integration tests

## Next Steps

1. **Add buffering**: Modify `MessageHandler` to buffer messages when mapping doesn't exist
2. **Flush on SubagentStart**: After mapping is created, flush any buffered messages
3. **Fallback in PostToolUse:Task**: Extract result content and write to child state
4. **Test**: Clear `.mort-dev/threads/`, run "spawn hello sub-agent", verify messages appear

## Testing Commands

```bash
# Clear existing test threads
rm -rf ~/.mort-dev/threads/*

# Run the test in mortician dev mode
# Then check results:
find ~/.mort-dev/threads -name "state.json" -exec cat {} \;
```
