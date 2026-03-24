# Phase 1b: TestAnvilDirectory Service

## Overview

Create `TestAnvilDirectory` service for isolated anvil directory creation with full orchestration support. This service creates a temporary directory structure that mirrors the real `~/.anvil` layout, enabling integration tests to run against realistic file-based state without affecting real data.

## Dependencies

- `01a-test-types.md` (types)

## Parallel With

- `01c-test-repository.md` (no shared dependencies)

## Files to Create

### `agents/src/testing/services/test-anvil-directory.ts`

```typescript
import { mkdirSync, rmSync, writeFileSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { randomUUID } from "crypto";
import type { TaskMetadata } from "@core/types/tasks";
import type { RepositorySettings } from "@/entities/repositories/types";
import { generateTaskId } from "@core/types/tasks";
import { logger } from "@/lib/logger-client";

export interface TestAnvilDirectoryOptions {
  /** Keep directory after cleanup for debugging */
  keepOnCleanup?: boolean;
}

export interface TestRepository {
  name: string;
  path: string;
  /** Default branch name (defaults to "main") */
  defaultBranch?: string;
}

export class TestAnvilDirectory {
  public readonly path: string;
  private cleaned = false;
  private registeredRepos: Map<string, TestRepository> = new Map();

  constructor(private options: TestAnvilDirectoryOptions = {}) {
    this.path = join(tmpdir(), `anvil-test-${randomUUID()}`);
  }

  /**
   * Initialize the directory structure.
   * Creates repositories/, tasks/, and simple-tasks/ subdirectories
   * along with a minimal config.json.
   */
  init(): this {
    mkdirSync(this.path, { recursive: true });
    mkdirSync(join(this.path, "repositories"), { recursive: true });
    mkdirSync(join(this.path, "tasks"), { recursive: true });
    mkdirSync(join(this.path, "simple-tasks"), { recursive: true });

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
      logger.info(`Keeping test anvil directory for debugging: ${this.path}`);
      return;
    }

    if (existsSync(this.path)) {
      rmSync(this.path, { recursive: true, force: true });
    }
  }
}
```

## Usage Example

```typescript
import { TestAnvilDirectory } from "@/testing/services/test-anvil-directory";

describe("Agent Integration", () => {
  let anvilDir: TestAnvilDirectory;

  beforeEach(() => {
    anvilDir = new TestAnvilDirectory().init();
    anvilDir.registerRepository({
      name: "test-repo",
      path: "/path/to/test/repo",
    });
  });

  afterEach(() => {
    anvilDir.cleanup();
  });

  it("creates task in correct location", () => {
    const task = anvilDir.createTask({
      repositoryName: "test-repo",
      title: "Fix bug",
    });

    expect(task.id).toMatch(/^task-/);
    expect(task.repositoryName).toBe("test-repo");
  });
});
```

## Key Features

1. **Isolated temp directory** - Each test gets its own anvil-like directory in the system temp folder
2. **Full orchestration setup** - Creates settings.json with all required RepositorySettings fields
3. **Task creation** - Creates proper TaskMetadata matching the real schema from `@core/types/tasks`
4. **Cleanup on failure** - Optionally preserves directories for debugging via `KEEP_TEMP` env var or `failed` flag
5. **Fluent API** - Methods return `this` for chaining (e.g., `anvilDir.init().registerRepository(...)`)

## Directory Structure Created

```
/tmp/anvil-test-{uuid}/
├── config.json
├── repositories/
│   └── {repo-name}/
│       └── settings.json
├── tasks/
│   └── {task-slug}/
│       ├── metadata.json
│       └── threads/
└── simple-tasks/
```

## Acceptance Criteria

- [ ] Creates complete directory structure on `init()`
- [ ] `settings.json` matches `RepositorySettings` schema exactly
- [ ] `metadata.json` matches `TaskMetadata` schema exactly (including all required fields)
- [ ] Cleanup removes all temp files when not preserving
- [ ] `KEEP_TEMP` env var preserves directories for debugging
- [ ] `failed` parameter to `cleanup()` preserves directories
- [ ] Fluent API allows method chaining

## Estimated Effort

Medium (~1-2 hours)
