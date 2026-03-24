import type { PlanEntryFixture } from '../anvil-fixture.js';

/**
 * Build a default plan entry fixture.
 * Override specific fields as needed.
 */
export function buildPlanEntry(overrides: Partial<PlanEntryFixture> = {}): PlanEntryFixture {
  const now = Date.now();
  return {
    repoId: 'test-repo',
    worktreeId: 'test-worktree',
    relativePath: 'plans/test-plan.md',
    isRead: true,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

/**
 * Build an unread plan entry fixture.
 */
export function buildUnreadPlan(overrides: Partial<PlanEntryFixture> = {}): PlanEntryFixture {
  return buildPlanEntry({
    isRead: false,
    ...overrides,
  });
}
