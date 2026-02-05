import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestContext, type QuickActionTestContext } from '../harness/index.js';

describe('mark-unread action', () => {
  let ctx: QuickActionTestContext;

  beforeEach(async () => {
    ctx = await createTestContext();
  });

  afterEach(async () => {
    await ctx.cleanup();
  });

  it('emits thread:markUnread and ui:closePanel events', async () => {
    await ctx.fixture.addThread('thread-123', {
      isRead: true,
    });

    const { result, events } = await ctx.run('mark-unread', {
      contextType: 'thread',
      threadId: 'thread-123',
    });

    expect(result.exitCode).toBe(0);
    events.expectEvent('thread:markUnread', { threadId: 'thread-123' });
    events.expectEvent('ui:closePanel');
    events.expectLog('info', 'Marked thread as unread');
  });

  it('emits events in correct sequence', async () => {
    await ctx.fixture.addThread('thread-456');

    const { events } = await ctx.run('mark-unread', {
      contextType: 'thread',
      threadId: 'thread-456',
    });

    // markUnread should happen before closePanel
    events.expectEventSequence(['thread:markUnread', 'ui:closePanel']);
  });

  it('handles missing threadId gracefully', async () => {
    const { result, events } = await ctx.run('mark-unread', {
      contextType: 'thread',
      // No threadId
    });

    expect(result.exitCode).toBe(0);
    events.expectNoEvent('thread:markUnread');
    events.expectNoEvent('ui:closePanel');
  });

  it('does nothing in non-thread contexts', async () => {
    const { result, events } = await ctx.run('mark-unread', {
      contextType: 'plan',
      planId: 'plan-123',
    });

    expect(result.exitCode).toBe(0);
    events.expectNoEvent('thread:markUnread');
  });
});
