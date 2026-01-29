import type { GitAdapter, PathLock, Logger } from '@core/adapters/types';
import type { RepositorySettingsService } from '../repository/settings-service';
import type { WorktreeState } from '@core/types/repositories.js';

/**
 * Simple worktree CRUD service.
 * No pooling, no allocation, no claiming - just create/delete/list.
 */
export class WorktreeService {
  constructor(
    private mortDir: string,
    private settingsService: RepositorySettingsService,
    private git: GitAdapter,
    private pathLock: PathLock,
    private logger: Logger
  ) {}

  /**
   * Create a new named worktree.
   */
  create(repoName: string, name: string): WorktreeState {
    return this.withLock(repoName, () => {
      const settings = this.settingsService.load(repoName);

      // Validate name uniqueness
      if (settings.worktrees.some(w => w.name === name)) {
        throw new Error(`Worktree "${name}" already exists`);
      }

      // Validate name format
      if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
        throw new Error('Name can only contain letters, numbers, dashes, and underscores');
      }

      const worktreePath = `${this.mortDir}/repositories/${repoName}/${name}`;
      this.git.createWorktree(settings.sourcePath, worktreePath);

      const now = Date.now();
      const worktree: WorktreeState = {
        id: crypto.randomUUID(),
        path: worktreePath,
        name,
        createdAt: now,
        lastAccessedAt: now,
        currentBranch: null,
      };

      settings.worktrees.push(worktree);
      this.settingsService.save(repoName, settings);

      this.logger.info('Created worktree', { repoName, name, path: worktreePath });
      return worktree;
    });
  }

  /**
   * Delete a worktree by name.
   */
  delete(repoName: string, name: string): void {
    return this.withLock(repoName, () => {
      const settings = this.settingsService.load(repoName);
      const index = settings.worktrees.findIndex(w => w.name === name);

      if (index === -1) {
        throw new Error(`Worktree "${name}" not found`);
      }

      const worktree = settings.worktrees[index];
      this.git.removeWorktree(settings.sourcePath, worktree.path);
      settings.worktrees.splice(index, 1);
      this.settingsService.save(repoName, settings);

      this.logger.info('Deleted worktree', { repoName, name, path: worktree.path });
    });
  }

  /**
   * Rename a worktree (metadata only, not the directory).
   */
  rename(repoName: string, oldName: string, newName: string): void {
    return this.withLock(repoName, () => {
      const settings = this.settingsService.load(repoName);
      const worktree = settings.worktrees.find(w => w.name === oldName);

      if (!worktree) {
        throw new Error(`Worktree "${oldName}" not found`);
      }
      if (settings.worktrees.some(w => w.name === newName)) {
        throw new Error(`Worktree "${newName}" already exists`);
      }

      // Validate new name format
      if (!/^[a-zA-Z0-9_-]+$/.test(newName)) {
        throw new Error('Name can only contain letters, numbers, dashes, and underscores');
      }

      worktree.name = newName;
      this.settingsService.save(repoName, settings);

      this.logger.info('Renamed worktree', { repoName, oldName, newName });
    });
  }

  /**
   * List all worktrees, sorted by creation date (most recent first).
   */
  list(repoName: string): WorktreeState[] {
    const settings = this.settingsService.load(repoName);
    return [...settings.worktrees].sort((a, b) => {
      // Use createdAt, falling back to lastAccessedAt for migration
      const aTime = a.createdAt ?? a.lastAccessedAt ?? 0;
      const bTime = b.createdAt ?? b.lastAccessedAt ?? 0;
      return bTime - aTime;
    });
  }

  /**
   * Get a worktree by path.
   */
  getByPath(repoName: string, path: string): WorktreeState | null {
    const settings = this.settingsService.load(repoName);
    return settings.worktrees.find(w => w.path === path) ?? null;
  }

  /**
   * Get a worktree by name.
   */
  getByName(repoName: string, name: string): WorktreeState | null {
    const settings = this.settingsService.load(repoName);
    return settings.worktrees.find(w => w.name === name) ?? null;
  }

  /**
   * Update lastAccessedAt timestamp.
   */
  touch(repoName: string, worktreePath: string): void {
    return this.withLock(repoName, () => {
      const settings = this.settingsService.load(repoName);
      const worktree = settings.worktrees.find(w => w.path === worktreePath);
      if (worktree) {
        worktree.lastAccessedAt = Date.now();
        this.settingsService.save(repoName, settings);
        this.logger.debug('Touched worktree', { repoName, path: worktreePath });
      }
    });
  }

  private withLock<T>(repoName: string, fn: () => T): T {
    const lockPath = `${this.mortDir}/repositories/${repoName}/.lock`;
    this.pathLock.acquire(lockPath);
    try {
      return fn();
    } finally {
      this.pathLock.release(lockPath);
    }
  }
}
