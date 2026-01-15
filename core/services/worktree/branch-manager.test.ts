import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BranchManager } from './branch-manager';
import type { GitAdapter } from '../../adapters/types';

describe('BranchManager', () => {
  let manager: BranchManager;
  let mockGit: GitAdapter;

  const worktreePath = '/path/to/worktree';
  const sourcePath = '/path/to/source';
  const mergeBase = 'abc123';

  beforeEach(() => {
    mockGit = {
      getCurrentBranch: vi.fn(),
      checkoutCommit: vi.fn(),
      branchExists: vi.fn(),
      createBranch: vi.fn(),
      checkoutBranch: vi.fn(),
      // Other GitAdapter methods not used by BranchManager
      createWorktree: vi.fn(),
      removeWorktree: vi.fn(),
      listWorktrees: vi.fn(),
      getDefaultBranch: vi.fn(),
      getBranchCommit: vi.fn(),
      getMergeBase: vi.fn(),
      fetch: vi.fn(),
    } as unknown as GitAdapter;

    manager = new BranchManager(mockGit);
  });

  describe('isOnBranch', () => {
    it('returns true when on target branch', () => {
      vi.mocked(mockGit.getCurrentBranch).mockReturnValue('task/foo');
      expect(manager.isOnBranch(worktreePath, 'task/foo')).toBe(true);
    });

    it('returns false when on different branch', () => {
      vi.mocked(mockGit.getCurrentBranch).mockReturnValue('task/other');
      expect(manager.isOnBranch(worktreePath, 'task/foo')).toBe(false);
    });

    it('returns false when in detached HEAD', () => {
      vi.mocked(mockGit.getCurrentBranch).mockReturnValue(null);
      expect(manager.isOnBranch(worktreePath, 'task/foo')).toBe(false);
    });
  });

  describe('ensureBranch', () => {
    it('skips all operations when already on target branch', () => {
      vi.mocked(mockGit.getCurrentBranch).mockReturnValue('task/foo');

      manager.ensureBranch(worktreePath, 'task/foo', sourcePath, mergeBase);

      expect(mockGit.checkoutCommit).not.toHaveBeenCalled();
      expect(mockGit.branchExists).not.toHaveBeenCalled();
      expect(mockGit.createBranch).not.toHaveBeenCalled();
      expect(mockGit.checkoutBranch).not.toHaveBeenCalled();
    });

    it('creates and checks out new branch when not resuming', () => {
      vi.mocked(mockGit.getCurrentBranch).mockReturnValue(null); // detached HEAD

      manager.ensureBranch(worktreePath, 'task/foo', sourcePath, mergeBase, false);

      expect(mockGit.checkoutCommit).toHaveBeenCalledWith(worktreePath, mergeBase);
      expect(mockGit.createBranch).toHaveBeenCalledWith(worktreePath, 'task/foo');
      expect(mockGit.checkoutBranch).toHaveBeenCalledWith(worktreePath, 'task/foo');
    });

    it('checks out existing branch without creating when resuming', () => {
      vi.mocked(mockGit.getCurrentBranch).mockReturnValue('task/other');

      manager.ensureBranch(worktreePath, 'task/foo', sourcePath, mergeBase, true);

      expect(mockGit.checkoutCommit).not.toHaveBeenCalled();
      expect(mockGit.createBranch).not.toHaveBeenCalled();
      expect(mockGit.checkoutBranch).toHaveBeenCalledWith(worktreePath, 'task/foo');
    });

    it('handles transition from detached HEAD to new branch', () => {
      vi.mocked(mockGit.getCurrentBranch).mockReturnValue(null);

      manager.ensureBranch(worktreePath, 'task/foo', sourcePath, mergeBase, false);

      expect(mockGit.checkoutCommit).toHaveBeenCalledWith(worktreePath, mergeBase);
      expect(mockGit.createBranch).toHaveBeenCalledWith(worktreePath, 'task/foo');
      expect(mockGit.checkoutBranch).toHaveBeenCalledWith(worktreePath, 'task/foo');
    });
  });
});
