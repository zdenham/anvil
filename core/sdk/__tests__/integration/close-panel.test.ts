import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestContext, type QuickActionTestContext } from '../harness/index.js';

describe('close-panel action', () => {
  let ctx: QuickActionTestContext;

  beforeEach(async () => {
    ctx = await createTestContext();
  });

  afterEach(async () => {
    await ctx.cleanup();
  });

  it('emits ui:closePanel event', async () => {
    const { result, events } = await ctx.run('close-panel', {
      contextType: 'thread',
      threadId: 'thread-123',
    });

    expect(result.exitCode).toBe(0);
    events.expectEvent('ui:closePanel');
    events.expectLog('info', 'Closed panel');
  });

  it('works from thread context', async () => {
    await ctx.fixture.addThread('thread-456');

    const { result, events } = await ctx.run('close-panel', {
      contextType: 'thread',
      threadId: 'thread-456',
    });

    expect(result.exitCode).toBe(0);
    events.expectEvent('ui:closePanel');
  });

  it('works from plan context', async () => {
    await ctx.fixture.addPlan('plan-123');

    const { result, events } = await ctx.run('close-panel', {
      contextType: 'plan',
      planId: 'plan-123',
    });

    expect(result.exitCode).toBe(0);
    events.expectEvent('ui:closePanel');
  });

  it('does not require thread or plan to exist', async () => {
    // Can close panel even without actual thread/plan fixture
    const { result, events } = await ctx.run('close-panel', {
      contextType: 'thread',
      threadId: 'nonexistent-thread',
    });

    expect(result.exitCode).toBe(0);
    events.expectEvent('ui:closePanel');
  });
});
