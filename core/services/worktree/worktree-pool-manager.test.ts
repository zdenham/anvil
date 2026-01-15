import { describe, it, expect, beforeEach, vi } from 'vitest';
import { WorktreePoolManager } from './worktree-pool-manager';
import type { WorktreeState, RepositorySettings } from '@core/types/repositories.js';
import type { GitAdapter } from '@core/adapters/types';

describe('WorktreePoolManager', () => {
  let manager: WorktreePoolManager;
  let mockGit: { createWorktree: ReturnType<typeof vi.fn> };
  let settings: RepositorySettings;

  beforeEach(() => {
    mockGit = {
      createWorktree: vi.fn(),
    };

    manager = new WorktreePoolManager(mockGit as unknown as GitAdapter, '/home/user/.mort-dev');

    settings = {
      schemaVersion: 1,
      name: 'test-repo',
      originalUrl: null,
      sourcePath: '/path/to/source',
      useWorktrees: true,
      defaultBranch: 'main',
      createdAt: 1000,
      worktrees: [],
      taskBranches: {},
      lastUpdated: 1000,
    };
  });

  describe('findByTask', () => {
    it('returns worktree claimed by task', () => {
      settings.worktrees = [
        { path: '/wt-1', version: 1, currentBranch: null, claim: { taskId: 'task-A', threadIds: ['t1'], claimedAt: 1000 } },
        { path: '/wt-2', version: 1, currentBranch: null, claim: null },
      ] as WorktreeState[];

      const result = manager.findByTask(settings, 'task-A');
      expect(result?.path).toBe('/wt-1');
    });

    it('returns undefined when no match', () => {
      settings.worktrees = [
        { path: '/wt-1', version: 1, currentBranch: null, claim: { taskId: 'task-B', threadIds: ['t1'], claimedAt: 1000 } },
      ] as WorktreeState[];

      expect(manager.findByTask(settings, 'task-A')).toBeUndefined();
    });
  });

  describe('findByThread', () => {
    it('returns worktree containing thread', () => {
      settings.worktrees = [
        { path: '/wt-1', version: 1, currentBranch: null, claim: { taskId: 'task-A', threadIds: ['t1', 't2'], claimedAt: 1000 } },
      ] as WorktreeState[];

      const result = manager.findByThread(settings, 't2');
      expect(result?.path).toBe('/wt-1');
    });

    it('returns undefined when thread not found', () => {
      settings.worktrees = [
        { path: '/wt-1', version: 1, currentBranch: null, claim: { taskId: 'task-A', threadIds: ['t1'], claimedAt: 1000 } },
      ] as WorktreeState[];

      expect(manager.findByThread(settings, 't3')).toBeUndefined();
    });
  });

  describe('selectByAffinity', () => {
    it('returns unclaimed worktree with matching lastTaskId', () => {
      settings.worktrees = [
        { path: '/wt-1', version: 1, currentBranch: null, claim: null, lastTaskId: 'task-A', lastReleasedAt: 1000 },
        { path: '/wt-2', version: 1, currentBranch: null, claim: null, lastTaskId: 'task-B', lastReleasedAt: 2000 },
      ] as WorktreeState[];

      const result = manager.selectByAffinity(settings, 'task-A');
      expect(result?.path).toBe('/wt-1');
    });

    it('ignores claimed worktrees', () => {
      settings.worktrees = [
        { path: '/wt-1', version: 1, currentBranch: null, claim: { taskId: 'task-X', threadIds: ['t1'], claimedAt: 1000 }, lastTaskId: 'task-A' },
      ] as WorktreeState[];

      expect(manager.selectByAffinity(settings, 'task-A')).toBeUndefined();
    });
  });

  describe('getAvailable', () => {
    it('returns unclaimed worktrees sorted by LRU', () => {
      settings.worktrees = [
        { path: '/wt-1', version: 1, currentBranch: null, claim: null, lastReleasedAt: 3000 },
        { path: '/wt-2', version: 1, currentBranch: null, claim: null, lastReleasedAt: 1000 }, // oldest
        { path: '/wt-3', version: 1, currentBranch: null, claim: { taskId: 'x', threadIds: ['t1'], claimedAt: 1000 } }, // claimed
        { path: '/wt-4', version: 1, currentBranch: null, claim: null, lastReleasedAt: 2000 },
      ] as WorktreeState[];

      const result = manager.getAvailable(settings);
      expect(result.map((w) => w.path)).toEqual(['/wt-2', '/wt-4', '/wt-1']);
    });

    it('handles worktrees without lastReleasedAt', () => {
      settings.worktrees = [
        { path: '/wt-1', version: 1, currentBranch: null, claim: null, lastReleasedAt: 1000 },
        { path: '/wt-2', version: 1, currentBranch: null, claim: null }, // no lastReleasedAt
      ] as WorktreeState[];

      const result = manager.getAvailable(settings);
      // Worktree without lastReleasedAt sorts first (0 < 1000)
      expect(result.map((w) => w.path)).toEqual(['/wt-2', '/wt-1']);
    });
  });

  describe('addThreadToClaim', () => {
    it('adds thread to existing claim', () => {
      const worktree = {
        path: '/wt-1',
        version: 1,
        currentBranch: null,
        claim: { taskId: 'task-A', threadIds: ['t1'], claimedAt: 1000 },
      } as WorktreeState;

      manager.addThreadToClaim(worktree, 't2');

      expect(worktree.claim?.threadIds).toEqual(['t1', 't2']);
    });

    it('does not add duplicate thread', () => {
      const worktree = {
        path: '/wt-1',
        version: 1,
        currentBranch: null,
        claim: { taskId: 'task-A', threadIds: ['t1'], claimedAt: 1000 },
      } as WorktreeState;

      manager.addThreadToClaim(worktree, 't1');

      expect(worktree.claim?.threadIds).toEqual(['t1']);
    });

    it('throws when worktree is not claimed', () => {
      const worktree = { path: '/wt-1', version: 1, currentBranch: null, claim: null } as WorktreeState;

      expect(() => manager.addThreadToClaim(worktree, 't1')).toThrow('Cannot add thread to unclaimed worktree');
    });
  });

  describe('claim', () => {
    it('creates new claim', () => {
      const worktree = { path: '/wt-1', version: 1, currentBranch: null, claim: null } as WorktreeState;

      manager.claim(worktree, 'task-A', 't1');

      expect(worktree.claim).toEqual({
        taskId: 'task-A',
        threadIds: ['t1'],
        claimedAt: expect.any(Number),
      });
    });

    it('throws when already claimed', () => {
      const worktree = {
        path: '/wt-1',
        version: 1,
        currentBranch: null,
        claim: { taskId: 'task-B', threadIds: ['t2'], claimedAt: 1000 },
      } as WorktreeState;

      expect(() => manager.claim(worktree, 'task-A', 't1')).toThrow('Worktree is already claimed');
    });
  });

  describe('releaseThread', () => {
    it('removes thread from claim, keeps worktree claimed', () => {
      const worktree = {
        path: '/wt-1',
        version: 1,
        currentBranch: null,
        claim: { taskId: 'task-A', threadIds: ['t1', 't2'], claimedAt: 1000 },
      } as WorktreeState;

      const fullyReleased = manager.releaseThread(worktree, 't1');

      expect(fullyReleased).toBe(false);
      expect(worktree.claim?.threadIds).toEqual(['t2']);
      expect(worktree.lastReleasedAt).toBeUndefined();
    });

    it('releases worktree when last thread exits', () => {
      const worktree = {
        path: '/wt-1',
        version: 1,
        currentBranch: null,
        claim: { taskId: 'task-A', threadIds: ['t1'], claimedAt: 1000 },
      } as WorktreeState;

      const fullyReleased = manager.releaseThread(worktree, 't1');

      expect(fullyReleased).toBe(true);
      expect(worktree.claim).toBeNull();
      expect(worktree.lastTaskId).toBe('task-A');
      expect(worktree.lastReleasedAt).toBeDefined();
    });

    it('returns false for unclaimed worktree', () => {
      const worktree = { path: '/wt-1', version: 1, currentBranch: null, claim: null } as WorktreeState;

      expect(manager.releaseThread(worktree, 't1')).toBe(false);
    });
  });

  describe('create', () => {
    it('creates worktree and adds to settings', () => {
      settings.worktrees = [{ path: '/existing', version: 1, currentBranch: null, claim: null } as WorktreeState];

      const result = manager.create('my-repo', settings);

      expect(mockGit.createWorktree).toHaveBeenCalledWith(
        settings.sourcePath,
        '/home/user/.mort-dev/repositories/my-repo/my-repo-2'
      );
      expect(result.path).toBe('/home/user/.mort-dev/repositories/my-repo/my-repo-2');
      expect(settings.worktrees).toHaveLength(2);
    });

    it('creates first worktree with index 1', () => {
      const result = manager.create('new-repo', settings);

      expect(mockGit.createWorktree).toHaveBeenCalledWith(
        settings.sourcePath,
        '/home/user/.mort-dev/repositories/new-repo/new-repo-1'
      );
      expect(result.path).toBe('/home/user/.mort-dev/repositories/new-repo/new-repo-1');
      expect(result.version).toBe(1);
      expect(result.currentBranch).toBeNull();
      expect(result.claim).toBeNull();
    });
  });
});
