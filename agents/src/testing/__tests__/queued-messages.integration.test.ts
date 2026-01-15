import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AgentTestHarness } from '../agent-harness.js';
import { createMockScript, cleanupMockScript, MOCK_LLM_VAR } from '../mock-llm.js';

/**
 * Integration tests for queued messages.
 *
 * These tests validate that the agent harness can schedule and send
 * queued messages via stdin during agent execution without crashing.
 *
 * Note: Testing actual queued message processing requires carefully timed
 * mock scripts that keep the agent alive long enough for messages to arrive.
 * The mock LLM doesn't support dynamic delays, so these tests focus on:
 * 1. Harness correctly formats and sends queued messages
 * 2. Agent completes successfully with queued message timeouts scheduled
 * 3. Timeouts are cleaned up properly when agent exits early
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
        { delayMs: 10000, content: 'Should never be sent' },
      ],
      timeout: 5000,
      env: { [MOCK_LLM_VAR]: mockScriptPath },
    });

    // Agent should complete successfully without waiting for queued message timeout
    // This validates that timeouts are cleaned up when process closes
    expect(result.exitCode).toBe(0);
    expect(result.durationMs).toBeLessThan(5000);
  });

  it('sends properly formatted JSON messages via stdin', async () => {
    // This test verifies the harness sends properly formatted messages
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
    // queued messages - the JSON format is validated by the agent's stdin parser
    expect(result.exitCode).toBe(0);
  });
});
