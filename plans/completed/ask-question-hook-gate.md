# Ask Question Hook Gate

Gate the `AskUserQuestion` tool at the PreToolUse hook level — same deferred-promise pattern used for permissions — so the agent blocks until the user answers in the UI.

## Background

Today, `AskUserQuestion` flows through the SDK's normal tool execution path. The agent emits the tool_use, the SDK calls the tool, and the result is returned inline. The UI renders an `AskUserQuestionBlock` component inside the message list, but the response path (`onToolResponse` → `submitToolResult`) is **not wired up** — so answers never reach the agent.

The permission system solves exactly this class of problem: intercept a tool at `PreToolUse`, emit an event to the frontend, block the hook with a deferred promise, and resolve it when the frontend responds over the hub socket. We replicate that pattern here.

### Why a two-phase hook + canUseTool approach?

The SDK's **official mechanism** for handling `AskUserQuestion` answers is the `canUseTool` callback ([docs](https://platform.claude.com/docs/en/agent-sdk/user-input#handle-clarifying-questions)). The callback returns `{ behavior: "allow", updatedInput: { ...input, answers } }` and the SDK executes the tool with pre-populated answers, producing a proper `AskUserQuestionOutput` — no `is_error`, no hacks.

**The problem**: `canUseTool` has a hard 60-second timeout and we're in `bypassPermissions` mode (which skips `canUseTool` entirely). Users may take minutes to answer.

**The solution**: Two-phase approach that combines hooks (for the long async wait) with `canUseTool` (for the official answer delivery):

1. **PreToolUse hook** (custom timeout up to 3600s): Intercepts `AskUserQuestion`, emits event to frontend, blocks on deferred promise. When answer arrives, stashes it in a shared `Map<toolUseId, answers>` and returns `permissionDecision: "ask"` — which forces the SDK to fall through to `canUseTool`.
2. **`canUseTool` callback** (fires instantly since answers are pre-stashed): Checks the stash, finds answers, returns `{ behavior: "allow", updatedInput: { ...input, answers } }`.

This gives us arbitrary timeout via hooks AND the official `updatedInput.answers` path via `canUseTool`. The agent receives a proper `AskUserQuestionOutput` with no `is_error` flag.

**Key insight from Phase 0 spike**: `updatedInput.answers` via PreToolUse hooks alone does NOT work — the SDK's AskUserQuestion tool ignores pre-populated answers when the hook returns `allow`. But the `canUseTool` callback is the **documented** integration point for this exact use case, and `updatedInput` via `canUseTool` IS the supported path. Phase 0.5 spike will validate this two-phase approach.

## Phases

- [x] Phase 0: Validate `updatedInput.answers` via PreToolUse hook alone (spike — INVALIDATED)
- [x] Phase 0.5: Validate two-phase hook + canUseTool approach (spike — VALIDATED)
- [x] Add `QuestionGate` class (agent-side deferred promise bridge)
- [x] Register PreToolUse hook + canUseTool for `AskUserQuestion` in shared.ts
- [x] Add hub event types and socket message handling
- [x] Wire frontend event routing and store
- [x] Render question inline in message stream via existing `AskUserQuestionBlock`
- [x] Connect answer submission back through hub socket

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Phase 0 — Validate `updatedInput.answers` (experimental spike) ✅ COMPLETED

**Files**:
- Runner: `agents/src/experimental/ask-question-updatedinput-runner.ts`
- Test: `agents/src/experimental/__tests__/ask-question-updatedinput.integration.test.ts`

### Results (2025-02-25, live API tests, both passing)

**Approach 1: `allow` + `updatedInput.answers` — DOES NOT WORK**

The `answers` field exists on `AskUserQuestionInput` (type-level) and `updatedInput` exists on `PreToolUseHookSpecificOutput`, but the SDK's internal `AskUserQuestion` tool implementation **does not check for pre-populated answers at runtime**. When the hook returns `allow` + `updatedInput` with answers:

1. The SDK applies `updatedInput` (confirmed: `answers` appears in the tool input in `permission_denials`)
2. But the tool still tries to prompt via stdin → fails in non-TTY environment
3. Returns `is_error: true` with content `"Answer questions?"` (a generic fallback error)
4. The tool appears in the result's `permission_denials` array — the SDK treats this as a denied permission internally
5. `PostToolUse` never fires — the tool never actually executes
6. Agent gets an error result with no answer data

**Approach 2: `deny` + `permissionDecisionReason` — WORKS PERFECTLY**

When the hook returns `deny` with the answers formatted in `permissionDecisionReason`:

1. The SDK sends the denial reason as a `tool_result` with `is_error: true` back to the agent
2. The agent sees the full text, e.g.: `"The user has already answered this question in the UI.\nUser answers:\n  Q: "Which color do you prefer?" → A: "Blue"\nUse these answers directly. Do not ask again."`
3. Agent correctly extracts the answer and responds with `ANSWER_RECEIVED:Blue`
4. No `permission_denials` in the result (deny is expected behavior)
5. Fast: ~6s total, no hangs
6. No `PostToolUse` fires (tool denied, as expected)

### Decision: Use deny-with-reason approach

The deny approach is clean, reliable, and gives the agent exactly the information it needs. The `is_error: true` flag is cosmetic — the agent still processes the content correctly. The formatted denial reason is a structured way to communicate answers.

### Impact on remaining phases

- **Phase 1 (QuestionGate)**: Response type stays `{ answers: Record<string, string> }` — no change needed. The formatting into denial reason text happens in the hook, not the gate.
- **Phase 2 (Hook)**: Must use `deny` + `permissionDecisionReason` instead of `allow` + `updatedInput`. Updated below.
- **Phases 3-6**: No changes — the frontend still collects answers as `Record<string, string>` and sends them back. The formatting is purely in the hook's return value.

---

## Phase 0.5 — Validate two-phase hook + canUseTool approach (spike) ✅ COMPLETED

**Files**:
- Runner: `agents/src/experimental/ask-question-canuse-runner.ts`
- Test: `agents/src/experimental/__tests__/ask-question-canuse.integration.test.ts`

### Results (2025-02-25, live API tests, all 3 passing)

Tested three approaches:
1. **two_phase**: hook returns `ask` → `canUseTool` delivers answers via `updatedInput`
2. **canuse_only**: no hooks, `canUseTool` alone in bypass mode
3. **deny_fallback**: hook returns `deny` with answers in reason text (re-validated)

### Answers to key questions

**Q1: Does `canUseTool` fire in `bypassPermissions` mode?**
**YES.** `canUseTool` fires even with `bypassPermissions: true`. The `canuse_only` approach (no hooks at all) confirmed this — `canUseTool` was invoked for `AskUserQuestion` and successfully delivered answers. **Our previous assumption that bypass mode skips canUseTool was wrong.**

**Q2: Does `permissionDecision: "ask"` from a hook override bypass mode?**
**YES.** The `two_phase` approach confirmed this. The hook returned `permissionDecision: "ask"`, and `canUseTool` fired immediately after. The SDK's evaluation chain correctly falls through from hook → canUseTool regardless of bypass mode.

**Q3: Does `updatedInput.answers` via `canUseTool` work?**
**YES — perfectly.** The SDK executes the AskUserQuestion tool with pre-populated answers and produces a proper `AskUserQuestionOutput`:
- Tool result text: `"User has answered your questions: \"Which color do you prefer?\"=\"Blue\". You can now continue with the user's answers in mind."`
- `is_error: false` (clean, no error flag)
- `permission_denials: []` (no false positives)
- `PostToolUse` fires (tool actually executed, unlike deny approach)
- Agent correctly responded: `"ANSWER_RECEIVED:Blue"`

**Q4: Does `toolUseID` match between hook and `canUseTool`?**
**YES — exact match.** Hook received `toolUseId: "toolu_01AR7U6UXK7m9hXfEziFYmpS"`, canUseTool received `toolUseID: "toolu_01AR7U6UXK7m9hXfEziFYmpS"`. The shared stash lookup works correctly.

### Comparison of all three approaches

| Property | two_phase (hook+canUseTool) | canuse_only | deny_fallback |
|---|---|---|---|
| `is_error` | `false` ✅ | `false` ✅ | `true` ⚠️ |
| `PostToolUse` fires | Yes ✅ | No ❌ (no hooks) | No ❌ |
| `permission_denials` | `[]` ✅ | `[]` ✅ | `[]` ✅ |
| Proper `AskUserQuestionOutput` | Yes ✅ | Yes ✅ | No (text in reason) |
| Custom timeout support | Yes (hook timeout) ✅ | No (60s hard limit) ❌ | Yes (hook timeout) ✅ |
| Agent gets answer | Structured ✅ | Structured ✅ | Parses from text ⚠️ |

### Decision: Use two-phase approach (hook + canUseTool)

The `two_phase` approach is the clear winner:
- **Clean output**: `is_error: false`, proper `AskUserQuestionOutput`, `PostToolUse` fires
- **Custom timeout**: Hook's `timeout: 3600` gives us 1-hour wait for user answers
- **Official SDK path**: `canUseTool` with `updatedInput.answers` is the documented integration
- **Stash pattern works**: `Map<toolUseId, answers>` shared between hook and canUseTool closures

The `canuse_only` approach is simpler but has a 60s hard timeout — unsuitable for real user interaction. The `deny_fallback` works but produces `is_error: true` and requires the agent to parse answers from text.

### Impact on remaining phases

- **Phase 2**: Validated as designed. Hook stashes answers, returns `ask`. canUseTool picks up stash, returns `{ behavior: "allow", updatedInput }`. No `bypassPermissions` workarounds needed.
- **Existing hook in shared.ts (lines 487-535)**: Currently returns `permissionDecision: "allow"` + `updatedInput` — must be changed to return `permissionDecision: "ask"` and stash answers for canUseTool. Also need to add the `canUseTool` callback to the `query()` options.
- **No changes needed** to QuestionGate, hub events, frontend store, or UI phases.

### Correction to previous assumptions

Previous memory noted "`canUseTool` has hard 60s timeout — not configurable, fails open" and implied it doesn't fire in bypass mode. The timeout note is still true, but **`canUseTool` DOES fire in `bypassPermissions` mode** — the evaluation order always includes canUseTool when a callback is registered.

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
      toolUseId: string;
      toolInput: Record<string, unknown>;
      signal: AbortSignal;
    },
    emitEvent: (name: string, payload: Record<string, unknown>) => void,
  ): Promise<{ answers: Record<string, string> } | "timeout"> {
    emitEvent("question:request", {
      requestId,
      threadId: context.threadId,
      toolUseId: context.toolUseId,
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

## Phase 2 — PreToolUse hook + canUseTool for `AskUserQuestion`

**Files**: `agents/src/runners/shared.ts`, `agents/src/runner.ts`

**Approach** (pending Phase 0.5 spike validation): Two-phase pattern — hook does the long async wait, `canUseTool` delivers answers via the official SDK path.

### 2a. Shared answer stash

A simple `Map<string, Record<string, string>>` keyed by `toolUseId`, shared between the hook closure and `canUseTool` closure:

```ts
const answerStash = new Map<string, Record<string, string>>();
```

### 2b. PreToolUse hook (long async wait)

```ts
{
  matcher: "AskUserQuestion",
  timeout: 3600, // 1 hour — user may take time to answer
  hooks: [
    async (hookInput, toolUseId, { signal }) => {
      const input = hookInput as PreToolUseHookInput;
      const toolInput = input.tool_input as Record<string, unknown>;
      const requestId = crypto.randomUUID();

      const response = await questionGate.waitForAnswer(requestId, {
        threadId: context.threadId,
        toolUseId,
        toolInput,
        signal,
      }, emitEvent);

      if (response === "timeout" || signal.aborted) {
        return {
          hookSpecificOutput: {
            hookEventName: "PreToolUse" as const,
            permissionDecision: "deny" as const,
            permissionDecisionReason: "Question timed out — the user did not respond.",
          },
        };
      }

      // Stash answers for canUseTool to pick up
      answerStash.set(toolUseId, response.answers);

      // Return "ask" to force fall-through to canUseTool
      return {
        hookSpecificOutput: {
          hookEventName: "PreToolUse" as const,
          permissionDecision: "ask" as const,
        },
      };
    },
  ],
}
```

### 2c. canUseTool callback

```ts
canUseTool: async (toolName, input, options) => {
  if (toolName === "AskUserQuestion") {
    const answers = answerStash.get(options.toolUseID);
    if (answers) {
      answerStash.delete(options.toolUseID);
      return {
        behavior: "allow" as const,
        updatedInput: { ...input, answers },
      };
    }
    // No stashed answers — shouldn't happen, but deny gracefully
    return { behavior: "deny" as const, message: "No answers available" };
  }
  // For all other tools: auto-allow (replicates bypassPermissions behavior)
  return { behavior: "allow" as const, updatedInput: input };
},
```

### 2d. Hook chaining note

The SDK runs ALL matching hooks. The permission hook uses `matcher: undefined` (matches all tools) and will also fire for `AskUserQuestion`. Add an early return in the permission hook when `tool_name === "AskUserQuestion"` to avoid double-gating.

### Fallback: deny-with-reason approach

If the Phase 0.5 spike shows that `canUseTool` doesn't fire (e.g., bypass mode prevents it, or `ask` doesn't force fall-through), use the deny-with-reason approach from Phase 0 — already validated and working. The hook formats answers into `permissionDecisionReason` and the agent reads them from the `is_error: true` tool result.

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
  toolUseId: string;              // matches tool_use block's id for inline rendering
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
  toolUseId: string;           // matches tool_use block's id — same pattern as permissions
  toolInput: Record<string, unknown>;
  timestamp: number;
  status: "pending" | "answered";
  answers?: Record<string, string>;
}

interface QuestionStore {
  requests: Record<string, QuestionRequest>;
  addRequest(req: QuestionRequest): void;
  markAnswered(requestId: string, answers: Record<string, string>): void;
  getRequestByToolUseId(toolUseId: string): QuestionRequest | undefined;
  _applyClearThread(threadId: string): void;
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

## Phase 5 — Render question inline in message stream

The existing `AskUserQuestionBlock` component already renders the full interactive question UI (options, keyboard navigation, multi-select). Currently it's embedded inside `AssistantMessage` as part of the tool_use block rendering.

**Goal**: Render the interactive question block **inline in the message stream** — in the position where the tool_use block appears. When a `QUESTION_REQUEST` arrives, the tool_use block for `AskUserQuestion` in `AssistantMessage` becomes the live interactive widget. This is the same UX pattern we will use for permissions (both should be inline, not footer-based).

### Approach — Inline in tool_use block position

The `AskUserQuestionBlock` is already rendered inside `AssistantMessage` at the tool_use position. The change is:

1. Wire the question store into the existing `AskUserQuestionBlock` rendering in `AssistantMessage`.
2. When a pending question exists (from the `QUESTION_REQUEST` event) that matches this tool_use block, render the **interactive** version (with clickable options, keyboard nav).
3. When answered, transition to the **answered/collapsed** state showing the selected answer.
4. The block auto-focuses on mount (already implemented), capturing keyboard input.
5. When the user submits, call the answer handler (Phase 6).

**Matching store to tool_use block — via `toolUseId`**: Follow the same pattern as permissions. The `QUESTION_REQUEST` event includes the `toolUseId` (passed from the PreToolUse hook's `toolUseId` parameter). The question store has `getRequestByToolUseId(id)`. In `ToolUseBlock`, query the question store by the block's `id` — if a pending question exists, render the interactive `AskUserQuestionBlock`. This is the exact pattern used by `InlinePermissionApproval` in `tool-use-block.tsx` (lines 100-113).

**Live vs. historical**: When a tool_use block for AskUserQuestion has a matching pending question in the store → render interactive. When there's no matching store entry (historical, already answered) → render the answered/collapsed state from the tool result in the message history.

This keeps questions and permissions consistent — both render inline in the message stream at their tool_use position, both use `toolUseId` matching. Future work: migrate permissions to this same pattern.

### "Other" (freeform text) — per-question inline text input

The SDK provides an automatic "Other" option that lets users type a custom response. In the CLI this is a text prompt. In our UI, each question in the carousel gets its own **always-visible inline text input** below the predefined options:

- Below each question's options, render a compact single-line text input (e.g., placeholder "Type a custom answer...").
- Always visible (not behind a reveal button) — minimal visual weight but immediately discoverable.
- Typing into the input auto-focuses it (no need to click first).
- The user can either click a predefined option (which auto-submits for single-select) OR type freeform text in this input and press Enter.
- Pressing Enter in the "Other" input submits that freeform text as the answer and auto-advances (or auto-submits if last question).
- The freeform text becomes the answer value (e.g., `{ "Which auth method?": "the user typed this" }`).
- This keeps the interaction self-contained within the question block.
- Each question in the carousel has its own independent "Other" input.

### Persistence — lean on thread state

Thread messages (including full tool_use blocks with `toolInput`) are already persisted to disk in `~/.anvil/threads/{threadId}/state.json`. The question data (questions array, options, etc.) is stored as part of the `messages` array. **No separate question persistence needed.**

The question store is **memory-only** (Zustand, no disk backing):
- Tracks only the currently-pending question's `requestId`, `toolUseId`, `threadId`, and `status`.
- On app restart, the agent process also restarts and the pending hook promise dies, so the question is stale anyway — memory-only is correct.
- When the user navigates away and back, the store entry persists in memory. The tool_use block re-renders and finds the pending entry via `getRequestByToolUseId`.
- Cleanup: clear store entries on `AGENT_COMPLETED` / `AGENT_ERROR` events (same pattern as permissions).

### Multi-question carousel

Build a carousel for 1-4 questions with dot navigation:

- `parseAskUserQuestionInput` updated to return `NormalizedQuestion[]` (array) instead of single
- Carousel wrapper component around `AskUserQuestionBlock`

**Single question (1 of 1)**: Hide all carousel chrome — no dots, no left/right arrows. Render the `AskUserQuestionBlock` exactly as today, just with the new "Other" inline text input added below the options. This is the most common case and should feel zero-overhead.

**Multiple questions (2-4)**:
- Left/right arrow keys cycle between questions (existing j/k + up/down stays for option selection within a question)
- Dot indicators below the question block show position and answered state: `● ○ ○ ○` (filled = answered, hollow = unanswered)
- Each question tracks its own selected answer independently
- **Auto-advance on answer**: For single-select, clicking an option records the answer and auto-advances to the next unanswered question. For multi-select, pressing Enter confirms the selection and advances.
- **Auto-submit on last answer**: When the user answers the last unanswered question, all answers are automatically sent to the agent. No explicit "Submit all" button.
- **Keyboard hint adapts**: On the last unanswered question, show "Enter to submit" instead of "Enter to continue".
- **Navigating back**: The user can navigate back to previously-answered questions. Answers are editable — clicking a different option updates that answer. The answered dot reverts to unanswered if the selection changes. Re-answering only triggers submission if all questions are now answered.

**Visual style**: Keep current accent blue (`border-accent-500/50 bg-accent-950/20`) for pending questions. Answered questions shown with selected option highlighted and `CheckCircle`, options still clickable to change.

- Answer format: `Record<string, string>` mapping question text to selected option label(s). Multi-select answers are comma-separated labels per SDK spec.
- Build a lightweight Tailwind-based carousel (no existing pagination/carousel components in the codebase)
- No timeout indicator in the UI — 1-hour timeout is generous enough for v1.

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

The `answers` map flows back to the agent's PreToolUse hook, which stashes them and returns `ask`. The SDK falls through to `canUseTool`, which delivers answers via `{ behavior: "allow", updatedInput: { ...input, answers } }`. The SDK executes the tool with pre-populated answers and the agent receives a proper `AskUserQuestionOutput`. (Fallback: deny-with-reason if canUseTool path doesn't work — see Phase 0.5.)

---

## Data flow summary

### Primary path (two-phase hook + canUseTool — VALIDATED ✅)

```
Agent SDK about to call AskUserQuestion
  ↓
PreToolUse hook fires (matcher: "AskUserQuestion")
  (permission hook skips AskUserQuestion via early return — no double-gating)
  ↓
QuestionGate.waitForAnswer() emits QUESTION_REQUEST event, blocks on promise
  ↓
HubClient sends event over Unix socket → Tauri hub → frontend
  ↓
routeAgentEvent → eventBus.emit(QUESTION_REQUEST) → question store
  ↓
AskUserQuestionBlock renders inline in message stream (at tool_use position)
  question carousel with all questions, dot navigation for multi-question
  ↓
User answers via option click OR types freeform text in per-question inline "Other" input
  ↓
questionService.respond() → sendToAgent("question_response", { requestId, answers })
  answers = { "Which auth?": "JWT", "Which lib?": "jsonwebtoken" }
  ↓
Tauri hub → Unix socket → agent HubClient message handler
  ↓
questionGate.resolve(requestId, answers) — promise resolves
  ↓
Hook stashes answers in Map<toolUseId, answers>, returns permissionDecision: "ask"
  ↓
SDK evaluation continues: "ask" forces fall-through to canUseTool callback
  ↓
canUseTool checks stash, finds answers, returns:
  { behavior: "allow", updatedInput: { ...input, answers } }
  ↓
SDK executes AskUserQuestion with pre-populated answers
  ↓
Agent receives proper AskUserQuestionOutput: { questions: [...], answers: {...} }
```

### Fallback path (deny-with-reason — validated but NOT needed)

Phase 0.5 confirmed `canUseTool` fires in bypass mode, so the primary path above is the production approach. The deny-with-reason fallback remains available but is not needed:

```
... (same as above through questionGate.resolve) ...
  ↓
Hook formats answers as denial reason text, returns permissionDecision: "deny"
  ↓
SDK sends denial reason as tool_result (is_error: true) to the agent
  ↓
Agent reads formatted answers from denial reason and continues
```

## Research findings

> Sources: [SDK TypeScript Reference](https://platform.claude.com/docs/en/agent-sdk/typescript), [Handle approvals and user input (official canUseTool docs)](https://platform.claude.com/docs/en/agent-sdk/user-input), [Configure permissions](https://platform.claude.com/docs/en/agent-sdk/permissions), [Hooks Reference](https://platform.claude.com/docs/en/agent-sdk/hooks), [Issue #12031 — PreToolUse strips AskUserQuestion results](https://github.com/anthropics/claude-code/issues/12031), [Issue #13439 — Empty responses with hooks](https://github.com/anthropics/claude-code/issues/13439), [Issue #12605 — AskUserQuestion hook support](https://github.com/anthropics/claude-code/issues/12605)

### 1. SDK tool result injection — VALIDATED: two-phase hook + canUseTool ✅

**Phase 0 spike found**: `updatedInput.answers` via PreToolUse hooks alone does NOT work. The SDK's AskUserQuestion tool ignores pre-populated answers when the hook returns `allow` — it always tries stdin.

**Phase 0.5 spike validated**: The two-phase approach works perfectly:
1. PreToolUse hook handles the long async wait (with custom timeout), stashes answers
2. Hook returns `permissionDecision: "ask"` to force fall-through to `canUseTool`
3. `canUseTool` picks up stashed answers, returns `{ behavior: "allow", updatedInput: { ...input, answers } }`
4. SDK executes AskUserQuestion with answers → proper `AskUserQuestionOutput` with `is_error: false`

**Key discovery**: `canUseTool` fires even in `bypassPermissions` mode — our previous assumption was wrong. Both the standalone `canUseTool` path and the hook→`ask`→`canUseTool` path work.

### 2. Updated Phase 2 — two-phase hook + canUseTool (VALIDATED ✅)

See Phase 2 section above for the implementation. The `QuestionGate` resolves with `Record<string, string>` (answers map). The hook stashes answers and returns `ask`, `canUseTool` delivers them via the official SDK path. This is now the confirmed production approach.

### 3. Multiple questions — carousel (decided, see Phase 5)

Building the carousel for 1-4 questions as part of Phase 5. See that section for full spec.

### 4. Streaming state — deferred (not important for now)

### 5. Hook chaining — ALL matching hooks fire (confirmed)

The SDK runs all `HookCallbackMatcher[]` entries in the `PreToolUse` array. When a hook with `matcher: "AskUserQuestion"` fires and returns `permissionDecision: "allow"`, the subsequent hook with `matcher: undefined` (permission hook) **still fires**. There is no short-circuit on allow.

**Decision**: The permission hook must explicitly skip `AskUserQuestion` with an early return when `tool_name === "AskUserQuestion"`. The question hook is placed first in the array and handles the full lifecycle.

### 6. Answer key format — `{ [k: string]: string }` keyed by question text (confirmed)

From `sdk-tools.d.ts:1537-1542`:
```ts
/** User answers collected by the permission component */
answers?: { [k: string]: string };
```

The key is the full question text string (the `question` field from each question object). The value is the selected option label. For multi-select, values are comma-separated labels per SDK spec.

**Decision**: Use question text as key — matches SDK's documented format exactly. No index-based or header-based keying.

### 7. `toolUseId` matching — VERIFIED end-to-end

The `toolUseId` from the PreToolUse hook's second argument IS the same `id` as the `tool_use` content block in the message stream. Verified through the existing permission flow:

1. **Hook receives it**: `shared.ts:493` — `toolUseId: string | undefined` second arg to hook callback
2. **Gate emits it**: `permission-gate.ts:44` — `{ toolUseId: context.toolUseId }` in the PERMISSION_REQUEST event
3. **Store indexes it**: `permissions/store.ts:49-51` — `getRequestByToolUseId(toolUseId)` does `Object.values().find(r => r.toolUseId === toolUseId)`
4. **ToolUseBlock matches**: `tool-use-block.tsx:101-103` — `usePermissionStore(s => s.getRequestByToolUseId(id))` where `id` is the block's id prop

This is a proven pattern. The question store can use identical matching.

### 8. `updatedInput.answers` — INVALIDATED via hooks, VALIDATED via canUseTool ✅

**Via PreToolUse hooks**: Does NOT work. The `updatedInput` IS applied (confirmed: `answers` field appears in `permission_denials` tool input), but the SDK's AskUserQuestion tool still tries stdin. Confirmed via Phase 0 spike.

**Via canUseTool callback**: **WORKS PERFECTLY** (confirmed via Phase 0.5 spike). The SDK executes the AskUserQuestion tool with pre-populated answers, producing a clean `AskUserQuestionOutput` with `is_error: false`. The tool result text is: `"User has answered your questions: \"Which color do you prefer?\"=\"Blue\". You can now continue with the user's answers in mind."`

**Previous concern resolved**: `canUseTool` DOES fire in `bypassPermissions` mode. The two-phase approach works exactly as designed — hook waits with custom timeout, canUseTool delivers answers instantly.
