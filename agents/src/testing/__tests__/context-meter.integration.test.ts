import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AgentTestHarness } from '../agent-harness.js';
import type { TokenUsage } from '@core/types/events.js';

/**
 * Live LLM integration tests for token usage / context meter.
 *
 * These tests use a REAL Anthropic API key to verify that when the agent
 * runs, it emits state messages containing `lastCallUsage` data with token
 * counts, and that the final state includes `metrics.lastCallUsage` after
 * completion.
 *
 * IMPORTANT: Requires ANTHROPIC_API_KEY environment variable.
 */
describe('Context Meter - Live LLM', () => {
  let harness: AgentTestHarness;

  beforeEach(() => {
    harness = new AgentTestHarness();
  });

  afterEach((context) => {
    const failed = context.task.result?.state === 'fail';
    harness.cleanup(failed);
  });

  it('emits token usage in state during agent execution', async () => {
    const apiKey = process.env.ANTHROPIC_API_KEY ?? process.env.VITE_ANTHROPIC_API_KEY;
    if (!apiKey) {
      console.log('[LIVE TEST] Skipping: ANTHROPIC_API_KEY not set');
      return;
    }

    console.log('[LIVE TEST] Running token usage emission test with live Anthropic API...');

    const result = await harness.run({
      prompt: 'Reply with exactly: "Hello, world!" and nothing else.',
      timeout: 90000,
    });

    console.log(`[LIVE TEST] Agent exit code: ${result.exitCode}`);
    console.log(`[LIVE TEST] Duration: ${result.durationMs}ms`);
    console.log(`[LIVE TEST] Total state messages: ${result.states.length}`);

    // Agent should complete successfully
    expect(result.exitCode).toBe(0);

    // Find state messages that have usage data
    const statesWithUsage = result.states.filter(s => s.state.lastCallUsage);

    console.log(`[LIVE TEST] States with usage data: ${statesWithUsage.length}`);
    if (statesWithUsage.length > 0) {
      const firstUsage = statesWithUsage[0].state.lastCallUsage as TokenUsage;
      console.log(`[LIVE TEST] First usage: inputTokens=${firstUsage.inputTokens}, outputTokens=${firstUsage.outputTokens}, cacheCreation=${firstUsage.cacheCreationTokens}, cacheRead=${firstUsage.cacheReadTokens}`);
    }

    // At least one state should have usage data
    expect(statesWithUsage.length).toBeGreaterThan(0);

    // Verify the usage has reasonable values
    const usage = statesWithUsage[0].state.lastCallUsage!;
    expect(usage.inputTokens).toBeGreaterThan(0);
    expect(usage.outputTokens).toBeGreaterThan(0);

    // Sanity check: input tokens should be less than 200,000
    expect(usage.inputTokens).toBeLessThan(200000);

    console.log('[LIVE TEST] Token usage emission test passed');
  }, 120000);

  it('includes lastCallUsage in final metrics after completion', async () => {
    const apiKey = process.env.ANTHROPIC_API_KEY ?? process.env.VITE_ANTHROPIC_API_KEY;
    if (!apiKey) {
      console.log('[LIVE TEST] Skipping: ANTHROPIC_API_KEY not set');
      return;
    }

    console.log('[LIVE TEST] Running final metrics usage test with live Anthropic API...');

    const result = await harness.run({
      prompt: 'Reply with exactly: "Hello, world!" and nothing else.',
      timeout: 90000,
    });

    console.log(`[LIVE TEST] Agent exit code: ${result.exitCode}`);
    console.log(`[LIVE TEST] Duration: ${result.durationMs}ms`);
    console.log(`[LIVE TEST] Total state messages: ${result.states.length}`);

    // Agent should complete successfully
    expect(result.exitCode).toBe(0);

    // Get the final state
    expect(result.states.length).toBeGreaterThan(0);
    const finalState = result.states[result.states.length - 1];

    console.log(`[LIVE TEST] Final state status: ${finalState.state.status}`);
    console.log(`[LIVE TEST] Final state has metrics: ${!!finalState.state.metrics}`);
    if (finalState.state.metrics) {
      console.log(`[LIVE TEST] Final metrics: ${JSON.stringify(finalState.state.metrics)}`);
    }
    if (finalState.state.lastCallUsage) {
      console.log(`[LIVE TEST] Final state lastCallUsage: ${JSON.stringify(finalState.state.lastCallUsage)}`);
    }

    // Final state should be complete
    expect(finalState.state.status).toBe('complete');

    // Final state should have metrics
    expect(finalState.state.metrics).toBeDefined();

    // metrics.lastCallUsage should be populated
    const metricsUsage = finalState.state.metrics!.lastCallUsage;
    expect(metricsUsage).toBeDefined();
    expect(metricsUsage!.inputTokens).toBeGreaterThan(0);
    expect(metricsUsage!.outputTokens).toBeGreaterThan(0);

    console.log(`[LIVE TEST] Final metrics.lastCallUsage: inputTokens=${metricsUsage!.inputTokens}, outputTokens=${metricsUsage!.outputTokens}`);
    console.log('[LIVE TEST] Final metrics usage test passed');
  }, 120000);
});
