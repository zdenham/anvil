# 02 - Agent Stdin Message Stream

## Dependencies

None for development. Needs 01 complete to test end-to-end.

## Parallel With

01-prereq-api-key, 03-frontend-queuing

## Scope

Implement agent-side stdin listening that:
1. Validates incoming JSON messages with Zod
2. Creates an async generator for SDK consumption
3. Injects queued messages into the conversation

## Interface Contract (Input)

Frontend sends JSON lines to stdin:

```typescript
{
  type: 'queued_message',
  id: string,        // UUID
  content: string,   // Min 1 char
  timestamp: number  // Unix ms
}
```

## Important: Simple Agent Only

This implementation applies **only to the simple agent** (SimpleRunnerStrategy). Task-based agents (research, execution, merge) are not currently planned to support queued messages because:

1. They operate in orchestrated worktrees where user interaction is less common
2. The primary use case for queued messages is interactive simple tasks

The changes to `shared.ts` must be conditional or a separate code path for simple agents.

## Files to Create

### 1. `agents/src/runners/stdin-message-schema.ts`

Zod schema for stdin validation:

```typescript
import { z } from 'zod';

export const StdinMessageSchema = z.object({
  type: z.literal('queued_message'),
  id: z.string().uuid(),
  content: z.string().min(1),
  timestamp: z.number(),
});

export type StdinMessage = z.infer<typeof StdinMessageSchema>;

export function parseStdinMessage(line: string): StdinMessage | null {
  try {
    const parsed = JSON.parse(line);
    const result = StdinMessageSchema.safeParse(parsed);
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}
```

### 2. `agents/src/runners/stdin-message-stream.ts`

Full implementation from main plan (lines 245-431). Key points:

- `StdinMessageStream` class with readline interface
- Pre-generates session ID via `crypto.randomUUID()`
- `createStream(initialPrompt)` returns `AsyncGenerator<SDKUserMessage>`
- Yields initial prompt first, then listens for queued messages
- `MAX_QUEUE_SIZE = 50` to prevent memory issues
- Proper cleanup on close/abort

```typescript
import * as readline from 'readline';
import { randomUUID } from 'crypto';
import type { SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import { parseStdinMessage, type StdinMessage } from './stdin-message-schema.js';
import { logger } from '../lib/logger.js';

const MAX_QUEUE_SIZE = 50;

export class StdinMessageStream {
  private rl: readline.Interface | null = null;
  private messageQueue: StdinMessage[] = [];
  private resolveNext: ((msg: StdinMessage | null) => void) | null = null;
  private closed = false;
  private sessionId: string;

  constructor(private abortSignal?: AbortSignal) {
    this.sessionId = randomUUID();
  }

  setSessionId(sessionId: string): void {
    this.sessionId = sessionId;
  }

  getSessionId(): string {
    return this.sessionId;
  }

  async *createStream(initialPrompt: string): AsyncGenerator<SDKUserMessage> {
    // Initial prompt is marked synthetic because runAgentLoop already calls
    // appendUserMessage for it. Only queued messages should be non-synthetic.
    yield this.formatUserMessage(initialPrompt, true);
    this.startListening();

    if (this.abortSignal) {
      this.abortSignal.addEventListener('abort', () => this.close());
    }

    try {
      while (!this.closed) {
        const msg = await this.waitForMessage();
        if (msg === null) break;
        logger.info(`[StdinMessageStream] Processing queued message: ${msg.id}`);
        // Queued messages are non-synthetic so MessageHandler will append them
        yield this.formatUserMessage(msg.content, false);
      }
    } finally {
      this.close();
    }
  }

  private formatUserMessage(content: string, isSynthetic: boolean): SDKUserMessage {
    return {
      type: 'user',
      message: { role: 'user', content },
      parent_tool_use_id: null,
      session_id: this.sessionId,
      isSynthetic,
    };
  }

  private startListening(): void {
    if (this.rl) return;

    this.rl = readline.createInterface({
      input: process.stdin,
      terminal: false,
    });

    this.rl.on('line', (line) => {
      if (this.closed) return;
      const msg = parseStdinMessage(line);
      if (!msg) return;

      if (this.messageQueue.length >= MAX_QUEUE_SIZE) {
        logger.warn(`[StdinMessageStream] Queue full, dropping message: ${msg.id}`);
        return;
      }

      if (this.resolveNext) {
        const resolve = this.resolveNext;
        this.resolveNext = null;
        resolve(msg);
      } else {
        this.messageQueue.push(msg);
      }
    });

    this.rl.on('close', () => this.close());
    this.rl.on('error', (err) => {
      logger.error('[StdinMessageStream] Readline error:', err);
      this.close();
    });
  }

  private waitForMessage(): Promise<StdinMessage | null> {
    if (this.closed) return Promise.resolve(null);
    if (this.messageQueue.length > 0) {
      return Promise.resolve(this.messageQueue.shift()!);
    }
    return new Promise((resolve) => {
      this.resolveNext = resolve;
    });
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    logger.debug('[StdinMessageStream] Closing');

    if (this.rl) {
      this.rl.close();
      this.rl = null;
    }

    if (this.resolveNext) {
      this.resolveNext(null);
      this.resolveNext = null;
    }

    this.messageQueue = [];
  }
}

export function createStdinMessageStream(
  initialPrompt: string,
  abortSignal?: AbortSignal
): { stream: AsyncGenerator<SDKUserMessage>; controller: StdinMessageStream } {
  const controller = new StdinMessageStream(abortSignal);
  const stream = controller.createStream(initialPrompt);
  return { stream, controller };
}
```

## Files to Modify

### 3. `agents/src/runners/shared.ts`

Update `runAgentLoop` to use async generator prompt. Note: The existing code already has an `options.abortController` that may be passed in - we need to use that if provided, or create one.

**Key changes:**
- Add new option `enableStdinQueue?: boolean` to `AgentLoopOptions`
- Only use stdin streaming when this flag is true (simple agent passes it)
- Use existing `options.abortController` if provided, don't create a duplicate

```typescript
import { createStdinMessageStream, StdinMessageStream } from './stdin-message-stream.js';

// Update AgentLoopOptions interface to add:
export interface AgentLoopOptions {
  // ... existing options ...
  /** Enable stdin message queue for queued user messages (simple agent only) */
  enableStdinQueue?: boolean;
}

export async function runAgentLoop(
  config: RunnerConfig,
  context: OrchestrationContext,
  agentConfig: AgentConfig,
  priorMessages: MessageParam[] = [],
  options: AgentLoopOptions = {}
): Promise<void> {
  // ... existing setup (initState, appendUserMessage, buildSystemPrompt) ...

  // Use provided abortController or create one
  const abortController = options.abortController ?? new AbortController();

  // Determine prompt: stdin stream for simple agent, string for task-based
  let prompt: string | AsyncGenerator<SDKUserMessage>;
  let streamController: StdinMessageStream | null = null;

  if (options.enableStdinQueue) {
    const stdinStream = createStdinMessageStream(config.prompt, abortController.signal);
    prompt = stdinStream.stream;
    streamController = stdinStream.controller;
  } else {
    prompt = config.prompt;
  }

  // Note: Mock mode does NOT support stdin queue - it uses scripted responses.
  // For testing queued messages, use real SDK with ANTHROPIC_API_KEY or
  // extend mockQuery to support async prompts (future work).
  const result = useMockMode
    ? mockQuery({ /* ... existing mock config ... */ })
    : query({
        prompt,  // Now either string or AsyncGenerator
        options: {
          // ... existing options ...
          abortController,
        },
      });

  try {
    for await (const message of result) {
      // Capture session_id from init message for stdin streaming
      if (streamController && message.type === 'system' && message.subtype === 'init') {
        streamController.setSessionId(message.session_id);
        logger.debug(`[runAgentLoop] SDK session_id: ${message.session_id}`);
      }

      const shouldContinue = await handler.handle(message);
      if (!shouldContinue) break;
    }
  } finally {
    // Clean up stdin stream if used
    streamController?.close();
  }
}
```

### 3b. `agents/src/runners/simple-runner-strategy.ts`

Update the simple runner to pass `enableStdinQueue: true` when calling `runAgentLoop`:

```typescript
// In the run() method where runAgentLoop is called:
await runAgentLoop(config, context, agentConfig, priorMessages, {
  ...existingOptions,
  enableStdinQueue: true,  // Enable stdin queue for simple agent
});
```

### 4. `agents/src/runners/message-handler.ts`

Update `handleUser` to process queued (non-synthetic, non-tool-result) messages.

**Important**: The existing code has:
```typescript
private async handleUser(msg: SDKUserMessage): Promise<boolean> {
  if (!msg.parent_tool_use_id) {
    logger.debug("[MessageHandler] Ignoring non-tool user message");
    return true;
  }
  // ... tool result handling ...
}
```

This needs to be changed to handle queued messages. Note the `isSynthetic` field is optional in `SDKUserMessage` and defaults to `undefined` (falsy), so the check `!msg.isSynthetic` will be true for both queued messages AND the initial prompt. We need to handle this carefully.

**Updated implementation:**

```typescript
private async handleUser(msg: SDKUserMessage): Promise<boolean> {
  // Tool result message - existing behavior
  if (msg.parent_tool_use_id) {
    const toolUseId = msg.parent_tool_use_id;
    const result = this.extractToolResult(msg);
    const isError = this.detectToolError(msg);
    await markToolComplete(toolUseId, result, isError);
    return true;
  }

  // Queued user message (not synthetic, not tool result)
  // isSynthetic is optional, undefined means user-originated
  // Note: The initial prompt is also yielded as SDKUserMessage by our stdin stream,
  // but appendUserMessage is already called in runAgentLoop setup, so we skip
  // the first non-synthetic message to avoid duplication.
  //
  // KNOWN ISSUE: This check assumes isSynthetic=false means queued message,
  // but our stdin stream explicitly sets isSynthetic: false for ALL messages
  // including the initial prompt. This will cause the initial prompt to be
  // appended twice (once in runAgentLoop setup, once here).
  //
  // FIX: Either:
  // 1. Don't call appendUserMessage in runAgentLoop for stdin queue mode, OR
  // 2. Set isSynthetic: true for the initial prompt in stdin stream
  //
  // Option 2 is cleaner - update formatUserMessage to accept an isSynthetic param.
  if (msg.isSynthetic === false) {
    const content = typeof msg.message.content === 'string'
      ? msg.message.content
      : msg.message.content
          .filter((block): block is { type: 'text'; text: string } => block.type === 'text')
          .map(block => block.text)
          .join('\n');

    await appendUserMessage(content);
    logger.info('[MessageHandler] Processed queued user message');
  }

  return true;
}
```

**Critical Fix Required in stdin-message-stream.ts:**

The initial prompt should be marked as synthetic to avoid double-appending:

```typescript
async *createStream(initialPrompt: string): AsyncGenerator<SDKUserMessage> {
  // Initial prompt is marked synthetic because runAgentLoop already calls
  // appendUserMessage for it. Only queued messages should be non-synthetic.
  yield this.formatUserMessage(initialPrompt, true);  // isSynthetic: true
  this.startListening();
  // ...
  yield this.formatUserMessage(msg.content, false);  // isSynthetic: false for queued
}

private formatUserMessage(content: string, isSynthetic: boolean): SDKUserMessage {
  return {
    type: 'user',
    message: { role: 'user', content },
    parent_tool_use_id: null,
    session_id: this.sessionId,
    isSynthetic,
  };
}
```

## Verification

1. Unit test stdin-message-schema.ts parsing
2. Unit test StdinMessageStream with mock stdin
3. Verify agent doesn't crash when random stdin lines arrive
4. Verify proper cleanup on process exit
5. **Verify initial prompt is NOT duplicated in thread state** (isSynthetic flag test)
6. **Verify queued messages ARE appended to thread state** (non-synthetic handling)

### Test Files to Create

- `agents/src/runners/stdin-message-schema.test.ts` - Zod schema unit tests
- `agents/src/runners/stdin-message-stream.test.ts` - Stream class unit tests

## Notes

- The SDK's `query()` accepts `AsyncIterable<SDKUserMessage>` as prompt
- Session ID is pre-generated to avoid chicken-and-egg timing issue
- Queued messages are injected at "safe points" (after current tool completes)

## Implementation Checklist

Before marking this complete, verify:

- [ ] `stdin-message-schema.ts` created with Zod schema and parseStdinMessage function
- [ ] `stdin-message-stream.ts` created with StdinMessageStream class
- [ ] `shared.ts` updated with conditional stdin queue support
- [ ] `AgentLoopOptions` interface updated with `enableStdinQueue` option
- [ ] `simple-runner-strategy.ts` passes `enableStdinQueue: true`
- [ ] `message-handler.ts` updated to handle non-synthetic user messages
- [ ] Initial prompt uses `isSynthetic: true` to avoid duplication
- [ ] Queued messages use `isSynthetic: false` to trigger state append
- [ ] Unit tests pass
- [ ] Manual test: agent processes queued message mid-execution

## Edge Cases to Consider

1. **Multiple queued messages arriving simultaneously**: Queue should preserve order by timestamp
2. **Queued message arrives during tool execution**: SDK handles this - message waits for safe point
3. **Agent completes before queued message processed**: Stream closes, message lost (acceptable for v1)
4. **stdin closed unexpectedly**: Stream should close gracefully, not crash agent
5. **Very long message content**: No explicit limit, but stdin buffer (64KB) provides natural cap
