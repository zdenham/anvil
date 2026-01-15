import * as path from 'path';
import { execSync } from 'child_process';
import type { FileSystemAdapter } from '@core/adapters/types';
import type { RepositorySettings, WorktreeClaim } from '@core/types/repositories.js';
import { RepositorySettingsSchema } from '@core/types/repositories.js';

/**
 * Migrate a single WorktreeClaim from old format to new format.
 * Old: { threadId: string, taskId: string, claimedAt: number }
 * New: { threadIds: string[], taskId: string, claimedAt: number }
 *
 * @deprecated Use WorktreeClaimSchema directly - migration is built into the schema's preprocess.
 */
export function migrateWorktreeClaim(claim: unknown): WorktreeClaim | null {
  if (!claim || typeof claim !== 'object') {
    return null;
  }

  const c = claim as Record<string, unknown>;

  // Already migrated (has threadIds array)
  if (Array.isArray(c.threadIds)) {
    return claim as WorktreeClaim;
  }

  // Old format (has threadId string) - migrate
  if (typeof c.threadId === 'string' && typeof c.taskId === 'string') {
    return {
      taskId: c.taskId,
      threadIds: [c.threadId],
      claimedAt: (c.claimedAt as number) ?? Date.now(),
    };
  }

  // Invalid format
  return null;
}

/**
 * Migrate settings from any older format to current format.
 *
 * @deprecated Use RepositorySettingsSchema directly - migration is built into the schema.
 */
export function migrateSettings(settings: unknown): RepositorySettings {
  const s = settings as RepositorySettings;

  // Ensure worktrees array exists
  if (!Array.isArray(s.worktrees)) {
    s.worktrees = [];
  }

  // Migrate each worktree's claim using the legacy function
  for (const worktree of s.worktrees) {
    worktree.claim = migrateWorktreeClaim(worktree.claim);
  }

  // Add defaultBranch if missing
  if (!s.defaultBranch) {
    s.defaultBranch = detectDefaultBranch(s.sourcePath) ?? 'main';
  }

  return s;
}

/**
 * Detect the default branch for a repository.
 * Tries: origin/HEAD symbolic ref, then common branch names.
 */
export function detectDefaultBranch(sourcePath: string): string | null {
  // Try to get default branch from origin
  try {
    const result = execSync(
      'git symbolic-ref refs/remotes/origin/HEAD --short',
      { cwd: sourcePath, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }
    );
    // Returns "origin/main" or "origin/master" - extract branch name
    return result.trim().replace('origin/', '');
  } catch {
    // Fallback: check if common branches exist
  }

  // Check common branch names locally
  for (const branch of ['main', 'master']) {
    try {
      execSync(`git rev-parse --verify refs/heads/${branch}`, {
        cwd: sourcePath,
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      return branch;
    } catch {
      continue;
    }
  }

  return null;
}

/**
 * Pre-process raw settings to add defaultBranch if missing.
 * This uses git detection which requires runtime execution.
 */
function preprocessSettings(raw: unknown): unknown {
  if (raw && typeof raw === 'object') {
    const settings = raw as Record<string, unknown>;
    // Add defaultBranch if missing (requires git detection)
    if (!settings.defaultBranch && typeof settings.sourcePath === 'string') {
      settings.defaultBranch = detectDefaultBranch(settings.sourcePath) ?? 'main';
    }
  }
  return raw;
}

/**
 * Single-responsibility service for loading and saving repository settings.json files.
 *
 * This service ONLY:
 * - Reads settings from disk with Zod schema validation
 * - Writes settings to disk
 * - Returns path to settings file
 * - Migrates settings from older schema versions (via Zod preprocess transforms)
 *
 * It does NOT:
 * - Manage worktrees
 * - Handle locking
 */
export class RepositorySettingsService {
  constructor(
    private mortDir: string,
    private fs: FileSystemAdapter
  ) {}

  /**
   * Load repository settings from disk.
   * Automatically migrates from older schema versions using Zod schema transforms.
   * @param repoName - The repository name (slug)
   * @returns The parsed and validated repository settings
   * @throws If file does not exist, contains malformed JSON, or fails validation
   */
  load(repoName: string): RepositorySettings {
    const settingsPath = this.getSettingsPath(repoName);
    const content = this.fs.readFile(settingsPath);
    const rawSettings = JSON.parse(content);

    // Pre-process to add defaultBranch if missing (requires git detection)
    // Then validate and migrate using Zod schema (handles worktree claim migration)
    return RepositorySettingsSchema.parse(preprocessSettings(rawSettings));
  }

  /**
   * Save repository settings to disk.
   * Updates the lastUpdated timestamp automatically.
   * @param repoName - The repository name (slug)
   * @param settings - The settings to save
   */
  save(repoName: string, settings: RepositorySettings): void {
    settings.lastUpdated = Date.now();
    const settingsPath = this.getSettingsPath(repoName);
    this.fs.writeFile(settingsPath, JSON.stringify(settings, null, 2));
  }

  /**
   * Check if repository settings exist on disk.
   * @param repoName - The repository name (slug)
   * @returns true if settings file exists
   */
  exists(repoName: string): boolean {
    return this.fs.exists(this.getSettingsPath(repoName));
  }

  /**
   * Get the path to the settings file for a repository.
   * @param repoName - The repository name (slug)
   * @returns Absolute path to the settings.json file
   */
  private getSettingsPath(repoName: string): string {
    return path.join(this.mortDir, 'repositories', repoName, 'settings.json');
  }
}
