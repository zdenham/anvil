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
        id: 'test-uuid-123',
        taskId: 'task-456',
        agentType: 'execution',
        workingDirectory: '/path/to/worktree',
        prompt: 'Implement feature X',
        git: { branch: 'feature/test' },
      };

      const result = service.create('my-task', input);

      expect(result.id).toBe('test-uuid-123');
      expect(result.taskId).toBe('task-456');
      expect(result.agentType).toBe('execution');
      expect(result.workingDirectory).toBe('/path/to/worktree');
      expect(result.status).toBe('running');
      expect(result.git).toEqual({ branch: 'feature/test' });
      expect(result.createdAt).toBeDefined();
      expect(result.updatedAt).toBeDefined();
    });

    it('should create thread with initial turn', () => {
      const input: CreateThreadInput = {
        id: 'test-uuid-123',
        taskId: 'task-456',
        agentType: 'execution',
        workingDirectory: '/path/to/worktree',
        prompt: 'Implement feature X',
      };

      const result = service.create('my-task', input);

      expect(result.turns).toHaveLength(1);
      expect(result.turns[0].index).toBe(0);
      expect(result.turns[0].prompt).toBe('Implement feature X');
      expect(result.turns[0].startedAt).toBeDefined();
      expect(result.turns[0].completedAt).toBeNull();
    });

    it('should generate id if not provided', () => {
      const input: CreateThreadInput = {
        taskId: 'task-456',
        agentType: 'execution',
        workingDirectory: '/path/to/worktree',
        prompt: 'Implement feature X',
      };

      const result = service.create('my-task', input);

      expect(result.id).toBeDefined();
      expect(result.id.length).toBeGreaterThan(0);
    });

    it('should create thread directory', () => {
      const input: CreateThreadInput = {
        id: 'test-uuid-123',
        taskId: 'task-456',
        agentType: 'execution',
        workingDirectory: '/path/to/worktree',
        prompt: 'Implement feature X',
      };

      service.create('my-task', input);

      expect(mockFs.mkdir).toHaveBeenCalledWith(
        '/home/user/.mort/tasks/my-task/threads/execution-test-uuid-123',
        { recursive: true }
      );
    });

    it('should write metadata file', () => {
      const input: CreateThreadInput = {
        id: 'test-uuid-123',
        taskId: 'task-456',
        agentType: 'execution',
        workingDirectory: '/path/to/worktree',
        prompt: 'Implement feature X',
      };

      service.create('my-task', input);

      expect(mockFs.writeFile).toHaveBeenCalledWith(
        '/home/user/.mort/tasks/my-task/threads/execution-test-uuid-123/metadata.json',
        expect.any(String)
      );
    });
  });

  describe('get', () => {
    it('should return parsed metadata', () => {
      const metadata: ThreadMetadata = {
        id: 'test-uuid-123',
        taskId: 'task-456',
        agentType: 'execution',
        workingDirectory: '/path/to/worktree',
        status: 'running',
        createdAt: 1000,
        updatedAt: 1000,
        isRead: true,
        turns: [],
      };
      const metadataPath =
        '/home/user/.mort/tasks/my-task/threads/execution-test-uuid-123/metadata.json';
      mockStorage.set(metadataPath, JSON.stringify(metadata));

      const result = service.get('my-task', 'execution-test-uuid-123');

      expect(result).toEqual(metadata);
    });

    it('should throw when thread does not exist', () => {
      expect(() =>
        service.get('my-task', 'execution-nonexistent')
      ).toThrow();
    });
  });

  describe('update', () => {
    it('should merge changes correctly', () => {
      const metadata: ThreadMetadata = {
        id: 'test-uuid-123',
        taskId: 'task-456',
        agentType: 'execution',
        workingDirectory: '/path/to/worktree',
        status: 'running',
        createdAt: 1000,
        updatedAt: 1000,
        isRead: true,
        turns: [],
      };
      const metadataPath =
        '/home/user/.mort/tasks/my-task/threads/execution-test-uuid-123/metadata.json';
      mockStorage.set(metadataPath, JSON.stringify(metadata));

      const result = service.update('my-task', 'execution-test-uuid-123', {
        status: 'paused',
      });

      expect(result.status).toBe('paused');
      expect(result.id).toBe('test-uuid-123');
      expect(result.taskId).toBe('task-456');
    });

    it('should update timestamp', () => {
      const metadata: ThreadMetadata = {
        id: 'test-uuid-123',
        taskId: 'task-456',
        agentType: 'execution',
        workingDirectory: '/path/to/worktree',
        status: 'running',
        createdAt: 1000,
        updatedAt: 1000,
        isRead: true,
        turns: [],
      };
      const metadataPath =
        '/home/user/.mort/tasks/my-task/threads/execution-test-uuid-123/metadata.json';
      mockStorage.set(metadataPath, JSON.stringify(metadata));

      const result = service.update('my-task', 'execution-test-uuid-123', {
        status: 'paused',
      });

      expect(result.updatedAt).toBeGreaterThan(1000);
    });

    it('should update git info', () => {
      const metadata: ThreadMetadata = {
        id: 'test-uuid-123',
        taskId: 'task-456',
        agentType: 'execution',
        workingDirectory: '/path/to/worktree',
        status: 'running',
        createdAt: 1000,
        updatedAt: 1000,
        isRead: true,
        git: { branch: 'feature/old' },
        turns: [],
      };
      const metadataPath =
        '/home/user/.mort/tasks/my-task/threads/execution-test-uuid-123/metadata.json';
      mockStorage.set(metadataPath, JSON.stringify(metadata));

      const result = service.update('my-task', 'execution-test-uuid-123', {
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
        id: 'test-uuid-123',
        taskId: 'task-456',
        agentType: 'execution',
        workingDirectory: '/path/to/worktree',
        status: 'running',
        createdAt: 1000,
        updatedAt: 1000,
        isRead: true,
        turns: [{ index: 0, prompt: 'test', startedAt: 1000, completedAt: null }],
      };
      const metadataPath =
        '/home/user/.mort/tasks/my-task/threads/execution-test-uuid-123/metadata.json';
      mockStorage.set(metadataPath, JSON.stringify(metadata));

      const result = service.markCompleted('my-task', 'execution-test-uuid-123');

      expect(result.status).toBe('completed');
    });

    it('should complete current turn', () => {
      const metadata: ThreadMetadata = {
        id: 'test-uuid-123',
        taskId: 'task-456',
        agentType: 'execution',
        workingDirectory: '/path/to/worktree',
        status: 'running',
        createdAt: 1000,
        updatedAt: 1000,
        isRead: true,
        turns: [{ index: 0, prompt: 'test', startedAt: 1000, completedAt: null }],
      };
      const metadataPath =
        '/home/user/.mort/tasks/my-task/threads/execution-test-uuid-123/metadata.json';
      mockStorage.set(metadataPath, JSON.stringify(metadata));

      const result = service.markCompleted(
        'my-task',
        'execution-test-uuid-123',
        0
      );

      expect(result.turns[0].completedAt).not.toBeNull();
      expect(result.turns[0].exitCode).toBe(0);
    });

    it('should not modify already completed turn', () => {
      const completedAt = 2000;
      const metadata: ThreadMetadata = {
        id: 'test-uuid-123',
        taskId: 'task-456',
        agentType: 'execution',
        workingDirectory: '/path/to/worktree',
        status: 'running',
        createdAt: 1000,
        updatedAt: 1000,
        isRead: true,
        turns: [
          { index: 0, prompt: 'test', startedAt: 1000, completedAt, exitCode: 1 },
        ],
      };
      const metadataPath =
        '/home/user/.mort/tasks/my-task/threads/execution-test-uuid-123/metadata.json';
      mockStorage.set(metadataPath, JSON.stringify(metadata));

      const result = service.markCompleted(
        'my-task',
        'execution-test-uuid-123',
        0
      );

      expect(result.turns[0].completedAt).toBe(completedAt);
      expect(result.turns[0].exitCode).toBe(1);
    });
  });

  describe('markError', () => {
    it('should set status to error', () => {
      const metadata: ThreadMetadata = {
        id: 'test-uuid-123',
        taskId: 'task-456',
        agentType: 'execution',
        workingDirectory: '/path/to/worktree',
        status: 'running',
        createdAt: 1000,
        updatedAt: 1000,
        isRead: true,
        turns: [{ index: 0, prompt: 'test', startedAt: 1000, completedAt: null }],
      };
      const metadataPath =
        '/home/user/.mort/tasks/my-task/threads/execution-test-uuid-123/metadata.json';
      mockStorage.set(metadataPath, JSON.stringify(metadata));

      const result = service.markError('my-task', 'execution-test-uuid-123');

      expect(result.status).toBe('error');
    });

    it('should complete current turn with exit code', () => {
      const metadata: ThreadMetadata = {
        id: 'test-uuid-123',
        taskId: 'task-456',
        agentType: 'execution',
        workingDirectory: '/path/to/worktree',
        status: 'running',
        createdAt: 1000,
        updatedAt: 1000,
        isRead: true,
        turns: [{ index: 0, prompt: 'test', startedAt: 1000, completedAt: null }],
      };
      const metadataPath =
        '/home/user/.mort/tasks/my-task/threads/execution-test-uuid-123/metadata.json';
      mockStorage.set(metadataPath, JSON.stringify(metadata));

      const result = service.markError('my-task', 'execution-test-uuid-123', 1);

      expect(result.turns[0].completedAt).not.toBeNull();
      expect(result.turns[0].exitCode).toBe(1);
    });
  });

  describe('exists', () => {
    it('should return true when thread exists', () => {
      const metadataPath =
        '/home/user/.mort/tasks/my-task/threads/execution-test-uuid-123/metadata.json';
      mockStorage.set(metadataPath, '{}');

      const result = service.exists('my-task', 'execution-test-uuid-123');

      expect(result).toBe(true);
    });

    it('should return false when thread does not exist', () => {
      const result = service.exists('my-task', 'execution-nonexistent');

      expect(result).toBe(false);
    });
  });

  describe('list', () => {
    it('should return all thread folder names for a task', () => {
      // Set up multiple threads
      mockStorage.set(
        '/home/user/.mort/tasks/my-task/threads/execution-uuid1/metadata.json',
        '{}'
      );
      mockStorage.set(
        '/home/user/.mort/tasks/my-task/threads/review-uuid2/metadata.json',
        '{}'
      );
      mockStorage.set(
        '/home/user/.mort/tasks/my-task/threads/research-uuid3/metadata.json',
        '{}'
      );
      mockDirs.add('/home/user/.mort/tasks/my-task/threads');

      const result = service.list('my-task');

      expect(result.sort()).toEqual(
        ['execution-uuid1', 'research-uuid3', 'review-uuid2'].sort()
      );
    });

    it('should return empty array when threads directory does not exist', () => {
      const result = service.list('nonexistent-task');

      expect(result).toEqual([]);
    });

    it('should filter out directories without metadata.json', () => {
      // Set up one valid thread and one invalid directory
      mockStorage.set(
        '/home/user/.mort/tasks/my-task/threads/execution-uuid1/metadata.json',
        '{}'
      );
      // Add a directory without metadata.json
      mockDirs.add('/home/user/.mort/tasks/my-task/threads');

      // Override readDir to return both valid and invalid entries
      (mockFs.readDir as ReturnType<typeof vi.fn>).mockReturnValue([
        'execution-uuid1',
        'invalid-dir',
      ]);

      const result = service.list('my-task');

      expect(result).toEqual(['execution-uuid1']);
    });
  });
});
