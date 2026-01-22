import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ThreadService } from './thread-service';
import type { FileSystemAdapter } from '@core/adapters/types';
import type { CreateThreadInput, ThreadMetadata } from '@core/types/threads.js';

describe('ThreadService', () => {
  let service: ThreadService;
  let mockFs: FileSystemAdapter;
  let mockStorage: Map<string, string>;
  let mockDirs: Set<string>;
  const mortDir = '/home/user/.mort';

  // Valid UUIDs for testing
  const testThreadId = '550e8400-e29b-41d4-a716-446655440001';
  const testRepoId = '550e8400-e29b-41d4-a716-446655440002';
  const testWorktreeId = '550e8400-e29b-41d4-a716-446655440003';

  beforeEach(() => {
    mockStorage = new Map();
    mockDirs = new Set();

    mockFs = {
      readFile: vi.fn((filePath: string) => {
        const content = mockStorage.get(filePath);
        if (content === undefined) {
          throw new Error(`File not found: ${filePath}`);
        }
        return content;
      }),
      writeFile: vi.fn((filePath: string, content: string) => {
        mockStorage.set(filePath, content);
      }),
      mkdir: vi.fn((dirPath: string) => {
        mockDirs.add(dirPath);
      }),
      exists: vi.fn((targetPath: string) => {
        return mockStorage.has(targetPath) || mockDirs.has(targetPath);
      }),
      remove: vi.fn((targetPath: string) => {
        mockStorage.delete(targetPath);
        mockDirs.delete(targetPath);
      }),
      readDir: vi.fn((dirPath: string) => {
        const entries: string[] = [];
        for (const key of mockStorage.keys()) {
          if (key.startsWith(dirPath + '/')) {
            const relative = key.slice(dirPath.length + 1);
            const firstPart = relative.split('/')[0];
            if (!entries.includes(firstPart)) {
              entries.push(firstPart);
            }
          }
        }
        return entries;
      }),
      glob: vi.fn(() => []),
    };

    service = new ThreadService(mortDir, mockFs);
  });

  describe('create', () => {
    it('should create thread with all required fields', () => {
      const input: CreateThreadInput = {
        id: testThreadId,
        repoId: testRepoId,
        worktreeId: testWorktreeId,
        prompt: 'Implement feature X',
        git: { branch: 'feature/test' },
      };

      const result = service.create(input);

      expect(result.id).toBe(testThreadId);
      expect(result.repoId).toBe(testRepoId);
      expect(result.worktreeId).toBe(testWorktreeId);
      expect(result.status).toBe('running');
      expect(result.git).toEqual({ branch: 'feature/test' });
      expect(result.createdAt).toBeDefined();
      expect(result.updatedAt).toBeDefined();
    });

    it('should create thread with initial turn', () => {
      const input: CreateThreadInput = {
        id: testThreadId,
        repoId: testRepoId,
        worktreeId: testWorktreeId,
        prompt: 'Implement feature X',
      };

      const result = service.create(input);

      expect(result.turns).toHaveLength(1);
      expect(result.turns[0].index).toBe(0);
      expect(result.turns[0].prompt).toBe('Implement feature X');
      expect(result.turns[0].startedAt).toBeDefined();
      expect(result.turns[0].completedAt).toBeNull();
    });

    it('should generate id if not provided', () => {
      const input: CreateThreadInput = {
        repoId: testRepoId,
        worktreeId: testWorktreeId,
        prompt: 'Implement feature X',
      };

      const result = service.create(input);

      expect(result.id).toBeDefined();
      expect(result.id.length).toBeGreaterThan(0);
    });

    it('should create thread directory', () => {
      const input: CreateThreadInput = {
        id: testThreadId,
        repoId: testRepoId,
        worktreeId: testWorktreeId,
        prompt: 'Implement feature X',
      };

      service.create(input);

      expect(mockFs.mkdir).toHaveBeenCalledWith(
        `/home/user/.mort/threads/${testThreadId}`,
        { recursive: true }
      );
    });

    it('should write metadata file', () => {
      const input: CreateThreadInput = {
        id: testThreadId,
        repoId: testRepoId,
        worktreeId: testWorktreeId,
        prompt: 'Implement feature X',
      };

      service.create(input);

      expect(mockFs.writeFile).toHaveBeenCalledWith(
        `/home/user/.mort/threads/${testThreadId}/metadata.json`,
        expect.any(String)
      );
    });
  });

  describe('get', () => {
    it('should return parsed metadata', () => {
      const metadata: ThreadMetadata = {
        id: testThreadId,
        repoId: testRepoId,
        worktreeId: testWorktreeId,
        status: 'running',
        createdAt: 1000,
        updatedAt: 1000,
        isRead: true,
        turns: [],
      };
      const metadataPath = `/home/user/.mort/threads/${testThreadId}/metadata.json`;
      mockStorage.set(metadataPath, JSON.stringify(metadata));

      const result = service.get(testThreadId);

      expect(result).toEqual(metadata);
    });

    it('should throw when thread does not exist', () => {
      expect(() => service.get('nonexistent')).toThrow();
    });
  });

  describe('update', () => {
    it('should merge changes correctly', () => {
      const metadata: ThreadMetadata = {
        id: testThreadId,
        repoId: testRepoId,
        worktreeId: testWorktreeId,
        status: 'running',
        createdAt: 1000,
        updatedAt: 1000,
        isRead: true,
        turns: [],
      };
      const metadataPath = `/home/user/.mort/threads/${testThreadId}/metadata.json`;
      mockStorage.set(metadataPath, JSON.stringify(metadata));

      const result = service.update(testThreadId, { status: 'paused' });

      expect(result.status).toBe('paused');
      expect(result.id).toBe(testThreadId);
      expect(result.repoId).toBe(testRepoId);
    });

    it('should update timestamp', () => {
      const metadata: ThreadMetadata = {
        id: testThreadId,
        repoId: testRepoId,
        worktreeId: testWorktreeId,
        status: 'running',
        createdAt: 1000,
        updatedAt: 1000,
        isRead: true,
        turns: [],
      };
      const metadataPath = `/home/user/.mort/threads/${testThreadId}/metadata.json`;
      mockStorage.set(metadataPath, JSON.stringify(metadata));

      const result = service.update(testThreadId, { status: 'paused' });

      expect(result.updatedAt).toBeGreaterThan(1000);
    });

    it('should update git info', () => {
      const metadata: ThreadMetadata = {
        id: testThreadId,
        repoId: testRepoId,
        worktreeId: testWorktreeId,
        status: 'running',
        createdAt: 1000,
        updatedAt: 1000,
        isRead: true,
        git: { branch: 'feature/old' },
        turns: [],
      };
      const metadataPath = `/home/user/.mort/threads/${testThreadId}/metadata.json`;
      mockStorage.set(metadataPath, JSON.stringify(metadata));

      const result = service.update(testThreadId, {
        git: { branch: 'feature/new', commitHash: 'abc123' },
      });

      expect(result.git).toEqual({
        branch: 'feature/new',
        commitHash: 'abc123',
      });
    });
  });

  describe('markCompleted', () => {
    it('should set status to completed', () => {
      const metadata: ThreadMetadata = {
        id: testThreadId,
        repoId: testRepoId,
        worktreeId: testWorktreeId,
        status: 'running',
        createdAt: 1000,
        updatedAt: 1000,
        isRead: true,
        turns: [{ index: 0, prompt: 'test', startedAt: 1000, completedAt: null }],
      };
      const metadataPath = `/home/user/.mort/threads/${testThreadId}/metadata.json`;
      mockStorage.set(metadataPath, JSON.stringify(metadata));

      const result = service.markCompleted(testThreadId);

      expect(result.status).toBe('completed');
    });

    it('should complete current turn', () => {
      const metadata: ThreadMetadata = {
        id: testThreadId,
        repoId: testRepoId,
        worktreeId: testWorktreeId,
        status: 'running',
        createdAt: 1000,
        updatedAt: 1000,
        isRead: true,
        turns: [{ index: 0, prompt: 'test', startedAt: 1000, completedAt: null }],
      };
      const metadataPath = `/home/user/.mort/threads/${testThreadId}/metadata.json`;
      mockStorage.set(metadataPath, JSON.stringify(metadata));

      const result = service.markCompleted(testThreadId, 0);

      expect(result.turns[0].completedAt).not.toBeNull();
      expect(result.turns[0].exitCode).toBe(0);
    });

    it('should not modify already completed turn', () => {
      const completedAt = 2000;
      const metadata: ThreadMetadata = {
        id: testThreadId,
        repoId: testRepoId,
        worktreeId: testWorktreeId,
        status: 'running',
        createdAt: 1000,
        updatedAt: 1000,
        isRead: true,
        turns: [
          { index: 0, prompt: 'test', startedAt: 1000, completedAt, exitCode: 1 },
        ],
      };
      const metadataPath = `/home/user/.mort/threads/${testThreadId}/metadata.json`;
      mockStorage.set(metadataPath, JSON.stringify(metadata));

      const result = service.markCompleted(testThreadId, 0);

      expect(result.turns[0].completedAt).toBe(completedAt);
      expect(result.turns[0].exitCode).toBe(1);
    });
  });

  describe('markError', () => {
    it('should set status to error', () => {
      const metadata: ThreadMetadata = {
        id: testThreadId,
        repoId: testRepoId,
        worktreeId: testWorktreeId,
        status: 'running',
        createdAt: 1000,
        updatedAt: 1000,
        isRead: true,
        turns: [{ index: 0, prompt: 'test', startedAt: 1000, completedAt: null }],
      };
      const metadataPath = `/home/user/.mort/threads/${testThreadId}/metadata.json`;
      mockStorage.set(metadataPath, JSON.stringify(metadata));

      const result = service.markError(testThreadId);

      expect(result.status).toBe('error');
    });

    it('should complete current turn with exit code', () => {
      const metadata: ThreadMetadata = {
        id: testThreadId,
        repoId: testRepoId,
        worktreeId: testWorktreeId,
        status: 'running',
        createdAt: 1000,
        updatedAt: 1000,
        isRead: true,
        turns: [{ index: 0, prompt: 'test', startedAt: 1000, completedAt: null }],
      };
      const metadataPath = `/home/user/.mort/threads/${testThreadId}/metadata.json`;
      mockStorage.set(metadataPath, JSON.stringify(metadata));

      const result = service.markError(testThreadId, 1);

      expect(result.turns[0].completedAt).not.toBeNull();
      expect(result.turns[0].exitCode).toBe(1);
    });
  });

  describe('exists', () => {
    it('should return true when thread exists', () => {
      const metadataPath = `/home/user/.mort/threads/${testThreadId}/metadata.json`;
      mockStorage.set(metadataPath, '{}');

      const result = service.exists(testThreadId);

      expect(result).toBe(true);
    });

    it('should return false when thread does not exist', () => {
      const result = service.exists('nonexistent');

      expect(result).toBe(false);
    });
  });

  describe('list', () => {
    it('should return all thread folder names', () => {
      const uuid1 = '550e8400-e29b-41d4-a716-446655440011';
      const uuid2 = '550e8400-e29b-41d4-a716-446655440012';
      const uuid3 = '550e8400-e29b-41d4-a716-446655440013';
      // Set up multiple threads
      mockStorage.set(
        `/home/user/.mort/threads/${uuid1}/metadata.json`,
        '{}'
      );
      mockStorage.set(
        `/home/user/.mort/threads/${uuid2}/metadata.json`,
        '{}'
      );
      mockStorage.set(
        `/home/user/.mort/threads/${uuid3}/metadata.json`,
        '{}'
      );
      mockDirs.add('/home/user/.mort/threads');

      const result = service.list();

      expect(result.sort()).toEqual([uuid1, uuid2, uuid3].sort());
    });

    it('should return empty array when threads directory does not exist', () => {
      const result = service.list();

      expect(result).toEqual([]);
    });

    it('should filter out directories without metadata.json', () => {
      const validUuid = '550e8400-e29b-41d4-a716-446655440021';
      // Set up one valid thread and one invalid directory
      mockStorage.set(
        `/home/user/.mort/threads/${validUuid}/metadata.json`,
        '{}'
      );
      // Add a directory without metadata.json
      mockDirs.add('/home/user/.mort/threads');

      // Override readDir to return both valid and invalid entries
      (mockFs.readDir as ReturnType<typeof vi.fn>).mockReturnValue([
        validUuid,
        'invalid-dir',
      ]);

      const result = service.list();

      expect(result).toEqual([validUuid]);
    });
  });
});
