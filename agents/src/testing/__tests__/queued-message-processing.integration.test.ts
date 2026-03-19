import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AgentTestHarness } from '../agent-harness.js';

/**
 * Live LLM test: verifies the SDK actually processes a queued follow-up message.
 *
 * Sends a prompt that keeps the agent busy (Bash sleep), then queues a follow-up.
 * If the SDK handles the follow-up correctly, the final conversation should contain
 * an assistant response to the queued message.
 *
 * This catches the bug where a queued message gets acked (written to state.json)
 * but never actually processed by Claude — the reconciliation false positive.
 */
describe('Queued Message Processing - Live LLM', () => {
  let harness: AgentTestHarness;

  beforeEach(() => {
    harness = new AgentTestHarness();
  });

  afterEach((context) => {
    const failed = context.task.result?.state === 'fail';
    harness.cleanup(failed);
  });

  it('processes a queued follow-up that overrides the initial prompt', async () => {
    const apiKey = process.env.ANTHROPIC_API_KEY ?? process.env.VITE_ANTHROPIC_API_KEY;
    if (!apiKey) {
      console.log('[SKIP] ANTHROPIC_API_KEY not set');
      return;
    }

    const result = await harness.run({
      prompt:
        'Use the Bash tool to run "sleep 4 && echo hello" and then reply with ONLY the number 1. Just the digit 1, nothing else.',
      queuedMessages: [
        {
          // Send while the Bash sleep is running
          delayMs: 2000,
          content:
            'Nevermind my previous message. Reply with ONLY the number 2. Just the digit 2, nothing else.',
        },
      ],
      timeout: 90_000,
    });

    console.log(`[LIVE] exit=${result.exitCode} duration=${result.durationMs}ms`);
    console.log(`[LIVE] events: ${result.events.map((e) => e.name).join(', ')}`);

    // Dump messages for debugging
    const lastState = result.states[result.states.length - 1];
    const messages = lastState?.state?.messages ?? [];
    for (const m of messages) {
      const text =
        typeof m.content === 'string'
          ? m.content.slice(0, 200)
          : JSON.stringify(m.content).slice(0, 200);
      console.log(`[LIVE] ${m.role}: ${text}`);
    }

    expect(result.exitCode).toBe(0);

    // The queued message should have been acked
    const acks = result.events.filter((e) => e.name === 'queued-message:ack');
    console.log(`[LIVE] ack events: ${acks.length}`);
    expect(acks.length).toBeGreaterThan(0);

    // Find the queued user message in the conversation
    const queuedMsgIndex = messages.findIndex(
      (m) =>
        m.role === 'user' &&
        typeof m.content === 'string' &&
        m.content.includes('number 2')
    );
    console.log(`[LIVE] queued message index: ${queuedMsgIndex}`);
    expect(queuedMsgIndex).toBeGreaterThan(0);

    // There should be an assistant response AFTER the queued message
    const responsesAfter = messages
      .slice(queuedMsgIndex + 1)
      .filter((m) => m.role === 'assistant');
    console.log(
      `[LIVE] assistant responses after queued msg: ${responsesAfter.length}`
    );

    expect(responsesAfter.length).toBeGreaterThan(0);

    // The response after the queued message should contain "2"
    const lastAssistantContent = responsesAfter
      .map((m) => (typeof m.content === 'string' ? m.content : ''))
      .join(' ');
    console.log(`[LIVE] final assistant text: "${lastAssistantContent}"`);
    expect(lastAssistantContent).toContain('2');
  }, 120_000);
});
