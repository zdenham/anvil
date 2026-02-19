# Ask Question Hook Gate

Gate the `AskUserQuestion` tool at the PreToolUse hook level — same deferred-promise pattern used for permissions — so the agent blocks until the user answers in the UI.

## Background

Today, `AskUserQuestion` flows through the SDK's normal tool execution path. The agent emits the tool_use, the SDK calls the tool, and the result is returned inline. The UI renders an `AskUserQuestionBlock` component inside the message list, but the response path (`onToolResponse` → `submitToolResult`) is **not wired up** — so answers never reach the agent.

The permission system solves exactly this class of problem: intercept a tool at `PreToolUse`, emit an event to the frontend, block the hook with a deferred promise, and resolve it when the frontend responds over the hub socket. We replicate that pattern here.

### Why hook-level, not tool-result level?

- **Consistency**: Same async-wait architecture as permissions — one pattern to maintain.
- **SDK-native**: The `AskUserQuestionInput` has an official `answers` field "populated by the permission system." PreToolUse hooks can inject this via `updatedInput`, so the SDK handles the rest — no custom result injection needed.
- **Simplicity**: Hook blocks, user answers in UI, hook returns `allow` + `updatedInput` with answers pre-populated. The SDK executes the tool normally and produces the correct `AskUserQuestionOutput`.

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
      toolInput: Record<string, unknown>;
      signal: AbortSignal;
    },
    emitEvent: (name: string, payload: Record<string, unknown>) => void,
  ): Promise<{ answers: Record<string, string> } | "timeout"> {
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

  resolve(requestId: string, answers: Record<string, string>): void {
    const pending = this.pending.get(requestId);
    if (!pending) return;
    this.pending.delete(requestId);
    pending.resolve({ answers });
  }

  clear(): void {
    for (const [, p] of this.pending) p.resolve("timeout");
    this.pending.clear();
  }
}
```

Differences from `PermissionGate`:
- Response payload is `{ answers: Record<string, string> }` (question text → answer label) instead of `{ approved: boolean; reason?: string }`.
- Event name is `question:request` / `question:response` instead of `permission:*`.
- Matches SDK's `AskUserQuestionInput.answers` format exactly.

---

## Phase 2 — PreToolUse hook for `AskUserQuestion`

**File**: `agents/src/runners/shared.ts`

Add a new entry to the `PreToolUse` hooks array, **before** the permission hook (so it fires first and the permission hook never sees AskUserQuestion). Uses `updatedInput` to inject the `answers` field — see [Research finding #1](#1-sdk-tool-result-injection--resolved-updatedinput-with-answers-field) for full rationale.

```ts
{
  matcher: "AskUserQuestion",
  timeout: 3600, // 1 hour — user may take time to answer
  hooks: [
    async (hookInput, _toolUseId, { signal }) => {
      const input = hookInput as PreToolUseHookInput;
      const toolInput = input.tool_input as Record<string, unknown>;
      const requestId = crypto.randomUUID();

      const response = await questionGate.waitForAnswer(requestId, {
        threadId: context.threadId,
        toolInput,
        signal,
      }, emitEvent);

      if (response === "timeout" || signal.aborted) {
        return {
          hookSpecificOutput: {
            hookEventName: "PreToolUse" as const,
            permissionDecision: "deny" as const,
            permissionDecisionReason: "Question timed out",
          },
        };
      }

      // Inject answers into tool input via updatedInput — SDK's official mechanism
      // AskUserQuestionInput.answers: Record<string, string> maps question text → answer
      return {
        hookSpecificOutput: {
          hookEventName: "PreToolUse" as const,
          permissionDecision: "allow" as const,
          updatedInput: { ...toolInput, answers: response.answers },
        },
      };
    },
  ],
}
```

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
  answers: Record<string, string>; // question text → selected label(s)
};
```

### 3b. Hub message type (`agents/src/lib/hub/types.ts`)

Add to `TauriToAgentMessage`:

```ts
| { type: "question_response"; payload: { requestId: string; answers: Record<string, string> } }
```

### 3c. Runner message handler (`agents/src/runner.ts`)

In the `hub.on("message")` handler, add a case:

```ts
case "question_response": {
  const { requestId, answers } = msg.payload;
  questionGate.resolve(requestId, answers);
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
async function respond(
  threadId: string,
  requestId: string,
  answers: Record<string, string>,
): Promise<void> {
  // 1. Optimistically mark answered in store
  useQuestionStore.getState().markAnswered(requestId, answers);

  // 2. Send response to agent via socket
  await sendToAgent(threadId, {
    type: "question_response",
    payload: { requestId, answers },
  });
}
```

Uses the same `sendToAgent` helper that permission responses use.

### 6b. Wire into question carousel

The carousel component collects answers from each question as `Record<string, string>` mapping question text to selected option label(s). Multi-select answers are comma-separated labels per the SDK spec (e.g., `"Option A, Option C"`).

When all questions are answered and user confirms, calls `questionService.respond(threadId, requestId, answersMap)`.

The `answers` map flows all the way back to the agent's PreToolUse hook, which injects it via `updatedInput.answers` into the `AskUserQuestionInput` — matching the SDK's official format exactly.

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
MessageList footer renders question carousel (all questions, dot navigation)
  ↓
User answers each question, navigates with ←/→, confirms with Enter
  ↓
questionService.respond() → sendToAgent("question_response", { requestId, answers })
  answers = { "Which auth?": "JWT", "Which lib?": "jsonwebtoken" }
  ↓
Tauri hub → Unix socket → agent HubClient message handler
  ↓
questionGate.resolve(requestId, answers) — promise resolves
  ↓
Hook returns allow + updatedInput: { ...originalInput, answers }
  ↓
SDK executes AskUserQuestion with pre-populated answers → returns AskUserQuestionOutput
  ↓
Agent sees: { questions: [...], answers: { "Which auth?": "JWT", ... } }
```

## Research findings

> Sources: [SDK TypeScript Reference](https://platform.claude.com/docs/en/agent-sdk/typescript), [Hooks Reference](https://code.claude.com/docs/en/hooks), [Issue #12031 — PreToolUse strips AskUserQuestion results](https://github.com/anthropics/claude-code/issues/12031), [Issue #13439 — Empty responses with hooks](https://github.com/anthropics/claude-code/issues/13439), [Issue #12605 — AskUserQuestion hook support](https://github.com/anthropics/claude-code/issues/12605)

### 1. SDK tool result injection — RESOLVED: `updatedInput` with `answers` field

**The SDK has a built-in `answers` field on `AskUserQuestionInput`** (from official docs):

```ts
interface AskUserQuestionInput {
  questions: Array<{ question, header, options, multiSelect }>;
  /**
   * User answers populated by the permission system.
   * Maps question text to selected option label(s).
   * Multi-select answers are comma-separated.
   */
  answers?: Record<string, string>;
}
```

And `AskUserQuestionOutput` returns:

```ts
interface AskUserQuestionOutput {
  questions: Array<{ question, header, options, multiSelect }>;
  answers: Record<string, string>; // Maps question text → answer string
}
```

**This is the official mechanism.** The SDK's `AskUserQuestion` tool checks for pre-populated `answers` in its input. When present, it uses them directly instead of prompting via stdin. The permission system (`canUseTool`) is documented as the intended integration point for this.

**Our approach**: PreToolUse hook with `updatedInput`:

1. Hook fires, blocks on deferred promise, emits event to frontend
2. User answers in UI, response flows back through hub socket
3. Gate resolves with user's answers as `Record<string, string>` (question text → selected label)
4. Hook returns:
   ```ts
   {
     hookSpecificOutput: {
       hookEventName: "PreToolUse",
       permissionDecision: "allow",
       updatedInput: {
         ...originalInput,
         answers: { "Which auth method?": "JWT tokens", "Which library?": "jsonwebtoken" }
       }
     }
   }
   ```
5. SDK executes `AskUserQuestion` with pre-populated answers → returns `AskUserQuestionOutput` with answers filled in → agent sees correct results

**This is clean, official, and avoids any hacks.** No deny-as-answer workaround, no result interception, no shared state stores. The `updatedInput` field is explicitly designed for this — the docs even say answers are "populated by the permission system."

**Known issue**: There are open bugs ([#12031](https://github.com/anthropics/claude-code/issues/12031), [#13439](https://github.com/anthropics/claude-code/issues/13439)) where PreToolUse hooks strip AskUserQuestion results or cause empty responses in the CLI. These are CLI-specific stdin/stdout conflicts. Since we're using the SDK programmatically with `updatedInput.answers` (not stdin), we should not hit these issues. If we do, fallback is to use `permissionDecision: "deny"` with the answers formatted in `permissionDecisionReason` — the agent sees the denial reason as context and extracts the answers.

### 2. Updated Phase 2 — hook returns `updatedInput` with `answers`

Replace the Phase 2 hook implementation. The `QuestionGate` now resolves with `Record<string, string>` (answers map) instead of a single string:

```ts
{
  matcher: "AskUserQuestion",
  timeout: 3600,
  hooks: [
    async (hookInput, _toolUseId, { signal }) => {
      const input = hookInput as PreToolUseHookInput;
      const toolInput = input.tool_input as Record<string, unknown>;
      const requestId = crypto.randomUUID();

      const response = await questionGate.waitForAnswer(requestId, {
        threadId: context.threadId,
        toolInput,
        signal,
      }, emitEvent);

      if (response === "timeout" || signal.aborted) {
        return {
          hookSpecificOutput: {
            hookEventName: "PreToolUse" as const,
            permissionDecision: "deny" as const,
            permissionDecisionReason: "Question timed out",
          },
        };
      }

      // Inject answers into tool input — SDK's official mechanism
      return {
        hookSpecificOutput: {
          hookEventName: "PreToolUse" as const,
          permissionDecision: "allow" as const,
          updatedInput: { ...toolInput, answers: response.answers },
        },
      };
    },
  ],
}
```

The `QuestionGate` response type changes from `{ answer: string }` to `{ answers: Record<string, string> }` to match the SDK's expected format.

### 3. Multiple questions — carousel with dot navigation

The `AskUserQuestion` tool supports 1-4 questions in the `questions` array. The current UI (`parseAskUserQuestionInput`) only extracts the first question.

**Plan**: Render all questions in a carousel with left/right navigation and dot indicators:

- `parseAskUserQuestionInput` updated to return `NormalizedQuestion[]` (array) instead of single
- Carousel wrapper component around `AskUserQuestionBlock`
- Left/right arrow keys cycle between questions (existing vim j/k + up/down stays for option selection within a question)
- Dot indicators below the question block show position: `● ○ ○ ○`
- Each question tracks its own selected answer independently
- Submit sends all answers at once when the last unanswered question is answered (or an explicit "Submit all" action)
- Answer format: `Record<string, string>` mapping question text to selected option label(s), matching SDK's `AskUserQuestionOutput.answers` format. Multi-select answers are comma-separated labels per the SDK spec.

**No existing pagination/carousel components** in the codebase — build a lightweight Tailwind-based one.

### 4. Streaming state — deferred (not important for now)
