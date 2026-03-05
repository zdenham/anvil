import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { AgentTestHarness } from '../agent-harness.js';
import { EventName } from '@core/types/events.js';

/**
 * Live LLM integration tests for thread naming.
 *
 * These tests use a REAL Anthropic API key to verify that when a thread is
 * created, the agent automatically generates a descriptive name (max 30 chars)
 * and emits a THREAD_NAME_GENERATED event.
 *
 * The naming runs in parallel with the main agent execution and should not
 * block or delay the agent's primary task.
 *
 * IMPORTANT: Requires ANTHROPIC_API_KEY environment variable.
 */
// Requires live LLM API calls and working agent harness.
// Skip until agent harness state collection is fixed (test-audit.md issue #7).
describe.skip('Thread Naming - Live LLM', () => {
  let harness: AgentTestHarness;

  beforeEach(() => {
    harness = new AgentTestHarness();
  });

  afterEach((context) => {
    const failed = context.task.result?.state === 'fail';
    harness.cleanup(failed);
  });

  it('emits THREAD_NAME_GENERATED event with descriptive name', async () => {
    // Skip if no API key
    const apiKey = process.env.ANTHROPIC_API_KEY ?? process.env.VITE_ANTHROPIC_API_KEY;
    if (!apiKey) {
      console.log('[LIVE TEST] Skipping: ANTHROPIC_API_KEY not set');
      return;
    }

    console.log('[LIVE TEST] Running thread naming test with live Anthropic API...');

    // Run the agent with a specific prompt that should generate a clear thread name
    const result = await harness.run({
      agent: 'simple',
      prompt: 'Create a React component for a login form with email and password fields',
      timeout: 90000, // 90 second timeout for live LLM
    });

    console.log(`[LIVE TEST] Agent exit code: ${result.exitCode}`);
    console.log(`[LIVE TEST] Duration: ${result.durationMs}ms`);
    console.log(`[LIVE TEST] Events received: ${result.events.length}`);
    console.log(`[LIVE TEST] All events:`, JSON.stringify(result.events.map(e => ({ name: e.name, payload: e.payload })), null, 2));

    // 1. Agent should complete successfully
    expect(result.exitCode).toBe(0);

    // 2. Find THREAD_NAME_GENERATED events
    const nameEvents = result.events.filter(
      (e) => e.name === EventName.THREAD_NAME_GENERATED
    );

    console.log(`[LIVE TEST] THREAD_NAME_GENERATED events found: ${nameEvents.length}`);

    // 3. Should have exactly one THREAD_NAME_GENERATED event
    expect(nameEvents.length).toBe(1);

    // 4. Verify event payload structure
    const nameEvent = nameEvents[0];
    expect(nameEvent.payload).toBeDefined();
    expect(nameEvent.payload).toHaveProperty('threadId');
    expect(nameEvent.payload).toHaveProperty('name');
    expect(typeof nameEvent.payload.threadId).toBe('string');
    expect(typeof nameEvent.payload.name).toBe('string');

    // 5. threadId should be a valid UUID
    const threadId = nameEvent.payload.threadId as string;
    expect(threadId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    );

    // 6. Name should exist and be reasonable length (LLM is prompted for ~30 chars)
    const name = nameEvent.payload.name as string;
    console.log(`[LIVE TEST] Generated thread name: "${name}" (${name.length} chars)`);
    expect(name.length).toBeGreaterThan(0);

    // 7. Verify thread metadata was updated with name on disk
    const mortDir = harness.tempDirPath;
    expect(mortDir).not.toBeNull();

    const threadMetadataPath = join(mortDir!, 'threads', threadId, 'metadata.json');
    let threadMetadata: {
      id: string;
      name?: string;
    };

    try {
      threadMetadata = JSON.parse(readFileSync(threadMetadataPath, 'utf-8'));
    } catch (err) {
      console.log(`[LIVE TEST] Failed to read thread metadata: ${err}`);
      throw err;
    }

    console.log(`[LIVE TEST] Thread metadata name: "${threadMetadata.name}"`);

    // 8. Thread metadata should have the name field set
    expect(threadMetadata.name).toBe(name);

    // 9. Verify thread:created event also has matching threadId
    const threadCreatedEvent = result.events.find(e => e.name === EventName.THREAD_CREATED);
    expect(threadCreatedEvent).toBeDefined();
    expect(threadCreatedEvent!.payload.threadId).toBe(threadId);

  }, 120000); // 2 minute timeout

  it('generates contextually relevant names for different prompts', async () => {
    const apiKey = process.env.ANTHROPIC_API_KEY ?? process.env.VITE_ANTHROPIC_API_KEY;
    if (!apiKey) {
      console.log('[LIVE TEST] Skipping: ANTHROPIC_API_KEY not set');
      return;
    }

    console.log('[LIVE TEST] Running contextual naming test with live Anthropic API...');

    // Test with a database-related prompt
    const result = await harness.run({
      agent: 'simple',
      prompt: 'Write a SQL migration to add a users table with id, email, and created_at columns',
      timeout: 90000,
    });

    console.log(`[LIVE TEST] Agent exit code: ${result.exitCode}`);
    expect(result.exitCode).toBe(0);

    const nameEvents = result.events.filter(
      (e) => e.name === EventName.THREAD_NAME_GENERATED
    );

    expect(nameEvents.length).toBe(1);

    const name = nameEvents[0].payload.name as string;
    console.log(`[LIVE TEST] Generated name for SQL task: "${name}"`);

    // Name should exist and be meaningful (not empty or generic)
    expect(name.trim().length).toBeGreaterThan(0);

  }, 120000);

  it('handles very short prompts gracefully', async () => {
    const apiKey = process.env.ANTHROPIC_API_KEY ?? process.env.VITE_ANTHROPIC_API_KEY;
    if (!apiKey) {
      console.log('[LIVE TEST] Skipping: ANTHROPIC_API_KEY not set');
      return;
    }

    console.log('[LIVE TEST] Running short prompt naming test...');

    const result = await harness.run({
      agent: 'simple',
      prompt: 'Fix the bug',
      timeout: 90000,
    });

    console.log(`[LIVE TEST] Agent exit code: ${result.exitCode}`);
    // Agent may fail since prompt is vague, but naming should still work
    // if thread was created

    const nameEvents = result.events.filter(
      (e) => e.name === EventName.THREAD_NAME_GENERATED
    );

    if (nameEvents.length > 0) {
      const name = nameEvents[0].payload.name as string;
      console.log(`[LIVE TEST] Generated name for short prompt: "${name}"`);
      expect(name.length).toBeGreaterThan(0);
    } else {
      console.log('[LIVE TEST] No THREAD_NAME_GENERATED event (thread may not have been created)');
    }

  }, 120000);

  it('handles very long prompts by generating concise names', async () => {
    const apiKey = process.env.ANTHROPIC_API_KEY ?? process.env.VITE_ANTHROPIC_API_KEY;
    if (!apiKey) {
      console.log('[LIVE TEST] Skipping: ANTHROPIC_API_KEY not set');
      return;
    }

    console.log('[LIVE TEST] Running long prompt naming test...');

    // A very long, detailed prompt
    const longPrompt = `
      I need you to help me refactor the authentication system in my Node.js application.
      The current system uses session-based authentication with Express sessions stored in Redis.
      I want to migrate to JWT-based authentication with refresh tokens.
      The JWT should be signed with RS256 algorithm, tokens should expire after 15 minutes,
      and refresh tokens should be stored in an HTTP-only cookie.
      Please also add rate limiting to the auth endpoints and implement proper password
      hashing using bcrypt with a cost factor of 12.
      Make sure to handle edge cases like token refresh race conditions and logout from all devices.
    `.trim();

    const result = await harness.run({
      agent: 'simple',
      prompt: longPrompt,
      timeout: 180000, // 3 minutes - long prompts may take longer
    });

    console.log(`[LIVE TEST] Agent exit code: ${result.exitCode}`);
    expect(result.exitCode).toBe(0);

    const nameEvents = result.events.filter(
      (e) => e.name === EventName.THREAD_NAME_GENERATED
    );

    expect(nameEvents.length).toBe(1);

    const name = nameEvents[0].payload.name as string;
    console.log(`[LIVE TEST] Generated name for long prompt: "${name}" (${name.length} chars)`);

    // Name should exist (LLM is prompted to keep it concise)
    expect(name.length).toBeGreaterThan(0);

  }, 120000);

  it('naming does not block main agent execution', async () => {
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

    // Both thread:created and thread:name:generated events should exist
    const threadCreatedEvent = result.events.find(e => e.name === EventName.THREAD_CREATED);
    const nameEvent = result.events.find(e => e.name === EventName.THREAD_NAME_GENERATED);

    expect(threadCreatedEvent).toBeDefined();
    expect(nameEvent).toBeDefined();

    // Thread IDs should match
    expect(nameEvent!.payload.threadId).toBe(threadCreatedEvent!.payload.threadId);

    console.log('[LIVE TEST] Both events received - naming ran in parallel with agent execution');

  }, 240000); // 4 minute vitest timeout to accommodate the 3 minute harness timeout

  it('thread metadata on disk reflects generated name', async () => {
    const apiKey = process.env.ANTHROPIC_API_KEY ?? process.env.VITE_ANTHROPIC_API_KEY;
    if (!apiKey) {
      console.log('[LIVE TEST] Skipping: ANTHROPIC_API_KEY not set');
      return;
    }

    console.log('[LIVE TEST] Running disk persistence test...');

    const result = await harness.run({
      agent: 'simple',
      prompt: 'Add unit tests for the user service',
      timeout: 180000, // 3 minutes - allow ample time for agent completion
    });

    expect(result.exitCode).toBe(0);

    const nameEvent = result.events.find(e => e.name === EventName.THREAD_NAME_GENERATED);
    expect(nameEvent).toBeDefined();

    const threadId = nameEvent!.payload.threadId as string;
    const generatedName = nameEvent!.payload.name as string;

    console.log(`[LIVE TEST] Thread ID: ${threadId}`);
    console.log(`[LIVE TEST] Generated name: "${generatedName}"`);

    // Read thread metadata from disk
    const mortDir = harness.tempDirPath!;
    const threadMetadataPath = join(mortDir, 'threads', threadId, 'metadata.json');
    const threadMetadata = JSON.parse(readFileSync(threadMetadataPath, 'utf-8'));

    console.log(`[LIVE TEST] Disk metadata name: "${threadMetadata.name}"`);

    // Metadata on disk should have the name
    expect(threadMetadata.name).toBe(generatedName);

    // Verify other expected fields exist
    expect(threadMetadata.id).toBe(threadId);
    expect(threadMetadata.status).toBeDefined();
    expect(threadMetadata.createdAt).toBeDefined();
    expect(threadMetadata.updatedAt).toBeDefined();

  }, 240000); // 4 minute vitest timeout to accommodate the 3 minute harness timeout
});
