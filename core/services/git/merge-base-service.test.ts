import { describe, it, expect, vi } from 'vitest';
import { MergeBaseService } from './merge-base-service';
import type { GitAdapter } from '@core/adapters/types';

/**
 * Creates a mock GitAdapter for testing.
 * Only implements getMergeBase as that's all MergeBaseService uses.
 */
function createMockGitAdapter(
  getMergeBaseImpl?: (repoPath: string, ref1: string, ref2: string) => string
): GitAdapter {
  return {
    createWorktree: vi.fn(),
    removeWorktree: vi.fn(),
    listWorktrees: vi.fn(() => []),
    getDefaultBranch: vi.fn(() => 'main'),
    getBranchCommit: vi.fn(() => 'abc123'),
    checkoutCommit: vi.fn(),
    checkoutBranch: vi.fn(),
    getMergeBase: vi.fn(getMergeBaseImpl ?? (() => 'merge-base-sha')),
    fetch: vi.fn(),
    branchExists: vi.fn(() => false),
    createBranch: vi.fn(),
    getCurrentBranch: vi.fn(() => null),
  };
}

describe('MergeBaseService', () => {
  describe('compute', () => {
    it('should compute merge base between HEAD and main', () => {
      const expectedSha = 'abc123def456';
      const mockGit = createMockGitAdapter(() => expectedSha);
      const service = new MergeBaseService(mockGit);

      const result = service.compute('/path/to/repo', 'main');

      expect(result).toBe(expectedSha);
      expect(mockGit.getMergeBase).toHaveBeenCalledWith(
        '/path/to/repo',
        'HEAD',
        'main'
      );
    });

    it('should compute merge base between HEAD and specified branch', () => {
      const expectedSha = 'feature-base-sha';
      const mockGit = createMockGitAdapter(() => expectedSha);
      const service = new MergeBaseService(mockGit);

      const result = service.compute('/repo', 'develop');

      expect(result).toBe(expectedSha);
      expect(mockGit.getMergeBase).toHaveBeenCalledWith(
        '/repo',
        'HEAD',
        'develop'
      );
    });

    it('should propagate error when merge base cannot be found', () => {
      const mockGit = createMockGitAdapter(() => {
        throw new Error('git merge-base failed: no common ancestor');
      });
      const service = new MergeBaseService(mockGit);

      expect(() => service.compute('/repo', 'orphan-branch')).toThrow(
        'no common ancestor'
      );
    });
  });

  describe('computeBetween', () => {
    it('should compute merge base between two branches', () => {
      const expectedSha = 'common-ancestor-sha';
      const mockGit = createMockGitAdapter(() => expectedSha);
      const service = new MergeBaseService(mockGit);

      const result = service.computeBetween('/repo', 'feature-a', 'feature-b');

      expect(result).toBe(expectedSha);
      expect(mockGit.getMergeBase).toHaveBeenCalledWith(
        '/repo',
        'feature-a',
        'feature-b'
      );
    });

    it('should compute merge base between commit and branch', () => {
      const expectedSha = 'sha123';
      const mockGit = createMockGitAdapter(() => expectedSha);
      const service = new MergeBaseService(mockGit);

      const result = service.computeBetween('/repo', 'abc123', 'main');

      expect(result).toBe(expectedSha);
      expect(mockGit.getMergeBase).toHaveBeenCalledWith(
        '/repo',
        'abc123',
        'main'
      );
    });

    it('should compute merge base between two commits', () => {
      const expectedSha = 'ancestor-sha';
      const mockGit = createMockGitAdapter(() => expectedSha);
      const service = new MergeBaseService(mockGit);

      const result = service.computeBetween('/repo', 'abc123', 'def456');

      expect(result).toBe(expectedSha);
      expect(mockGit.getMergeBase).toHaveBeenCalledWith(
        '/repo',
        'abc123',
        'def456'
      );
    });

    it('should propagate error when refs share no history', () => {
      const mockGit = createMockGitAdapter(() => {
        throw new Error('git merge-base failed: fatal: Not a valid object name');
      });
      const service = new MergeBaseService(mockGit);

      expect(() =>
        service.computeBetween('/repo', 'orphan-a', 'orphan-b')
      ).toThrow('fatal: Not a valid object name');
    });

    it('should propagate error for invalid refs', () => {
      const mockGit = createMockGitAdapter(() => {
        throw new Error('git merge-base failed: Unknown revision or path');
      });
      const service = new MergeBaseService(mockGit);

      expect(() =>
        service.computeBetween('/repo', 'nonexistent', 'also-nonexistent')
      ).toThrow('Unknown revision or path');
    });
  });
});
