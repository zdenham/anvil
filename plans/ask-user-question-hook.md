# AskUserQuestion Hook Implementation

## Problem

The Claude Agent SDK's `canUseTool` callback has a hard-coded 60-second timeout. When Claude calls `AskUserQuestion` to ask clarifying questions, users may need more than 60 seconds to respond. After 60 seconds, the SDK assumes denial and Claude retries with a different approach.

## Solution

Use a `PreToolUse` hook instead of `canUseTool` to intercept `AskUserQuestion`. Hooks have **configurable timeouts**, allowing us to set a longer window (e.g., 5 minutes) for user responses.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Agent Process                             │
│                                                                  │
│  ┌──────────┐    ┌─────────────────┐    ┌──────────────────┐   │
│  │   SDK    │───▶│  PreToolUse     │───▶│  Question        │   │
│  │  query() │    │  Hook           │    │  Handler         │   │
│  └──────────┘    └─────────────────┘    └──────────────────┘   │
│                           │                      │              │
│                           │ emit event           │ wait         │
│                           ▼                      ▼              │
│                    ┌─────────────────────────────────┐          │
│                    │         stdout / stdin          │          │
│                    └─────────────────────────────────┘          │
└─────────────────────────────────────────────────────────────────┘
                              │ ▲
                              │ │
                              ▼ │
┌─────────────────────────────────────────────────────────────────┐
│                      Frontend (Tauri)                            │
│                                                                  │
│  ┌──────────────────┐         ┌──────────────────────────┐     │
│  │  Event Listener  │────────▶│  AskUserQuestion UI      │     │
│  │  (stdout parser) │         │  (renders questions)     │     │
│  └──────────────────┘         └──────────────────────────┘     │
│                                          │                      │
│                                          │ user answers         │
│                                          ▼                      │
│                               ┌──────────────────────────┐     │
│                               │  Send Response (stdin)   │     │
│                               └──────────────────────────┘     │
└─────────────────────────────────────────────────────────────────┘
```

## Implementation Steps

### 1. Create Question Handler Module

**File:** `agents/src/questions/question-handler.ts`

```typescript
import { emitEvent } from "../runners/shared.js";
import { logger } from "../lib/logger.js";
import { randomUUID } from "crypto";

interface AskUserQuestionInput {
  questions: Array<{
    question: string;
    header: string;
    options: Array<{ label: string; description: string }>;
    multiSelect: boolean;
  }>;
}

interface QuestionResponse {
  answers: Record<string, string>;
}

// Map of pending question requests awaiting responses
const pendingQuestions = new Map<
  string,
  {
    resolve: (response: QuestionResponse) => void;
    questions: AskUserQuestionInput["questions"];
  }
>();

/**
 * Handle incoming question responses from stdin.
 * Called by the stdin message stream when it receives a question:response message.
 */
export function handleQuestionResponse(
  requestId: string,
  answers: Record<string, string>
): void {
  const pending = pendingQuestions.get(requestId);
  if (pending) {
    pending.resolve({ answers });
    pendingQuestions.delete(requestId);
  }
}

/**
 * Request answers to questions and wait for response.
 * Emits event and blocks until frontend responds via stdin.
 */
export async function requestAnswers(
  threadId: string,
  questions: AskUserQuestionInput["questions"],
  timeoutMs: number = 5 * 60 * 1000
): Promise<QuestionResponse> {
  const requestId = randomUUID();

  // Emit request event to frontend
  emitEvent("question:request", {
    requestId,
    threadId,
    questions,
    timestamp: Date.now(),
  });

  logger.debug(`[question] Awaiting answers (${requestId})`);

  return new Promise((resolve, reject) => {
    pendingQuestions.set(requestId, { resolve, questions });

    // Timeout after configured duration
    setTimeout(() => {
      if (pendingQuestions.has(requestId)) {
        pendingQuestions.delete(requestId);
        // Return empty answers on timeout - Claude will see no answers were provided
        resolve({ answers: {} });
      }
    }, timeoutMs);
  });
}

/**
 * Cleanup pending questions on shutdown.
 */
export function cleanupQuestionHandler(): void {
  pendingQuestions.clear();
}
```

### 2. Create PreToolUse Hook

**File:** `agents/src/hooks/ask-user-question-hook.ts`

```typescript
import type { PreToolUseHookInput } from "@anthropic-ai/claude-agent-sdk";
import { requestAnswers } from "../questions/question-handler.js";
import { logger } from "../lib/logger.js";

interface HookOutput {
  hookSpecificOutput?: {
    hookEventName: "PreToolUse";
    permissionDecision: "allow" | "deny";
    permissionDecisionReason?: string;
    updatedInput?: Record<string, unknown>;
  };
}

/**
 * PreToolUse hook that intercepts AskUserQuestion tool calls.
 * Collects answers from the user via stdin/stdout IPC and injects
 * them into the tool input before execution.
 */
export async function askUserQuestionHook(
  input: PreToolUseHookInput,
  toolUseId: string | undefined,
  context: { signal: AbortSignal }
): Promise<HookOutput> {
  const { tool_name, tool_input, session_id } = input;

  // Only handle AskUserQuestion
  if (tool_name !== "AskUserQuestion") {
    return {};
  }

  const questions = (tool_input as any).questions;
  if (!questions || !Array.isArray(questions)) {
    logger.warn("[askUserQuestionHook] Invalid questions input");
    return {};
  }

  logger.debug(`[askUserQuestionHook] Intercepted ${questions.length} questions`);

  try {
    // Request answers from frontend (waits up to 5 minutes)
    const response = await requestAnswers(session_id, questions);

    // If no answers provided (timeout or user dismissed), deny
    if (!response.answers || Object.keys(response.answers).length === 0) {
      return {
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "deny",
          permissionDecisionReason: "User did not provide answers",
        },
      };
    }

    // Allow with updated input containing answers
    return {
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "allow",
        updatedInput: {
          questions,
          answers: response.answers,
        },
      },
    };
  } catch (error) {
    logger.error(`[askUserQuestionHook] Error: ${error}`);
    return {
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: "Error collecting user answers",
      },
    };
  }
}
```

### 3. Wire Hook into Runner

**File:** `agents/src/runners/shared.ts` (modify `runAgentLoop`)

Add the hook to the hooks configuration:

```typescript
import { askUserQuestionHook } from "../hooks/ask-user-question-hook.js";

// In runAgentLoop, modify the hooks object:
const hooks = {
  PreToolUse: [
    {
      matcher: "AskUserQuestion",
      hooks: [askUserQuestionHook],
      timeout: 300, // 5 minutes
    },
  ],
  PostToolUse: [
    // ... existing PostToolUse hooks
  ],
  // ... other hooks
};
```

### 4. Handle Stdin Messages

**File:** `agents/src/runners/stdin-message-stream.ts` (modify)

Add handling for question responses:

```typescript
import { handleQuestionResponse } from "../questions/question-handler.js";

// In the message processing logic:
if (msg.type === "question:response" && msg.requestId) {
  handleQuestionResponse(msg.requestId, msg.answers);
}
```

### 5. Frontend Event Handling

**File:** `src/lib/agent-service.ts` (modify)

Add handling for `question:request` events:

```typescript
// In the event parsing logic:
case "question:request":
  eventBridge.emit("question:request", {
    threadId: event.payload.threadId,
    requestId: event.payload.requestId,
    questions: event.payload.questions,
    timestamp: event.payload.timestamp,
  });
  break;
```

### 6. Frontend UI Component

**File:** `src/components/thread/ask-user-question-block.tsx` (modify or verify)

Ensure the existing component can:
1. Listen for `question:request` events
2. Render the questions with options
3. Send `question:response` back via stdin when user answers

Response format to send back:
```typescript
{
  type: "question:response",
  requestId: string,
  answers: Record<string, string>  // question text -> selected label(s)
}
```

### 7. Type Definitions

**File:** `core/types/ask-user-question.ts` (create or extend)

```typescript
export interface QuestionOption {
  label: string;
  description: string;
}

export interface Question {
  question: string;
  header: string;
  options: QuestionOption[];
  multiSelect: boolean;
}

export interface QuestionRequest {
  requestId: string;
  threadId: string;
  questions: Question[];
  timestamp: number;
}

export interface QuestionResponse {
  type: "question:response";
  requestId: string;
  answers: Record<string, string>;
}
```

## Configuration

Add configurable timeout to agent config:

```typescript
// In agent-types or runner config
interface AgentConfig {
  // ... existing fields
  questionTimeoutMs?: number;  // Default: 300000 (5 minutes)
}
```

## Testing

### Unit Tests

1. `question-handler.test.ts`
   - Test requestAnswers emits correct event
   - Test handleQuestionResponse resolves pending promise
   - Test timeout returns empty answers
   - Test cleanup clears pending questions

2. `ask-user-question-hook.test.ts`
   - Test hook only intercepts AskUserQuestion tool
   - Test hook returns allow with answers when provided
   - Test hook returns deny when no answers provided
   - Test hook handles errors gracefully

### Integration Tests

1. End-to-end flow test
   - Agent calls AskUserQuestion
   - Frontend receives event
   - Frontend sends response
   - Agent continues with answers

2. Timeout test
   - Agent calls AskUserQuestion
   - No response sent
   - After timeout, agent receives denial

## Migration Notes

- This approach is additive - doesn't break existing code
- Can run alongside current permission system
- Eventually can unify permissions and questions under same hook pattern

## Future Work

- Unify permission requests to use same hook pattern (see `smart-permission-system.md`)
- Add support for custom question types beyond multiple choice
- Add "typing indicator" to show user is actively responding
