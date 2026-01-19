# Queued Messages Acknowledgement - Investigation & Solution

## Problem Statement

1. **Queued messages show forever**: Messages queued while the agent is running never animate into the message list and stay pinned in the `QueuedMessagesBanner`.
2. **No acknowledgement from agent**: The UI has no way to know when a queued message has been successfully received and processed by the agent.
3. **Messages not scoped to thread**: Queued messages accumulate globally rather than being cleared when switching threads or when a thread completes.

---

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                              CURRENT FLOW (BROKEN)                                   │
└─────────────────────────────────────────────────────────────────────────────────────┘

  FRONTEND (Tauri)                    AGENT PROCESS                      SDK
  ═══════════════════                ═══════════════════                ═════════

  ┌─────────────────┐
  │ User submits    │
  │ queued message  │
  └────────┬────────┘
           │
           ▼
  ┌─────────────────┐
  │ sendQueuedMsg() │
  │ agent-service.ts│
  │                 │
  │ • Generate UUID │
  │ • Track pending │
  └────────┬────────┘
           │
           │  JSON via stdin
           │  {type, id, content, timestamp}
           │
           ▼
                                     ┌─────────────────┐
                                     │ StdinMsgStream  │
                                     │ stdin-msg-      │
                                     │ stream.ts       │
                                     │                 │
                                     │ • Parse JSON    │
                                     │ • Has msg.id ✓  │
                                     └────────┬────────┘
                                              │
                                              │  formatUserMessage()
                                              │  ❌ DROPS msg.id!
                                              │
                                              ▼
                                     ┌─────────────────┐
                                     │ SDKUserMessage  │────────────►┌──────────────┐
                                     │                 │             │ SDK query()  │
                                     │ • content ✓     │             │              │
                                     │ • isSynthetic ✓ │             │ Async iter   │
                                     │ • uuid: ???     │◄────────────│ yields back  │
                                     │   (undefined!)  │             └──────────────┘
                                     └────────┬────────┘
                                              │
                                              ▼
                                     ┌─────────────────┐
                                     │ MessageHandler  │
                                     │ message-        │
                                     │ handler.ts      │
                                     │                 │
                                     │ • No uuid!      │
                                     │ • appendUser-   │
                                     │   Message()     │
                                     └────────┬────────┘
                                              │
                                              │  stdout JSON
                                              │  {type: "state",...}
                                              │  ❌ NO ACK EVENT!
                                              │
                                              ▼
  ┌─────────────────┐
  │ Content-based   │◄───────────────────────────────────────────────
  │ matching        │
  │                 │
  │ ❌ FAILS when:  │
  │ • Duplicate msg │
  │ • Same as init  │
  └─────────────────┘


┌─────────────────────────────────────────────────────────────────────────────────────┐
│                              PROPOSED FLOW (FIXED)                                   │
└─────────────────────────────────────────────────────────────────────────────────────┘

  FRONTEND (Tauri)                    AGENT PROCESS                      SDK
  ═══════════════════                ═══════════════════                ═════════

  ┌─────────────────┐
  │ User submits    │
  │ queued message  │
  └────────┬────────┘
           │
           ▼
  ┌─────────────────┐
  │ sendQueuedMsg() │
  │ agent-service.ts│
  │                 │
  │ • Generate UUID │
  │ • Track pending │
  └────────┬────────┘
           │
           │  JSON via stdin
           │  {type, id, content, timestamp}
           │
           ▼
                                     ┌─────────────────┐
                                     │ StdinMsgStream  │
                                     │ stdin-msg-      │
                                     │ stream.ts       │
                                     │                 │
                                     │ • Parse JSON    │
                                     │ • Has msg.id ✓  │
                                     └────────┬────────┘
                                              │
                                              │  formatUserMessage()
                                              │  ✅ PASS msg.id!
                                              │
                                              ▼
                                     ┌─────────────────┐
                                     │ SDKUserMessage  │────────────►┌──────────────┐
                                     │                 │             │ SDK query()  │
                                     │ • content ✓     │             │              │
                                     │ • isSynthetic ✓ │             │ Async iter   │
                                     │ • uuid ✓        │◄────────────│ yields back  │
                                     │   (our msg ID!) │             └──────────────┘
                                     └────────┬────────┘
                                              │
                                              ▼
                                     ┌─────────────────┐
                                     │ MessageHandler  │
                                     │ message-        │
                                     │ handler.ts      │
                                     │                 │
                                     │ • Has uuid ✓    │
                                     │ • Emit ACK      │
                                     │ • appendUser-   │
                                     │   Message()     │
                                     └────────┬────────┘
                                              │
                                              │  stdout JSON
                                              │  {type: "queued_message_ack",
                                              │   messageId: uuid}
                                              │  ✅ ACK EVENT!
                                              │
                                              ▼
  ┌─────────────────┐
  │ Event-based     │◄───────────────────────────────────────────────
  │ confirmation    │
  │                 │
  │ ✅ Match by ID  │
  │ ✅ Remove from  │
  │   banner        │
  └─────────────────┘
```

---

## SDK Analysis: Critical Findings

### What SDKUserMessageReplay is NOT

The original plan suggested using `SDKUserMessageReplay` for acknowledgement. **This is incorrect.**

From the SDK documentation and types:
- `SDKUserMessageReplay` is for **session resumption** scenarios only
- It's emitted when replaying historical messages with `resume: sessionId`
- The `isReplay: true` flag tells the SDK not to add the message to the array again (it's already there)
- The SDK does NOT emit `SDKUserMessageReplay` for messages injected via `AsyncIterable<SDKUserMessage>`

### What actually happens with injected messages

When we yield an `SDKUserMessage` from our async generator:
1. SDK passes it through to Claude API
2. SDK yields it back via the async iterator (same object, with any SDK-assigned fields)
3. Our `MessageHandler` receives it with `type: "user"`
4. If `msg.uuid` was set on our input, it will be preserved in the yielded message

### The uuid field IS the solution

The `uuid?: UUID` field on `SDKUserMessage` (line 387 of agentSdkTypes.d.ts):
- Is optional for input messages
- If set, is preserved when the message is yielded back
- Is the correct field to carry our queued message ID through the pipeline

**Key insight:** The SDK doesn't "acknowledge" messages - it just passes them through. We must emit our own acknowledgement event from `MessageHandler` when we detect a queued message (non-synthetic, has uuid).

---

## Complete Message Flow Trace (With Line References)

### Step 1: Frontend sends queued message

**File:** `src/lib/agent-service.ts:1094-1129`

```typescript
export async function sendQueuedMessage(threadId: string, message: string): Promise<string> {
  const child = agentProcesses.get(threadId);
  const messageId = crypto.randomUUID();
  const timestamp = Date.now();

  // Format as JSON line (must end with newline)
  const payload = JSON.stringify({
    type: 'queued_message',
    id: messageId,        // <-- Message ID is included
    content: message,
    timestamp,
  }) + '\n';

  // Track for confirmation
  pendingQueuedMessages.set(messageId, { threadId, content: message, timestamp });

  await child.write(payload);  // Write to stdin
  return messageId;
}
```

**Evidence:** The `messageId` IS sent to the agent in the JSON payload.

### Step 2: Agent parses stdin message

**File:** `agents/src/runners/stdin-message-schema.ts:9-14`

```typescript
export const StdinMessageSchema = z.object({
  type: z.literal("queued_message"),
  id: z.string().uuid(),      // <-- ID is parsed and validated
  content: z.string().min(1),
  timestamp: z.number(),
});
```

**File:** `agents/src/runners/stdin-message-stream.ts:88-104`

```typescript
this.rl.on("line", (line) => {
  const msg = parseStdinMessage(line);  // <-- Returns { type, id, content, timestamp }
  if (!msg) return;
  // ... queues msg which includes msg.id
});
```

**Evidence:** The `msg.id` is successfully parsed and available.

### Step 3: Message ID is DROPPED (THE BUG)

**File:** `agents/src/runners/stdin-message-stream.ts:58-63`

```typescript
while (!this.closed) {
  const msg = await this.waitForMessage();
  if (msg === null) break;
  logger.info(`[StdinMessageStream] Processing queued message: ${msg.id}`);  // ID is logged!
  yield this.formatUserMessage(msg.content, false);  // <-- ID NOT PASSED
}
```

**File:** `agents/src/runners/stdin-message-stream.ts:70-78`

```typescript
private formatUserMessage(content: string, isSynthetic: boolean): SDKUserMessage {
  return {
    type: "user",
    message: { role: "user", content },
    parent_tool_use_id: null,
    session_id: this.sessionId,
    isSynthetic,
    // <-- NO MESSAGE ID FIELD
  };
}
```

**Evidence:** The `formatUserMessage` function signature is `(content: string, isSynthetic: boolean)` - it doesn't accept or include the message ID. The call site at line 63 only passes `msg.content`, not `msg.id`.

### Step 4: MessageHandler processes without ID

**File:** `agents/src/runners/message-handler.ts:108-118`

```typescript
if (msg.isSynthetic === false) {
  const content = typeof msg.message.content === "string"
    ? msg.message.content
    : /* array handling */;

  await appendUserMessage(content);  // <-- Only content, no ID
  logger.info("[MessageHandler] Processed queued user message");
  return true;
}
```

**Evidence:** The `SDKUserMessage` received here has no reference to the original queued message ID. Only `content` is passed to `appendUserMessage`.

### Step 5: State emitted without acknowledgement

**File:** `agents/src/output.ts:94-97`

```typescript
export async function appendUserMessage(content: string): Promise<void> {
  state.messages.push({ role: "user", content });  // <-- Just content
  await emitState();
}
```

**Evidence:** The emitted state contains the message content but no queued message ID. No acknowledgement event is ever emitted.

### Step 6: Frontend attempts content-based matching (fails)

**File:** `src/components/simple-task/simple-task-window.tsx:221-247`

```typescript
useEffect(() => {
  if (!activeState?.messages) return;

  for (const qm of currentQueued) {
    const foundInConversation = activeState.messages.some(m => {
      if (m.role !== 'user') return false;
      const content = /* extract content */;
      return content === qm.content;  // <-- Content comparison
    });

    if (foundInConversation) {
      confirmQueuedMessage(qm.id);
    }
  }
}, [activeState?.messages]);
```

**Why this fails:**
1. **Initial prompt collision:** If user queues "fix the bug" and the initial prompt was also "fix the bug", it matches immediately (false positive)
2. **Message format mismatch:** Content extraction assumes string or array with text blocks, but format may vary
3. **No guarantee of uniqueness:** Two identical queued messages can't be distinguished

---

## Root Cause Summary

| Location | What happens | Problem |
|----------|-------------|---------|
| `stdin-message-stream.ts:63` | `yield this.formatUserMessage(msg.content, false)` | `msg.id` available but not passed |
| `stdin-message-stream.ts:70-78` | `formatUserMessage(content, isSynthetic)` | Signature doesn't accept ID |
| `message-handler.ts:116` | `await appendUserMessage(content)` | Only content passed, no ID |
| `output.ts:94-97` | `state.messages.push({ role: "user", content })` | No acknowledgement emitted |

**The fix requires:** Passing the message ID through the entire pipeline and emitting an acknowledgement event.

---

## SDK Type Analysis: Verified Approach

Based on comprehensive review of the SDK documentation and type definitions:

### SDKUserMessage.uuid Field

**File:** `@anthropic-ai/claude-agent-sdk/entrypoints/agentSdkTypes.d.ts:386-389`

```typescript
export type SDKUserMessage = SDKUserMessageContent & {
  uuid?: UUID;      // <-- Optional, we can set this
  session_id: string;
};
```

**Verified behavior:**
- The `uuid` field is optional on input messages
- When set, it is preserved when the SDK yields the message back through the async iterator
- This is the correct field to carry our queued message ID

### SDKUserMessageReplay - NOT Applicable

**File:** `@anthropic-ai/claude-agent-sdk/entrypoints/agentSdkTypes.d.ts:390-398`

```typescript
export type SDKUserMessageReplay = SDKUserMessageContent & {
  uuid: UUID;       // Required (not optional like SDKUserMessage)
  session_id: string;
  isReplay: true;   // Always true
};
```

**This type is NOT used for our case.** It's specifically for:
- Session resumption with `resume: sessionId` option
- Replaying historical messages to prevent duplicates
- The SDK emits this when replaying, NOT when processing new injected messages

### isSynthetic Flag - Already Correct

```typescript
isSynthetic?: boolean;
// true  → Initial prompt (already appended by runAgentLoop)
// false → Queued message (MessageHandler should append)
```

Our current usage is correct. We just need to add the `uuid` field.

---

## Additional Issue: Inefficient Pending Messages Map

**File:** `src/lib/agent-service.ts:44-48, 1148-1154`

```typescript
// Current structure
pendingQueuedMessages: Map<string, { threadId: string; content: string; timestamp: number }>
// Keyed by messageId, threadId is a property

// Clearing requires O(n) iteration
export function clearPendingQueuedMessages(threadId: string): void {
  for (const [id, data] of pendingQueuedMessages.entries()) {
    if (data.threadId === threadId) {
      pendingQueuedMessages.delete(id);
    }
  }
}
```

**Should be:** `Map<threadId, Map<messageId, { content, timestamp }>>` for O(1) thread operations.

---

## Solution: Agent-Side Acknowledgement

### Change 1: Pass message ID through stdin-message-stream.ts

**File:** `agents/src/runners/stdin-message-stream.ts`

```typescript
// Update formatUserMessage signature to accept queued message ID
private formatUserMessage(content: string, isSynthetic: boolean, queuedMessageId?: string): SDKUserMessage {
  return {
    type: "user",
    message: { role: "user", content },
    parent_tool_use_id: null,
    session_id: this.sessionId,
    isSynthetic,
    uuid: queuedMessageId,  // Use SDK's native uuid field
  };
}

// Update call site (line 63) to pass the message ID
yield this.formatUserMessage(msg.content, false, msg.id);
```

### Change 2: Emit acknowledgement in message-handler.ts

**File:** `agents/src/runners/message-handler.ts`

```typescript
import { stdout } from "../output.js";  // Add import

// In handleUser, after detecting queued message
if (msg.isSynthetic === false) {
  const content = /* ... */;

  // Use SDK's uuid field which now carries our queued message ID
  if (msg.uuid) {
    // Emit acknowledgement event BEFORE appending (so UI gets it first)
    stdout({ type: 'queued_message_ack', messageId: msg.uuid });
  }

  await appendUserMessage(content);
  return true;
}
```

### Change 3: Handle event in agent-service.ts

```typescript
// In handleAgentOutput or event handler
case 'queued_message_ack':
  const { messageId } = data;
  eventBus.emit(EventName.QUEUED_MESSAGE_ACK, { messageId, threadId });
  break;
```

### Change 4: Update simple-task-window.tsx

```typescript
// Replace content-based matching with event-based
useEffect(() => {
  const unsubscribe = eventBus.on(EventName.QUEUED_MESSAGE_ACK, (data) => {
    if (data.threadId !== threadId) return;
    confirmQueuedMessage(threadId, data.messageId);
    setQueuedMessages(prev => prev.filter(qm => qm.id !== data.messageId));
  });
  return unsubscribe;
}, [threadId]);
```

### Change 5: Refactor pending messages map structure

```typescript
// New structure
pendingQueuedMessages: Map<string, Map<string, { content: string; timestamp: number }>>
// Map<threadId, Map<messageId, data>>

// Updated functions
export function sendQueuedMessage(threadId: string, message: string): Promise<string> {
  // ...
  if (!pendingQueuedMessages.has(threadId)) {
    pendingQueuedMessages.set(threadId, new Map());
  }
  pendingQueuedMessages.get(threadId)!.set(messageId, { content: message, timestamp });
  // ...
}

export function confirmQueuedMessage(threadId: string, messageId: string): void {
  pendingQueuedMessages.get(threadId)?.delete(messageId);
  if (pendingQueuedMessages.get(threadId)?.size === 0) {
    pendingQueuedMessages.delete(threadId);
  }
}

export function clearPendingQueuedMessages(threadId: string): void {
  pendingQueuedMessages.delete(threadId);  // O(1)
}
```

---

## Implementation Files

| File | Change |
|------|--------|
| `agents/src/runners/stdin-message-stream.ts:63,70-78` | Add `queuedMessageId` parameter, set `uuid` field, pass `msg.id` |
| `agents/src/runners/message-handler.ts:108-118` | Check `msg.uuid`, emit `queued_message_ack` event |
| `src/lib/agent-service.ts:44-48,1094-1154` | Refactor map to `Map<threadId, Map<messageId, data>>`, handle ack event |
| `src/entities/events.ts` | Add `QUEUED_MESSAGE_ACK` event type |
| `src/components/simple-task/simple-task-window.tsx:221-247` | Replace content-matching with event subscription |

---

## Testing Scenarios

1. **Basic acknowledgement:** Queue message → agent processes → banner updates immediately
2. **Duplicate content:** Queue "test" twice → both should be tracked/acked separately by ID
3. **Thread switch:** Queue message → switch threads → queued messages cleared
4. **Agent completion:** Queue message → agent completes → all cleared
5. **Agent cancellation:** Queue message → cancel → all cleared
6. **Rapid queueing:** Queue 5 messages quickly → all acked in order

---

## Risks & Edge Cases

### 1. Timing: ACK Before State Update

**Risk:** The ack event and state update may arrive in different order.

**Mitigation:** Emit ack BEFORE calling `appendUserMessage()`. The UI should:
1. Receive ack → remove from banner
2. Receive state → message appears in conversation

If state arrives first, content-based matching (as fallback) would still work.

### 2. Process Crash Between Queue and ACK

**Risk:** Agent crashes after receiving message but before emitting ack.

**Mitigation:** On agent crash/error/cancel:
- Clear all pending queued messages for that thread
- Current behavior (clearing on thread complete) handles this

### 3. Message Lost in Transit

**Risk:** Stdin write succeeds but message never reaches agent (buffer full, process dying).

**Mitigation:**
- StdinMessageStream already logs received messages
- Could add timeout-based fallback (if no ack within X seconds, assume failed)
- For MVP, rely on thread cleanup on completion/cancellation

### 4. UUID Collision

**Risk:** Frontend-generated UUID collides with SDK-internal UUID.

**Reality:** Extremely unlikely (UUID v4 collision probability ~1 in 2^122). The SDK's uuid field is meant for external use.

---

## Alternative Approaches Considered

### A. SDK-level replay (REJECTED)

**Idea:** Use `SDKUserMessageReplay` type.
**Why rejected:** That type is for session resumption, not runtime message injection. The SDK doesn't emit it for async iterable messages.

### B. Custom field instead of uuid (REJECTED)

**Idea:** Add `_queuedMessageId` custom field to SDKUserMessage.
**Why rejected:** TypeScript would complain. The `uuid` field exists and is documented for this purpose.

### C. Keep content-based matching as primary (REJECTED)

**Idea:** Improve content matching instead of adding ack events.
**Why rejected:** Fundamentally broken for duplicate messages and initial prompt collisions.

### D. Bidirectional stdin/stdout protocol (CONSIDERED)

**Idea:** Agent sends ack, frontend confirms receipt.
**Status:** Overkill for MVP. Current one-way ack is sufficient. Could add later if reliability issues emerge.

---

## Implementation Order

1. **agents/stdin-message-stream.ts** - Pass uuid through formatUserMessage
2. **agents/message-handler.ts** - Emit ack event when processing queued message
3. **src/lib/agent-service.ts** - Handle ack event, refactor pending messages map
4. **src/entities/events.ts** - Add QUEUED_MESSAGE_ACK event type
5. **src/components/simple-task/simple-task-window.tsx** - Subscribe to ack events, remove content-based matching
