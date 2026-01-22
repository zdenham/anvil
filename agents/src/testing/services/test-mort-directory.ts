import { mkdirSync, rmSync, writeFileSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { randomUUID } from "crypto";
import type { RepositorySettings } from "@core/types/repositories.js";

export interface TestMortDirectoryOptions {
  /** Keep directory after cleanup for debugging */
  keepOnCleanup?: boolean;
}

export interface TestRepository {
  name: string;
  path: string;
  /** Default branch name (defaults to "main") */
  defaultBranch?: string;
}

export class TestMortDirectory {
  public readonly path: string;
  private cleaned = false;
  private registeredRepos: Map<string, TestRepository> = new Map();

  constructor(private options: TestMortDirectoryOptions = {}) {
    this.path = join(tmpdir(), `mort-test-${randomUUID()}`);
  }

  /**
   * Initialize the directory structure.
   * Creates repositories/ and tasks/ subdirectories
   * along with a minimal config.json.
   */
  init(): this {
    mkdirSync(this.path, { recursive: true });
    mkdirSync(join(this.path, "repositories"), { recursive: true });

    // Write minimal config
    writeFileSync(
      join(this.path, "config.json"),
      JSON.stringify({ version: 1 }, null, 2)
    );

    return this;
  }

  /**
   * Register a repository with full settings.
   * Creates the settings.json that RepositorySettingsService expects.
   */
  registerRepository(repo: TestRepository): this {
    this.registeredRepos.set(repo.name, repo);

    const repoDir = join(this.path, "repositories", repo.name);
    mkdirSync(repoDir, { recursive: true });

    const now = Date.now();
    const settings: RepositorySettings = {
      id: randomUUID(),
      schemaVersion: 1,
      name: repo.name,
      originalUrl: null,
      sourcePath: repo.path,
      useWorktrees: false, // Disable worktrees for test simplicity
      defaultBranch: repo.defaultBranch ?? "main",
      createdAt: now,
      worktrees: [],
      threadBranches: {},
      lastUpdated: now,
      plansDirectory: "plans/",
      completedDirectory: "plans/completed/",
    };

    writeFileSync(
      join(repoDir, "settings.json"),
      JSON.stringify(settings, null, 2)
    );

    return this;
  }

  /**
   * Get a registered repository by name.
   */
  getRepository(name: string): TestRepository | undefined {
    return this.registeredRepos.get(name);
  }

  /**
   * Clean up the temporary directory.
   * Call this in afterEach or afterAll hooks.
   *
   * @param failed - If true, preserve directory for debugging regardless of options
   */
  cleanup(failed = false): void {
    if (this.cleaned) return;
    this.cleaned = true;

    const shouldKeep = this.options.keepOnCleanup || process.env.KEEP_TEMP || failed;
    if (shouldKeep) {
      console.log(`[TestMortDirectory] Keeping temp dir for debugging: ${this.path}`);
      return;
    }

    if (existsSync(this.path)) {
      rmSync(this.path, { recursive: true, force: true });
    }
  }
}
