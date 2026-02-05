import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestContext, type QuickActionTestContext } from '../harness/index.js';

describe('archive action', () => {
  let ctx: QuickActionTestContext;

  beforeEach(async () => {
    ctx = await createTestContext();
  });

  afterEach(async () => {
    await ctx.cleanup();
  });

  describe('thread context', () => {
    it('emits thread:archive event with correct threadId', async () => {
      await ctx.fixture.addThread('thread-123', {
        repoId: 'repo-1',
        status: 'idle',
        isRead: true,
      });

      const { result, events } = await ctx.run('archive', {
        contextType: 'thread',
        threadId: 'thread-123',
      });

      expect(result.exitCode).toBe(0);
      events.expectEvent('thread:archive', { threadId: 'thread-123' });
      events.expectLog('info', 'Archived thread');
    });

    it('handles missing threadId gracefully', async () => {
      const { result, events } = await ctx.run('archive', {
        contextType: 'thread',
        // No threadId provided
      });

      expect(result.exitCode).toBe(0);
      events.expectNoEvent('thread:archive');
    });

    it('includes thread metadata in log', async () => {
      await ctx.fixture.addThread('thread-456');

      const { events } = await ctx.run('archive', {
        contextType: 'thread',
        threadId: 'thread-456',
      });

      const logs = events.getLogs();
      const archiveLog = logs.find(l => l.message.includes('Archived thread'));
      expect(archiveLog).toBeDefined();
      expect(archiveLog?.data).toEqual({ threadId: 'thread-456' });
    });
  });

  describe('plan context', () => {
    it('emits plan:archive event with correct planId', async () => {
      await ctx.fixture.addPlan('plan-123', {
        repoId: 'repo-1',
        relativePath: 'plans/my-plan.md',
      });

      const { result, events } = await ctx.run('archive', {
        contextType: 'plan',
        planId: 'plan-123',
      });

      expect(result.exitCode).toBe(0);
      events.expectEvent('plan:archive', { planId: 'plan-123' });
      events.expectLog('info', 'Archived plan');
    });

    it('handles missing planId gracefully', async () => {
      const { result, events } = await ctx.run('archive', {
        contextType: 'plan',
        // No planId provided
      });

      expect(result.exitCode).toBe(0);
      events.expectNoEvent('plan:archive');
    });
  });

  describe('empty context', () => {
    it('does nothing in empty context', async () => {
      const { result, events } = await ctx.run('archive', {
        contextType: 'empty',
      });

      expect(result.exitCode).toBe(0);
      events.expectNoEvent('thread:archive');
      events.expectNoEvent('plan:archive');
    });
  });
});
