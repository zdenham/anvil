import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { FileSystemAdapter } from '@core/adapters/types';
import { TaskDraftService } from './draft-service';
import { TaskMetadataService } from './metadata-service';

/**
 * Create a mock FileSystemAdapter for testing.
 * Simulates an in-memory file system.
 */
function createMockFS(
  files: Record<string, string> = {}
): FileSystemAdapter {
  const store = { ...files };

  return {
    readFile: vi.fn((filePath: string) => {
      if (!(filePath in store)) {
        throw new Error(`ENOENT: no such file: ${filePath}`);
      }
      return store[filePath];
    }),
    writeFile: vi.fn((filePath: string, content: string) => {
      store[filePath] = content;
    }),
    mkdir: vi.fn(() => {}),
    exists: vi.fn((targetPath: string) => {
      // Check for exact file match
      if (targetPath in store) return true;
      // Check if any file exists under this directory path
      const prefix = targetPath.endsWith('/') ? targetPath : `${targetPath}/`;
      for (const key of Object.keys(store)) {
        if (key.startsWith(prefix)) return true;
      }
      return false;
    }),
    remove: vi.fn((targetPath: string) => {
      for (const key of Object.keys(store)) {
        if (key.startsWith(targetPath)) {
          delete store[key];
        }
      }
    }),
    readDir: vi.fn((dirPath: string) => {
      const prefix = dirPath.endsWith('/') ? dirPath : `${dirPath}/`;
      const dirs = new Set<string>();
      for (const key of Object.keys(store)) {
        if (key.startsWith(prefix)) {
          const rest = key.slice(prefix.length);
          const firstDir = rest.split('/')[0];
          if (firstDir) dirs.add(firstDir);
        }
      }
      return Array.from(dirs);
    }),
    glob: vi.fn(() => []),
  };
}

describe('TaskDraftService', () => {
  let fs: FileSystemAdapter;
  let service: TaskDraftService;
  const mortDir = '/test/mort';

  beforeEach(() => {
    fs = createMockFS();
    service = new TaskDraftService(mortDir, fs);
  });

  describe('create', () => {
    it('should create directory and metadata file', () => {
      const result = service.create({
        id: 'task-123',
        repositoryName: 'my-repo',
        title: 'My Feature',
      });

      expect(fs.mkdir).toHaveBeenCalledWith(
        '/test/mort/tasks/my-feature',
        { recursive: true }
      );
      expect(fs.writeFile).toHaveBeenCalledWith(
        '/test/mort/tasks/my-feature/metadata.json',
        expect.any(String)
      );
      expect(result.id).toBe('task-123');
    });

    it('should have correct initial values', () => {
      const result = service.create({
        id: 'task-456',
        repositoryName: 'test-repo',
        title: 'Test Task',
      });

      expect(result.id).toBe('task-456');
      expect(result.slug).toBe('test-task');
      expect(result.title).toBe('Test Task');
      expect(result.repositoryName).toBe('test-repo');
      expect(result.subtasks).toEqual([]);
      expect(result.parentId).toBeNull();
      expect(result.tags).toEqual([]);
      expect(result.pendingReviews).toEqual([]);
      expect(result.type).toBe('work');
    });

    it('should set status to draft', () => {
      const result = service.create({
        id: 'task-789',
        repositoryName: 'repo',
        title: 'Draft Task',
      });

      expect(result.status).toBe('draft');
    });

    it('should generate slug from title', () => {
      const result = service.create({
        id: 'task-abc',
        repositoryName: 'repo',
        title: 'My AWESOME Feature!!!',
      });

      expect(result.slug).toBe('my-awesome-feature');
    });

    it('should follow task/{slug} pattern for branchName', () => {
      const result = service.create({
        id: 'task-def',
        repositoryName: 'repo',
        title: 'Branch Test',
      });

      expect(result.branchName).toBe('task/branch-test');
    });

    it('should respect custom type', () => {
      const result = service.create({
        id: 'task-investigate',
        repositoryName: 'repo',
        title: 'Investigate Issue',
        type: 'investigate',
      });

      expect(result.type).toBe('investigate');
    });

    it('should truncate long slugs to 50 characters', () => {
      const longTitle = 'This is a very long title that should be truncated to fifty characters maximum';
      const result = service.create({
        id: 'task-long',
        repositoryName: 'repo',
        title: longTitle,
      });

      expect(result.slug.length).toBeLessThanOrEqual(50);
    });

    it('should set timestamps', () => {
      const before = Date.now();
      const result = service.create({
        id: 'task-time',
        repositoryName: 'repo',
        title: 'Timestamp Test',
      });
      const after = Date.now();

      expect(result.createdAt).toBeGreaterThanOrEqual(before);
      expect(result.createdAt).toBeLessThanOrEqual(after);
      expect(result.updatedAt).toBe(result.createdAt);
      expect(result.sortOrder).toBe(result.createdAt);
    });
  });
});

describe('TaskMetadataService', () => {
  let fs: FileSystemAdapter;
  let service: TaskMetadataService;
  const mortDir = '/test/mort';

  beforeEach(() => {
    fs = createMockFS();
    service = new TaskMetadataService(mortDir, fs);
  });

  describe('get', () => {
    it('should return parsed metadata', () => {
      const metadata = {
        id: 'task-123',
        slug: 'my-task',
        title: 'My Task',
        branchName: 'task/my-task',
        type: 'work',
        subtasks: [],
        status: 'draft',
        createdAt: 1000,
        updatedAt: 1000,
        parentId: null,
        tags: [],
        sortOrder: 1000,
        repositoryName: 'repo',
        pendingReviews: [],
      };
      fs = createMockFS({
        '/test/mort/tasks/my-task/metadata.json': JSON.stringify(metadata),
      });
      service = new TaskMetadataService(mortDir, fs);

      const result = service.get('my-task');

      expect(result).toEqual(metadata);
    });

    it('should throw when metadata does not exist', () => {
      expect(() => service.get('nonexistent')).toThrow();
    });
  });

  describe('update', () => {
    it('should merge changes and update timestamp', () => {
      const originalMeta = {
        id: 'task-update',
        slug: 'update-task',
        title: 'Original Title',
        branchName: 'task/update-task',
        type: 'work',
        subtasks: [],
        status: 'draft',
        createdAt: 1000,
        updatedAt: 1000,
        parentId: null,
        tags: [],
        sortOrder: 1000,
        repositoryName: 'repo',
        pendingReviews: [],
      };
      fs = createMockFS({
        '/test/mort/tasks/update-task/metadata.json': JSON.stringify(originalMeta),
      });
      service = new TaskMetadataService(mortDir, fs);

      const before = Date.now();
      const result = service.update('update-task', {
        title: 'Updated Title',
        status: 'todo',
      });
      const after = Date.now();

      expect(result.title).toBe('Updated Title');
      expect(result.status).toBe('todo');
      expect(result.id).toBe('task-update');
      expect(result.createdAt).toBe(1000);
      expect(result.updatedAt).toBeGreaterThanOrEqual(before);
      expect(result.updatedAt).toBeLessThanOrEqual(after);
    });

    it('should persist changes to disk', () => {
      const originalMeta = {
        id: 'task-persist',
        slug: 'persist-task',
        title: 'Original',
        branchName: 'task/persist-task',
        type: 'work',
        subtasks: [],
        status: 'draft',
        createdAt: 1000,
        updatedAt: 1000,
        parentId: null,
        tags: [],
        sortOrder: 1000,
        repositoryName: 'repo',
        pendingReviews: [],
      };
      fs = createMockFS({
        '/test/mort/tasks/persist-task/metadata.json': JSON.stringify(originalMeta),
      });
      service = new TaskMetadataService(mortDir, fs);

      service.update('persist-task', { title: 'Persisted' });

      expect(fs.writeFile).toHaveBeenCalled();
      const writeCall = (fs.writeFile as ReturnType<typeof vi.fn>).mock.calls[0];
      const writtenContent = JSON.parse(writeCall[1]);
      expect(writtenContent.title).toBe('Persisted');
    });
  });

  describe('exists', () => {
    it('should return true when metadata exists', () => {
      fs = createMockFS({
        '/test/mort/tasks/existing/metadata.json': '{}',
      });
      service = new TaskMetadataService(mortDir, fs);

      expect(service.exists('existing')).toBe(true);
    });

    it('should return false when metadata does not exist', () => {
      expect(service.exists('nonexistent')).toBe(false);
    });

    it('should return false for directory without metadata', () => {
      fs = createMockFS({
        '/test/mort/tasks/no-meta/other-file.txt': 'content',
      });
      service = new TaskMetadataService(mortDir, fs);

      expect(service.exists('no-meta')).toBe(false);
    });
  });

  describe('list', () => {
    it('should return all task slugs', () => {
      fs = createMockFS({
        '/test/mort/tasks/task-one/metadata.json': '{}',
        '/test/mort/tasks/task-two/metadata.json': '{}',
        '/test/mort/tasks/task-three/metadata.json': '{}',
      });
      service = new TaskMetadataService(mortDir, fs);

      const result = service.list();

      expect(result.sort()).toEqual(['task-one', 'task-three', 'task-two']);
    });

    it('should filter out directories without metadata', () => {
      fs = createMockFS({
        '/test/mort/tasks/valid-task/metadata.json': '{}',
        '/test/mort/tasks/invalid-task/other.txt': 'content',
      });
      service = new TaskMetadataService(mortDir, fs);

      const result = service.list();

      expect(result).toEqual(['valid-task']);
    });

    it('should return empty array when tasks dir does not exist', () => {
      const result = service.list();

      expect(result).toEqual([]);
    });

    it('should return empty array when tasks dir is empty', () => {
      // Mark tasks dir as existing but with no subdirectories
      (fs.exists as ReturnType<typeof vi.fn>).mockImplementation(
        (p: string) => p === '/test/mort/tasks'
      );
      (fs.readDir as ReturnType<typeof vi.fn>).mockReturnValue([]);

      const result = service.list();

      expect(result).toEqual([]);
    });
  });
});
