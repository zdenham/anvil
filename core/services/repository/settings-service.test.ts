import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RepositorySettingsService } from './settings-service';
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
    id: '550e8400-e29b-41d4-a716-446655440000',
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
    plansDirectory: 'plans/',
    completedDirectory: 'plans/completed/',
    ...overrides,
  };
}

describe('RepositorySettingsService', () => {
  const anvilDir = '/home/user/.anvil';
  let mockFS: FileSystemAdapter;
  let service: RepositorySettingsService;

  beforeEach(() => {
    mockFS = createMockFS();
    service = new RepositorySettingsService(anvilDir, mockFS);
  });

  describe('load', () => {
    it('should load existing settings file', () => {
      const settings = createValidSettings({ name: 'my-repo' });
      const settingsPath = '/home/user/.anvil/repositories/my-repo/settings.json';
      mockFS = createMockFS({
        [settingsPath]: JSON.stringify(settings),
      });
      service = new RepositorySettingsService(anvilDir, mockFS);

      const result = service.load('my-repo');

      expect(result).toEqual(settings);
      expect(mockFS.readFile).toHaveBeenCalledWith(settingsPath);
    });

    it('should throw when file does not exist', () => {
      expect(() => service.load('nonexistent-repo')).toThrow();
    });

    it('should throw on malformed JSON', () => {
      const settingsPath = '/home/user/.anvil/repositories/bad-repo/settings.json';
      mockFS = createMockFS({
        [settingsPath]: 'not valid json {{{',
      });
      service = new RepositorySettingsService(anvilDir, mockFS);

      expect(() => service.load('bad-repo')).toThrow();
    });
  });

  describe('save', () => {
    it('should save settings file', () => {
      const settings = createValidSettings({ name: 'my-repo' });
      const settingsPath = '/home/user/.anvil/repositories/my-repo/settings.json';

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
      const settingsPath = '/home/user/.anvil/repositories/my-repo/settings.json';
      const initialSettings = createValidSettings({ name: 'my-repo' });
      mockFS = createMockFS({
        [settingsPath]: JSON.stringify(initialSettings),
      });
      service = new RepositorySettingsService(anvilDir, mockFS);

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
      const settingsPath = '/home/user/.anvil/repositories/my-repo/settings.json';
      mockFS = createMockFS({
        [settingsPath]: '{}',
      });
      service = new RepositorySettingsService(anvilDir, mockFS);

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
      const settingsPath = '/home/user/.anvil/repositories/test-repo/settings.json';
      mockFS = createMockFS({
        [settingsPath]: JSON.stringify(createValidSettings()),
      });
      service = new RepositorySettingsService(anvilDir, mockFS);

      service.load('test-repo');

      expect(mockFS.readFile).toHaveBeenCalledWith(settingsPath);
    });

    it('should handle repository names with special characters', () => {
      const repoName = 'my-awesome-repo_123';
      const settingsPath = `/home/user/.anvil/repositories/${repoName}/settings.json`;
      mockFS = createMockFS({
        [settingsPath]: JSON.stringify(createValidSettings()),
      });
      service = new RepositorySettingsService(anvilDir, mockFS);

      service.load(repoName);

      expect(mockFS.readFile).toHaveBeenCalledWith(settingsPath);
    });
  });

});
