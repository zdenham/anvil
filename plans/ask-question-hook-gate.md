# Ask Question Hook Gate

Gate the `AskUserQuestion` tool at the PreToolUse hook level — same deferred-promise pattern used for permissions — so the agent blocks until the user answers in the UI.

## Background

Today, `AskUserQuestion` flows through the SDK's normal tool execution path. The agent emits the tool_use, the SDK calls the tool, and the result is returned inline. The UI renders an `AskUserQuestionBlock` component inside the message list, but the response path (`onToolResponse` → `submitToolResult`) is **not wired up** — so answers never reach the agent.

The permission system solves exactly this class of problem: intercept a tool at `PreToolUse`, emit an event to the frontend, block the hook with a deferred promise, and resolve it when the frontend responds over the hub socket. We replicate that pattern here.

### Why hook-level, not tool-result level?

- **Consistency**: Same async-wait architecture as permissions — one pattern to maintain.
- **SDK control**: The hook controls whether the tool "succeeds" or "fails" from the SDK's perspective. We can inject the user's answer as the tool result directly, avoiding the need for a separate `submitToolResult` Tauri command.
- **Simplicity**: No need to pause/resume the agent loop or manage tool-result injection. The hook blocks, the user answers, the hook returns a tool result containing the answer.

## Phases

- [ ] Add `QuestionGate` class (agent-side deferred promise bridge)
- [ ] Register PreToolUse hook for `AskUserQuestion` in shared.ts
- [ ] Add hub event types and socket message handling
- [ ] Wire frontend event routing and store
- [ ] Render question natively in chat via existing `AskUserQuestionBlock`
- [ ] Connect answer submission back through hub socket

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Phase 1 — `QuestionGate` class

**File**: `agents/src/lib/question-gate.ts` (new, mirrors `permission-gate.ts`)

Same deferred-promise bridge as `PermissionGate`, but for questions:

```ts
export class QuestionGate {
  private pending = new Map<string, PendingQuestion>();

  async waitForAnswer(
    requestId: string,
    context: {
      threadId: string;
      toolName: string;
      toolInput: Record<string, unknown>;
      signal: AbortSignal;
    },
    emitEvent: (name: string, payload: Record<string, unknown>) => void,
  ): Promise<{ answer: string } | "timeout"> {
    emitEvent("question:request", {
      requestId,
      threadId: context.threadId,
      toolInput: context.toolInput, // contains questions array
      timestamp: Date.now(),
    });

    return new Promise((resolve) => {
      this.pending.set(requestId, { resolve, createdAt: Date.now() });
      context.signal.addEventListener("abort", () => {
        if (this.pending.has(requestId)) {
          this.pending.delete(requestId);
          resolve("timeout");
        }
      }, { once: true });
    });
  }

  resolve(requestId: string, answer: string): void {
    const pending = this.pending.get(requestId);
    if (!pending) return;
    this.pending.delete(requestId);
    pending.resolve({ answer });
  }

  clear(): void {
    for (const [, p] of this.pending) p.resolve("timeout");
    this.pending.clear();
  }
}
```

Differences from `PermissionGate`:
- Response payload is `{ answer: string }` instead of `{ approved: boolean; reason?: string }`.
- Event name is `question:request` / `question:response` instead of `permission:*`.

---

## Phase 2 — PreToolUse hook for `AskUserQuestion`

**File**: `agents/src/runners/shared.ts`

Add a second entry to the `PreToolUse` hooks array, **before** the permission hook (so it fires first and the permission hook never sees AskUserQuestion):

```ts
{
  matcher: "AskUserQuestion",
  timeout: 3600, // 1 hour — user may take time to answer
  hooks: [
    async (hookInput, _toolUseId, { signal }) => {
      const input = hookInput as PreToolUseHookInput;
      const requestId = crypto.randomUUID();

      const response = await questionGate.waitForAnswer(
        requestId,
        {
          threadId: context.threadId,
          toolName: input.tool_name,
          toolInput: input.tool_input as Record<string, unknown>,
          signal,
        },
        emitEvent,
      );

      if (response === "timeout" || signal.aborted) {
        return {
          hookSpecificOutput: {
            hookEventName: "PreToolUse" as const,
            permissionDecision: "deny" as const,
            permissionDecisionReason: "Question timed out",
          },
        };
      }

      // Return allow + inject the user's answer so the SDK sees a successful tool result
      return {
        hookSpecificOutput: {
          hookEventName: "PreToolUse" as const,
          permissionDecision: "allow" as const,
          permissionDecisionReason: response.answer,
          // The SDK will use this as the tool_result content
          toolResult: response.answer,
        },
      };
    },
  ],
},
```

> **Open question**: The SDK may or may not support injecting a `toolResult` from the hook output. If it doesn't, we may need to let the tool execute normally and instead use a **PostToolUse** hook or intercept the tool's own execution to return the answer. Investigate SDK behavior during implementation. Worst case, we allow the tool, then the tool itself reads the answer from a shared in-memory store that the gate populates before resolving.

`questionGate` is instantiated in `runner.ts` alongside `permissionGate` and passed into `runAgentLoop` via the options bag.

---

## Phase 3 — Hub event types and socket message handling

### 3a. Event names (`core/types/events.ts`)

```ts
QUESTION_REQUEST: "question:request",
QUESTION_RESPONSE: "question:response",
```

With payload types:

```ts
[EventName.QUESTION_REQUEST]: {
  requestId: string;
  threadId: string;
  toolInput: Record<string, unknown>; // the full AskUserQuestion input (questions array)
  timestamp: number;
};

[EventName.QUESTION_RESPONSE]: {
  requestId: string;
  threadId: string;
  answer: string;
};
```

### 3b. Hub message type (`agents/src/lib/hub/types.ts`)

Add to `TauriToAgentMessage`:

```ts
| { type: "question_response"; payload: { requestId: string; answer: string } }
```

### 3c. Runner message handler (`agents/src/runner.ts`)

In the `hub.on("message")` handler, add a case:

```ts
case "question_response": {
  const { requestId, answer } = msg.payload;
  questionGate.resolve(requestId, answer);
  break;
}
```

### 3d. Tauri hub relay (`src-tauri/src/agent_hub.rs`)

Add a Tauri command (or reuse the existing `send_to_agent` command) to forward `question_response` messages from the frontend to the agent process over the socket. This likely already works via the generic `send_to_agent` path used for `permission_response`.

---

## Phase 4 — Frontend event routing and store

### 4a. Question store (`src/entities/questions/store.ts`, new)

Zustand store holding pending questions per thread:

```ts
interface QuestionRequest {
  requestId: string;
  threadId: string;
  toolInput: Record<string, unknown>;
  timestamp: number;
  status: "pending" | "answered";
  answer?: string;
}

interface QuestionStore {
  requests: Map<string, QuestionRequest>;
  addRequest(req: QuestionRequest): void;
  markAnswered(requestId: string, answer: string): void;
  getPendingForThread(threadId: string): QuestionRequest | undefined;
}
```

### 4b. Event routing (`src/lib/agent-service.ts`)

In `routeAgentEvent`, add:

```ts
case EventName.QUESTION_REQUEST:
  eventBus.emit(EventName.QUESTION_REQUEST, payload);
  break;
```

### 4c. Listener (`src/entities/questions/listeners.ts`, new)

Subscribe to `QUESTION_REQUEST` events and push into the question store.

---

## Phase 5 — Render question natively in chat

The existing `AskUserQuestionBlock` component already renders the full interactive question UI (options, keyboard navigation, multi-select). Currently it's embedded inside `AssistantMessage` as part of the tool_use block rendering — but this means it only appears after the tool_use content block streams in, and it renders *inside* the message bubble.

**Goal**: When a `QUESTION_REQUEST` event arrives, render the question block **natively in the message list** — at the bottom of the chat, as its own distinct element (not inside a message bubble). This feels more like a native interaction and less like an embedded tool.

### Approach

Two options for rendering location:

**Option A — Streaming footer widget** (recommended): The `MessageList` component already has a footer area used for `StreamingContent` and working indicators. Add the question block here when a pending question exists for the active thread. This puts it at the very bottom of the scrolled area, right above the input — the natural place for an interactive prompt.

**Option B — Injected pseudo-message**: Create a synthetic message entry in the virtualized list. More complex, less natural.

With Option A:
- In `MessageList` footer, check `useQuestionStore.getPendingForThread(threadId)`.
- If a pending question exists, render `AskUserQuestionBlock` with the parsed question data.
- The block auto-focuses on mount (already implemented), capturing keyboard input.
- When the user submits, call the answer handler (Phase 6).

The existing `AskUserQuestionBlock` in `AssistantMessage` continues to work for the *answered* state — once the question is answered and the turn completes, the tool_use block in the message history shows the answered/collapsed state as it does today.

---

## Phase 6 — Answer submission back through hub socket

### 6a. Question service (`src/entities/questions/service.ts`, new)

```ts
async function respond(threadId: string, requestId: string, answer: string): Promise<void> {
  // 1. Optimistically mark answered in store
  useQuestionStore.getState().markAnswered(requestId, answer);

  // 2. Send response to agent via socket
  await sendToAgent(threadId, {
    type: "question_response",
    payload: { requestId, answer },
  });
}
```

Uses the same `sendToAgent` helper that permission responses use.

### 6b. Wire into AskUserQuestionBlock

The `onSubmit` callback from the question block calls `questionService.respond(threadId, requestId, formattedAnswer)`.

The formatted answer is the string representation of the user's selection (e.g., `"Option A: Description"` or for multi-select, a comma-separated list). This matches what the SDK currently expects as a tool_result for AskUserQuestion.

---

## Data flow summary

```
Agent SDK about to call AskUserQuestion
  ↓
PreToolUse hook fires (matcher: "AskUserQuestion")
  ↓
QuestionGate.waitForAnswer() emits QUESTION_REQUEST event, blocks on promise
  ↓
HubClient sends event over Unix socket → Tauri hub → frontend
  ↓
routeAgentEvent → eventBus.emit(QUESTION_REQUEST) → question store
  ↓
MessageList footer renders AskUserQuestionBlock (pending, interactive)
  ↓
User selects option(s), presses Enter
  ↓
questionService.respond() → sendToAgent("question_response", { requestId, answer })
  ↓
Tauri hub → Unix socket → agent HubClient message handler
  ↓
questionGate.resolve(requestId, answer) — promise resolves
  ↓
Hook returns allow + answer → SDK receives tool result → agent continues
```

## Open questions / risks

1. **SDK tool result injection from hooks**: Can a PreToolUse hook override the tool's return value? If not, we need an alternative:
   - Let the tool execute but have it read the answer from a shared store (the gate populates before resolving).
   - Or use a custom `canUseTool` implementation instead of hooks.
   - Investigation needed during Phase 2 implementation.

2. **Multiple questions in one tool call**: The `AskUserQuestion` tool can contain multiple questions in the `questions` array. The current UI only renders the first question. For the initial implementation, we can keep this behavior (one question per tool call is the common case). Multi-question support can be added later.

3. **Streaming state**: While the hook blocks, the agent appears "working" to the user. We may want to update the streaming store to show a different state (e.g., "waiting for answer") so the UI doesn't show a spinner. This is a polish item.
