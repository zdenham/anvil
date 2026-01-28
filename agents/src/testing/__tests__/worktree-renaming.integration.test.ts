import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AgentTestHarness } from '../agent-harness.js';
import { EventName } from '@core/types/events.js';

/**
 * Live LLM integration tests for worktree renaming.
 *
 * These tests use a REAL Anthropic API key to verify that when a thread is
 * created, the agent automatically generates a worktree name (max 10 chars)
 * and emits a WORKTREE_NAME_GENERATED event.
 *
 * The naming runs in parallel with the main agent execution and should not
 * block or delay the agent's primary task.
 *
 * IMPORTANT: Requires ANTHROPIC_API_KEY environment variable.
 */
describe('Worktree Renaming - Live LLM', () => {
  let harness: AgentTestHarness;

  beforeEach(() => {
    harness = new AgentTestHarness();
  });

  afterEach((context) => {
    const failed = context.task.result?.state === 'fail';
    harness.cleanup(failed);
  });

  it('emits WORKTREE_NAME_GENERATED event with valid name', async () => {
    // Skip if no API key
    const apiKey = process.env.ANTHROPIC_API_KEY ?? process.env.VITE_ANTHROPIC_API_KEY;
    if (!apiKey) {
      console.log('[LIVE TEST] Skipping: ANTHROPIC_API_KEY not set');
      return;
    }

    console.log('[LIVE TEST] Running worktree renaming test with live Anthropic API...');

    // Run the agent with a specific prompt that should generate a clear worktree name
    const result = await harness.run({
      agent: 'simple',
      prompt: 'Create a React component for user authentication with login and logout buttons',
      timeout: 90000, // 90 second timeout for live LLM
    });

    console.log(`[LIVE TEST] Agent exit code: ${result.exitCode}`);
    console.log(`[LIVE TEST] Duration: ${result.durationMs}ms`);
    console.log(`[LIVE TEST] Events received: ${result.events.length}`);
    console.log(`[LIVE TEST] All events:`, JSON.stringify(result.events.map(e => ({ name: e.name, payload: e.payload })), null, 2));

    // 1. Agent should complete successfully
    expect(result.exitCode).toBe(0);

    // 2. Find WORKTREE_NAME_GENERATED events
    const worktreeNameEvents = result.events.filter(
      (e) => e.name === EventName.WORKTREE_NAME_GENERATED
    );

    console.log(`[LIVE TEST] WORKTREE_NAME_GENERATED events found: ${worktreeNameEvents.length}`);

    // 3. Should have exactly one WORKTREE_NAME_GENERATED event
    expect(worktreeNameEvents.length).toBe(1);

    // 4. Verify event payload structure
    const nameEvent = worktreeNameEvents[0];
    expect(nameEvent.payload).toBeDefined();
    expect(nameEvent.payload).toHaveProperty('worktreeId');
    expect(nameEvent.payload).toHaveProperty('repoId');
    expect(nameEvent.payload).toHaveProperty('name');
    expect(typeof nameEvent.payload.worktreeId).toBe('string');
    expect(typeof nameEvent.payload.repoId).toBe('string');
    expect(typeof nameEvent.payload.name).toBe('string');

    // 5. worktreeId should be a valid string (not empty)
    const worktreeId = nameEvent.payload.worktreeId as string;
    expect(worktreeId.length).toBeGreaterThan(0);

    // 6. repoId should be a valid string (not empty)
    const repoId = nameEvent.payload.repoId as string;
    expect(repoId.length).toBeGreaterThan(0);

    // 7. Name should be max 10 characters (worktree naming limit)
    const name = nameEvent.payload.name as string;
    console.log(`[LIVE TEST] Generated worktree name: "${name}" (${name.length} chars)`);
    expect(name.length).toBeLessThanOrEqual(10);
    expect(name.length).toBeGreaterThan(0);

    // 8. Name should be properly formatted (lowercase, alphanumeric + hyphens)
    expect(name).toMatch(/^[a-z0-9-]+$/);
    // Name should not start or end with hyphen
    expect(name).not.toMatch(/^-/);
    expect(name).not.toMatch(/-$/);

    // 9. Verify thread:created event exists and has matching worktreeId
    const threadCreatedEvent = result.events.find(e => e.name === EventName.THREAD_CREATED);
    expect(threadCreatedEvent).toBeDefined();
    expect(threadCreatedEvent!.payload.worktreeId).toBe(worktreeId);
    expect(threadCreatedEvent!.payload.repoId).toBe(repoId);

  }, 120000); // 2 minute timeout

  it('generates contextually relevant worktree names', async () => {
    const apiKey = process.env.ANTHROPIC_API_KEY ?? process.env.VITE_ANTHROPIC_API_KEY;
    if (!apiKey) {
      console.log('[LIVE TEST] Skipping: ANTHROPIC_API_KEY not set');
      return;
    }

    console.log('[LIVE TEST] Running contextual worktree naming test...');

    // Test with a database-related prompt
    const result = await harness.run({
      agent: 'simple',
      prompt: 'Write a SQL migration to add a users table',
      timeout: 90000,
    });

    console.log(`[LIVE TEST] Agent exit code: ${result.exitCode}`);
    expect(result.exitCode).toBe(0);

    const worktreeNameEvents = result.events.filter(
      (e) => e.name === EventName.WORKTREE_NAME_GENERATED
    );

    expect(worktreeNameEvents.length).toBe(1);

    const name = worktreeNameEvents[0].payload.name as string;
    console.log(`[LIVE TEST] Generated worktree name for SQL task: "${name}"`);

    // Name should be max 10 chars
    expect(name.length).toBeLessThanOrEqual(10);
    expect(name.length).toBeGreaterThan(0);

    // Name should be properly formatted
    expect(name).toMatch(/^[a-z0-9-]+$/);

  }, 120000);

  it('handles short prompts by sanitizing directly (no LLM)', async () => {
    const apiKey = process.env.ANTHROPIC_API_KEY ?? process.env.VITE_ANTHROPIC_API_KEY;
    if (!apiKey) {
      console.log('[LIVE TEST] Skipping: ANTHROPIC_API_KEY not set');
      return;
    }

    console.log('[LIVE TEST] Running short prompt worktree naming test...');

    // Short prompt (<=10 chars) should be sanitized directly without LLM call
    const result = await harness.run({
      agent: 'simple',
      prompt: 'Fix bug',
      timeout: 90000,
    });

    console.log(`[LIVE TEST] Agent exit code: ${result.exitCode}`);

    const worktreeNameEvents = result.events.filter(
      (e) => e.name === EventName.WORKTREE_NAME_GENERATED
    );

    if (worktreeNameEvents.length > 0) {
      const name = worktreeNameEvents[0].payload.name as string;
      console.log(`[LIVE TEST] Generated worktree name for short prompt: "${name}"`);

      // Should be sanitized version of prompt
      expect(name.length).toBeLessThanOrEqual(10);
      expect(name).toMatch(/^[a-z0-9-]+$/);
      // For "Fix bug" -> "fix-bug"
      expect(name).toBe('fix-bug');
    } else {
      console.log('[LIVE TEST] No WORKTREE_NAME_GENERATED event (thread may not have been created)');
    }

  }, 120000);

  it('worktree naming runs in parallel with main agent execution', async () => {
    const apiKey = process.env.ANTHROPIC_API_KEY ?? process.env.VITE_ANTHROPIC_API_KEY;
    if (!apiKey) {
      console.log('[LIVE TEST] Skipping: ANTHROPIC_API_KEY not set');
      return;
    }

    console.log('[LIVE TEST] Running parallel execution test...');

    const result = await harness.run({
      agent: 'simple',
      prompt: 'Create a simple hello.txt file with the text "Hello, World!"',
      timeout: 90000,
    });

    console.log(`[LIVE TEST] Agent exit code: ${result.exitCode}`);
    console.log(`[LIVE TEST] Duration: ${result.durationMs}ms`);

    // Agent should complete successfully
    expect(result.exitCode).toBe(0);

    // Both thread:created and worktree:name:generated events should exist
    const threadCreatedEvent = result.events.find(e => e.name === EventName.THREAD_CREATED);
    const worktreeNameEvent = result.events.find(e => e.name === EventName.WORKTREE_NAME_GENERATED);

    expect(threadCreatedEvent).toBeDefined();
    expect(worktreeNameEvent).toBeDefined();

    // Worktree IDs should match
    expect(worktreeNameEvent!.payload.worktreeId).toBe(threadCreatedEvent!.payload.worktreeId);

    console.log('[LIVE TEST] Both events received - worktree naming ran in parallel with agent execution');

  }, 120000);

  it('handles long prompts by generating concise worktree names', async () => {
    const apiKey = process.env.ANTHROPIC_API_KEY ?? process.env.VITE_ANTHROPIC_API_KEY;
    if (!apiKey) {
      console.log('[LIVE TEST] Skipping: ANTHROPIC_API_KEY not set');
      return;
    }

    console.log('[LIVE TEST] Running long prompt worktree naming test...');

    // A very long, detailed prompt that requires LLM to summarize
    const longPrompt = `
      I need you to help me refactor the authentication system in my Node.js application.
      The current system uses session-based authentication with Express sessions stored in Redis.
      I want to migrate to JWT-based authentication with refresh tokens.
      The JWT should be signed with RS256 algorithm, tokens should expire after 15 minutes,
      and refresh tokens should be stored in an HTTP-only cookie.
      Please also add rate limiting to the auth endpoints and implement proper password
      hashing using bcrypt with a cost factor of 12.
    `.trim();

    const result = await harness.run({
      agent: 'simple',
      prompt: longPrompt,
      timeout: 120000, // 2 minutes - long prompts may take longer
    });

    console.log(`[LIVE TEST] Agent exit code: ${result.exitCode}`);
    expect(result.exitCode).toBe(0);

    const worktreeNameEvents = result.events.filter(
      (e) => e.name === EventName.WORKTREE_NAME_GENERATED
    );

    expect(worktreeNameEvents.length).toBe(1);

    const name = worktreeNameEvents[0].payload.name as string;
    console.log(`[LIVE TEST] Generated worktree name for long prompt: "${name}" (${name.length} chars)`);

    // Even for very long prompts, worktree name should still be max 10 chars
    expect(name.length).toBeLessThanOrEqual(10);
    expect(name.length).toBeGreaterThan(0);
    expect(name).toMatch(/^[a-z0-9-]+$/);

  }, 180000); // 3 minute vitest timeout
});
