import type { ThreadMetaFixture } from '../anvil-fixture.js';

/**
 * Build a default thread meta fixture.
 * Override specific fields as needed.
 */
export function buildThreadMeta(overrides: Partial<ThreadMetaFixture> = {}): ThreadMetaFixture {
  const now = Date.now();
  return {
    repoId: 'test-repo',
    worktreeId: 'test-worktree',
    status: 'idle',
    createdAt: now,
    updatedAt: now,
    isRead: true,
    turnCount: 0,
    ...overrides,
  };
}

/**
 * Build an unread thread meta fixture.
 */
export function buildUnreadThread(overrides: Partial<ThreadMetaFixture> = {}): ThreadMetaFixture {
  return buildThreadMeta({
    isRead: false,
    ...overrides,
  });
}

/**
 * Build a running thread meta fixture.
 */
export function buildRunningThread(overrides: Partial<ThreadMetaFixture> = {}): ThreadMetaFixture {
  return buildThreadMeta({
    status: 'running',
    ...overrides,
  });
}

/**
 * Build a completed thread meta fixture.
 */
export function buildCompletedThread(overrides: Partial<ThreadMetaFixture> = {}): ThreadMetaFixture {
  return buildThreadMeta({
    status: 'completed',
    ...overrides,
  });
}

/**
 * Build an errored thread meta fixture.
 */
export function buildErroredThread(overrides: Partial<ThreadMetaFixture> = {}): ThreadMetaFixture {
  return buildThreadMeta({
    status: 'error',
    ...overrides,
  });
}
