import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestContext, type QuickActionTestContext } from '../harness/index.js';

describe('next-unread action', () => {
  let ctx: QuickActionTestContext;

  beforeEach(async () => {
    ctx = await createTestContext();
  });

  afterEach(async () => {
    await ctx.cleanup();
  });

  it('emits ui:navigate event for nextUnread', async () => {
    const { result, events } = await ctx.run('next-unread', {
      contextType: 'empty',
    });

    expect(result.exitCode).toBe(0);
    events.expectEvent('ui:navigate', { type: 'nextUnread' });
    events.expectLog('info', 'Navigated to next unread');
  });

  it('works from any context type', async () => {
    // Can be invoked from thread context
    const { events: threadEvents } = await ctx.run('next-unread', {
      contextType: 'thread',
      threadId: 'thread-123',
    });
    threadEvents.expectEvent('ui:navigate', { type: 'nextUnread' });

    // Can be invoked from plan context
    const { events: planEvents } = await ctx.run('next-unread', {
      contextType: 'plan',
      planId: 'plan-123',
    });
    planEvents.expectEvent('ui:navigate', { type: 'nextUnread' });
  });

  it('emits events in correct sequence', async () => {
    const { events } = await ctx.run('next-unread', {
      contextType: 'empty',
    });

    // Navigation should happen before log
    events.expectEventSequence(['ui:navigate', 'log']);
  });
});
