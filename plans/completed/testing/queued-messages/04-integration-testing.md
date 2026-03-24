# 04 - Integration Testing

## Dependencies

Requires 01, 02, and 03 to be complete.

## Parallel With

None - this is the final phase.

## Scope

Implement comprehensive tests:
1. Unit tests for stdin schema and stream
2. Agent harness integration for queued messages
3. UI isolation tests for frontend (this project does not use Playwright)

## Files to Create

### 1. `agents/src/runners/stdin-message-schema.test.ts`

Note: Test files in agents/src/runners use `.test.ts` suffix directly in the same directory, not in a `__tests__` subdirectory.

```typescript
import { describe, it, expect } from 'vitest';
import { parseStdinMessage } from './stdin-message-schema.js';

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
      id: '550e8400-e29b-41d4-a716-446655440000',
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

### 2. `agents/src/runners/stdin-message-stream.test.ts`

Note: Test file should be in same directory as source file, not in `__tests__` subdirectory.

```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { PassThrough } from 'stream';
import { StdinMessageStream } from './stdin-message-stream.js';
import { logger } from '../lib/logger.js';

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
    const stream = controller.createStream('Hello');

    const first = await stream.next();
    expect(first.value?.session_id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    );

    controller.close();
  });

  it('yields queued messages from stdin', async () => {
    const controller = new StdinMessageStream();
    controller.setSessionId('test-session');
    const stream = controller.createStream('Hello');

    await stream.next();

    const queuedMsg = JSON.stringify({
      type: 'queued_message',
      id: '550e8400-e29b-41d4-a716-446655440000',
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

    await stream.next();
    abortController.abort();

    const result = await stream.next();
    expect(result.done).toBe(true);
  });

  it('ignores invalid JSON lines', async () => {
    const controller = new StdinMessageStream();
    controller.setSessionId('test-session');
    const stream = controller.createStream('Hello');

    await stream.next();

    mockStdin.push('not json\n');
    mockStdin.push(JSON.stringify({
      type: 'queued_message',
      id: '550e8400-e29b-41d4-a716-446655440000',
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
    await stream.next();

    const warnSpy = vi.spyOn(logger, 'warn');

    // Push 60 messages (limit is 50)
    for (let i = 0; i < 60; i++) {
      mockStdin.push(JSON.stringify({
        type: 'queued_message',
        id: `550e8400-e29b-41d4-a716-44665544${i.toString().padStart(4, '0')}`,
        content: `Message ${i}`,
        timestamp: Date.now(),
      }) + '\n');
      await new Promise(resolve => setImmediate(resolve));
    }

    await new Promise(resolve => setTimeout(resolve, 10));

    const dropWarnings = warnSpy.mock.calls.filter(
      call => call[0].includes('Queue full')
    );
    expect(dropWarnings.length).toBe(10);

    controller.close();
  });
});
```

### 3. Agent Harness Extension

Update `agents/src/testing/agent-harness.ts`:

Note: Add `queuedMessages` to `AgentTestOptions` in `agents/src/testing/types.ts`, not `AgentTestHarnessOptions`. The harness options extend `Partial<AgentTestOptions>`, so adding it to test options makes it available in both places.

Update `agents/src/testing/types.ts`:

```typescript
export interface AgentTestOptions {
  // ... existing options ...

  /**
   * Queued messages to send during execution.
   * Each message is sent after the specified delay from agent start.
   */
  queuedMessages?: Array<{
    delayMs: number;
    content: string;
  }>;
}
```

Update the `spawnAgent` method in `agents/src/testing/agent-harness.ts`:

```typescript
import { randomUUID } from "crypto";

// In spawnAgent method, modify the spawn call to enable stdin:
private spawnAgent(
  opts: AgentTestOptions,
  task: TaskMetadata
): Promise<AgentRunOutput> {
  // ... existing setup ...

  return new Promise((resolve, reject) => {
    const proc = spawn("tsx", args, {
      env: { ...process.env, ...this.runnerConfig.env, ...opts.env },
      stdio: ['pipe', 'pipe', 'pipe'],  // Changed: Enable stdin pipe
    });

    // Schedule queued messages
    const queuedMessageTimeouts: NodeJS.Timeout[] = [];
    if (opts.queuedMessages) {
      for (const qm of opts.queuedMessages) {
        const timeoutId = setTimeout(() => {
          const payload = JSON.stringify({
            type: 'queued_message',
            id: randomUUID(),
            content: qm.content,
            timestamp: Date.now(),
          }) + '\n';
          proc.stdin?.write(payload);
        }, qm.delayMs);
        queuedMessageTimeouts.push(timeoutId);
      }
    }

    // ... existing timeout handling ...

    proc.on("close", (code) => {
      queuedMessageTimeouts.forEach(clearTimeout);
      // ... existing close handler ...
    });

    // ... rest of existing code ...
  });
}
```

Note: The current harness uses `spawn("tsx", args, {...})` without specifying `stdio`, which defaults to `['pipe', 'pipe', 'pipe']` for stdin/stdout/stderr. Verify the current default before changing.

### 4. `agents/src/testing/__tests__/queued-messages.integration.test.ts`

Note: Uses `ANVIL_MOCK_LLM_PATH` environment variable with `createMockScript()` helper, not a fixture file path. The mock LLM system works by creating temp files with scripted responses.

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AgentTestHarness } from '../agent-harness.js';
import { createMockScript, cleanupMockScript, MOCK_LLM_VAR } from '../mock-llm.js';

describe('Queued Messages Integration', () => {
  let harness: AgentTestHarness;
  let mockScriptPath: string;

  beforeEach(() => {
    // Create a mock script that simulates a multi-turn conversation
    // with delays to allow queued messages to be injected
    mockScriptPath = createMockScript({
      responses: [
        {
          // First response: acknowledge and use a tool to create delay
          toolCalls: [{ name: "Read", input: { file_path: "/tmp/test.txt" } }],
        },
        {
          // After tool result: respond to initial prompt
          content: "I've started the task.",
        },
        {
          // Response to queued message
          content: "Processing your follow-up request.",
        },
      ],
    });

    harness = new AgentTestHarness();
  });

  afterEach(() => {
    harness.cleanup();
    cleanupMockScript(mockScriptPath);
  });

  it('processes queued message mid-execution', async () => {
    const result = await harness.run({
      agent: 'simple',
      prompt: 'Start a long task',
      queuedMessages: [
        { delayMs: 500, content: 'Also do this follow-up' }
      ],
      timeout: 10000,
      env: { [MOCK_LLM_VAR]: mockScriptPath },
    });

    expect(result.exitCode).toBe(0);

    const states = result.states;
    const lastState = states[states.length - 1];
    const messages = lastState?.state?.messages ?? [];
    const userMessages = messages.filter((m: { role: string }) => m.role === 'user');
    expect(userMessages.length).toBeGreaterThanOrEqual(2);
  });

  it('handles multiple queued messages in sequence', async () => {
    // Create a longer mock script for multiple messages
    const multiMsgScript = createMockScript({
      responses: [
        { toolCalls: [{ name: "Read", input: { file_path: "/tmp/test.txt" } }] },
        { content: "Initial response." },
        { content: "First follow-up response." },
        { content: "Second follow-up response." },
      ],
    });

    const result = await harness.run({
      agent: 'simple',
      prompt: 'Initial prompt',
      queuedMessages: [
        { delayMs: 300, content: 'First follow-up' },
        { delayMs: 600, content: 'Second follow-up' },
      ],
      timeout: 15000,
      env: { [MOCK_LLM_VAR]: multiMsgScript },
    });

    cleanupMockScript(multiMsgScript);
    expect(result.exitCode).toBe(0);
  });
});
```

### 5. Mock LLM Script

**REMOVED**: The fixture file approach is not used by this codebase. Instead, use the `createMockScript()` helper function which creates temporary JSON files programmatically. This is already handled in the integration test above.

The mock script format uses `content` (not `text`) for response text:

```typescript
// Correct format for MockScript
{
  responses: [
    {
      content: "I'll start the task.",  // NOT "text"
      toolCalls: [
        { name: "Read", input: { file_path: "/tmp/test.txt" } }
      ]
    },
    { content: "Done with initial task." },
  ]
}
```

### 6. UI Isolation Tests (Not Playwright)

**IMPORTANT**: This project does NOT use Playwright for E2E testing. Instead, it uses:
- **UI Isolation Tests** (`pnpm test:ui`) - Vitest + happy-dom for React component testing
- **E2E Accessibility Tests** (`anvil-test`) - Native macOS accessibility APIs

Create `src/components/simple-task/queued-messages.ui.test.tsx`:

```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueuedMessagesBanner } from './queued-messages-banner';

describe('QueuedMessagesBanner', () => {
  it('renders nothing when no messages queued', () => {
    const { container } = render(<QueuedMessagesBanner messages={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it('shows single queued message', () => {
    render(
      <QueuedMessagesBanner
        messages={[{ id: '1', content: 'Follow-up task', timestamp: Date.now() }]}
      />
    );

    expect(screen.getByText('Queued message')).toBeInTheDocument();
    expect(screen.getByText('Follow-up task')).toBeInTheDocument();
  });

  it('shows plural label for multiple messages', () => {
    render(
      <QueuedMessagesBanner
        messages={[
          { id: '1', content: 'First', timestamp: Date.now() },
          { id: '2', content: 'Second', timestamp: Date.now() },
        ]}
      />
    );

    expect(screen.getByText('Queued messages')).toBeInTheDocument();
  });
});
```

For testing the full SimpleTaskWindow with queued messages, create `src/components/simple-task/simple-task-queuing.ui.test.tsx`:

```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { SimpleTaskWindowContent } from './simple-task-window';
import * as agentService from '@/lib/agent-service';

// Mock agent service
vi.mock('@/lib/agent-service', () => ({
  sendQueuedMessage: vi.fn(),
  confirmQueuedMessage: vi.fn(),
  clearPendingQueuedMessages: vi.fn(),
}));

describe('SimpleTaskWindow queuing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('queues message when agent is streaming', async () => {
    const mockSendQueued = vi.mocked(agentService.sendQueuedMessage);
    mockSendQueued.mockResolvedValue('msg-123');

    // Render with streaming status
    // ... setup component with mocked streaming state ...

    const input = screen.getByTestId('thread-input');
    fireEvent.change(input, { target: { value: 'Follow-up' } });
    fireEvent.submit(input.closest('form')!);

    await waitFor(() => {
      expect(mockSendQueued).toHaveBeenCalledWith(
        expect.any(String), // threadId
        'Follow-up'
      );
    });
  });

  it('shows queued message banner', async () => {
    // ... test implementation depends on component structure ...
  });
});
```

**Note**: The exact test implementation depends on how `SimpleTaskWindowContent` is structured and what props/context it requires. You may need to wrap it in providers or mock additional dependencies.

## Verification

1. Run `cd agents && pnpm test` - all agent unit/integration tests pass
2. Run `pnpm test` (from root) - all frontend tests pass
3. Run `pnpm test:ui` - all UI isolation tests pass
4. Manual testing per checklist below

**Note**: There is no `pnpm test:e2e` command. E2E testing uses the `anvil-test` binary for accessibility-based testing, which is not applicable for this feature.

## Manual Testing Checklist

- [ ] Start task, type follow-up while streaming
- [ ] Verify banner appears with preview
- [ ] Verify message injected into conversation
- [ ] Verify banner disappears after message appears
- [ ] Test multiple queued messages
- [ ] Test queueing during tool execution
- [ ] Test input placeholder changes
- [ ] Test paused state prevents queuing

## Additional Considerations

### Race Conditions
The integration tests use fixed delays (e.g., `delayMs: 500`) to send queued messages. These tests may be flaky if the mock LLM completes faster than expected. Consider:
- Using longer delays in CI environments
- Adding synchronization mechanisms (e.g., wait for specific state before sending)
- Using the mock script to control timing more precisely

### Test File Cleanup
The `cleanupMockScript()` function should be called in `afterEach` for every script created in `beforeEach`. For scripts created within individual tests (like `multiMsgScript`), clean them up before the test assertion to ensure cleanup even on failure:

```typescript
try {
  // ... test logic ...
} finally {
  cleanupMockScript(multiMsgScript);
}
```
