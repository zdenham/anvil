import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WorktreeAllocationService } from './allocation-service';
import type { GitAdapter, PathLock, Logger } from '@core/adapters/types';
import type { RepositorySettingsService } from '../repository/settings-service';
import type { MergeBaseService } from '../git/merge-base-service';
import type { BranchManager } from './branch-manager';
import type { WorktreePoolManager } from './worktree-pool-manager';
import type { RepositorySettings, WorktreeState } from '@core/types/repositories.js';

// =============================================================================
// Mock Factories
// =============================================================================

function createMockGitAdapter(overrides: Partial<GitAdapter> = {}): GitAdapter {
  return {
    createWorktree: vi.fn(),
    removeWorktree: vi.fn(),
    listWorktrees: vi.fn(() => []),
    getDefaultBranch: vi.fn(() => 'main'),
    getBranchCommit: vi.fn(() => 'abc123'),
    checkoutCommit: vi.fn(),
    checkoutBranch: vi.fn(),
    getMergeBase: vi.fn(() => 'merge-base-sha'),
    fetch: vi.fn(),
    branchExists: vi.fn(() => false),
    createBranch: vi.fn(),
    getCurrentBranch: vi.fn(() => null),
    ...overrides,
  };
}

function createMockPathLock(overrides: Partial<PathLock> = {}): PathLock {
  return {
    acquire: vi.fn(),
    release: vi.fn(),
    isHeld: vi.fn(() => false),
    ...overrides,
  };
}

function createMockLogger(): Logger {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };
}

function createMockBranchManager(): BranchManager {
  return {
    isOnBranch: vi.fn(() => false),
    ensureBranch: vi.fn(),
  } as unknown as BranchManager;
}

function createMockPoolManager(
  overrides: Partial<WorktreePoolManager> = {}
): WorktreePoolManager {
  return {
    findByTask: vi.fn(() => undefined),
    findByThread: vi.fn(() => undefined),
    selectByAffinity: vi.fn(() => undefined),
    getAvailable: vi.fn(() => []),
    addThreadToClaim: vi.fn(),
    claim: vi.fn(),
    releaseThread: vi.fn(),
    create: vi.fn(),
    ...overrides,
  } as unknown as WorktreePoolManager;
}

function createMockSettingsService(
  settings: RepositorySettings
): RepositorySettingsService {
  // Store a reference to allow mutations to be visible
  const settingsRef = { current: settings };
  return {
    load: vi.fn(() => settingsRef.current),
    save: vi.fn((_, updated: RepositorySettings) => {
      settingsRef.current = updated;
    }),
    exists: vi.fn(() => true),
  } as unknown as RepositorySettingsService;
}

function createMockMergeBaseService(
  mergeBase: string = 'merge-base-sha'
): MergeBaseService {
  return {
    compute: vi.fn(() => mergeBase),
    computeBetween: vi.fn(() => mergeBase),
  } as unknown as MergeBaseService;
}

function createValidSettings(
  overrides: Partial<RepositorySettings> = {}
): RepositorySettings {
  return {
    schemaVersion: 1,
    name: 'test-repo',
    originalUrl: 'https://github.com/example/repo.git',
    sourcePath: '/path/to/source',
    useWorktrees: true,
    defaultBranch: 'main',
    createdAt: 1700000000000,
    worktrees: [],
    taskBranches: {},
    lastUpdated: 1700000000000,
    ...overrides,
  };
}

function createWorktree(overrides: Partial<WorktreeState> = {}): WorktreeState {
  return {
    path: '/home/user/.mort/repositories/test-repo/worktrees/worktree-1',
    version: 1,
    currentBranch: null,
    claim: null,
    ...overrides,
  };
}

// =============================================================================
// Test Suite
// =============================================================================

describe('WorktreeAllocationService', () => {
  const mortDir = '/home/user/.mort';
  const repoName = 'test-repo';
  const threadId = 'thread-abc123';
  const sourcePath = '/path/to/source';
  const mergeBase = 'merge-base-sha';

  let mockGit: GitAdapter;
  let mockPathLock: PathLock;
  let mockSettingsService: RepositorySettingsService;
  let mockMergeBaseService: MergeBaseService;
  let mockBranchManager: BranchManager;
  let mockPoolManager: WorktreePoolManager;
  let mockLogger: Logger;
  let service: WorktreeAllocationService;

  // Test fixtures
  let worktree: WorktreeState;
  let existingWorktree: WorktreeState;
  let affinityWorktree: WorktreeState;
  let lruWorktree: WorktreeState;
  let newWorktree: WorktreeState;

  beforeEach(() => {
    mockGit = createMockGitAdapter();
    mockPathLock = createMockPathLock();
    mockMergeBaseService = createMockMergeBaseService(mergeBase);
    mockBranchManager = createMockBranchManager();
    mockLogger = createMockLogger();

    // Initialize test worktrees
    worktree = createWorktree();
    existingWorktree = createWorktree({
      path: '/path/to/existing-worktree',
      claim: { taskId: 'task-A', threadIds: ['thread-1'], claimedAt: Date.now() },
    });
    affinityWorktree = createWorktree({
      path: '/path/to/affinity-worktree',
      lastTaskId: 'task-A',
    });
    lruWorktree = createWorktree({
      path: '/path/to/lru-worktree',
      lastReleasedAt: Date.now() - 10000,
    });
    newWorktree = createWorktree({
      path: '/path/to/new-worktree',
    });
  });

  function createService(settings: RepositorySettings): void {
    mockSettingsService = createMockSettingsService(settings);
    service = new WorktreeAllocationService(
      mortDir,
      mockSettingsService,
      mockMergeBaseService,
      mockGit,
      mockPathLock,
      mockBranchManager,
      mockPoolManager,
      mockLogger
    );
  }

  describe('allocate', () => {
    describe('merge base computation', () => {
      it('fetches from origin before computing merge base', () => {
        const settings = createValidSettings({ worktrees: [worktree] });
        mockPoolManager = createMockPoolManager({
          getAvailable: vi.fn(() => [worktree]),
        });
        createService(settings);

        service.allocate(repoName, threadId, { taskId: 'task-1' });

        expect(mockGit.fetch).toHaveBeenCalledWith(sourcePath);
        expect(mockMergeBaseService.compute).toHaveBeenCalledWith(
          sourcePath,
          'origin/main' // NOT 'HEAD'!
        );
      });

      it('uses defaultBranch from settings', () => {
        const settings = createValidSettings({
          worktrees: [worktree],
          defaultBranch: 'master',
        });
        mockPoolManager = createMockPoolManager({
          getAvailable: vi.fn(() => [worktree]),
        });
        createService(settings);

        service.allocate(repoName, threadId, { taskId: 'task-1' });

        expect(mockMergeBaseService.compute).toHaveBeenCalledWith(
          sourcePath,
          'origin/master'
        );
      });

      it('continues with local refs when fetch fails', () => {
        const settings = createValidSettings({ worktrees: [worktree] });
        mockGit = createMockGitAdapter({
          fetch: vi.fn(() => {
            throw new Error('Network error');
          }),
        });
        mockPoolManager = createMockPoolManager({
          getAvailable: vi.fn(() => [worktree]),
        });
        createService(settings);

        const result = service.allocate(repoName, threadId, { taskId: 'task-1' });

        expect(result.worktree).toBeDefined();
        expect(mockLogger.warn).toHaveBeenCalledWith(
          'Failed to fetch from origin, using local refs',
          expect.anything()
        );
      });
    });

    describe('branch attachment', () => {
      it('calls branchManager.ensureBranch when taskBranch provided', () => {
        const settings = createValidSettings({ worktrees: [worktree] });
        mockPoolManager = createMockPoolManager({
          getAvailable: vi.fn(() => [worktree]),
        });
        createService(settings);

        service.allocate(repoName, threadId, {
          taskId: 'task-1',
          taskBranch: 'task/foo',
        });

        expect(mockBranchManager.ensureBranch).toHaveBeenCalledWith(
          worktree.path,
          'task/foo',
          sourcePath,
          mergeBase,
          false // isResume = false for new branches
        );
      });

      it('checkouts merge base when no taskBranch', () => {
        const settings = createValidSettings({ worktrees: [worktree] });
        mockPoolManager = createMockPoolManager({
          getAvailable: vi.fn(() => [worktree]),
        });
        createService(settings);

        service.allocate(repoName, threadId, { taskId: 'task-1' });

        expect(mockGit.checkoutCommit).toHaveBeenCalledWith(worktree.path, mergeBase);
        expect(mockBranchManager.ensureBranch).not.toHaveBeenCalled();
      });
    });

    describe('worktree claiming', () => {
      it('adds thread to existing task claim (concurrent access)', () => {
        const settings = createValidSettings({ worktrees: [existingWorktree] });
        mockPoolManager = createMockPoolManager({
          findByTask: vi.fn(() => existingWorktree),
        });
        createService(settings);

        service.allocate(repoName, 'thread-2', { taskId: 'task-A' });

        expect(mockPoolManager.addThreadToClaim).toHaveBeenCalledWith(
          existingWorktree,
          'thread-2'
        );
        expect(mockPoolManager.claim).not.toHaveBeenCalled();
      });

      it('uses affinity worktree for resumed task', () => {
        const settings = createValidSettings({ worktrees: [affinityWorktree] });
        mockPoolManager = createMockPoolManager({
          findByTask: vi.fn(() => undefined),
          selectByAffinity: vi.fn(() => affinityWorktree),
        });
        createService(settings);

        service.allocate(repoName, threadId, { taskId: 'task-A' });

        expect(mockPoolManager.claim).toHaveBeenCalledWith(
          affinityWorktree,
          'task-A',
          threadId
        );
      });

      it('uses LRU worktree for new task', () => {
        const settings = createValidSettings({ worktrees: [lruWorktree] });
        mockPoolManager = createMockPoolManager({
          findByTask: vi.fn(() => undefined),
          selectByAffinity: vi.fn(() => undefined),
          getAvailable: vi.fn(() => [lruWorktree]),
        });
        createService(settings);

        service.allocate(repoName, threadId, { taskId: 'task-NEW' });

        expect(mockPoolManager.claim).toHaveBeenCalledWith(
          lruWorktree,
          'task-NEW',
          threadId
        );
      });

      it('creates worktree when none available', () => {
        const settings = createValidSettings({ worktrees: [] });
        mockPoolManager = createMockPoolManager({
          findByTask: vi.fn(() => undefined),
          selectByAffinity: vi.fn(() => undefined),
          getAvailable: vi.fn(() => []),
          create: vi.fn(() => newWorktree),
        });
        createService(settings);

        service.allocate(repoName, threadId, { taskId: 'task-1' });

        expect(mockPoolManager.create).toHaveBeenCalled();
        expect(mockPoolManager.claim).toHaveBeenCalledWith(
          newWorktree,
          'task-1',
          threadId
        );
      });
    });

    describe('error handling', () => {
      it('releases claim on failure', () => {
        const settings = createValidSettings({ worktrees: [worktree] });
        mockPoolManager = createMockPoolManager({
          getAvailable: vi.fn(() => [worktree]),
          findByThread: vi.fn(() => worktree),
        });
        mockBranchManager = {
          isOnBranch: vi.fn(() => false),
          ensureBranch: vi.fn(() => {
            throw new Error('Checkout failed');
          }),
        } as unknown as BranchManager;
        createService(settings);

        expect(() =>
          service.allocate(repoName, threadId, {
            taskId: 'task-1',
            taskBranch: 'task/foo',
          })
        ).toThrow('Checkout failed');

        expect(mockPoolManager.releaseThread).toHaveBeenCalled();
      });
    });

    describe('locking', () => {
      it('acquires and releases lock around allocation', () => {
        const settings = createValidSettings({ worktrees: [worktree] });
        const lockPath = '/home/user/.mort/repositories/test-repo/.lock';
        mockPoolManager = createMockPoolManager({
          getAvailable: vi.fn(() => [worktree]),
        });
        createService(settings);

        service.allocate(repoName, threadId);

        expect(mockPathLock.acquire).toHaveBeenCalledWith(lockPath, {
          maxRetries: 5,
          retryDelayMs: 100,
        });
        expect(mockPathLock.release).toHaveBeenCalledWith(lockPath);
      });

      it('releases lock even if operation fails', () => {
        const settings = createValidSettings({ worktrees: [worktree] });
        mockPoolManager = createMockPoolManager({
          getAvailable: vi.fn(() => [worktree]),
          findByThread: vi.fn(() => worktree),
        });
        mockGit = createMockGitAdapter({
          checkoutCommit: vi.fn(() => {
            throw new Error('checkout failed');
          }),
        });
        createService(settings);

        expect(() => service.allocate(repoName, threadId)).toThrow();
        expect(mockPathLock.release).toHaveBeenCalled();
      });

      it('propagates lock acquisition error', () => {
        const settings = createValidSettings({ worktrees: [worktree] });
        mockPathLock = createMockPathLock({
          acquire: vi.fn(() => {
            throw new Error('lock acquisition failed after retries');
          }),
        });
        mockPoolManager = createMockPoolManager();
        createService(settings);

        expect(() => service.allocate(repoName, threadId)).toThrow(
          'lock acquisition failed'
        );
      });
    });
  });

  describe('release', () => {
    it('delegates to poolManager.releaseThread', () => {
      const settings = createValidSettings({ worktrees: [worktree] });
      mockPoolManager = createMockPoolManager({
        findByThread: vi.fn(() => worktree),
      });
      createService(settings);

      service.release(repoName, threadId);

      expect(mockPoolManager.releaseThread).toHaveBeenCalledWith(worktree, threadId);
      expect(mockSettingsService.save).toHaveBeenCalled();
    });

    it('no-ops when thread not found', () => {
      const settings = createValidSettings({ worktrees: [] });
      mockPoolManager = createMockPoolManager({
        findByThread: vi.fn(() => undefined),
      });
      createService(settings);

      service.release(repoName, 'thread-unknown');

      expect(mockPoolManager.releaseThread).not.toHaveBeenCalled();
    });

    it('acquires and releases lock around release', () => {
      const settings = createValidSettings({ worktrees: [worktree] });
      const lockPath = '/home/user/.mort/repositories/test-repo/.lock';
      mockPoolManager = createMockPoolManager({
        findByThread: vi.fn(() => worktree),
      });
      createService(settings);

      service.release(repoName, threadId);

      expect(mockPathLock.acquire).toHaveBeenCalledWith(lockPath, {
        maxRetries: 5,
        retryDelayMs: 100,
      });
      expect(mockPathLock.release).toHaveBeenCalledWith(lockPath);
    });
  });

  describe('getForThread', () => {
    it('returns worktree when found by thread', () => {
      const settings = createValidSettings({ worktrees: [worktree] });
      mockPoolManager = createMockPoolManager({
        findByThread: vi.fn(() => worktree),
      });
      createService(settings);

      const result = service.getForThread(repoName, threadId);

      expect(result).toBe(worktree);
    });

    it('returns null when not found', () => {
      const settings = createValidSettings({ worktrees: [] });
      mockPoolManager = createMockPoolManager({
        findByThread: vi.fn(() => undefined),
      });
      createService(settings);

      const result = service.getForThread(repoName, threadId);

      expect(result).toBeNull();
    });

    it('does not acquire lock for read operation', () => {
      const settings = createValidSettings({ worktrees: [] });
      mockPoolManager = createMockPoolManager();
      createService(settings);

      service.getForThread(repoName, threadId);

      expect(mockPathLock.acquire).not.toHaveBeenCalled();
    });
  });
});
