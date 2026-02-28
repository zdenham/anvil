import { appData, loadSettings, saveSettings } from "@/lib/app-data-store";
import { useRepoStore } from "./store";
import { logger } from "@/lib/logger-client";
import { eventBus } from "../events";
import { EventName } from "@core/types/events.js";
import {
  RepositorySettingsSchema,
  type Repository,
  type RepositoryMetadata,
  type RepositoryVersion,
  type RepositorySettings,
  type CreateRepositoryInput,
  type UpdateRepositoryInput,
} from "./types";
import { repoCommands } from "@/lib/tauri-commands";
import { z } from "zod";

// Schema for legacy metadata.json format
const LegacyMetadataSchema = z.object({
  name: z.string(),
  originalUrl: z.string().nullable().optional(),
  sourcePath: z.string().nullable().optional(),
  useWorktrees: z.boolean().optional(),
  createdAt: z.number().optional(),
});

const REPOS_DIR = "repositories";

/**
 * Converts a repository name to a slug (lowercase, hyphens for spaces/special chars).
 */
function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Extracts the folder name from a full path.
 */
function extractFolderName(path: string): string {
  const segments = path.split("/").filter((s) => s.length > 0);
  if (segments.length === 0) {
    throw new Error("Invalid path: cannot extract folder name");
  }
  return segments[segments.length - 1];
}

/**
 * Detects worktree directories from disk.
 * Supports patterns: {slug}-N (e.g., shortcut-1) or vN (e.g., v1)
 */
async function detectWorktrees(repoDir: string, slug: string): Promise<RepositoryVersion[]> {
  const entries = await appData.listDirEntries(repoDir);
  const versions: RepositoryVersion[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory) continue;
    if (entry.name === "metadata.json" || entry.name === "versions") continue;

    // Match {slug}-N pattern (e.g., shortcut-1, shortcut-2)
    const slugMatch = entry.name.match(new RegExp(`^${slug}-(\\d+)$`));
    // Match vN pattern (e.g., v1, v2)
    const vMatch = entry.name.match(/^v(\d+)$/);

    const match = slugMatch || vMatch;
    if (match) {
      versions.push({
        version: parseInt(match[1], 10),
        createdAt: 0, // Not tracked - disk is source of truth
        path: entry.path,
      });
    }
  }

  // Sort by version number
  versions.sort((a, b) => a.version - b.version);
  return versions;
}

export const repoService = {
  /**
   * Hydrates the repository store from disk.
   * Worktrees are auto-detected from directory structure (disk always wins).
   * Supports both settings.json (new) and metadata.json (legacy) formats.
   */
  async hydrate(): Promise<void> {
    logger.log(`[repo:hydrate] Starting hydration`);

    await appData.ensureDir(REPOS_DIR);
    const repoDirs = await appData.listDir(REPOS_DIR);

    const repositories: Record<string, Repository> = {};

    for (const repoName of repoDirs) {
      // Try settings.json first (new format), fall back to metadata.json (legacy)
      let metadata: RepositoryMetadata | null = null;

      const settingsPath = `${REPOS_DIR}/${repoName}/settings.json`;
      const rawSettings = await appData.readJson(settingsPath);
      const settingsResult = rawSettings ? RepositorySettingsSchema.safeParse(rawSettings) : null;

      if (settingsResult?.success) {
        const settings = settingsResult.data;
        metadata = {
          name: settings.name,
          originalUrl: settings.originalUrl,
          sourcePath: settings.sourcePath,
          useWorktrees: settings.useWorktrees,
          createdAt: settings.createdAt,
        };
      } else {
        // Log why settings.json failed so we can diagnose issues
        if (!rawSettings) {
          logger.warn(`[repo:hydrate] ${repoName}: settings.json not found or unreadable`);
        } else if (settingsResult && !settingsResult.success) {
          logger.warn(`[repo:hydrate] ${repoName}: settings.json failed schema validation:`, settingsResult.error.message);
        }
        // Fall back to legacy metadata.json
        const metadataPath = `${REPOS_DIR}/${repoName}/metadata.json`;
        const rawMetadata = await appData.readJson(metadataPath);
        const metadataResult = rawMetadata ? LegacyMetadataSchema.safeParse(rawMetadata) : null;

        if (metadataResult?.success) {
          const legacyData = metadataResult.data;
          metadata = {
            name: legacyData.name,
            originalUrl: legacyData.originalUrl ?? null,
            sourcePath: legacyData.sourcePath ?? null,
            useWorktrees: legacyData.useWorktrees ?? false,
            createdAt: legacyData.createdAt ?? Date.now(),
          };
        }
      }

      if (metadata) {
        // Auto-detect worktrees from disk structure
        const slug = slugify(metadata.name);
        const versions = await detectWorktrees(`${REPOS_DIR}/${repoName}`, slug);
        repositories[metadata.name] = { ...metadata, versions };
      } else {
        logger.warn(`[repo:hydrate] ${repoName}: SKIPPED - no settings.json or metadata.json found!`);
      }
    }

    logger.log(`[repo:hydrate] Complete. Loaded ${Object.keys(repositories).length} repositories:`, Object.keys(repositories));
    useRepoStore.getState().hydrate(repositories);
  },

  /**
   * Gets a repository by name from the store.
   */
  get(name: string): Repository | undefined {
    return useRepoStore.getState().repositories[name];
  },

  /**
   * Gets all repositories from the store.
   */
  getAll(): Repository[] {
    return Object.values(useRepoStore.getState().repositories);
  },

  /**
   * Validates a path before creating a new repository.
   * Checks for duplicate paths and names, verifies the path exists, and ensures it's a git repository.
   */
  async validateNewRepository(path: string): Promise<{ valid: boolean; error?: string }> {
    const existing = this.getAll();

    // Check for duplicate source path
    for (const repo of existing) {
      if (repo.sourcePath === path) {
        return { valid: false, error: "Repository already added" };
      }
    }

    // Check if path exists
    if (!(await appData.absolutePathExists(path))) {
      return { valid: false, error: "Path does not exist" };
    }

    // Check if it's a git repository
    if (!(await appData.isGitRepo(path))) {
      return { valid: false, error: "This folder is not a git repository. Please initialize git first or select a different folder." };
    }

    // Check for duplicate name/slug
    const folderName = extractFolderName(path);
    const slug = slugify(folderName);
    const repoDir = `${REPOS_DIR}/${slug}`;

    if (await appData.exists(repoDir)) {
      return { valid: false, error: `Repository "${folderName}" already exists` };
    }

    return { valid: true };
  },

  /**
   * Creates a new empty repository entry.
   * Use createFromFolder() to import an existing folder with worktrees.
   */
  async create(input: CreateRepositoryInput): Promise<Repository> {
    const now = Date.now();
    const slug = slugify(input.name);
    const repoDir = `${REPOS_DIR}/${slug}`;
    const absoluteRepoDir = await appData.getAbsolutePath(repoDir);

    logger.log(`[repo:create] Creating repo: "${input.name}" (slug: "${slug}")`);
    logger.log(`[repo:create] Target directory (absolute): ${absoluteRepoDir}`);

    const exists = await appData.exists(repoDir);
    logger.log(`[repo:create] Directory exists: ${exists}`);

    if (exists) {
      const contents = await appData.listDir(repoDir);
      logger.error(`[repo:create] Directory already exists with contents:`, contents);
      throw new Error(`Repository already exists: ${input.name}`);
    }

    const metadata: RepositoryMetadata = {
      name: input.name,
      originalUrl: input.originalUrl ?? null,
      sourcePath: input.sourcePath ?? null,
      useWorktrees: input.useWorktrees ?? false,
      createdAt: now,
    };

    const repo: Repository = { ...metadata, versions: [] };

    // Create directory and settings.json
    await appData.ensureDir(repoDir);
    const sourcePath = input.sourcePath ?? "";
    const settings: RepositorySettings = {
      id: crypto.randomUUID(),
      schemaVersion: 1,
      name: input.name,
      originalUrl: input.originalUrl ?? null,
      sourcePath: sourcePath,
      useWorktrees: input.useWorktrees ?? false,
      defaultBranch: 'main',
      createdAt: now,
      // Register source path as "main" worktree if provided
      worktrees: sourcePath ? [{
        id: crypto.randomUUID(),
        path: sourcePath,
        name: 'main',
        createdAt: now,
        lastAccessedAt: now,
        currentBranch: null,
      }] : [],
      threadBranches: {},
      lastUpdated: now,
      plansDirectory: 'plans/',
      completedDirectory: 'plans/completed/',
    };
    await saveSettings(slug, settings);

    useRepoStore.getState()._applyCreate(repo);
    eventBus.emit(EventName.REPOSITORY_CREATED, { name: repo.name });
    return repo;
  },

  /**
   * Creates a repository from a local folder.
   * Worktrees are created on demand, not upfront.
   * Writes settings.json with the full RepositorySettings schema.
   */
  async createFromFolder(sourcePath: string): Promise<Repository> {
    logger.log(`[repo:createFromFolder] Starting creation from: ${sourcePath}`);

    if (!(await appData.absolutePathExists(sourcePath))) {
      logger.error(`[repo:createFromFolder] Source path does not exist: ${sourcePath}`);
      throw new Error(`Source path does not exist: ${sourcePath}`);
    }

    const folderName = extractFolderName(sourcePath);
    const slug = slugify(folderName);
    const repoDir = `${REPOS_DIR}/${slug}`;
    const absoluteRepoDir = await appData.getAbsolutePath(repoDir);

    logger.log(`[repo:createFromFolder] Folder name: "${folderName}", slug: "${slug}"`);
    logger.log(`[repo:createFromFolder] Target directory (relative): ${repoDir}`);
    logger.log(`[repo:createFromFolder] Target directory (absolute): ${absoluteRepoDir}`);

    const exists = await appData.exists(repoDir);
    logger.log(`[repo:createFromFolder] Directory exists: ${exists}`);

    if (exists) {
      // Log what's in the directory to help debug zombie repos
      const contents = await appData.listDir(repoDir);
      logger.error(`[repo:createFromFolder] Directory already exists with contents:`, contents);
      throw new Error(`Repository already exists: ${folderName}`);
    }

    // Check if source is a git repo
    const isGitRepo = await appData.isGitRepo(sourcePath);
    const now = Date.now();

    // Create directory structure
    await appData.ensureDir(repoDir);

    // Write settings.json with full RepositorySettings schema
    // Register the source repo as the "main" worktree
    const settings: RepositorySettings = {
      id: crypto.randomUUID(),
      schemaVersion: 1,
      name: folderName,
      originalUrl: null,
      sourcePath: sourcePath,
      useWorktrees: isGitRepo,
      defaultBranch: 'main',
      createdAt: now,
      worktrees: [{
        id: crypto.randomUUID(),
        path: sourcePath,
        name: 'main',
        createdAt: now,
        lastAccessedAt: now,
        currentBranch: null,
      }],
      threadBranches: {},
      lastUpdated: now,
      plansDirectory: 'plans/',
      completedDirectory: 'plans/completed/',
    };
    await saveSettings(slug, settings);

    // Build Repository object for the store (uses the old versions format for compatibility)
    const versions = await detectWorktrees(repoDir, slug);
    const repo: Repository = {
      name: folderName,
      originalUrl: null,
      sourcePath: sourcePath,
      useWorktrees: isGitRepo,
      createdAt: now,
      versions,
    };

    useRepoStore.getState()._applyCreate(repo);
    eventBus.emit(EventName.REPOSITORY_CREATED, { name: repo.name });
    return repo;
  },

  /**
   * Updates a repository's metadata.
   * Preserves worktrees and threadBranches when updating settings.
   */
  async update(name: string, updates: UpdateRepositoryInput): Promise<Repository> {
    const existing = useRepoStore.getState().repositories[name];
    if (!existing) throw new Error(`Repository not found: ${name}`);

    const slug = slugify(name);
    const updated: Repository = {
      name: updates.name ?? existing.name,
      originalUrl: existing.originalUrl,
      sourcePath: updates.sourcePath ?? existing.sourcePath,
      useWorktrees: updates.useWorktrees ?? existing.useWorktrees,
      createdAt: existing.createdAt,
      versions: existing.versions,
    };

    // Load existing settings to preserve worktrees and threadBranches
    const settings = await loadSettings(slug);
    settings.name = updated.name;
    settings.useWorktrees = updated.useWorktrees;
    if (updates.sourcePath !== undefined) {
      settings.sourcePath = updates.sourcePath;
    }
    settings.lastUpdated = Date.now();
    await saveSettings(slug, settings);

    useRepoStore.getState()._applyUpdate(name, updated);
    eventBus.emit(EventName.REPOSITORY_UPDATED, { name: updated.name });
    return updated;
  },

  /**
   * Gets the latest worktree of a repository.
   */
  getLatestVersion(name: string): RepositoryVersion | undefined {
    const repo = useRepoStore.getState().repositories[name];
    if (!repo || repo.versions.length === 0) return undefined;
    return repo.versions[repo.versions.length - 1];
  },

  /**
   * Gets a specific worktree version of a repository.
   */
  getVersion(name: string, versionNumber: number): RepositoryVersion | undefined {
    const repo = useRepoStore.getState().repositories[name];
    if (!repo) return undefined;
    return repo.versions.find((v) => v.version === versionNumber);
  },

  /**
   * Deletes a repository and all its worktrees.
   * Handles git worktree cleanup if applicable.
   */
  async delete(name: string): Promise<void> {
    const existing = useRepoStore.getState().repositories[name];
    if (!existing) return;

    const slug = slugify(name);

    // If using worktrees, remove them first to keep git's worktree list clean
    if (existing.useWorktrees && existing.sourcePath) {
      for (const version of existing.versions) {
        try {
          await appData.gitWorktreeRemove(existing.sourcePath, version.path);
        } catch {
          // Worktree might already be gone, continue cleanup
        }
      }
    }

    // Remove the entire repository directory
    await appData.removeDir(`${REPOS_DIR}/${slug}`);
    useRepoStore.getState()._applyDelete(name);
    eventBus.emit(EventName.REPOSITORY_DELETED, { name });
  },

  /**
   * Removes a repository from Mort settings without deleting source files on disk.
   * This is the user-facing "remove" action from the UI.
   * Removes the ~/.mort/repositories/{slug} folder but leaves source code untouched.
   */
  async remove(repoId: string): Promise<void> {
    const existing = useRepoStore.getState().repositories[repoId];
    if (!existing) return;

    const slug = slugify(repoId);

    // Remove the settings folder from ~/.mort/repositories/{slug}
    // Do NOT delete source files on disk - they remain untouched
    await appData.removeDir(`${REPOS_DIR}/${slug}`);
    useRepoStore.getState()._applyDelete(repoId);
    eventBus.emit(EventName.REPOSITORY_DELETED, { name: repoId });
  },

  /**
   * Renames a repository's display name.
   * Updates the settings.json with the new name.
   * Note: Does not change the slug/folder name to avoid breaking references.
   */
  async rename(repoId: string, newName: string): Promise<void> {
    const existing = useRepoStore.getState().repositories[repoId];
    if (!existing) throw new Error(`Repository not found: ${repoId}`);

    const slug = slugify(repoId);

    // Load existing settings and update the name
    const settings = await loadSettings(slug);
    settings.name = newName;
    settings.lastUpdated = Date.now();
    await saveSettings(slug, settings);

    // Update the store
    const updated: Repository = {
      ...existing,
      name: newName,
    };
    useRepoStore.getState()._applyUpdate(repoId, updated);
    eventBus.emit(EventName.REPOSITORY_UPDATED, { name: newName });
  },

  /**
   * Refreshes worktrees from disk for a repository.
   * Call this after external changes to the filesystem.
   */
  async refresh(name: string): Promise<Repository | undefined> {
    const existing = useRepoStore.getState().repositories[name];
    if (!existing) return undefined;

    const slug = slugify(name);
    const versions = await detectWorktrees(`${REPOS_DIR}/${slug}`, slug);
    const updated = { ...existing, versions };

    useRepoStore.getState()._applyUpdate(name, updated);
    return updated;
  },

  /**
   * Validates all repository source paths.
   * Useful for detecting repos that have been moved on disk.
   * Returns validation results for each repository.
   */
  async validateAllPaths(): Promise<{ repoId: string; valid: boolean }[]> {
    const repos = this.getAll();
    const results: { repoId: string; valid: boolean }[] = [];

    for (const repo of repos) {
      if (!repo.sourcePath) {
        results.push({ repoId: repo.name, valid: false });
        continue;
      }

      try {
        const validation = await repoCommands.validateRepository(repo.sourcePath);
        results.push({
          repoId: repo.name,
          valid: validation.exists && validation.is_git_repo,
        });
      } catch (error) {
        logger.error(`[repo:validateAllPaths] Failed to validate ${repo.name}:`, error);
        results.push({ repoId: repo.name, valid: false });
      }
    }

    return results;
  },

  /**
   * Updates the source path of a repository.
   * Used when a repository has been moved on disk and needs to be relocated.
   */
  async updatePath(repoId: string, newPath: string): Promise<void> {
    const existing = useRepoStore.getState().repositories[repoId];
    if (!existing) throw new Error(`Repository not found: ${repoId}`);

    const slug = slugify(repoId);

    // Validate the new path is a git repo
    const validation = await repoCommands.validateRepository(newPath);
    if (!validation.exists || !validation.is_git_repo) {
      throw new Error(`Invalid repository path: ${newPath}`);
    }

    // Load existing settings and update sourcePath
    const settings = await loadSettings(slug);
    settings.sourcePath = newPath;
    settings.lastUpdated = Date.now();

    // Update the main worktree path if it exists
    const mainWorktree = settings.worktrees.find(w => w.name === 'main');
    if (mainWorktree) {
      mainWorktree.path = newPath;
    }

    await saveSettings(slug, settings);

    // Update the store
    const updated: Repository = {
      ...existing,
      sourcePath: newPath,
    };
    useRepoStore.getState()._applyUpdate(repoId, updated);
    eventBus.emit(EventName.REPOSITORY_UPDATED, { name: repoId });

    logger.info(`[repo:updatePath] Updated path for ${repoId} to ${newPath}`);
  },

  /**
   * Gets repositories that have invalid/missing source paths.
   * Returns array of repository names that need to be relocated.
   */
  async getInvalidRepositories(): Promise<string[]> {
    const results = await this.validateAllPaths();
    return results.filter(r => !r.valid).map(r => r.repoId);
  },
};
