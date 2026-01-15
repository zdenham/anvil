# Queued Messages for Simple Task

## Overview

Implement the ability to "queue" messages while an agent is running, similar to Claude Code's feature. Users can type follow-up messages mid-execution, which are injected into the agent's conversation without restarting.

## Prerequisites

Before implementing this feature, the following must be fixed:

### 1. Add ANTHROPIC_API_KEY to spawnSimpleAgent

The current `spawnSimpleAgent` function in `src/lib/agent-service.ts` does NOT pass `ANTHROPIC_API_KEY` in the environment, unlike `spawnAgentWithOrchestration`. This must be fixed first:

```typescript
// In spawnSimpleAgent, update the env object:
const settings = settingsService.get();
const apiKey = settings.anthropicApiKey || import.meta.env.VITE_ANTHROPIC_API_KEY;

if (!apiKey) {
  throw new Error("Anthropic API key not configured");
}

const command = Command.create("node", commandArgs, {
  cwd: options.sourcePath,
  env: {
    ANTHROPIC_API_KEY: apiKey,  // ADD THIS LINE
    NODE_PATH: nodeModulesPath,
    MORT_DATA_DIR: mortDir,
    PATH: shellPath,
  },
});
```

The same fix should be applied to `resumeSimpleAgent`.

## Background

Claude Code uses the `@anthropic-ai/claude-agent-sdk` which supports mid-run message injection.

### SDK API

The SDK's `query()` function signature (`agentSdkTypes.d.ts:1045-1048`):

```typescript
declare function query(_params: {
    prompt: string | AsyncIterable<SDKUserMessage>;
    options?: Options;
}): Query;
```

The `Query` interface also exposes `streamInput()` (`agentSdkTypes.d.ts:610-616`):

```typescript
interface Query extends AsyncGenerator<SDKMessage, void> {
    /**
     * Stream input messages to the query.
     * Used internally for multi-turn conversations.
     */
    streamInput(stream: AsyncIterable<SDKUserMessage>): Promise<void>;
}
```

### SDKUserMessage Structure

**Critical**: The SDK requires specific message structure. From `agentSdkTypes.d.ts:368-389`:

```typescript
type SDKUserMessageContent = {
    type: 'user';
    message: APIUserMessage;  // MessageParam from @anthropic-ai/sdk
    parent_tool_use_id: string | null;
    isSynthetic?: boolean;
    tool_use_result?: unknown;
};

export type SDKUserMessage = SDKUserMessageContent & {
    uuid?: UUID;
    session_id: string;  // REQUIRED
};
```

Where `APIUserMessage` is `MessageParam` from `@anthropic-ai/sdk/resources`, which has the structure:

```typescript
type MessageParam = {
    role: 'user';
    content: string | ContentBlockParam[];
};
```

### Two Approaches

**Option A: AsyncIterable prompt** (recommended)
Pass an async generator as the `prompt` parameter. The SDK will pull messages from the generator as the agent runs:

```typescript
async function* messageStream(sessionId: string): AsyncGenerator<SDKUserMessage> {
  yield {
    type: 'user',
    message: { role: 'user', content: 'Initial prompt' },
    parent_tool_use_id: null,
    session_id: sessionId,
  };

  // Later, when user queues a message:
  yield {
    type: 'user',
    message: { role: 'user', content: 'Follow-up question' },
    parent_tool_use_id: null,
    session_id: sessionId,
    isSynthetic: false,  // User-originated message
  };
}

const result = query({ prompt: messageStream(sessionId), options: {...} });
```

**Option B: streamInput() method**
Start with a string prompt, then call `streamInput()` to add more messages:

```typescript
const result = query({ prompt: 'Initial prompt', options: {...} });

// Later, add queued messages via another async iterable
await result.streamInput(queuedMessageGenerator());
```

### How It Works Internally

The SDK spawns a Claude Code subprocess and uses **stdin/stdout IPC**:

```
┌──────────────────────────┐                    ┌─────────────────────────┐
│  SDK (Parent Process)    │                    │  Claude Code Subprocess │
│                          │                    │                         │
│  AsyncIterable<Message>  │   JSON lines       │                         │
│         │                │ ──────────────────>│  stdin → message queue  │
│         │ yields message │                    │         │               │
│         v                │                    │         v               │
│  Transport.write(stdin)  │                    │  Process message        │
│                          │                    │         │               │
│                          │   JSON lines       │         v               │
│  Transport.read(stdout)  │ <──────────────────│  stdout ← response      │
│         │                │                    │                         │
│         v                │                    └─────────────────────────┘
│  yield SDKMessage        │
└──────────────────────────┘
```

1. SDK iterates over the `AsyncIterable<SDKUserMessage>` prompt
2. Each yielded message is serialized to JSON and written to subprocess stdin
3. Subprocess reads stdin, processes message, makes LLM calls, executes tools
4. Subprocess writes responses to stdout as JSON lines
5. SDK reads stdout and yields `SDKMessage` objects

**Key insight**: The async generator controls when messages are sent. If the generator is waiting (e.g., for a queued message from the user), the SDK simply doesn't send anything new until the generator yields.

### Multi-Turn Semantics

When a queued message is injected:

1. **Timing**: The message is injected at the next "safe point" in the agent loop - typically after the current LLM response completes and any tool calls finish. The SDK does NOT interrupt mid-tool-execution.

2. **New Turn**: Each queued message creates a new conversation turn. The agent will complete its current response, then start a new turn with the queued user message.

3. **Tool Call Handling**: If a queued message arrives while a tool is executing:
   - The tool completes normally
   - The LLM processes the tool result
   - The LLM generates a response
   - Then the queued message is processed as a new turn

4. **Multiple Queued Messages**: If multiple messages are queued, they are processed in order, each as a separate turn. This matches the sequential nature of conversation.

### Tauri Integration

Tauri's shell plugin provides `child.write()` to write to stdin of spawned processes:

```typescript
// From @tauri-apps/plugin-shell (index.d.ts:127-143)
interface Child {
    /** Writes `data` to the `stdin`. */
    write(data: IOPayload | number[]): Promise<void>;
}
```

This allows the Tauri frontend to send queued messages to the Node agent process.

**Note**: The `shell:allow-stdin-write` permission is already granted in `src-tauri/capabilities/default.json:61`.

## Architecture

```
┌─────────────────────────┐     stdin (JSON lines)      ┌─────────────────────────┐
│  Tauri Frontend         │ ─────────────────────────── │  Node Agent Process     │
│  (SimpleTaskWindow)     │                              │  (runner.ts)            │
│                         │ <───────────────────────────│                         │
│  • ThreadInput          │     stdout (JSON lines)     │  • Agent loop           │
│  • child.write()        │                              │  • SDK query()          │
│  • QueuedMessagesBanner │                              │  • Stdin message stream │
└─────────────────────────┘                              └─────────────────────────┘
```

## Implementation Steps

### 1. Define Stdin Message Schema (Zod Validation)

Create `agents/src/runners/stdin-message-schema.ts`:

```typescript
import { z } from 'zod';

/**
 * Schema for messages received on stdin from the frontend.
 * Per Zod-at-Boundaries pattern - stdin is a trust boundary.
 */
export const StdinMessageSchema = z.object({
  type: z.literal('queued_message'),
  id: z.string().uuid(),  // Unique ID for tracking
  content: z.string().min(1),
  timestamp: z.number(),  // Unix timestamp for ordering
});

export type StdinMessage = z.infer<typeof StdinMessageSchema>;

/**
 * Parse and validate a stdin line.
 * Returns null for invalid/non-message lines.
 */
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

### 2. Agent: Create Stdin Message Stream with Cleanup

Create `agents/src/runners/stdin-message-stream.ts`:

```typescript
import * as readline from 'readline';
import { randomUUID } from 'crypto';
import type { SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import { parseStdinMessage, StdinMessage } from './stdin-message-schema.js';
import { logger } from '../lib/logger.js';

const MAX_QUEUE_SIZE = 50;  // Maximum queued messages to prevent memory issues

/**
 * Manages stdin message streaming with proper lifecycle control.
 *
 * Key features:
 * - Proper readline cleanup to prevent hanging processes
 * - Queue size limits to prevent memory exhaustion
 * - AbortSignal support for graceful shutdown
 *
 * Session ID Strategy:
 * The SDK requires session_id in SDKUserMessage, but the SDK's init message
 * (which contains the session_id) is only received AFTER we yield the initial
 * prompt. To resolve this chicken-and-egg problem, we pre-generate a session ID
 * using crypto.randomUUID(). The SDK accepts client-generated session IDs.
 *
 * When the SDK's init message arrives, we could update our session ID to match,
 * but in practice the pre-generated ID works fine for message correlation.
 */
export class StdinMessageStream {
  private rl: readline.Interface | null = null;
  private messageQueue: StdinMessage[] = [];
  private resolveNext: ((msg: StdinMessage | null) => void) | null = null;
  private closed = false;
  private sessionId: string;

  constructor(private abortSignal?: AbortSignal) {
    // Pre-generate session ID to avoid chicken-and-egg problem.
    // The SDK init message arrives AFTER we yield the initial prompt,
    // so we can't wait for it. Pre-generating works because session_id
    // is used for message correlation, not authentication.
    this.sessionId = randomUUID();
  }

  /**
   * Update session ID if SDK provides one via init message.
   * Optional - the pre-generated ID works fine, but this allows
   * matching the SDK's session if needed for debugging/logging.
   */
  setSessionId(sessionId: string): void {
    this.sessionId = sessionId;
  }

  getSessionId(): string {
    return this.sessionId;
  }

  /**
   * Create the async generator for SDK consumption.
   * First yields the initial prompt, then listens for queued messages.
   */
  async *createStream(initialPrompt: string): AsyncGenerator<SDKUserMessage> {
    // Yield initial prompt
    yield this.formatUserMessage(initialPrompt);

    // Start listening on stdin
    this.startListening();

    // Setup abort handler
    if (this.abortSignal) {
      this.abortSignal.addEventListener('abort', () => this.close());
    }

    // Yield queued messages as they arrive
    try {
      while (!this.closed) {
        const msg = await this.waitForMessage();
        if (msg === null) break;  // Stream closed

        logger.info(`[StdinMessageStream] Processing queued message: ${msg.id}`);
        yield this.formatUserMessage(msg.content);
      }
    } finally {
      this.close();
    }
  }

  private formatUserMessage(content: string): SDKUserMessage {
    return {
      type: 'user',
      message: { role: 'user', content },
      parent_tool_use_id: null,
      session_id: this.sessionId,
      isSynthetic: false,
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

      // Enforce queue limit
      if (this.messageQueue.length >= MAX_QUEUE_SIZE) {
        logger.warn(`[StdinMessageStream] Queue full, dropping message: ${msg.id}`);
        return;
      }

      if (this.resolveNext) {
        // Someone is waiting for a message
        const resolve = this.resolveNext;
        this.resolveNext = null;
        resolve(msg);
      } else {
        // Queue for later
        this.messageQueue.push(msg);
      }
    });

    this.rl.on('close', () => {
      this.close();
    });

    this.rl.on('error', (err) => {
      logger.error('[StdinMessageStream] Readline error:', err);
      this.close();
    });
  }

  private waitForMessage(): Promise<StdinMessage | null> {
    if (this.closed) return Promise.resolve(null);

    // Check queue first
    if (this.messageQueue.length > 0) {
      return Promise.resolve(this.messageQueue.shift()!);
    }

    // Wait for next message
    return new Promise((resolve) => {
      this.resolveNext = resolve;
    });
  }

  /**
   * Close the stream and cleanup resources.
   * Safe to call multiple times.
   */
  close(): void {
    if (this.closed) return;
    this.closed = true;

    logger.debug('[StdinMessageStream] Closing');

    if (this.rl) {
      this.rl.close();
      this.rl = null;
    }

    // Resolve any pending waiter
    if (this.resolveNext) {
      this.resolveNext(null);
      this.resolveNext = null;
    }

    // Clear queue
    this.messageQueue = [];
  }
}

/**
 * Factory function for simple usage.
 */
export function createStdinMessageStream(
  initialPrompt: string,
  abortSignal?: AbortSignal
): { stream: AsyncGenerator<SDKUserMessage>; controller: StdinMessageStream } {
  const controller = new StdinMessageStream(abortSignal);
  const stream = controller.createStream(initialPrompt);
  return { stream, controller };
}
```

### 3. Agent: Update runAgentLoop to use Async Generator

Modify `agents/src/runners/shared.ts`:

```typescript
import { createStdinMessageStream, StdinMessageStream } from './stdin-message-stream.js';

export async function runAgentLoop(
  config: RunnerConfig,
  context: OrchestrationContext,
  agentConfig: AgentConfig,
  priorMessages: MessageParam[] = [],
  options: AgentLoopOptions = {}
): Promise<void> {
  // ... existing setup code ...

  const abortController = new AbortController();

  // Use stdin message stream for queued message support
  const { stream: promptStream, controller: streamController } =
    createStdinMessageStream(config.prompt, abortController.signal);

  const result = query({
    prompt: promptStream,  // Changed from config.prompt
    options: {
      // ... existing options ...
      abortController,
    },
  });

  // Process SDK messages
  try {
    for await (const message of result) {
      // Capture session_id from first system message (optional - pre-generated ID works)
      // The SDK always sends an 'init' message first with session_id.
      // We update our session ID to match for consistency, but the pre-generated
      // ID in StdinMessageStream constructor works fine if this is never called.
      if (message.type === 'system' && message.subtype === 'init') {
        streamController.setSessionId(message.session_id);
        logger.debug(`[runAgentLoop] SDK session_id: ${message.session_id}`);
      }

      const shouldContinue = await messageHandler.handle(message);
      if (!shouldContinue) break;
    }
  } finally {
    // Ensure cleanup on any exit path
    streamController.close();
  }
}
```

**Session ID Timing Notes:**

1. The SDK **always** sends an `init` system message as its first message
2. This message contains the authoritative `session_id`
3. Our `StdinMessageStream` pre-generates a session ID via `crypto.randomUUID()` to avoid blocking
4. When the `init` message arrives, we update to match the SDK's session ID
5. If somehow no `init` message is received (shouldn't happen), the pre-generated ID is used
6. Both IDs work for message correlation - the SDK uses session_id for grouping, not authentication

### 4. Frontend: Add sendQueuedMessage Function

Add to `src/lib/agent-service.ts`:

```typescript
import { v4 as uuidv4 } from 'uuid';

/** Track queued message IDs for confirmation matching */
const pendingQueuedMessages = new Map<string, {
  threadId: string;
  content: string;
  timestamp: number;
}>();

/**
 * Sends a queued message to a running simple agent via stdin.
 * The agent's stdin listener will pick this up and inject it into the conversation.
 *
 * @returns The unique ID of the queued message for tracking
 */
export async function sendQueuedMessage(
  threadId: string,
  message: string
): Promise<string> {
  const child = activeSimpleProcesses.get(threadId);
  if (!child) {
    throw new Error(`No active process for thread: ${threadId}`);
  }

  const messageId = uuidv4();
  const timestamp = Date.now();

  // Format as JSON line (must end with newline)
  const payload = JSON.stringify({
    type: 'queued_message',
    id: messageId,
    content: message,
    timestamp,
  }) + '\n';

  // Track for confirmation
  pendingQueuedMessages.set(messageId, {
    threadId,
    content: message,
    timestamp,
  });

  try {
    await child.write(payload);
    logger.info('[agent-service] Sent queued message', { threadId, messageId });
    return messageId;
  } catch (err) {
    pendingQueuedMessages.delete(messageId);
    throw err;
  }
}

/**
 * Check if a queued message has been processed (appeared in conversation).
 */
export function isQueuedMessagePending(messageId: string): boolean {
  return pendingQueuedMessages.has(messageId);
}

/**
 * Mark a queued message as processed.
 * Called when the message appears in the conversation.
 */
export function confirmQueuedMessage(messageId: string): void {
  pendingQueuedMessages.delete(messageId);
}

/**
 * Clear all pending queued messages for a thread.
 * Called when thread completes or is cancelled.
 */
export function clearPendingQueuedMessages(threadId: string): void {
  for (const [id, data] of pendingQueuedMessages.entries()) {
    if (data.threadId === threadId) {
      pendingQueuedMessages.delete(id);
    }
  }
}
```

### 5. Frontend: Update SimpleTaskWindow to Support Queuing

Modify `src/components/simple-task/simple-task-window.tsx`:

```typescript
import { sendQueuedMessage, confirmQueuedMessage, clearPendingQueuedMessages } from "@/lib/agent-service";

interface QueuedMessage {
  id: string;
  content: string;
  timestamp: number;
}

function SimpleTaskWindowContent({ taskId, threadId, prompt }: Props) {
  // ... existing code ...

  // Track queued messages that haven't been processed yet
  const [queuedMessages, setQueuedMessages] = useState<QueuedMessage[]>([]);

  const handleSubmit = async (prompt: string) => {
    if (!workingDirectory) {
      logger.error("[SimpleTaskWindow] Cannot submit: no working directory");
      return;
    }

    if (isStreaming) {
      // Agent is running - queue the message
      try {
        const messageId = await sendQueuedMessage(threadId, prompt);
        // Add to queued list immediately (optimistic UI)
        setQueuedMessages(prev => [...prev, {
          id: messageId,
          content: prompt,
          timestamp: Date.now(),
        }]);
      } catch (err) {
        logger.error("[SimpleTaskWindow] Failed to queue message", err);
        // TODO: Show error toast to user
      }
    } else {
      // Agent is idle - resume normally
      await resumeSimpleAgent(taskId, threadId, prompt, workingDirectory);
    }
  };

  // Remove queued messages once they appear in the conversation
  //
  // KNOWN LIMITATION: Content-based matching
  // The SDK does not echo back our message ID, so we must match by content.
  // This means if a user queues two identical messages (e.g., "yes" twice),
  // both will be marked as processed when the first one appears.
  // This is acceptable for v1 since:
  // 1. Identical consecutive messages are rare in practice
  // 2. The worst case is the banner disappears early (cosmetic issue)
  // 3. The messages ARE still processed correctly by the agent
  //
  // Future improvement: Store queued message IDs in ThreadState so agent
  // can echo them back, enabling exact ID matching.
  useEffect(() => {
    if (!activeState?.messages) return;

    // Check each queued message against conversation
    const processedIds: string[] = [];

    for (const qm of queuedMessages) {
      // Match on content since SDK doesn't echo back our message ID
      const foundInConversation = activeState.messages.some(m => {
        if (m.role !== 'user') return false;
        const content = typeof m.content === 'string'
          ? m.content
          : Array.isArray(m.content)
            ? m.content.find(b => b.type === 'text')?.text
            : '';
        return content === qm.content;
      });

      if (foundInConversation) {
        processedIds.push(qm.id);
        confirmQueuedMessage(qm.id);
      }
    }

    if (processedIds.length > 0) {
      setQueuedMessages(prev => prev.filter(qm => !processedIds.includes(qm.id)));
    }
  }, [activeState?.messages, queuedMessages]);

  // Clear pending messages on unmount or thread completion
  useEffect(() => {
    return () => {
      clearPendingQueuedMessages(threadId);
    };
  }, [threadId]);

  return (
    <div className="flex flex-col h-screen bg-surface-900 text-surface-50">
      <SimpleTaskHeader taskId={taskId} status={viewStatus} />
      <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
        <ThreadView ... />
      </div>

      {/* Queued messages banner */}
      <QueuedMessagesBanner messages={queuedMessages} />

      <ThreadInput
        onSubmit={handleSubmit}
        disabled={false}  // Always enabled now!
        workingDirectory={workingDirectory}
        placeholder={isStreaming ? "Queue a message..." : undefined}
      />
    </div>
  );
}
```

### 6. UI: Queued Messages Banner Component

Create `src/components/simple-task/queued-messages-banner.tsx`:

```typescript
interface QueuedMessage {
  id: string;
  content: string;
  timestamp: number;
}

interface QueuedMessagesBannerProps {
  messages: QueuedMessage[];
}

export function QueuedMessagesBanner({ messages }: QueuedMessagesBannerProps) {
  if (messages.length === 0) return null;

  return (
    <div className="px-4 py-2 bg-surface-800 border-t border-surface-700">
      <div className="flex items-center gap-2 text-xs text-surface-400 mb-1">
        <span className="inline-block w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
        <span>Queued {messages.length === 1 ? 'message' : 'messages'} (will be sent when agent is ready)</span>
      </div>
      <div className="space-y-1">
        {messages.map((msg) => (
          <div
            key={msg.id}
            className="text-sm text-surface-300 bg-surface-700/50 rounded px-2 py-1 truncate"
          >
            {msg.content}
          </div>
        ))}
      </div>
    </div>
  );
}
```

**Visual design:**
- Appears directly above the input (pinned position)
- Amber/yellow indicator to show "pending" state
- Pulsing dot animation to indicate waiting
- Shows truncated preview of each queued message
- Automatically disappears when message is processed
- Messages keyed by unique ID to prevent React reconciliation issues

### 7. Update MessageHandler for Injected User Messages

The existing `MessageHandler` in `agents/src/runners/message-handler.ts` currently ignores user messages without `parent_tool_use_id`. Update to handle queued user messages:

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
  if (!msg.isSynthetic) {
    // Extract content as string for appendUserMessage
    const content = typeof msg.message.content === 'string'
      ? msg.message.content
      : msg.message.content
          .filter((block): block is { type: 'text'; text: string } => block.type === 'text')
          .map(block => block.text)
          .join('\n');

    // Persist the user message to state
    await appendUserMessage(content);
    logger.info('[MessageHandler] Processed queued user message');
  }

  return true;
}
```

**Note**: The existing `appendUserMessage` function in `agents/src/output.ts` already has the correct signature:

```typescript
// Existing function - no changes needed
export async function appendUserMessage(content: string): Promise<void> {
  state.messages.push({ role: "user", content });
  await emitState();
}
```

## Thread Status During Queued Message Processing

The `isStreaming` check in `SimpleTaskWindow` should consider these states:

- **`status === 'streaming'`**: Agent is actively running, queue messages
- **`status === 'paused'`**: Agent is paused (permission prompt), **do not allow queuing** (messages could be lost)
- **`status === 'idle'`**: Agent is complete, use `resumeSimpleAgent` for new turn
- **`status === 'error'`**: Agent errored, use resume to retry

```typescript
const canQueueMessages = viewStatus === 'streaming';
const canResumeAgent = viewStatus === 'idle' || viewStatus === 'error';

const handleSubmit = async (prompt: string) => {
  if (canQueueMessages) {
    await sendQueuedMessage(threadId, prompt);
  } else if (canResumeAgent) {
    await resumeSimpleAgent(taskId, threadId, prompt, workingDirectory);
  } else {
    // Paused or other state - show message to user
    logger.warn('[SimpleTaskWindow] Cannot submit in current state', { status: viewStatus });
  }
};
```

## Alternative: File-Based Queue (Fallback)

If stdin proves problematic (e.g., SDK doesn't support async prompts or buffer issues occur), implement a file-based fallback:

### Implementation

1. **Write Location**: Frontend writes to `{threadPath}/queued-messages.jsonl`
2. **Polling**: Agent polls this file between tool calls using a `PostToolUse` hook
3. **Processing**: Agent reads pending messages, clears the file, injects into conversation
4. **Atomicity**: Use rename-based atomic writes to prevent partial reads

### File-Based Queue Code

```typescript
// agents/src/runners/file-based-queue.ts
import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'fs';
import { join } from 'path';
import { StdinMessageSchema, StdinMessage } from './stdin-message-schema.js';
import { logger } from '../lib/logger.js';

export class FileBasedMessageQueue {
  private queuePath: string;

  constructor(threadPath: string) {
    this.queuePath = join(threadPath, 'queued-messages.jsonl');
  }

  /**
   * Read and clear all pending messages.
   * Called by agent between tool calls.
   */
  consumeMessages(): StdinMessage[] {
    if (!existsSync(this.queuePath)) {
      return [];
    }

    try {
      const content = readFileSync(this.queuePath, 'utf-8');
      unlinkSync(this.queuePath);  // Clear after read

      const messages: StdinMessage[] = [];
      for (const line of content.split('\n')) {
        if (!line.trim()) continue;
        try {
          const parsed = JSON.parse(line);
          const result = StdinMessageSchema.safeParse(parsed);
          if (result.success) {
            messages.push(result.data);
          }
        } catch {
          // Skip invalid lines
        }
      }

      return messages.sort((a, b) => a.timestamp - b.timestamp);
    } catch (err) {
      logger.error('[FileBasedMessageQueue] Error reading queue:', err);
      return [];
    }
  }
}

// Frontend: atomic append to queue file
// src/lib/agent-service.ts
export async function appendToQueueFile(threadPath: string, message: StdinMessage): Promise<void> {
  const queuePath = await join(threadPath, 'queued-messages.jsonl');
  const line = JSON.stringify(message) + '\n';

  // Use Tauri fs plugin for atomic append
  await fs.appendFile(queuePath, line);
}
```

### When to Use File-Based Queue

- Stdin buffer overflow errors occur
- Process communication becomes unreliable
- Need to persist queued messages across crashes

The stdin approach is preferred for lower latency and simpler implementation.

## State Persistence and Crash Recovery (Future Work)

> **Note**: This section describes crash recovery for queued messages. This is NOT required for the initial implementation. The core feature works without persistence - if the agent crashes, queued messages in-flight are lost, which is acceptable for v1.

### Queued Message Persistence

Queued messages could be persisted to enable crash recovery:

1. **On Queue**: Write pending messages to `{threadPath}/pending-queued.json`
2. **On Process**: Remove from pending file after SDK processes the message
3. **On Resume**: Check for pending messages and re-inject if agent was interrupted

```typescript
// src/lib/queued-message-persistence.ts
// NOTE: Use separate imports - @tauri-apps/plugin-fs doesn't export 'path'
import { writeTextFile, readTextFile, remove } from '@tauri-apps/plugin-fs';
import { join } from '@tauri-apps/api/path';

interface PendingQueuedMessages {
  messages: QueuedMessage[];
  lastUpdated: number;
}

export async function persistQueuedMessages(
  threadPath: string,
  messages: QueuedMessage[]
): Promise<void> {
  const pendingPath = await join(threadPath, 'pending-queued.json');
  await writeTextFile(pendingPath, JSON.stringify({
    messages,
    lastUpdated: Date.now(),
  }));
}

export async function loadPendingQueuedMessages(
  threadPath: string
): Promise<QueuedMessage[]> {
  const pendingPath = await join(threadPath, 'pending-queued.json');
  try {
    const content = await readTextFile(pendingPath);
    const data: PendingQueuedMessages = JSON.parse(content);
    return data.messages;
  } catch {
    return [];  // No pending messages
  }
}

export async function clearPersistedQueuedMessages(threadPath: string): Promise<void> {
  const pendingPath = await join(threadPath, 'pending-queued.json');
  try {
    await remove(pendingPath);
  } catch {
    // Already cleared
  }
}
```

### State Persistence Timing

When a queued message is processed:

1. **Before yield to SDK**: The message is already in the stdin buffer
2. **On SDK user message**: `MessageHandler` calls `appendUserMessage()` which writes to `state.json`
3. **UI Confirmation**: The `state` event triggers UI update, removing from queued banner

If the agent crashes between steps 1 and 2, the message is lost. For critical recovery:
- Use the file-based persistence above
- On `resumeSimpleAgent`, check for pending messages and include in the resume prompt

### Consistency with resumeSimpleAgent

When resuming after a crash with pending queued messages:

```typescript
export async function resumeSimpleAgent(
  taskId: string,
  threadId: string,
  prompt: string,
  sourcePath: string,
): Promise<void> {
  // Load any pending queued messages from crash
  const threadPath = await path.join(mortDir, 'tasks', taskId, 'threads', `simple-${threadId}`);
  const pendingMessages = await loadPendingQueuedMessages(threadPath);

  // Combine with new prompt if there are pending messages
  let fullPrompt = prompt;
  if (pendingMessages.length > 0) {
    const pendingText = pendingMessages.map(m => m.content).join('\n\n');
    fullPrompt = `[Previously queued messages that weren't processed:\n${pendingText}]\n\n${prompt}`;
    await clearPersistedQueuedMessages(threadPath);
  }

  // ... rest of existing code, using fullPrompt ...
}
```

## Testing

### Unit Tests

Test the stdin message stream in isolation:

```typescript
// agents/src/runners/__tests__/stdin-message-stream.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Readable, PassThrough } from 'stream';
import { StdinMessageStream } from '../stdin-message-stream.js';

describe('StdinMessageStream', () => {
  let originalStdin: NodeJS.ReadStream;
  let mockStdin: PassThrough;

  beforeEach(() => {
    originalStdin = process.stdin;
    mockStdin = new PassThrough();
    // @ts-expect-error - replacing stdin for testing
    process.stdin = mockStdin;
  });

  afterEach(() => {
    // @ts-expect-error - restoring stdin
    process.stdin = originalStdin;
    mockStdin.destroy();
  });

  it('yields initial prompt first', async () => {
    const controller = new StdinMessageStream();
    // Override pre-generated session ID for test predictability
    controller.setSessionId('test-session');
    const stream = controller.createStream('Hello');

    const first = await stream.next();
    expect(first.value).toMatchObject({
      type: 'user',
      message: { role: 'user', content: 'Hello' },
      parent_tool_use_id: null,
      session_id: 'test-session',
    });

    controller.close();
  });

  it('uses pre-generated session ID when setSessionId not called', async () => {
    const controller = new StdinMessageStream();
    // Don't call setSessionId - verify pre-generated UUID is used
    const stream = controller.createStream('Hello');

    const first = await stream.next();
    // Session ID should be a valid UUID (pre-generated in constructor)
    expect(first.value?.session_id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    );

    controller.close();
  });

  it('yields queued messages from stdin', async () => {
    const controller = new StdinMessageStream();
    controller.setSessionId('test-session');
    const stream = controller.createStream('Hello');

    // Get initial
    await stream.next();

    // Push queued message to mock stdin
    const queuedMsg = JSON.stringify({
      type: 'queued_message',
      id: 'test-id-123',
      content: 'Follow-up',
      timestamp: Date.now(),
    }) + '\n';
    mockStdin.push(queuedMsg);

    const second = await stream.next();
    expect(second.value).toMatchObject({
      type: 'user',
      message: { role: 'user', content: 'Follow-up' },
    });

    controller.close();
  });

  it('closes cleanly on abort signal', async () => {
    const abortController = new AbortController();
    const controller = new StdinMessageStream(abortController.signal);
    const stream = controller.createStream('Hello');

    await stream.next();  // Initial prompt

    // Abort should close the stream
    abortController.abort();

    const result = await stream.next();
    expect(result.done).toBe(true);
  });

  it('ignores invalid JSON lines', async () => {
    const controller = new StdinMessageStream();
    controller.setSessionId('test-session');
    const stream = controller.createStream('Hello');

    await stream.next();

    // Push invalid line, then valid line
    mockStdin.push('not json\n');
    mockStdin.push(JSON.stringify({
      type: 'queued_message',
      id: 'valid-id',
      content: 'Valid',
      timestamp: Date.now(),
    }) + '\n');

    const result = await stream.next();
    expect(result.value).toMatchObject({
      message: { content: 'Valid' },
    });

    controller.close();
  });

  it('enforces queue size limit', async () => {
    const controller = new StdinMessageStream();
    const stream = controller.createStream('Hello');

    // Get initial message first
    await stream.next();

    // Use a spy/counter to track dropped messages via logger.warn
    const warnSpy = vi.spyOn(logger, 'warn');

    // Push messages one at a time with small delays to ensure proper async processing
    // This avoids race conditions where all messages arrive before any are queued
    for (let i = 0; i < 60; i++) {
      mockStdin.push(JSON.stringify({
        type: 'queued_message',
        id: `msg-${i}`,
        content: `Message ${i}`,
        timestamp: Date.now(),
      }) + '\n');
      // Small delay to allow readline to process each line
      await new Promise(resolve => setImmediate(resolve));
    }

    // Wait a tick for all messages to be processed by readline
    await new Promise(resolve => setTimeout(resolve, 10));

    // Verify that some messages were dropped (warned about)
    const dropWarnings = warnSpy.mock.calls.filter(
      call => call[0].includes('Queue full, dropping message')
    );
    expect(dropWarnings.length).toBe(10);  // 60 sent - 50 max = 10 dropped

    // Read all queued messages
    let count = 0;
    for (let i = 0; i < 50; i++) {
      const result = await stream.next();
      if (result.done) break;
      count++;
    }

    expect(count).toBe(50);  // MAX_QUEUE_SIZE
    controller.close();
  });
});
```

### Zod Schema Tests

```typescript
// agents/src/runners/__tests__/stdin-message-schema.test.ts
import { describe, it, expect } from 'vitest';
import { parseStdinMessage } from '../stdin-message-schema.js';

describe('parseStdinMessage', () => {
  it('parses valid queued message', () => {
    const result = parseStdinMessage(JSON.stringify({
      type: 'queued_message',
      id: '550e8400-e29b-41d4-a716-446655440000',
      content: 'Hello',
      timestamp: 1234567890,
    }));

    expect(result).toEqual({
      type: 'queued_message',
      id: '550e8400-e29b-41d4-a716-446655440000',
      content: 'Hello',
      timestamp: 1234567890,
    });
  });

  it('rejects invalid JSON', () => {
    expect(parseStdinMessage('not json')).toBeNull();
  });

  it('rejects missing required fields', () => {
    expect(parseStdinMessage(JSON.stringify({
      type: 'queued_message',
      content: 'Hello',
      // missing id and timestamp
    }))).toBeNull();
  });

  it('rejects wrong type', () => {
    expect(parseStdinMessage(JSON.stringify({
      type: 'other_message',
      id: 'test',
      content: 'Hello',
      timestamp: 123,
    }))).toBeNull();
  });

  it('rejects empty content', () => {
    expect(parseStdinMessage(JSON.stringify({
      type: 'queued_message',
      id: 'test',
      content: '',
      timestamp: 123,
    }))).toBeNull();
  });

  it('rejects invalid uuid format', () => {
    expect(parseStdinMessage(JSON.stringify({
      type: 'queued_message',
      id: 'not-a-uuid',
      content: 'Hello',
      timestamp: 123,
    }))).toBeNull();
  });
});
```

### Agent Harness Integration

Extend `AgentTestHarness` to support stdin writing:

```typescript
// agents/src/testing/agent-harness.ts

export interface AgentTestHarnessOptions extends Partial<AgentTestOptions> {
  // ... existing options ...

  /**
   * Queued messages to send during execution.
   * Each entry specifies a delay (ms) and message content.
   */
  queuedMessages?: Array<{
    delayMs: number;
    content: string;
  }>;
}

private spawnAgent(
  opts: AgentTestOptions,
  task: TaskMetadata
): Promise<AgentRunOutput> {
  // ... existing code ...

  return new Promise((resolve, reject) => {
    const proc = spawn("tsx", args, {
      env: { ...process.env, ...this.runnerConfig.env, ...opts.env },
      stdio: ['pipe', 'pipe', 'pipe'],  // Enable stdin
    });

    // Schedule queued messages
    const queuedMessageTimeouts: NodeJS.Timeout[] = [];
    if (opts.queuedMessages) {
      for (const qm of opts.queuedMessages) {
        const timeoutId = setTimeout(() => {
          const payload = JSON.stringify({
            type: 'queued_message',
            id: crypto.randomUUID(),
            content: qm.content,
            timestamp: Date.now(),
          }) + '\n';
          proc.stdin?.write(payload);
        }, qm.delayMs);
        queuedMessageTimeouts.push(timeoutId);
      }
    }

    // ... rest of existing code ...

    proc.on("close", (code) => {
      clearTimeoutHandler();
      // Clear queued message timeouts
      queuedMessageTimeouts.forEach(clearTimeout);

      resolve({
        logs,
        events,
        states,
        exitCode: killed ? -1 : (code ?? 1),
        stderr: killed
          ? `${stderr}\n[Killed: timeout after ${timeout}ms]`
          : stderr,
        durationMs: Date.now() - startTime,
      });
    });
  });
}
```

### Frontend Integration Tests (Playwright)

```typescript
// e2e/queued-messages.spec.ts
import { test, expect } from '@playwright/test';

test.describe('Queued Messages', () => {
  test('shows queued message banner while agent is running', async ({ page }) => {
    // Start a simple task
    await page.goto('/task/test-task');
    await page.fill('[data-testid="thread-input"]', 'Start a long task');
    await page.click('[data-testid="submit-button"]');

    // Wait for streaming to start
    await expect(page.locator('[data-testid="streaming-indicator"]')).toBeVisible();

    // Type a queued message
    await page.fill('[data-testid="thread-input"]', 'Also do this');
    await page.click('[data-testid="submit-button"]');

    // Verify banner appears
    await expect(page.locator('[data-testid="queued-messages-banner"]')).toBeVisible();
    await expect(page.getByText('Also do this')).toBeVisible();
    await expect(page.getByText('Queued message')).toBeVisible();
  });

  test('removes banner when message appears in conversation', async ({ page }) => {
    await page.goto('/task/test-task');
    await page.fill('[data-testid="thread-input"]', 'Quick task');
    await page.click('[data-testid="submit-button"]');

    // Queue a message
    await page.fill('[data-testid="thread-input"]', 'Follow-up');
    await page.click('[data-testid="submit-button"]');

    // Banner should appear
    await expect(page.locator('[data-testid="queued-messages-banner"]')).toBeVisible();

    // Wait for message to appear in thread
    await expect(page.locator('.thread-message:has-text("Follow-up")')).toBeVisible();

    // Banner should disappear
    await expect(page.locator('[data-testid="queued-messages-banner"]')).not.toBeVisible();
  });

  test('input placeholder changes when streaming', async ({ page }) => {
    await page.goto('/task/test-task');

    // Before streaming - normal placeholder
    await expect(page.locator('[data-testid="thread-input"]')).toHaveAttribute(
      'placeholder',
      expect.stringMatching(/type a message/i)
    );

    // Start streaming
    await page.fill('[data-testid="thread-input"]', 'Start task');
    await page.click('[data-testid="submit-button"]');

    // During streaming - queue placeholder
    await expect(page.locator('[data-testid="thread-input"]')).toHaveAttribute(
      'placeholder',
      'Queue a message...'
    );
  });
});
```

### Integration Test Example

```typescript
// agents/src/testing/__tests__/queued-messages.integration.test.ts

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AgentTestHarness } from '../agent-harness.js';

describe('Queued Messages', () => {
  let harness: AgentTestHarness;

  beforeEach(() => {
    harness = new AgentTestHarness({
      runnerConfig: {
        env: { MOCK_LLM_SCRIPT: 'fixtures/queued-messages-script.json' }
      }
    });
  });

  afterEach(() => {
    harness.cleanup();
  });

  it('processes queued message mid-execution', async () => {
    const result = await harness.run({
      agentType: 'simple',
      prompt: 'Start a long task',
      queuedMessages: [
        { delayMs: 500, content: 'Also do this follow-up' }
      ],
      timeout: 10000,
    });

    expect(result.exitCode).toBe(0);

    // Verify both messages were processed
    const states = result.states;
    const messages = states[states.length - 1]?.state?.messages ?? [];

    // Should have: user (initial), assistant, user (queued), assistant
    const userMessages = messages.filter(m => m.role === 'user');
    expect(userMessages.length).toBeGreaterThanOrEqual(2);
  });

  it('handles multiple queued messages in sequence', async () => {
    const result = await harness.run({
      agentType: 'simple',
      prompt: 'Initial prompt',
      queuedMessages: [
        { delayMs: 300, content: 'First follow-up' },
        { delayMs: 600, content: 'Second follow-up' },
      ],
      timeout: 15000,
    });

    expect(result.exitCode).toBe(0);
  });

  it('handles queued message while tool is executing', async () => {
    const result = await harness.run({
      agentType: 'simple',
      prompt: 'Read a large file',
      queuedMessages: [
        { delayMs: 100, content: 'What else is in that directory?' }
      ],
    });

    expect(result.exitCode).toBe(0);
  });
});
```

### Mock LLM Script for Tests

```json
// agents/src/testing/fixtures/queued-messages-script.json
{
  "responses": [
    {
      "text": "I'll start the task.",
      "toolCalls": [
        { "name": "Read", "input": { "file_path": "/tmp/test.txt" } }
      ]
    },
    {
      "text": "Done with initial task. Now handling your follow-up.",
      "toolCalls": []
    },
    {
      "text": "Follow-up complete!",
      "toolCalls": []
    }
  ]
}
```

### Manual Testing Checklist

1. Start a simple task with a long-running prompt
2. While agent is working, type a follow-up message
3. Verify queued banner appears with message preview
4. Verify message is injected into conversation
5. Verify banner disappears after message appears in thread
6. Verify agent responds to both original and queued message
7. Test multiple queued messages in sequence
8. Test queueing while agent is mid-tool-call
9. Test queueing when agent is waiting for LLM response
10. Test input placeholder changes (normal vs queue mode)
11. Test that paused state prevents queuing

## Telemetry and Logging

Add structured logging for queued message lifecycle:

### Agent-Side Logging

```typescript
// In StdinMessageStream
logger.info('[StdinMessageStream] Initialized', { sessionId: this.sessionId });
logger.info('[StdinMessageStream] Received queued message', {
  messageId: msg.id,
  contentLength: msg.content.length
});
logger.warn('[StdinMessageStream] Queue full, dropping message', {
  messageId: msg.id,
  queueSize: this.messageQueue.length
});
logger.info('[StdinMessageStream] Closing', {
  pendingMessages: this.messageQueue.length
});
```

### Frontend Logging

```typescript
// In agent-service.ts
logger.info('[agent-service] Sending queued message', {
  threadId,
  messageId,
  contentLength: message.length
});
logger.info('[agent-service] Queued message confirmed', { messageId });
logger.warn('[agent-service] Queued message failed to send', {
  threadId,
  messageId,
  error: err.message
});
```

### Metrics to Track

- Number of queued messages per session
- Time from queue to processing
- Queue drops due to size limits
- Failed stdin writes
- Crash recovery message counts

## Considerations

### Stdin Buffer Limits

Node.js stdin has a default highWaterMark of 64KB. Each queued message is typically:
- JSON overhead: ~50 bytes
- UUID: 36 bytes
- Timestamp: 13 bytes
- Content: variable

With average message size of 500 bytes, the buffer can hold ~130 messages before backpressure. The `MAX_QUEUE_SIZE = 50` limit provides safety margin.

If `child.write()` rejects due to buffer pressure:
1. Log the error
2. Retry with exponential backoff (up to 3 attempts)
3. If still failing, show error to user and keep message in UI queue

### Message Ordering

The SDK processes messages in order. Queued messages arrive asynchronously but are handled gracefully by the agentic loop. Messages with timestamps are processed in timestamp order if multiple arrive simultaneously.

### Optimistic UI

Show queued messages immediately in the banner (before agent acknowledges them) for responsive UX. Match by unique ID when removing from banner to handle duplicate content correctly.

### Error Handling

- **Process exits before queued message processed**: Use persistence (see Crash Recovery section)
- **Write fails**: Surface error to user via toast notification
- **Queue full**: Warn user, reject new message with explanation
- **Invalid stdin message**: Log and ignore, don't crash agent

## Known Limitations

This section consolidates known limitations for the v1 implementation:

### 1. Content-Based Message Matching (UI)

The SDK does not echo back our message IDs when processing queued messages. The frontend must match by content to determine when a queued message has been processed.

**Impact**: If a user queues two identical messages (e.g., "yes" twice), both will be marked as processed when the first appears in the conversation.

**Mitigation**: This is a cosmetic issue - the messages are still processed correctly. The banner just disappears early.

**Future fix**: Store queued message IDs in ThreadState so the agent can echo them back.

### 2. No Crash Recovery for In-Flight Messages (v1)

If the agent process crashes after receiving a queued message but before persisting it to state.json, that message is lost.

**Impact**: Rare edge case - requires crash during the brief window between stdin read and state write.

**Mitigation**: v1 accepts this limitation. The "State Persistence and Crash Recovery" section documents a future enhancement.

### 3. Cannot Queue During Paused State

When the agent is paused (e.g., waiting for permission prompt), queued messages cannot be sent because:
1. The agent is not processing stdin
2. Messages could be lost or arrive out of order when agent resumes

**Mitigation**: UI disables queuing when `status === 'paused'`. User must respond to the permission prompt first.

### 4. Queue Size Limit

Maximum 50 queued messages to prevent memory exhaustion. Additional messages are dropped with a warning.

**Impact**: Unlikely to hit in practice - 50 messages is far more than typical usage.

**Mitigation**: Clear warning logged when messages are dropped.
