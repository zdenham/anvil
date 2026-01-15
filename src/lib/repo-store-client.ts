import { FilesystemClient } from "./filesystem-client";
import {
  RepositoryMetadata,
  RepositoryMetadataSchema,
  RepositoryVersion,
  Repository,
} from "@/entities/repositories/types";

const REPOSITORIES_DIR = "repositories";
const METADATA_FILE = "metadata.json";

/**
 * Options for creating a repository
 */
export interface CreateRepositoryOptions {
  name: string;
  originalUrl?: string;
}

/**
 * Client for managing repositories in the data directory.
 * Handles repository registration and version cloning.
 */
export class RepoStoreClient {
  private fs: FilesystemClient;
  private reposDir: string | null = null;

  constructor(fs: FilesystemClient) {
    this.fs = fs;
  }

  /**
   * Ensures the repositories directory exists
   */
  async bootstrap(): Promise<void> {
    const reposDir = await this.getReposDir();
    await this.fs.mkdir(reposDir);
  }

  /**
   * Gets the repositories directory path, caching it for performance
   */
  private async getReposDir(): Promise<string> {
    if (!this.reposDir) {
      const dataDir = await this.fs.getDataDir();
      this.reposDir = this.fs.joinPath(dataDir, REPOSITORIES_DIR);
    }
    return this.reposDir;
  }

  /**
   * Creates a slug from a name (lowercase, hyphenated)
   */
  private slugify(name: string): string {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
  }

  /**
   * Creates a new repository entry
   */
  async create(options: CreateRepositoryOptions): Promise<RepositoryMetadata> {
    const reposDir = await this.getReposDir();
    const slug = this.slugify(options.name);
    const repoDir = this.fs.joinPath(reposDir, slug);

    if (await this.fs.exists(repoDir)) {
      throw new Error(`Repository already exists: ${options.name}`);
    }

    await this.fs.mkdir(repoDir);

    const metadata: RepositoryMetadata = {
      name: options.name,
      originalUrl: options.originalUrl ?? null,
      sourcePath: null,
      useWorktrees: false,
      createdAt: Date.now(),
    };

    await this.fs.writeJsonFile(
      this.fs.joinPath(repoDir, METADATA_FILE),
      metadata
    );

    return metadata;
  }

  /**
   * Lists all repositories
   */
  async list(): Promise<RepositoryMetadata[]> {
    const reposDir = await this.getReposDir();

    if (!(await this.fs.exists(reposDir))) {
      return [];
    }

    const entries = await this.fs.listDir(reposDir);
    const repos: RepositoryMetadata[] = [];

    for (const entry of entries) {
      if (!entry.isDirectory) continue;

      const metadataPath = this.fs.joinPath(entry.path, METADATA_FILE);
      if (await this.fs.exists(metadataPath)) {
        try {
          const raw = await this.fs.readJsonFile<unknown>(metadataPath);
          const metadata = RepositoryMetadataSchema.parse(raw);
          repos.push(metadata);
        } catch {
          // Skip invalid repository directories
        }
      }
    }

    return repos;
  }

  /**
   * Gets a repository by name
   */
  async get(name: string): Promise<Repository | null> {
    const reposDir = await this.getReposDir();
    const slug = this.slugify(name);
    const repoDir = this.fs.joinPath(reposDir, slug);

    if (!(await this.fs.exists(repoDir))) {
      return null;
    }

    const metadataPath = this.fs.joinPath(repoDir, METADATA_FILE);
    if (!(await this.fs.exists(metadataPath))) {
      return null;
    }

    const raw = await this.fs.readJsonFile<unknown>(metadataPath);
    const metadata = RepositoryMetadataSchema.parse(raw);
    const versions = await this.listVersions(name);

    return { ...metadata, versions };
  }

  /**
   * Lists versions for a repository.
   * Supports both naming patterns: v1, v2 (from createVersion) and slug-1, slug-2 (from createFromFolder)
   */
  async listVersions(name: string): Promise<RepositoryVersion[]> {
    const reposDir = await this.getReposDir();
    const slug = this.slugify(name);
    const repoDir = this.fs.joinPath(reposDir, slug);

    if (!(await this.fs.exists(repoDir))) {
      return [];
    }

    const entries = await this.fs.listDir(repoDir);
    const versions: RepositoryVersion[] = [];

    for (const entry of entries) {
      if (!entry.isDirectory) continue;
      if (entry.name === METADATA_FILE) continue;

      // Version directories can be named v1, v2, etc. OR slug-1, slug-2, etc.
      const vMatch = entry.name.match(/^v(\d+)$/);
      const slugMatch = entry.name.match(new RegExp(`^${slug}-(\\d+)$`));

      const match = vMatch || slugMatch;
      if (match) {
        versions.push({
          version: parseInt(match[1], 10),
          createdAt: 0, // Could read from fs metadata if needed
          path: entry.path,
        });
      }
    }

    // Sort by version number
    versions.sort((a, b) => a.version - b.version);
    return versions;
  }

  /**
   * Gets the next version number for a repository
   */
  private async getNextVersion(name: string): Promise<number> {
    const versions = await this.listVersions(name);
    if (versions.length === 0) return 1;
    return Math.max(...versions.map((v) => v.version)) + 1;
  }

  /**
   * Creates a new version by copying from a source directory
   */
  async createVersion(
    name: string,
    sourcePath: string
  ): Promise<RepositoryVersion> {
    const reposDir = await this.getReposDir();
    const slug = this.slugify(name);
    const repoDir = this.fs.joinPath(reposDir, slug);

    if (!(await this.fs.exists(repoDir))) {
      throw new Error(`Repository not found: ${name}`);
    }

    if (!(await this.fs.exists(sourcePath))) {
      throw new Error(`Source path does not exist: ${sourcePath}`);
    }

    const version = await this.getNextVersion(name);
    const versionDir = this.fs.joinPath(repoDir, `v${version}`);

    await this.fs.copyDirectory(sourcePath, versionDir);

    const versionInfo: RepositoryVersion = {
      version,
      createdAt: Date.now(),
      path: versionDir,
    };

    return versionInfo;
  }

  /**
   * Gets the path to a specific version
   */
  async getVersionPath(name: string, version: number): Promise<string | null> {
    const reposDir = await this.getReposDir();
    const slug = this.slugify(name);
    const versionDir = this.fs.joinPath(reposDir, slug, `v${version}`);

    if (!(await this.fs.exists(versionDir))) {
      return null;
    }

    return versionDir;
  }

  /**
   * Gets the latest version path for a repository
   */
  async getLatestVersionPath(name: string): Promise<string | null> {
    const versions = await this.listVersions(name);
    if (versions.length === 0) return null;

    const latest = versions[versions.length - 1];
    return latest.path;
  }

  /**
   * Deletes a repository and all its versions.
   * Handles worktree cleanup if applicable.
   */
  async delete(name: string): Promise<void> {
    const repo = await this.get(name);
    if (!repo) {
      throw new Error(`Repository not found: ${name}`);
    }

    // If using worktrees, remove them first to keep git's worktree list clean
    if (repo.useWorktrees && repo.sourcePath) {
      for (const version of repo.versions) {
        try {
          await this.fs.gitWorktreeRemove(repo.sourcePath, version.path);
        } catch {
          // Worktree might already be gone, continue cleanup
        }
      }
    }

    const reposDir = await this.getReposDir();
    const slug = this.slugify(name);
    const repoDir = this.fs.joinPath(reposDir, slug);
    await this.fs.removeAll(repoDir);
  }

  /**
   * Extracts the folder name from a full path
   */
  private extractFolderName(path: string): string {
    const segments = path.split("/").filter((s) => s.length > 0);
    if (segments.length === 0) {
      throw new Error("Invalid path: cannot extract folder name");
    }
    return segments[segments.length - 1];
  }

  /**
   * Creates a new repository from a local folder.
   * Uses git worktrees for git repos (fast), falls back to copying for non-git folders.
   * Structure: repositories/repo-name/repo-name-1, repo-name-2, etc.
   */
  async createFromFolder(
    sourcePath: string,
    count: number = 5
  ): Promise<Repository> {
    if (!(await this.fs.exists(sourcePath))) {
      throw new Error(`Source path does not exist: ${sourcePath}`);
    }

    const folderName = this.extractFolderName(sourcePath);
    const slug = this.slugify(folderName);
    const reposDir = await this.getReposDir();
    const repoDir = this.fs.joinPath(reposDir, slug);

    if (await this.fs.exists(repoDir)) {
      throw new Error(`Repository already exists: ${folderName}`);
    }

    await this.fs.mkdir(repoDir);

    // Check if source is a git repo - use worktrees if so (much faster)
    const isGitRepo = await this.fs.isGitRepo(sourcePath);

    const metadata: RepositoryMetadata = {
      name: folderName,
      originalUrl: null,
      sourcePath: sourcePath,
      useWorktrees: isGitRepo,
      createdAt: Date.now(),
    };

    await this.fs.writeJsonFile(
      this.fs.joinPath(repoDir, METADATA_FILE),
      metadata
    );

    // Create versions using worktrees (fast) or copying (fallback)
    const versions: RepositoryVersion[] = [];
    for (let i = 1; i <= count; i++) {
      const copyName = `${slug}-${i}`;
      const copyPath = this.fs.joinPath(repoDir, copyName);

      if (isGitRepo) {
        await this.fs.gitWorktreeAdd(sourcePath, copyPath);
      } else {
        await this.fs.copyDirectory(sourcePath, copyPath);
      }

      versions.push({
        version: i,
        createdAt: Date.now(),
        path: copyPath,
      });
    }

    return { ...metadata, versions };
  }

  /**
   * Deletes a specific version of a repository.
   * Handles both worktree removal and directory deletion.
   */
  async deleteVersion(name: string, version: number): Promise<void> {
    const repo = await this.get(name);
    if (!repo) {
      throw new Error(`Repository not found: ${name}`);
    }

    const versionPath = await this.getVersionPath(name, version);
    if (!versionPath) {
      throw new Error(`Version not found: ${name} v${version}`);
    }

    // If using worktrees, remove the worktree first
    if (repo.useWorktrees && repo.sourcePath) {
      try {
        await this.fs.gitWorktreeRemove(repo.sourcePath, versionPath);
      } catch {
        // Worktree might already be removed, fall through to directory deletion
      }
    }

    await this.fs.removeAll(versionPath);
  }
}
