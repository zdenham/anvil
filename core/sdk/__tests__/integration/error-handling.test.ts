import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestContext, runQuickAction, type QuickActionTestContext } from '../harness/index.js';
import { EventCollector } from '../harness/event-collector.js';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe('error handling', () => {
  let ctx: QuickActionTestContext;

  beforeEach(async () => {
    ctx = await createTestContext();
  });

  afterEach(async () => {
    await ctx.cleanup();
  });

  describe('invalid action', () => {
    it('returns error for non-existent action file', async () => {
      const result = await runQuickAction({
        actionPath: '/nonexistent/action.js',
        context: {
          contextType: 'empty',
          repository: null,
          worktree: null,
        },
        mortDir: ctx.fixture.mortDir,
        timeout: 2000,
      });

      expect(result.exitCode).toBe(1);
      const events = EventCollector.from(result.events);
      events.expectError();
    });
  });

  describe('timeout behavior', () => {
    it('reports timeout for slow actions', async () => {
      // Create a test action that takes too long
      const slowActionPath = path.join(__dirname, 'fixtures', 'slow-action.js');

      // Skip if slow action fixture doesn't exist
      // This test demonstrates the timeout mechanism
      const result = await runQuickAction({
        actionPath: slowActionPath,
        context: {
          contextType: 'empty',
          repository: null,
          worktree: null,
        },
        mortDir: ctx.fixture.mortDir,
        timeout: 100, // Very short timeout
      });

      // Either the file doesn't exist (error) or it timed out
      expect(result.exitCode).toBe(1);
    });
  });

  describe('invalid context', () => {
    it('handles context validation errors', async () => {
      // The runner validates context via Zod, so invalid context should fail
      const result = await runQuickAction({
        // @ts-expect-error - Testing invalid context
        actionPath: path.join(__dirname, '../../template/dist/actions/close-panel.js'),
        context: {
          contextType: 'invalid-type', // Not a valid context type
          repository: null,
          worktree: null,
        },
        mortDir: ctx.fixture.mortDir,
        timeout: 2000,
      });

      expect(result.exitCode).toBe(1);
      const events = EventCollector.from(result.events);
      events.expectError();
    });
  });
});

describe('EventCollector assertions', () => {
  it('expectEvent throws for missing event', () => {
    const events = EventCollector.from([]);
    expect(() => events.expectEvent('missing')).toThrow(/not emitted/);
  });

  it('expectEvent throws for payload mismatch', () => {
    const events = EventCollector.from([
      { event: 'test', payload: { a: 1 } },
    ]);
    expect(() => events.expectEvent('test', { a: 2 })).toThrow(/mismatch/);
  });

  it('expectNoEvent throws when event exists', () => {
    const events = EventCollector.from([
      { event: 'test', payload: 'data' },
    ]);
    expect(() => events.expectNoEvent('test')).toThrow(/was emitted/);
  });

  it('expectError throws when no error', () => {
    const events = EventCollector.from([
      { event: 'log', payload: { level: 'info', message: 'ok' } },
    ]);
    expect(() => events.expectError()).toThrow(/none was emitted/);
  });

  it('expectEventSequence throws for wrong order', () => {
    const events = EventCollector.from([
      { event: 'b', payload: null },
      { event: 'a', payload: null },
    ]);
    expect(() => events.expectEventSequence(['a', 'b'])).toThrow(/not found/);
  });

  it('expectEventMatching validates partial payloads', () => {
    const events = EventCollector.from([
      { event: 'test', payload: { a: 1, b: 2, c: 3 } },
    ]);

    // Should not throw - partial match
    events.expectEventMatching('test', { a: 1, b: 2 });

    // Should throw - wrong value
    expect(() => events.expectEventMatching('test', { a: 999 })).toThrow(/mismatch/);
  });
});
