/**
 * Quick Actions Integration Test Harness
 *
 * This module provides utilities for end-to-end testing of quick actions.
 * Tests spawn the actual runner process, capture stdout events, and verify
 * both emitted events and disk state changes.
 *
 * @example
 * ```typescript
 * import { createTestContext } from '../harness';
 *
 * describe('archive action', () => {
 *   it('archives a thread', async () => {
 *     const ctx = await createTestContext();
 *
 *     await ctx.fixture.addThread('thread-123', { isRead: true });
 *
 *     const { result, events } = await ctx.run('archive', {
 *       contextType: 'thread',
 *       threadId: 'thread-123',
 *     });
 *
 *     expect(result.exitCode).toBe(0);
 *     events.expectEvent('thread:archive', { threadId: 'thread-123' });
 *
 *     await ctx.cleanup();
 *   });
 * });
 * ```
 */

import type { QuickActionExecutionContext } from '../../types.js';
import { AnvilFixture, createAnvilFixture } from './anvil-fixture.js';
import { runQuickAction, getTemplateActionPath, type RunnerResult } from './runner-spawn.js';
import { EventCollector } from './event-collector.js';

// Re-export all harness components
export { AnvilFixture, createAnvilFixture } from './anvil-fixture.js';
export type { ThreadMetaFixture, PlanEntryFixture } from './anvil-fixture.js';

export { runQuickAction, getTemplateActionPath } from './runner-spawn.js';
export type { RunnerOptions, RunnerResult, QuickActionEvent } from './runner-spawn.js';

export { EventCollector } from './event-collector.js';

// Re-export fixture builders
export * from './fixtures/thread-meta.js';
export * from './fixtures/plan-entry.js';

/**
 * Options for running an action via the test context.
 */
export interface TestRunOptions {
  /** Override default timeout (ms) */
  timeout?: number;
}

/**
 * Result of running an action via the test context.
 */
export interface TestRunResult {
  /** Raw runner result with exit code, events, stderr, duration */
  result: RunnerResult;
  /** Event collector for assertions */
  events: EventCollector;
}

/**
 * High-level test context combining fixture and runner.
 */
export interface QuickActionTestContext {
  /** The temporary .anvil fixture */
  fixture: AnvilFixture;

  /**
   * Run a quick action and return results.
   * @param actionSlug - The action slug (e.g., 'archive', 'mark-read')
   * @param context - Partial context to merge with defaults
   * @param options - Run options (timeout, etc.)
   */
  run(
    actionSlug: string,
    context: Partial<QuickActionExecutionContext>,
    options?: TestRunOptions
  ): Promise<TestRunResult>;

  /**
   * Cleanup the test context.
   * Call this after each test.
   */
  cleanup(): Promise<void>;
}

/**
 * Build a full execution context from partial input.
 * Fills in reasonable defaults for testing.
 */
function buildContext(partial: Partial<QuickActionExecutionContext>): QuickActionExecutionContext {
  return {
    contextType: partial.contextType ?? 'empty',
    threadId: partial.threadId,
    planId: partial.planId,
    repository: partial.repository ?? null,
    worktree: partial.worktree ?? null,
    threadState: partial.threadState,
  };
}

/**
 * Create a test context for quick action integration tests.
 * Initializes a temporary .anvil directory and provides helpers
 * for running actions and asserting on events.
 *
 * @example
 * ```typescript
 * const ctx = await createTestContext();
 * try {
 *   await ctx.fixture.addThread('t1', { isRead: false });
 *   const { events } = await ctx.run('mark-read', { contextType: 'thread', threadId: 't1' });
 *   events.expectEvent('thread:markRead');
 * } finally {
 *   await ctx.cleanup();
 * }
 * ```
 */
export async function createTestContext(): Promise<QuickActionTestContext> {
  const fixture = await createAnvilFixture();

  return {
    fixture,

    async run(
      actionSlug: string,
      context: Partial<QuickActionExecutionContext>,
      options: TestRunOptions = {}
    ): Promise<TestRunResult> {
      const actionPath = getTemplateActionPath(actionSlug);
      const fullContext = buildContext(context);

      const result = await runQuickAction({
        actionPath,
        context: fullContext,
        anvilDir: fixture.anvilDir,
        timeout: options.timeout,
      });

      return {
        result,
        events: EventCollector.from(result.events),
      };
    },

    async cleanup(): Promise<void> {
      await fixture.cleanup();
    },
  };
}
