# Phase 1c: TestRepository Service

## Overview

Create `TestRepository` service for initializing isolated local git repositories with fixture files. This service provides real git repositories for agent testing, enabling tests to verify agent behavior against actual version control operations.

## Dependencies

- `01a-test-types.md` (types)

## Parallel With

- `01b-test-anvil-directory.md` (no shared dependencies)

## Files to Create

### `agents/src/testing/services/test-repository.ts`

```typescript
import { mkdirSync, rmSync, writeFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { tmpdir } from "os";
import { randomUUID } from "crypto";
import { execSync } from "child_process";

export interface TestRepositoryOptions {
  /** Repository name (used when registering with TestAnvilDirectory) */
  name?: string;
  /** Keep directory after cleanup for debugging */
  keepOnCleanup?: boolean;
  /** Fixture template to use */
  fixture?: "minimal" | "typescript" | "empty";
}

export interface FileFixture {
  path: string;
  content: string;
}

export class TestRepository {
  public readonly path: string;
  public readonly name: string;
  private cleaned = false;

  constructor(private options: TestRepositoryOptions = {}) {
    this.name = options.name ?? `test-repo-${randomUUID().slice(0, 8)}`;
    this.path = join(tmpdir(), this.name);
  }

  /**
   * Initialize the git repository with fixtures.
   * Creates the directory, initializes git, adds fixture files, and creates initial commit.
   */
  init(): this {
    mkdirSync(this.path, { recursive: true });

    // Initialize git repo with local-only config
    this.git("init");
    this.git("config user.email 'test@test.com'");
    this.git("config user.name 'Test User'");

    // Add fixture files based on template
    const files = this.getFixtureFiles();
    for (const file of files) {
      const filePath = join(this.path, file.path);
      mkdirSync(dirname(filePath), { recursive: true });
      writeFileSync(filePath, file.content);
    }

    // Create initial commit if there are files
    if (files.length > 0) {
      this.git("add .");
      this.git("commit -m 'Initial commit'");
    }

    return this;
  }

  /**
   * Add a file to the repository (does not stage or commit).
   * Creates parent directories as needed.
   */
  addFile(relativePath: string, content: string): this {
    const filePath = join(this.path, relativePath);
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, content);
    return this;
  }

  /**
   * Stage all changes and commit with the given message.
   */
  commit(message: string): this {
    this.git("add .");
    this.git(`commit -m '${message.replace(/'/g, "'\\''")}'`);
    return this;
  }

  /**
   * Run a git command in this repository.
   * Returns stdout as a string.
   * @throws Error if the command fails
   */
  git(command: string): string {
    return execSync(`git ${command}`, {
      cwd: this.path,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });
  }

  /**
   * Clean up the temporary directory.
   * @param failed - If true, preserve directory for debugging
   */
  cleanup(failed = false): void {
    if (this.cleaned) return;
    this.cleaned = true;

    const shouldKeep = this.options.keepOnCleanup || process.env.KEEP_TEMP || failed;
    if (shouldKeep) {
      console.log(`[TestRepository] Keeping temp dir: ${this.path}`);
      return;
    }

    if (existsSync(this.path)) {
      rmSync(this.path, { recursive: true, force: true });
    }
  }

  private getFixtureFiles(): FileFixture[] {
    switch (this.options.fixture) {
      case "empty":
        return [{ path: ".gitkeep", content: "" }];

      case "typescript":
        return [
          { path: "README.md", content: "# Test Repository\n\nA TypeScript test repository.\n" },
          { path: "package.json", content: JSON.stringify({ name: "test-repo", version: "1.0.0", type: "module" }, null, 2) },
          { path: "tsconfig.json", content: JSON.stringify({ compilerOptions: { target: "ES2020", module: "ESNext", strict: true } }, null, 2) },
          { path: "src/index.ts", content: "export const hello = (): string => 'world';\n" },
        ];

      case "minimal":
      default:
        return [
          { path: "README.md", content: "# Test Repository\n\nA minimal test repository.\n" },
          { path: "src/main.js", content: "console.log('Hello, world!');\n" },
        ];
    }
  }
}
```

## Fixture Templates

### `minimal` (default)

Basic JavaScript project structure:

```
README.md
src/main.js
```

### `typescript`

TypeScript project with module configuration:

```
README.md
package.json
tsconfig.json
src/index.ts
```

### `empty`

Bare repository with only a placeholder file:

```
.gitkeep
```

## Key Features

1. **Real git repository** - Uses actual git commands, not mocks
2. **Fixture templates** - Pre-configured file sets for common scenarios
3. **Custom files** - `addFile()` for test-specific content
4. **Commit helper** - Easy to stage and commit changes
5. **Git command access** - `git()` method for custom operations
6. **Fluent API** - Methods return `this` for chaining

## Usage Example

```typescript
// Create and initialize a TypeScript repository
const repo = new TestRepository({ fixture: "typescript" }).init();

// Add test-specific files
repo.addFile("src/utils.ts", "export const add = (a: number, b: number) => a + b;");
repo.commit("Add utils module");

// Use repo.path as cwd for simple agents
// Or register with TestAnvilDirectory for task-based agents:
anvilDir.registerRepository({ name: repo.name, path: repo.path });

// Always clean up after tests
repo.cleanup();
```

## Integration with TestAnvilDirectory

The `TestRepository` can be registered with `TestAnvilDirectory` to test agents that require the full orchestration setup:

```typescript
const anvilDir = new TestAnvilDirectory().init();
const repo = new TestRepository({ name: "my-project", fixture: "typescript" }).init();

anvilDir.registerRepository({ name: repo.name, path: repo.path });
const task = anvilDir.createTask({ repositoryName: repo.name });

// Run agent with full context
await runAgent({
  agent: "execution",
  anvilDir: anvilDir.path,
  taskSlug: task.slug,
  prompt: "Add a new function",
});
```

## Acceptance Criteria

- [ ] Creates valid git repository with `git init`
- [ ] Initial commit exists after `init()` (verify with `git log`)
- [ ] All fixture templates create expected files
- [ ] `addFile()` creates files with parent directories
- [ ] `commit()` stages and commits all changes
- [ ] `git()` method returns stdout and throws on failure
- [ ] Cleanup removes all temp files when not preserved
- [ ] `KEEP_TEMP` env var preserves directories for debugging
- [ ] `keepOnCleanup` option preserves directories
- [ ] `cleanup(true)` preserves directory when test failed

## Estimated Effort

Medium (~1-2 hours)
