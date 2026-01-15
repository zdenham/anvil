# Stream 2C: Mock Query Types

**Depends on:** Stream 1 (schema)
**Blocks:** Stream 3B (mock emission)
**Parallel with:** Streams 2A, 2B

## Goal

Replace local mock type definitions with SDK types for type safety.

## Files to Modify

1. `agents/src/testing/mock-claude-client.ts`
2. `agents/src/testing/mock-query.ts` (type imports only)

## Implementation

### 1. Update mock-claude-client.ts

Replace local type definitions with SDK imports:

```typescript
// BEFORE: Local type definitions
type MockSDKMessage = {
  type: "assistant" | "user" | "result";
  // ... simplified fields
};

// AFTER: SDK type imports
import type {
  SDKAssistantMessage,
  SDKUserMessage,
  SDKResultMessage,
  SDKMessage,
} from "@anthropic-ai/claude-agent-sdk";
```

Remove all local `Mock*` type definitions and use SDK types directly.

### 2. Update mock-query.ts imports

Add SDK type imports at top of file:

```typescript
import type {
  SDKAssistantMessage,
  SDKUserMessage,
  SDKResultMessage,
  SDKMessage,
} from "@anthropic-ai/claude-agent-sdk";
import type { MessageParam, ToolResultBlockParam } from "@anthropic-ai/sdk/resources/messages";
```

## Required SDK Message Fields

When constructing mock messages, ensure all required fields are present:

### SDKAssistantMessage
```typescript
{
  type: "assistant",
  message: { role: "assistant", content: [...] },
  parent_tool_use_id: null,
  uuid: string,
  session_id: string,
}
```

### SDKUserMessage
```typescript
{
  type: "user",
  message: MessageParam,
  parent_tool_use_id: string | null,
  tool_use_result?: unknown,
  session_id: string,
}
```

### SDKResultMessage
```typescript
{
  type: "result",
  subtype: "success" | "error_during_execution" | ...,
  is_error: boolean,
  uuid: string,
  session_id: string,
  // Additional fields based on subtype
}
```

## Verification

```bash
pnpm typecheck
```

TypeScript will catch any missing required fields.
