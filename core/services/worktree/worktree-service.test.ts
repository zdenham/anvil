import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WorktreeService } from './worktree-service';
import type { RepositorySettingsService } from '../repository/settings-service';
import type { GitAdapter, PathLock, Logger } from '@core/adapters/types';
import type { RepositorySettings, WorktreeState } from '@core/types/repositories.js';

function createTestWorktree(overrides: Partial<WorktreeState> = {}): WorktreeState {
  return {
    id: crypto.randomUUID(),
    path: '/default/path',
    name: 'default',
    lastAccessedAt: Date.now(),
    currentBranch: null,
    ...overrides,
  };
}

function createMockSettingsService(
  settings: RepositorySettings
): RepositorySettingsService {
  return {
    load: vi.fn(() => settings),
    save: vi.fn(),
    exists: vi.fn(() => true),
  } as unknown as RepositorySettingsService;
}

function createMockGit(): GitAdapter {
  return {
    createWorktree: vi.fn(),
    removeWorktree: vi.fn(),
    listWorktrees: vi.fn(() => []),
    getDefaultBranch: vi.fn(() => 'main'),
    getBranchCommit: vi.fn(() => 'abc123'),
    checkoutCommit: vi.fn(),
    checkoutBranch: vi.fn(),
    getMergeBase: vi.fn(() => 'abc123'),
    fetch: vi.fn(),
    branchExists: vi.fn(() => false),
    createBranch: vi.fn(),
    getCurrentBranch: vi.fn(() => 'main'),
  };
}

function createMockLock(): PathLock {
  return {
    acquire: vi.fn(),
    release: vi.fn(),
    isHeld: vi.fn(() => false),
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

function createValidSettings(overrides: Partial<RepositorySettings> = {}): RepositorySettings {
  return {
    schemaVersion: 1,
    name: 'test-repo',
    originalUrl: 'https://github.com/example/repo.git',
    sourcePath: '/path/to/source',
    useWorktrees: true,
    defaultBranch: 'main',
    createdAt: 1700000000000,
    worktrees: [],
    threadBranches: {},
    lastUpdated: 1700000000000,
    ...overrides,
  };
}

describe('WorktreeService', () => {
  const mortDir = '/home/user/.mort';
  let mockSettingsService: RepositorySettingsService;
  let mockGit: GitAdapter;
  let mockLock: PathLock;
  let mockLogger: Logger;
  let settings: RepositorySettings;
  let service: WorktreeService;

  beforeEach(() => {
    settings = createValidSettings();
    mockSettingsService = createMockSettingsService(settings);
    mockGit = createMockGit();
    mockLock = createMockLock();
    mockLogger = createMockLogger();
    service = new WorktreeService(
      mortDir,
      mockSettingsService,
      mockGit,
      mockLock,
      mockLogger
    );
  });

  describe('create()', () => {
    it('should fetch from origin and create worktree at remote commit', () => {
      const result = service.create('test-repo', 'my-worktree');

      // Should fetch from origin first
      expect(mockGit.fetch).toHaveBeenCalledWith('/path/to/source', 'origin');

      // Should get the default branch
      expect(mockGit.getDefaultBranch).toHaveBeenCalledWith('/path/to/source');

      // Should get the remote commit
      expect(mockGit.getBranchCommit).toHaveBeenCalledWith('/path/to/source', 'origin/main');

      // Should create worktree with the remote commit
      expect(mockGit.createWorktree).toHaveBeenCalledWith(
        '/path/to/source',
        '/home/user/.mort/repositories/test-repo/my-worktree',
        { commit: 'abc123' }
      );
      expect(result.path).toBe('/home/user/.mort/repositories/test-repo/my-worktree');
      expect(result.name).toBe('my-worktree');
    });

    it('should fall back to local default branch if fetch fails', () => {
      (mockGit.fetch as ReturnType<typeof vi.fn>).mockImplementation(() => {
        throw new Error('Network error');
      });

      const result = service.create('test-repo', 'my-worktree');

      // Should log warning about fetch failure
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Failed to fetch from origin, falling back to local default branch',
        expect.objectContaining({ repoName: 'test-repo' })
      );

      // Should create worktree without commit option (uses local HEAD)
      expect(mockGit.createWorktree).toHaveBeenCalledWith(
        '/path/to/source',
        '/home/user/.mort/repositories/test-repo/my-worktree',
        { commit: undefined }
      );
      expect(result.name).toBe('my-worktree');
    });

    it('should fall back to local if getBranchCommit fails for remote branch', () => {
      (mockGit.getBranchCommit as ReturnType<typeof vi.fn>).mockImplementation(() => {
        throw new Error('Remote branch not found');
      });

      const result = service.create('test-repo', 'my-worktree');

      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Failed to fetch from origin, falling back to local default branch',
        expect.objectContaining({ repoName: 'test-repo' })
      );

      expect(mockGit.createWorktree).toHaveBeenCalledWith(
        '/path/to/source',
        '/home/user/.mort/repositories/test-repo/my-worktree',
        { commit: undefined }
      );
      expect(result.name).toBe('my-worktree');
    });

    it('should add worktree to settings with correct name', () => {
      service.create('test-repo', 'my-worktree');

      expect(mockSettingsService.save).toHaveBeenCalledWith(
        'test-repo',
        expect.objectContaining({
          worktrees: expect.arrayContaining([
            expect.objectContaining({ name: 'my-worktree' }),
          ]),
        })
      );
    });

    it('should set lastAccessedAt timestamp', () => {
      const before = Date.now();
      const result = service.create('test-repo', 'my-worktree');
      const after = Date.now();

      expect(result.lastAccessedAt).toBeGreaterThanOrEqual(before);
      expect(result.lastAccessedAt).toBeLessThanOrEqual(after);
    });

    it('should reject duplicate names', () => {
      settings.worktrees = [
        createTestWorktree({ path: '/existing', name: 'my-worktree', lastAccessedAt: 1000 }),
      ];

      expect(() => service.create('test-repo', 'my-worktree')).toThrow(
        'Worktree "my-worktree" already exists'
      );
    });

    it('should reject invalid characters in name', () => {
      expect(() => service.create('test-repo', 'invalid name!')).toThrow(
        'Name can only contain letters, numbers, dashes, and underscores'
      );
      expect(() => service.create('test-repo', 'invalid/name')).toThrow(
        'Name can only contain letters, numbers, dashes, and underscores'
      );
      expect(() => service.create('test-repo', 'invalid.name')).toThrow(
        'Name can only contain letters, numbers, dashes, and underscores'
      );
    });

    it('should accept valid names with letters, numbers, dashes, and underscores', () => {
      const result = service.create('test-repo', 'valid-name_123');
      expect(result.name).toBe('valid-name_123');
    });

    it('should acquire and release lock', () => {
      service.create('test-repo', 'my-worktree');

      expect(mockLock.acquire).toHaveBeenCalledWith(
        '/home/user/.mort/repositories/test-repo/.lock'
      );
      expect(mockLock.release).toHaveBeenCalledWith(
        '/home/user/.mort/repositories/test-repo/.lock'
      );
    });

    it('should release lock even if operation fails', () => {
      settings.worktrees = [createTestWorktree({ path: '/existing', name: 'my-worktree', lastAccessedAt: 1000 })];

      expect(() => service.create('test-repo', 'my-worktree')).toThrow();
      expect(mockLock.release).toHaveBeenCalled();
    });
  });

  describe('delete()', () => {
    beforeEach(() => {
      settings.worktrees = [
        createTestWorktree({ path: '/home/user/.mort/repositories/test-repo/wt1', name: 'wt1', lastAccessedAt: 1000 }),
        createTestWorktree({ path: '/home/user/.mort/repositories/test-repo/wt2', name: 'wt2', lastAccessedAt: 2000 }),
      ];
    });

    it('should remove git worktree', () => {
      service.delete('test-repo', 'wt1');

      expect(mockGit.removeWorktree).toHaveBeenCalledWith(
        '/path/to/source',
        '/home/user/.mort/repositories/test-repo/wt1'
      );
    });

    it('should remove worktree from settings', () => {
      service.delete('test-repo', 'wt1');

      expect(mockSettingsService.save).toHaveBeenCalledWith(
        'test-repo',
        expect.objectContaining({
          worktrees: expect.not.arrayContaining([
            expect.objectContaining({ name: 'wt1' }),
          ]),
        })
      );
    });

    it('should fail if worktree not found', () => {
      expect(() => service.delete('test-repo', 'nonexistent')).toThrow(
        'Worktree "nonexistent" not found'
      );
    });

    it('should acquire and release lock', () => {
      service.delete('test-repo', 'wt1');

      expect(mockLock.acquire).toHaveBeenCalledWith(
        '/home/user/.mort/repositories/test-repo/.lock'
      );
      expect(mockLock.release).toHaveBeenCalledWith(
        '/home/user/.mort/repositories/test-repo/.lock'
      );
    });
  });

  describe('rename()', () => {
    beforeEach(() => {
      settings.worktrees = [
        createTestWorktree({ path: '/wt1', name: 'old-name', lastAccessedAt: 1000 }),
      ];
    });

    it('should update name in settings', () => {
      service.rename('test-repo', 'old-name', 'new-name');

      expect(mockSettingsService.save).toHaveBeenCalledWith(
        'test-repo',
        expect.objectContaining({
          worktrees: expect.arrayContaining([
            expect.objectContaining({ name: 'new-name' }),
          ]),
        })
      );
    });

    it('should reject duplicate names', () => {
      settings.worktrees = [
        createTestWorktree({ path: '/wt1', name: 'old-name', lastAccessedAt: 1000 }),
        createTestWorktree({ path: '/wt2', name: 'existing-name', lastAccessedAt: 2000 }),
      ];

      expect(() => service.rename('test-repo', 'old-name', 'existing-name')).toThrow(
        'Worktree "existing-name" already exists'
      );
    });

    it('should fail if source worktree not found', () => {
      expect(() => service.rename('test-repo', 'nonexistent', 'new-name')).toThrow(
        'Worktree "nonexistent" not found'
      );
    });

    it('should reject invalid characters in new name', () => {
      expect(() => service.rename('test-repo', 'old-name', 'invalid name!')).toThrow(
        'Name can only contain letters, numbers, dashes, and underscores'
      );
    });
  });

  describe('list()', () => {
    it('should return all worktrees', () => {
      settings.worktrees = [
        createTestWorktree({ path: '/wt1', name: 'wt1', lastAccessedAt: 1000 }),
        createTestWorktree({ path: '/wt2', name: 'wt2', lastAccessedAt: 2000 }),
      ];

      const result = service.list('test-repo');

      expect(result).toHaveLength(2);
      expect(result.map(w => w.name)).toContain('wt1');
      expect(result.map(w => w.name)).toContain('wt2');
    });

    it('should sort by lastAccessedAt descending', () => {
      settings.worktrees = [
        createTestWorktree({ path: '/wt1', name: 'wt1', lastAccessedAt: 1000 }),
        createTestWorktree({ path: '/wt2', name: 'wt2', lastAccessedAt: 3000 }),
        createTestWorktree({ path: '/wt3', name: 'wt3', lastAccessedAt: 2000 }),
      ];

      const result = service.list('test-repo');

      expect(result[0].name).toBe('wt2');
      expect(result[1].name).toBe('wt3');
      expect(result[2].name).toBe('wt1');
    });

    it('should return empty array when no worktrees', () => {
      settings.worktrees = [];

      const result = service.list('test-repo');

      expect(result).toEqual([]);
    });

    it('should handle worktrees without lastAccessedAt', () => {
      settings.worktrees = [
        createTestWorktree({ path: '/wt1', name: 'wt1', lastAccessedAt: undefined }),
        createTestWorktree({ path: '/wt2', name: 'wt2', lastAccessedAt: 1000 }),
      ];

      const result = service.list('test-repo');

      // Worktree with timestamp should come first
      expect(result[0].name).toBe('wt2');
      expect(result[1].name).toBe('wt1');
    });
  });

  describe('getByPath()', () => {
    beforeEach(() => {
      settings.worktrees = [
        createTestWorktree({ path: '/wt1', name: 'wt1', lastAccessedAt: 1000 }),
        createTestWorktree({ path: '/wt2', name: 'wt2', lastAccessedAt: 2000 }),
      ];
    });

    it('should return matching worktree', () => {
      const result = service.getByPath('test-repo', '/wt1');

      expect(result).not.toBeNull();
      expect(result?.name).toBe('wt1');
    });

    it('should return null if not found', () => {
      const result = service.getByPath('test-repo', '/nonexistent');

      expect(result).toBeNull();
    });
  });

  describe('getByName()', () => {
    beforeEach(() => {
      settings.worktrees = [
        createTestWorktree({ path: '/wt1', name: 'wt1', lastAccessedAt: 1000 }),
        createTestWorktree({ path: '/wt2', name: 'wt2', lastAccessedAt: 2000 }),
      ];
    });

    it('should return matching worktree', () => {
      const result = service.getByName('test-repo', 'wt1');

      expect(result).not.toBeNull();
      expect(result?.path).toBe('/wt1');
    });

    it('should return null if not found', () => {
      const result = service.getByName('test-repo', 'nonexistent');

      expect(result).toBeNull();
    });
  });

  describe('touch()', () => {
    beforeEach(() => {
      settings.worktrees = [
        createTestWorktree({ path: '/wt1', name: 'wt1', lastAccessedAt: 1000 }),
      ];
    });

    it('should update timestamp', () => {
      const before = Date.now();
      service.touch('test-repo', '/wt1');

      expect(mockSettingsService.save).toHaveBeenCalledWith(
        'test-repo',
        expect.objectContaining({
          worktrees: expect.arrayContaining([
            expect.objectContaining({
              name: 'wt1',
              lastAccessedAt: expect.any(Number),
            }),
          ]),
        })
      );

      // Check the actual timestamp value
      const savedSettings = (mockSettingsService.save as ReturnType<typeof vi.fn>).mock.calls[0][1];
      expect(savedSettings.worktrees[0].lastAccessedAt).toBeGreaterThanOrEqual(before);
    });

    it('should handle missing worktree gracefully', () => {
      // Should not throw
      expect(() => service.touch('test-repo', '/nonexistent')).not.toThrow();
      // Should not save if worktree not found
      expect(mockSettingsService.save).not.toHaveBeenCalled();
    });

    it('should acquire and release lock', () => {
      service.touch('test-repo', '/wt1');

      expect(mockLock.acquire).toHaveBeenCalledWith(
        '/home/user/.mort/repositories/test-repo/.lock'
      );
      expect(mockLock.release).toHaveBeenCalledWith(
        '/home/user/.mort/repositories/test-repo/.lock'
      );
    });
  });
});
