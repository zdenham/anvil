import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  RepositorySettingsService,
  migrateWorktreeClaim,
  migrateSettings,
} from './settings-service';
import type { FileSystemAdapter } from '@core/adapters/types';
import type { RepositorySettings } from '@core/types/repositories.js';

function createMockFS(
  files: Record<string, string> = {}
): FileSystemAdapter {
  return {
    readFile: vi.fn((path: string) => {
      if (!(path in files)) {
        throw new Error(`ENOENT: no such file or directory, open '${path}'`);
      }
      return files[path];
    }),
    writeFile: vi.fn((path: string, content: string) => {
      files[path] = content;
    }),
    exists: vi.fn((path: string) => path in files),
    mkdir: vi.fn(),
    remove: vi.fn(),
    readDir: vi.fn(() => []),
    glob: vi.fn(() => []),
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
    taskBranches: {},
    lastUpdated: 1700000000000,
    ...overrides,
  };
}

describe('RepositorySettingsService', () => {
  const mortDir = '/home/user/.mort';
  let mockFS: FileSystemAdapter;
  let service: RepositorySettingsService;

  beforeEach(() => {
    mockFS = createMockFS();
    service = new RepositorySettingsService(mortDir, mockFS);
  });

  describe('load', () => {
    it('should load existing settings file', () => {
      const settings = createValidSettings({ name: 'my-repo' });
      const settingsPath = '/home/user/.mort/repositories/my-repo/settings.json';
      mockFS = createMockFS({
        [settingsPath]: JSON.stringify(settings),
      });
      service = new RepositorySettingsService(mortDir, mockFS);

      const result = service.load('my-repo');

      expect(result).toEqual(settings);
      expect(mockFS.readFile).toHaveBeenCalledWith(settingsPath);
    });

    it('should throw when file does not exist', () => {
      expect(() => service.load('nonexistent-repo')).toThrow();
    });

    it('should throw on malformed JSON', () => {
      const settingsPath = '/home/user/.mort/repositories/bad-repo/settings.json';
      mockFS = createMockFS({
        [settingsPath]: 'not valid json {{{',
      });
      service = new RepositorySettingsService(mortDir, mockFS);

      expect(() => service.load('bad-repo')).toThrow();
    });
  });

  describe('save', () => {
    it('should save settings file', () => {
      const settings = createValidSettings({ name: 'my-repo' });
      const settingsPath = '/home/user/.mort/repositories/my-repo/settings.json';

      service.save('my-repo', settings);

      expect(mockFS.writeFile).toHaveBeenCalledWith(
        settingsPath,
        expect.any(String)
      );
      const savedContent = (mockFS.writeFile as ReturnType<typeof vi.fn>).mock.calls[0][1];
      const parsed = JSON.parse(savedContent);
      expect(parsed.name).toBe('my-repo');
    });

    it('should update lastUpdated timestamp on save', () => {
      const settings = createValidSettings({
        name: 'my-repo',
        lastUpdated: 1000,
      });
      const beforeSave = Date.now();

      service.save('my-repo', settings);

      expect(settings.lastUpdated).toBeGreaterThanOrEqual(beforeSave);
      expect(settings.lastUpdated).toBeLessThanOrEqual(Date.now());
    });

    it('should overwrite existing settings file', () => {
      const settingsPath = '/home/user/.mort/repositories/my-repo/settings.json';
      const initialSettings = createValidSettings({ name: 'my-repo' });
      mockFS = createMockFS({
        [settingsPath]: JSON.stringify(initialSettings),
      });
      service = new RepositorySettingsService(mortDir, mockFS);

      const updatedSettings = createValidSettings({
        name: 'my-repo',
        useWorktrees: false,
      });
      service.save('my-repo', updatedSettings);

      expect(mockFS.writeFile).toHaveBeenCalled();
      const savedContent = (mockFS.writeFile as ReturnType<typeof vi.fn>).mock.calls[0][1];
      const parsed = JSON.parse(savedContent);
      expect(parsed.useWorktrees).toBe(false);
    });

    it('should format JSON with indentation', () => {
      const settings = createValidSettings({ name: 'my-repo' });

      service.save('my-repo', settings);

      const savedContent = (mockFS.writeFile as ReturnType<typeof vi.fn>).mock.calls[0][1];
      expect(savedContent).toContain('\n');
      expect(savedContent).toMatch(/^{\n  "/);
    });
  });

  describe('exists', () => {
    it('should return true when settings file exists', () => {
      const settingsPath = '/home/user/.mort/repositories/my-repo/settings.json';
      mockFS = createMockFS({
        [settingsPath]: '{}',
      });
      service = new RepositorySettingsService(mortDir, mockFS);

      const result = service.exists('my-repo');

      expect(result).toBe(true);
      expect(mockFS.exists).toHaveBeenCalledWith(settingsPath);
    });

    it('should return false when settings file does not exist', () => {
      const result = service.exists('nonexistent-repo');

      expect(result).toBe(false);
    });
  });

  describe('settings path construction', () => {
    it('should construct correct path for repository', () => {
      const settingsPath = '/home/user/.mort/repositories/test-repo/settings.json';
      mockFS = createMockFS({
        [settingsPath]: JSON.stringify(createValidSettings()),
      });
      service = new RepositorySettingsService(mortDir, mockFS);

      service.load('test-repo');

      expect(mockFS.readFile).toHaveBeenCalledWith(settingsPath);
    });

    it('should handle repository names with special characters', () => {
      const repoName = 'my-awesome-repo_123';
      const settingsPath = `/home/user/.mort/repositories/${repoName}/settings.json`;
      mockFS = createMockFS({
        [settingsPath]: JSON.stringify(createValidSettings()),
      });
      service = new RepositorySettingsService(mortDir, mockFS);

      service.load(repoName);

      expect(mockFS.readFile).toHaveBeenCalledWith(settingsPath);
    });
  });

  describe('load with migration', () => {
    it('should migrate old settings format on load', () => {
      const oldSettings = JSON.stringify({
        schemaVersion: 1,
        name: 'my-repo',
        originalUrl: 'https://github.com/example/repo.git',
        sourcePath: '/path/to/source',
        useWorktrees: true,
        createdAt: 1700000000000,
        worktrees: [
          { path: '/wt-1', version: 1, currentBranch: 'main', claim: { taskId: 'task-1', threadId: 't1', claimedAt: 1000 } },
        ],
        taskBranches: {},
        lastUpdated: 1700000000000,
      });

      const settingsPath = '/home/user/.mort/repositories/my-repo/settings.json';
      mockFS = createMockFS({
        [settingsPath]: oldSettings,
      });
      service = new RepositorySettingsService(mortDir, mockFS);

      const result = service.load('my-repo');

      expect(result.worktrees[0].claim?.threadIds).toEqual(['t1']);
      expect(result.defaultBranch).toBeDefined();
    });
  });
});

describe('migrateWorktreeClaim', () => {
  it('returns null for null', () => {
    expect(migrateWorktreeClaim(null)).toBeNull();
  });

  it('returns null for undefined', () => {
    expect(migrateWorktreeClaim(undefined)).toBeNull();
  });

  it('preserves already-migrated claims (threadIds array)', () => {
    const claim = { taskId: 'task-1', threadIds: ['t1', 't2'], claimedAt: 1000 };
    expect(migrateWorktreeClaim(claim)).toEqual(claim);
  });

  it('migrates old format (threadId string) to new format', () => {
    const oldClaim = { taskId: 'task-1', threadId: 't1', claimedAt: 1000 };
    const result = migrateWorktreeClaim(oldClaim);

    expect(result).toEqual({
      taskId: 'task-1',
      threadIds: ['t1'],
      claimedAt: 1000,
    });
  });

  it('uses current timestamp when claimedAt missing', () => {
    const beforeTest = Date.now();
    const oldClaim = { taskId: 'task-1', threadId: 't1' };
    const result = migrateWorktreeClaim(oldClaim);

    expect(result?.claimedAt).toBeGreaterThanOrEqual(beforeTest);
    expect(result?.claimedAt).toBeLessThanOrEqual(Date.now());
  });

  it('returns null for invalid format (missing threadId)', () => {
    expect(migrateWorktreeClaim({ foo: 'bar' })).toBeNull();
  });

  it('returns null for non-object values', () => {
    expect(migrateWorktreeClaim('string')).toBeNull();
    expect(migrateWorktreeClaim(123)).toBeNull();
    expect(migrateWorktreeClaim([])).toBeNull();
  });
});

describe('migrateSettings', () => {
  it('migrates worktree claims', () => {
    const oldSettings = {
      sourcePath: '/path/to/repo',
      defaultBranch: 'main',
      worktrees: [
        { path: '/wt-1', version: 1, currentBranch: 'main', claim: { taskId: 'task-1', threadId: 't1', claimedAt: 1000 } },
        { path: '/wt-2', version: 1, currentBranch: null, claim: null },
      ],
    };

    const result = migrateSettings(oldSettings);

    expect(result.worktrees[0].claim).toEqual({
      taskId: 'task-1',
      threadIds: ['t1'],
      claimedAt: 1000,
    });
    expect(result.worktrees[1].claim).toBeNull();
  });

  it('adds defaultBranch if missing (falls back to main)', () => {
    const oldSettings = {
      sourcePath: '/nonexistent/path/to/repo',
      worktrees: [],
    };

    const result = migrateSettings(oldSettings);

    // Falls back to 'main' when git detection fails
    expect(result.defaultBranch).toBe('main');
  });

  it('preserves existing defaultBranch', () => {
    const settings = {
      sourcePath: '/path/to/repo',
      defaultBranch: 'develop',
      worktrees: [],
    };

    const result = migrateSettings(settings);

    expect(result.defaultBranch).toBe('develop');
  });

  it('initializes empty worktrees array if missing', () => {
    const settings = { sourcePath: '/path/to/repo', defaultBranch: 'main' };

    const result = migrateSettings(settings as unknown);

    expect(result.worktrees).toEqual([]);
  });

  it('handles partially migrated worktrees', () => {
    const mixedSettings = {
      sourcePath: '/path/to/repo',
      defaultBranch: 'main',
      worktrees: [
        // Old format
        { path: '/wt-1', version: 1, currentBranch: 'main', claim: { taskId: 'task-1', threadId: 't1', claimedAt: 1000 } },
        // New format
        { path: '/wt-2', version: 1, currentBranch: 'main', claim: { taskId: 'task-2', threadIds: ['t2', 't3'], claimedAt: 2000 } },
      ],
    };

    const result = migrateSettings(mixedSettings);

    expect(result.worktrees[0].claim?.threadIds).toEqual(['t1']);
    expect(result.worktrees[1].claim?.threadIds).toEqual(['t2', 't3']);
  });
});
