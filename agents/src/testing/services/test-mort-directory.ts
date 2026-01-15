import { mkdirSync, rmSync, writeFileSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { randomUUID } from "crypto";
import type { TaskMetadata } from "@core/types/tasks.js";
import type { RepositorySettings } from "@core/types/repositories.js";
import { generateTaskId } from "@core/types/tasks.js";

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
    mkdirSync(join(this.path, "tasks"), { recursive: true });

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
      schemaVersion: 1,
      name: repo.name,
      originalUrl: null,
      sourcePath: repo.path,
      useWorktrees: false, // Disable worktrees for test simplicity
      defaultBranch: repo.defaultBranch ?? "main",
      createdAt: now,
      worktrees: [],
      taskBranches: {},
      lastUpdated: now,
    };

    writeFileSync(
      join(repoDir, "settings.json"),
      JSON.stringify(settings, null, 2)
    );

    return this;
  }

  /**
   * Create a task with full metadata structure.
   * Returns the created TaskMetadata for use in assertions.
   */
  createTask(input: {
    repositoryName: string;
    title?: string;
    slug?: string;
    type?: "work" | "investigate" | "simple";
    description?: string;
  }): TaskMetadata {
    const slug = input.slug ?? `test-task-${randomUUID().slice(0, 8)}`;
    const now = Date.now();

    const task: TaskMetadata = {
      id: generateTaskId(),
      slug,
      title: input.title ?? "Test Task",
      description: input.description,
      branchName: `task/${slug}`,
      type: input.type ?? "work",
      subtasks: [],
      status: "draft",
      createdAt: now,
      updatedAt: now,
      parentId: null,
      tags: [],
      sortOrder: 0,
      repositoryName: input.repositoryName,
      pendingReviews: [],
    };

    const taskDir = join(this.path, "tasks", slug);
    mkdirSync(taskDir, { recursive: true });
    mkdirSync(join(taskDir, "threads"), { recursive: true });

    writeFileSync(
      join(taskDir, "metadata.json"),
      JSON.stringify(task, null, 2)
    );

    return task;
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
