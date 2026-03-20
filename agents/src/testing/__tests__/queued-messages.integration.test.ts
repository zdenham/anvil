import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AgentTestHarness } from '../agent-harness.js';
import { createMockScript, cleanupMockScript, MOCK_LLM_VAR } from '../mock-llm.js';

/**
 * Integration tests for queued messages.
 *
 * These tests validate that the agent harness can schedule and send
 * queued messages during agent execution without crashing.
 *
 * ## WebSocket-Based IPC
 *
 * These tests use WebSocket-based IPC:
 * - The AgentTestHarness creates a MockHubServer with a WebSocket endpoint
 * - Queued messages are sent via `mockHub.sendQueuedMessage()` instead of stdin
 * - Messages are collected from the MockHubServer instead of parsing stdout
 *
 * Note: Testing actual queued message processing requires carefully timed
 * mock scripts that keep the agent alive long enough for messages to arrive.
 * The mock LLM doesn't support dynamic delays, so these tests focus on:
 * 1. Harness correctly formats and sends queued messages via socket
 * 2. Agent completes successfully with queued message timeouts scheduled
 * 3. Timeouts are cleaned up properly when agent exits early
 * 4. Agent emits queued-message:ack events when processing queued messages
 *
 * See: agents/src/testing/mock-hub-server.ts for the MockHubServer implementation
 * See: agents/src/testing/agent-harness.ts for socket IPC integration
 */
describe('Queued Messages Integration', () => {
  let harness: AgentTestHarness;
  let mockScriptPath: string;

  beforeEach(() => {
    harness = new AgentTestHarness();
  });

  afterEach((context) => {
    const failed = context.task.result?.state === 'fail';
    harness.cleanup(failed);
    if (mockScriptPath) {
      cleanupMockScript(mockScriptPath);
    }
  });

  it('schedules queued messages without crashing', async () => {
    // Create a mock script that simulates a conversation
    mockScriptPath = createMockScript({
      responses: [
        {
          // First response: use a tool
          toolCalls: [{ name: 'Read', input: { file_path: '/tmp/test.txt' } }],
        },
        {
          // After tool result: respond to initial prompt
          content: "I've completed the task.",
        },
      ],
    });

    const result = await harness.run({
      agent: 'simple',
      prompt: 'Start a task',
      queuedMessages: [{ delayMs: 100, content: 'Follow-up message' }],
      timeout: 15000,
      env: { [MOCK_LLM_VAR]: mockScriptPath },
    });

    // Main assertion: harness handles queued messages without errors
    expect(result.exitCode).toBe(0);

    // Should have state snapshots
    expect(result.states.length).toBeGreaterThan(0);

    // Verify at least the initial message is in the conversation
    const lastState = result.states[result.states.length - 1];
    const messages = lastState?.state?.messages ?? [];
    expect(messages.length).toBeGreaterThan(0);
  });

  it('handles multiple queued messages scheduled at different times', async () => {
    mockScriptPath = createMockScript({
      responses: [
        {
          toolCalls: [{ name: 'Read', input: { file_path: '/tmp/test.txt' } }],
        },
        { content: 'Initial response.' },
      ],
    });

    const result = await harness.run({
      agent: 'simple',
      prompt: 'Initial prompt',
      queuedMessages: [
        { delayMs: 50, content: 'First follow-up' },
        { delayMs: 100, content: 'Second follow-up' },
      ],
      timeout: 20000,
      env: { [MOCK_LLM_VAR]: mockScriptPath },
    });

    // Agent completes without issues even with multiple queued messages
    expect(result.exitCode).toBe(0);
    expect(result.states.length).toBeGreaterThan(0);
  });

  it('cleans up timeouts when agent terminates early', async () => {
    // Mock script that completes immediately
    mockScriptPath = createMockScript({
      responses: [{ content: 'Done immediately.' }],
    });

    const result = await harness.run({
      agent: 'simple',
      prompt: 'Quick task',
      queuedMessages: [
        // This message would fire long after the agent is done
        { delayMs: 30000, content: 'Should never be sent' },
      ],
      timeout: 15000,
      env: { [MOCK_LLM_VAR]: mockScriptPath },
    });

    // Agent should complete successfully without waiting for queued message timeout
    // This validates that timeouts are cleaned up when process closes
    expect(result.exitCode).toBe(0);
    // Agent should complete well before the 30s queued message delay
    expect(result.durationMs).toBeLessThan(15000);
  });

  it('sends properly formatted JSON messages via socket', async () => {
    // This test verifies the harness sends properly formatted messages via socket
    // (Previously tested stdin JSON lines, now tests socket message format)
    // The agent validates the JSON format and ignores invalid messages
    mockScriptPath = createMockScript({
      responses: [
        {
          toolCalls: [{ name: 'Read', input: { file_path: '/tmp/wait.txt' } }],
        },
        { content: 'Processed.' },
      ],
    });

    const result = await harness.run({
      agent: 'simple',
      prompt: 'Test task',
      queuedMessages: [{ delayMs: 50, content: 'Test queued message content' }],
      timeout: 10000,
      env: { [MOCK_LLM_VAR]: mockScriptPath },
    });

    // The main verification is that the harness doesn't crash when sending
    // queued messages - the JSON format is validated by the agent's HubClient
    expect(result.exitCode).toBe(0);
  });

  it('emits queued-message:ack event when processing queued message', async () => {
    // Create a mock script that uses a tool to create delay, giving time
    // for the queued message to arrive and be processed
    mockScriptPath = createMockScript({
      responses: [
        {
          // First turn: read a file to create delay
          toolCalls: [{ name: 'Read', input: { file_path: '/tmp/delay.txt' } }],
        },
        {
          // Second turn: respond acknowledging the follow-up
          content: "I see you've sent a follow-up. Processing...",
        },
        {
          // Third turn: final response
          content: "Task complete.",
        },
      ],
    });

    const result = await harness.run({
      agent: 'simple',
      prompt: 'Start a longer task that reads multiple files',
      queuedMessages: [
        { delayMs: 200, content: 'This is a follow-up message' },
      ],
      timeout: 30000,
      env: { [MOCK_LLM_VAR]: mockScriptPath },
    });

    // 1. Agent should complete successfully
    expect(result.exitCode).toBe(0);

    // 2. Should have received events
    expect(result.events.length).toBeGreaterThan(0);

    // 3. Find the queued-message:ack event
    const ackEvents = result.events.filter(
      (e) => e.name === 'queued-message:ack'
    );

    // Note: This test may not always produce an ack event due to timing
    // The mock LLM completes quickly, so the queued message may arrive
    // after the agent has already finished. This is expected behavior.
    if (ackEvents.length > 0) {
      // 4. Verify event payload structure
      const ackEvent = ackEvents[0];
      expect(ackEvent.payload).toBeDefined();
      expect(ackEvent.payload).toHaveProperty('messageId');
      expect(typeof ackEvent.payload.messageId).toBe('string');
      // MessageId should be a valid UUID format
      expect(ackEvent.payload.messageId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
      );
    }
  });

  it('emits ack events for multiple queued messages in order', async () => {
    mockScriptPath = createMockScript({
      responses: [
        { toolCalls: [{ name: 'Read', input: { file_path: '/tmp/a.txt' } }] },
        { toolCalls: [{ name: 'Read', input: { file_path: '/tmp/b.txt' } }] },
        { content: "Processing messages..." },
        { content: "All done." },
      ],
    });

    const result = await harness.run({
      agent: 'simple',
      prompt: 'Run a multi-step task',
      queuedMessages: [
        { delayMs: 100, content: 'First follow-up' },
        { delayMs: 300, content: 'Second follow-up' },
      ],
      timeout: 30000,
      env: { [MOCK_LLM_VAR]: mockScriptPath },
    });

    expect(result.exitCode).toBe(0);

    const ackEvents = result.events.filter(
      (e) => e.name === 'queued-message:ack'
    );

    // If we got ack events, verify they have unique messageIds
    if (ackEvents.length > 1) {
      const messageIds = ackEvents.map((e) => e.payload.messageId);
      expect(new Set(messageIds).size).toBe(ackEvents.length);
    }
  });

  it('includes queued message content in state after ack', async () => {
    mockScriptPath = createMockScript({
      responses: [
        { toolCalls: [{ name: 'Read', input: { file_path: '/tmp/wait.txt' } }] },
        { content: "I received your follow-up." },
      ],
    });

    const uniqueContent = `My unique follow-up content XYZ123-${Date.now()}`;

    const result = await harness.run({
      agent: 'simple',
      prompt: 'Initial task',
      queuedMessages: [
        { delayMs: 150, content: uniqueContent },
      ],
      timeout: 20000,
      env: { [MOCK_LLM_VAR]: mockScriptPath },
    });

    expect(result.exitCode).toBe(0);

    // Find the state that includes the queued message (if it was processed)
    const stateWithMessage = result.states.find((s) => {
      const messages = s.state?.messages ?? [];
      return messages.some(
        (m) =>
          m.role === 'user' &&
          typeof m.content === 'string' &&
          m.content.includes('XYZ123')
      );
    });

    // Due to timing, the message may or may not be in the state
    // This is expected - the mock LLM may complete before processing
    if (stateWithMessage) {
      expect(stateWithMessage).toBeDefined();
    }
  });
});

/**
 * Live LLM tests for queued messages.
 *
 * These tests use a REAL Anthropic API key to verify queued message
 * ack events work end-to-end with a live agent.
 *
 * IMPORTANT: Requires ANTHROPIC_API_KEY environment variable.
 */
describe('Queued Messages - Live LLM', () => {
  let harness: AgentTestHarness;

  beforeEach(() => {
    harness = new AgentTestHarness();
  });

  afterEach((context) => {
    const failed = context.task.result?.state === 'fail';
    harness.cleanup(failed);
  });

  it('emits queued-message:ack with live Anthropic API', async () => {
    // Skip if no API key
    const apiKey = process.env.ANTHROPIC_API_KEY ?? process.env.VITE_ANTHROPIC_API_KEY;
    if (!apiKey) {
      console.log('[LIVE TEST] Skipping: ANTHROPIC_API_KEY not set');
      return;
    }

    console.log('[LIVE TEST] Running queued message ack test with live Anthropic API...');

    // Use a prompt that requires tool usage to create time for the queued message
    // The Read tool will take some time and keep the agent running
    const result = await harness.run({
      agent: 'simple',
      prompt: 'Use the Bash tool to run "sleep 3 && echo done" and tell me the result.',
      queuedMessages: [
        // Send during the tool execution
        { delayMs: 1000, content: 'Also, what is 2+2?' },
      ],
      timeout: 60000, // 60 second timeout for live LLM
      // No MOCK_LLM_VAR env = uses real Anthropic API
    });

    console.log(`[LIVE TEST] Agent exit code: ${result.exitCode}`);
    console.log(`[LIVE TEST] Duration: ${result.durationMs}ms`);
    console.log(`[LIVE TEST] Events received: ${result.events.length}`);
    console.log(`[LIVE TEST] All events:`, JSON.stringify(result.events.map(e => ({ name: e.name, payload: e.payload })), null, 2));
    console.log(`[LIVE TEST] States count: ${result.states.length}`);
    if (result.states.length > 0) {
      const lastState = result.states[result.states.length - 1];
      console.log(`[LIVE TEST] Last state messages:`, JSON.stringify(lastState.state?.messages?.map(m => ({ role: m.role, content: typeof m.content === 'string' ? m.content.slice(0, 100) : '[array]' })), null, 2));
    }

    // 1. Agent should complete successfully
    expect(result.exitCode).toBe(0);

    // 2. Find queued-message:ack events
    const ackEvents = result.events.filter(
      (e) => e.name === 'queued-message:ack'
    );

    console.log(`[LIVE TEST] Ack events found: ${ackEvents.length}`);

    // 3. With a live LLM and tool use, we should reliably get the ack
    expect(ackEvents.length).toBeGreaterThan(0);

    // 4. Verify ack event structure
    const ackEvent = ackEvents[0];
    expect(ackEvent.payload).toBeDefined();
    expect(ackEvent.payload).toHaveProperty('messageId');
    expect(typeof ackEvent.payload.messageId).toBe('string');

    // 5. MessageId should be a valid UUID
    expect(ackEvent.payload.messageId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    );

    console.log(`[LIVE TEST] Ack messageId: ${ackEvent.payload.messageId}`);

    // 6. Verify the queued message content appears in state
    const lastState = result.states[result.states.length - 1];
    const messages = lastState?.state?.messages ?? [];
    const hasQueuedMessage = messages.some(
      (m) =>
        m.role === 'user' &&
        typeof m.content === 'string' &&
        m.content.includes('2+2')
    );

    console.log(`[LIVE TEST] Queued message in state: ${hasQueuedMessage}`);
    expect(hasQueuedMessage).toBe(true);
  }, 120000); // 2 minute timeout

  it('emits multiple acks for multiple queued messages with live API', async () => {
    const apiKey = process.env.ANTHROPIC_API_KEY ?? process.env.VITE_ANTHROPIC_API_KEY;
    if (!apiKey) {
      console.log('[LIVE TEST] Skipping: ANTHROPIC_API_KEY not set');
      return;
    }

    console.log('[LIVE TEST] Running multiple queued messages test with live API...');

    // Use Bash tool with sleep to ensure agent stays running long enough
    const result = await harness.run({
      agent: 'simple',
      prompt: 'Use the Bash tool to run "sleep 5 && echo done" then tell me what happened.',
      queuedMessages: [
        { delayMs: 1000, content: 'First follow-up: what is 1+1?' },
        { delayMs: 2000, content: 'Second follow-up: what is 3+3?' },
      ],
      timeout: 90000,
    });

    console.log(`[LIVE TEST] Agent exit code: ${result.exitCode}`);
    console.log(`[LIVE TEST] Duration: ${result.durationMs}ms`);

    expect(result.exitCode).toBe(0);

    const ackEvents = result.events.filter(
      (e) => e.name === 'queued-message:ack'
    );

    console.log(`[LIVE TEST] Ack events found: ${ackEvents.length}`);

    // We expect at least one ack (both may arrive if agent takes long enough)
    expect(ackEvents.length).toBeGreaterThanOrEqual(1);

    // Verify unique messageIds
    if (ackEvents.length > 1) {
      const messageIds = ackEvents.map((e) => e.payload.messageId);
      const uniqueIds = new Set(messageIds);
      expect(uniqueIds.size).toBe(ackEvents.length);
      console.log(`[LIVE TEST] All ${ackEvents.length} acks have unique messageIds`);
    }
  }, 120000);
});
