# Agent Harness Testing Framework

## Goal

Create a testing framework to run agents independently of the UI by capturing and validating stdout output. This enables:
1. Verification of event emissions and state transitions
2. Regression testing of the anvil CLI within agent context
3. Future benchmark/eval infrastructure for agent intelligence

---

## Test Classification

This is **acceptance testing** (sometimes called "system testing"):
- Higher level than unit/integration tests
- Tests the full agent pipeline end-to-end
- Verifies externally observable behavior (stdout protocol)
- Sits above orchestration tests (which bypass the agent) but below UI E2E tests

```
┌─────────────────────────────────────────────────────────────┐
│                     Test Pyramid                             │
├─────────────────────────────────────────────────────────────┤
│  UI E2E Tests (anvil-test CLI)         ← existing plan       │
│  Agent Acceptance Tests               ← THIS PLAN           │
│  Orchestration Tests (--bypass-agent) ← existing plan       │
│  Integration Tests (service level)                          │
│  Unit Tests                                                 │
└─────────────────────────────────────────────────────────────┘
```

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                    Test Runner                               │
│                 (agent-harness.ts)                          │
├─────────────────────────────────────────────────────────────┤
│  1. Create isolated anvil directory                          │
│  2. Set up test repository + task                           │
│  3. Spawn agent runner as subprocess                        │
│  4. Capture stdout in real-time                             │
│  5. Parse JSON lines into typed objects                     │
│  6. Apply assertions on events/states                       │
│  7. Clean up temp directory                                 │
└───────────────────────┬─────────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────────┐
│              Agent Runner (subprocess)                       │
│                   node runner.js                             │
├─────────────────────────────────────────────────────────────┤
│  stdout: {"type": "log", ...}                               │
│  stdout: {"type": "event", "name": "thread:created", ...}   │
│  stdout: {"type": "state", "state": {...}}                  │
│  stdout: {"type": "event", "name": "worktree:allocated",...}│
│  ...                                                        │
└─────────────────────────────────────────────────────────────┘
```

---

## Stdout Protocol

Agents emit three message types as JSON lines to stdout:

### 1. Log Messages
```json
{"type": "log", "level": "INFO", "message": "Starting agent..."}
```

### 2. Event Messages
```json
{"type": "event", "name": "thread:created", "payload": {"threadId": "...", "taskId": "..."}}
{"type": "event", "name": "worktree:allocated", "payload": {"worktree": {...}, "mergeBase": "abc123"}}
{"type": "event", "name": "thread:status:changed", "payload": {"threadId": "...", "status": "complete"}}
```

### 3. State Messages
```json
{
  "type": "state",
  "state": {
    "messages": [...],
    "fileChanges": [{"path": "...", "operation": "modify", "diff": "..."}],
    "status": "running",
    "timestamp": 1234567890,
    "toolStates": {}
  }
}
```

---

## Prerequisites

### Runner Unification (Required)

Currently there are two separate runners with fundamentally different architectures:

| Aspect | `runner.ts` | `simple-runner.ts` |
|--------|-------------|-------------------|
| Task location | `tasks/{slug}/` | `simple-tasks/{taskId}/` |
| Thread folder | `{agent}-{threadId}` | `simple-{threadId}` |
| Worktrees | Yes (WorktreeAllocationService) | No (runs in cwd) |
| Orchestration | Full (TaskMetadataService, ThreadService) | Minimal (direct file writes) |
| Required args | `--task-slug` | `--task-id` |
| Dependencies | Repository settings, worktree pool | None |

**Before implementing the harness**, unify these into a single runner with a strategy pattern:

#### Unified CLI Interface

```bash
node runner.js \
  --agent <type>       # "research" | "execution" | "merge" | "simple"
  --prompt <string>    # The task prompt
  --thread-id <uuid>   # Thread identifier
  --anvil-dir <path>    # Path to anvil directory (instead of ~/.anvil)
  --task-slug <slug>   # Task slug (required for task-based agents)
  --cwd <path>         # Working directory (required for simple agent)
```

#### Architecture: Strategy Pattern

```typescript
// agents/src/runners/types.ts
interface RunnerStrategy {
  /** Validate args and return normalized config */
  parseArgs(args: string[]): RunnerConfig;
  /** Set up working directory and return context */
  setup(config: RunnerConfig): OrchestrationContext;
  /** Clean up resources on exit */
  cleanup(context: OrchestrationContext): void;
}

// agents/src/runners/task-runner-strategy.ts
class TaskRunnerStrategy implements RunnerStrategy {
  // Uses orchestration.ts for worktree allocation
  // Creates thread via ThreadService
  // Tracks file changes via git diff
}

// agents/src/runners/simple-runner-strategy.ts
class SimpleRunnerStrategy implements RunnerStrategy {
  // Runs in provided cwd, no worktree allocation
  // Creates simple-task metadata directly
  // No file change tracking
}
```

#### Unified Entry Point

```typescript
// agents/src/runner.ts (modified)
async function main() {
  const agentType = parseAgentType(process.argv);

  const strategy: RunnerStrategy = agentType === "simple"
    ? new SimpleRunnerStrategy()
    : new TaskRunnerStrategy();

  const config = strategy.parseArgs(process.argv.slice(2));
  const context = strategy.setup(config);

  setupCleanup(() => strategy.cleanup(context));

  // Common agent loop (shared between all strategies)
  await runAgentLoop(config, context);
}
```

#### Migration Steps

1. Extract shared code from both runners into `agents/src/runners/shared.ts`:
   - Agent loop (query, message handling, hooks)
   - System prompt building
   - Metadata update logic

2. Create `TaskRunnerStrategy` from `runner.ts` orchestration logic

3. Create `SimpleRunnerStrategy` from `simple-runner.ts` logic

4. Update `runner.ts` to be the unified entry point

5. Delete `simple-runner.ts` and `simple-runner-args.ts`

**Estimated complexity**: Medium. The runners share ~60% of their code (agent loop, hooks, state emission). The main difference is orchestration setup.

### Vitest Configuration (Required)

The agents package currently has no test configuration. Add:

1. `vitest` as a dev dependency in `agents/package.json`
2. `agents/vitest.config.ts` with node environment (not jsdom)
3. Test scripts in `agents/package.json`

```typescript
// agents/vitest.config.ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    include: ["src/**/*.test.ts", "src/testing/__tests__/**/*.ts"],
  },
});
```

```json
// agents/package.json (add to scripts)
{
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "test:harness": "vitest run src/testing/__tests__/*.test.ts",
    "test:harness-verify": "vitest run src/testing/__tests__/harness-self-test.ts"
  }
}
```

---

## Type Definitions

Types used by the testing framework. Reuses existing types where possible.

```typescript
// agents/src/testing/types.ts

// Re-export existing types from codebase
export type { TaskMetadata, TaskStatus } from "@core/types/tasks";
export type { ThreadState, FileChange, ResultMetrics } from "@core/types/events";

/** Log levels emitted by agents (matches lib/logger.ts) */
export type LogLevel = "DEBUG" | "INFO" | "WARN" | "ERROR";

/** Log message emitted to stdout */
export interface LogMessage {
  type: "log";
  level: LogLevel;
  message: string;
}

/** Event message emitted to stdout */
export interface EventMessage {
  type: "event";
  name: string;
  payload: Record<string, unknown>;
}

/** State message emitted to stdout (wraps ThreadState) */
export interface StateMessage {
  type: "state";
  state: ThreadState;
}

/** Union of all stdout message types */
export type StdoutMessage = LogMessage | EventMessage | StateMessage;

/** Agent output collected from a run */
export interface AgentOutput {
  logs: LogMessage[];
  events: EventMessage[];
  states: StateMessage[];
  exitCode: number;
  stderr: string;
  duration: number;
}

/** Options for running an agent test */
export interface AgentTestOptions {
  agent: "research" | "execution" | "merge" | "simple";
  prompt: string;
  anvilDir?: string;
  taskSlug?: string;
  repositoryName?: string;
  threadId?: string;
  timeout?: number;
  env?: Record<string, string>;
}
```

---

## Test Services

Reusable services for creating isolated test environments. These can be used independently by other test layers (orchestration tests, UI E2E tests, etc.).

### 1. TestAnvilDirectory

Creates an isolated anvil-like directory structure with full orchestration support.

**Critical**: This must create the complete infrastructure that `orchestration.ts` expects:
- Repository settings at `repositories/{name}/settings.json`
- Task metadata at `tasks/{slug}/metadata.json` with all required fields
- Worktree pool configuration

```typescript
// agents/src/testing/services/test-anvil-directory.ts

import { mkdirSync, rmSync, writeFileSync, existsSync, cpSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { randomUUID } from "crypto";
import type { TaskMetadata } from "@core/types/tasks";
import type { RepositorySettings } from "@/entities/repositories/types";
import { generateTaskId } from "@core/types/tasks";

export interface TestAnvilDirectoryOptions {
  /** Keep directory after cleanup for debugging */
  keepOnCleanup?: boolean;
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
   * This creates the settings.json that RepositorySettingsService expects.
   */
  registerRepository(repo: TestRepository): this {
    this.registeredRepos.set(repo.name, repo);

    const repoDir = join(this.path, "repositories", repo.name);
    mkdirSync(repoDir, { recursive: true });

    // Create settings.json with full RepositorySettings structure
    const settings: RepositorySettings = {
      schemaVersion: 1,
      name: repo.name,
      originalUrl: null,
      sourcePath: repo.path, // Points to the actual test repo
      useWorktrees: false, // Disable worktrees for test simplicity
      defaultBranch: "main",
      createdAt: Date.now(),
      worktrees: [],
      taskBranches: {},
      lastUpdated: Date.now(),
    };

    writeFileSync(
      join(repoDir, "settings.json"),
      JSON.stringify(settings, null, 2)
    );

    return this;
  }

  /**
   * Create a task with full metadata structure.
   * Returns a TaskMetadata that matches the real schema.
   */
  createTask(input: {
    repositoryName: string;
    title?: string;
    slug?: string;
    type?: "work" | "investigate" | "simple";
  }): TaskMetadata {
    const slug = input.slug ?? `test-task-${randomUUID().slice(0, 8)}`;
    const now = Date.now();

    const task: TaskMetadata = {
      id: generateTaskId(),
      slug,
      title: input.title ?? "Test Task",
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
   * Get the registered repository by name.
   */
  getRepository(name: string): TestRepository | undefined {
    return this.registeredRepos.get(name);
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
      console.log(`[TestAnvilDirectory] Keeping temp dir for debugging: ${this.path}`);
      return;
    }

    if (existsSync(this.path)) {
      rmSync(this.path, { recursive: true, force: true });
    }
  }
}
```

### 2. TestRepository

Initializes a local git repository with fixture files.

```typescript
// agents/src/testing/services/test-repository.ts

import { mkdirSync, rmSync, writeFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { tmpdir } from "os";
import { randomUUID } from "crypto";
import { execSync } from "child_process";

export interface TestRepositoryOptions {
  /** Repository name (used when adding to TestAnvilDirectory) */
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
   */
  init(): this {
    mkdirSync(this.path, { recursive: true });

    // Initialize git repo
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

    // Create initial commit
    this.git("add .");
    this.git("commit -m 'Initial commit'");

    return this;
  }

  /**
   * Add a file to the repository (does not commit).
   */
  addFile(relativePath: string, content: string): this {
    const filePath = join(this.path, relativePath);
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, content);
    return this;
  }

  /**
   * Run a git command in this repository.
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
      console.log(`[TestRepository] Keeping temp dir for debugging: ${this.path}`);
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
          { path: "README.md", content: "# Test Repository\n\nA test repository for agent testing.\n" },
          { path: "package.json", content: JSON.stringify({ name: "test-repo", version: "1.0.0" }, null, 2) },
          { path: "tsconfig.json", content: JSON.stringify({ compilerOptions: { target: "ES2020" } }, null, 2) },
          { path: "src/index.ts", content: "export const hello = () => 'world';\n" },
        ];

      case "minimal":
      default:
        return [
          { path: "README.md", content: "# Test Repository\n\nA test repository for agent testing.\n" },
          { path: "src/main.js", content: "console.log('Hello, world!');\n" },
        ];
    }
  }
}
```

### Service Composition

The harness composes these services:

```typescript
// Example usage in AgentTestHarness
const anvilDir = new TestAnvilDirectory().init();
const repo = new TestRepository({ fixture: "minimal" }).init();

// Register repository - creates settings.json with sourcePath pointing to repo
anvilDir.registerRepository(repo);

// Create task - creates full TaskMetadata with all required fields
const task = anvilDir.createTask({ repositoryName: repo.name });

// Run agent against this isolated environment
// Agent will use: anvilDir.path as --anvil-dir, task.slug as --task-slug
// The repo.path is the cwd for simple agents, or sourcePath for worktree allocation
// ...

// Cleanup
repo.cleanup();
anvilDir.cleanup();
```

---

## Core Components

### Design: Composition Over Configuration

The harness uses composition to allow flexible test configurations. Each component is a separate concern:

1. **Environment Setup** - `TestAnvilDirectory`, `TestRepository` (already composable)
2. **Runner Configuration** - `RunnerConfig` interface for spawning different runners
3. **Output Capture** - `StdoutCapture` for parsing JSON lines
4. **Assertions** - `AgentAssertions` for validating output

This allows tests to compose different configurations:

```typescript
// Default harness with standard runner
const harness = new AgentTestHarness();

// Custom runner configuration for specific test scenarios
const customHarness = new AgentTestHarness({
  runnerConfig: {
    runnerPath: "dist/runner.js",  // or custom test runner
    buildArgs: (opts, task) => [...],  // custom arg builder
  },
});

// Inject custom environment setup
const harness = new AgentTestHarness({
  setupEnvironment: async () => {
    const anvilDir = new TestAnvilDirectory().init();
    // Custom setup...
    return { anvilDir, repo, task };
  },
});
```

### 1. Runner Configuration Interface

```typescript
// agents/src/testing/runner-config.ts

import { randomUUID } from "crypto";
import type { TaskMetadata } from "@core/types/tasks";

/** Options for running an agent test */
export interface AgentTestOptions {
  agent: "research" | "execution" | "merge" | "simple";
  prompt: string;
  anvilDir?: string;
  taskSlug?: string;
  threadId?: string;
  timeout?: number;
  env?: Record<string, string>;
  /** Working directory for simple agents */
  cwd?: string;
}

/**
 * Configuration for spawning an agent runner.
 * After runner unification, there's a single runner.js with different args per agent type.
 */
export interface RunnerConfig {
  /** Path to runner script relative to agents/dist/ */
  runnerPath: string;

  /** Build CLI arguments for the runner */
  buildArgs: (opts: AgentTestOptions, task: TaskMetadata, anvilDirPath: string, repoCwd: string) => string[];

  /** Additional environment variables */
  env?: Record<string, string>;
}

/**
 * Default runner configuration for unified runner.
 * Handles both task-based agents (research/execution/merge) and simple agents.
 */
export const defaultRunnerConfig: RunnerConfig = {
  runnerPath: "runner.js",
  buildArgs: (opts, task, anvilDirPath, repoCwd) => {
    const threadId = opts.threadId ?? randomUUID();

    // Common args for all agent types
    const commonArgs = [
      "--agent", opts.agent,
      "--prompt", opts.prompt,
      "--thread-id", threadId,
      "--anvil-dir", anvilDirPath,
    ];

    if (opts.agent === "simple") {
      // Simple agent: uses --cwd, no task-slug
      return [
        ...commonArgs,
        "--cwd", opts.cwd ?? repoCwd,
      ];
    } else {
      // Task-based agents: use --task-slug for orchestration
      return [
        ...commonArgs,
        "--task-slug", task.slug,
      ];
    }
  },
};
```

### 2. AgentTestHarness Class

The primary interface for spawning and observing agent runs.

```typescript
// agents/src/testing/agent-harness.ts

import { spawn } from "child_process";
import { createInterface as createReadlineInterface } from "readline";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { TestAnvilDirectory } from "./services/test-anvil-directory";
import { TestRepository } from "./services/test-repository";
import { RunnerConfig, defaultRunnerConfig, AgentTestOptions } from "./runner-config";
import type { AgentOutput, LogMessage, EventMessage, StateMessage } from "./types";
import type { TaskMetadata } from "@core/types/tasks";

export interface AgentTestHarnessOptions extends Partial<AgentTestOptions> {
  /** Custom runner configuration */
  runnerConfig?: RunnerConfig;
  /** Custom environment setup function */
  setupEnvironment?: () => Promise<{ anvilDir: TestAnvilDirectory; repo: TestRepository; task: TaskMetadata }>;
}

export class AgentTestHarness {
  private anvilDir: TestAnvilDirectory | null = null;
  private repo: TestRepository | null = null;
  private runnerConfig: RunnerConfig;
  private customSetup?: () => Promise<{ anvilDir: TestAnvilDirectory; repo: TestRepository; task: TaskMetadata }>;

  constructor(private options: AgentTestHarnessOptions = {}) {
    this.runnerConfig = options.runnerConfig ?? defaultRunnerConfig;
    this.customSetup = options.setupEnvironment;
  }

  /**
   * Get the temp directory path (for testing the harness itself).
   */
  get tempDirPath(): string | null {
    return this.anvilDir?.path ?? null;
  }

  /**
   * Run an agent and capture all stdout output.
   * Returns when agent exits or timeout reached.
   */
  async run(overrides?: Partial<AgentTestOptions>): Promise<AgentOutput> {
    const opts = { ...this.options, ...overrides } as AgentTestOptions;

    let task: TaskMetadata;

    if (this.customSetup) {
      // Use custom environment setup
      const setup = await this.customSetup();
      this.anvilDir = setup.anvilDir;
      this.repo = setup.repo;
      task = setup.task;
    } else {
      // Default environment setup
      this.anvilDir = new TestAnvilDirectory().init();
      this.repo = new TestRepository({ fixture: "minimal" }).init();

      // Register repository with settings.json (required for orchestration)
      this.anvilDir.registerRepository(this.repo);

      task = this.anvilDir.createTask({
        repositoryName: this.repo.name,
        slug: opts.taskSlug,
      });
    }

    // Spawn agent subprocess
    const output = await this.spawnAgent(opts, task);

    return output;
  }

  /**
   * Clean up temporary resources.
   * @param failed - If true, preserve directories for debugging
   */
  cleanup(failed = false): void {
    this.repo?.cleanup(failed);
    this.anvilDir?.cleanup(failed);
  }

  private spawnAgent(opts: AgentTestOptions, task: TaskMetadata): Promise<AgentOutput> {
    // Resolve runner path relative to this module's location
    const currentDir = dirname(fileURLToPath(import.meta.url));
    const runnerPath = join(currentDir, "..", this.runnerConfig.runnerPath);

    // Get repo cwd - either from opts or from registered repository's path
    const repoCwd = opts.cwd ?? this.repo?.path ?? process.cwd();

    // Build args using configured builder
    const cliArgs = this.runnerConfig.buildArgs(opts, task, this.anvilDir!.path, repoCwd);
    const args = [runnerPath, ...cliArgs];

    const logs: LogMessage[] = [];
    const events: EventMessage[] = [];
    const states: StateMessage[] = [];
    let stderr = "";
    const startTime = Date.now();
    const timeout = opts.timeout ?? 60000;

    return new Promise((resolve, reject) => {
      const proc = spawn("node", args, {
        env: { ...process.env, ...this.runnerConfig.env, ...opts.env },
      });

      let killed = false;
      let timeoutId: NodeJS.Timeout | null = null;

      // Set up timeout with explicit kill
      timeoutId = setTimeout(() => {
        if (!killed) {
          killed = true;
          proc.kill("SIGTERM");
          // Force kill after grace period
          setTimeout(() => proc.kill("SIGKILL"), 5000);
        }
      }, timeout);

      const cleanup = () => {
        if (timeoutId) clearTimeout(timeoutId);
      };

      // Parse stdout JSON lines in real-time
      const rl = createReadlineInterface({ input: proc.stdout });
      rl.on("line", (line) => {
        try {
          const msg = JSON.parse(line);
          switch (msg.type) {
            case "log": logs.push(msg); break;
            case "event": events.push(msg); break;
            case "state": states.push(msg); break;
          }
        } catch {
          // Non-JSON line, ignore or log to debug output
          if (process.env.DEBUG) {
            console.log(`[agent stdout] ${line}`);
          }
        }
      });

      proc.stderr.on("data", (data) => {
        stderr += data.toString();
        if (process.env.DEBUG) {
          console.error(`[agent stderr] ${data.toString()}`);
        }
      });

      proc.on("close", (code) => {
        cleanup();
        resolve({
          logs,
          events,
          states,
          exitCode: killed ? -1 : (code ?? 1),
          stderr: killed ? `${stderr}\n[Killed: timeout after ${timeout}ms]` : stderr,
          duration: Date.now() - startTime,
        });
      });

      proc.on("error", (err) => {
        cleanup();
        reject(err);
      });
    });
  }
}
```

### 2. Assertion Helpers

Fluent assertions for validating agent output.

```typescript
// agents/src/testing/assertions.ts

export class AgentAssertions {
  constructor(private output: AgentOutput) {}

  /**
   * Assert that a specific event was emitted.
   */
  hasEvent(name: string, predicate?: (payload: unknown) => boolean): this {
    const event = this.output.events.find(e => e.name === name);
    if (!event) {
      throw new Error(`Expected event "${name}" not found. Events: ${this.output.events.map(e => e.name).join(", ")}`);
    }
    if (predicate && !predicate(event.payload)) {
      throw new Error(`Event "${name}" found but payload predicate failed`);
    }
    return this;
  }

  /**
   * Assert events were emitted in specific order.
   */
  hasEventsInOrder(names: string[]): this {
    const eventNames = this.output.events.map(e => e.name);
    let lastIndex = -1;
    for (const name of names) {
      const index = eventNames.indexOf(name, lastIndex + 1);
      if (index === -1) {
        throw new Error(`Event "${name}" not found after position ${lastIndex}`);
      }
      lastIndex = index;
    }
    return this;
  }

  /**
   * Assert final state matches predicate.
   */
  finalState(predicate: (state: ThreadState) => boolean): this {
    const lastState = this.output.states[this.output.states.length - 1];
    if (!lastState) {
      throw new Error("No state messages received");
    }
    if (!predicate(lastState.state)) {
      throw new Error(`Final state predicate failed`);
    }
    return this;
  }

  /**
   * Assert agent exited successfully.
   */
  succeeded(): this {
    if (this.output.exitCode !== 0) {
      throw new Error(`Agent exited with code ${this.output.exitCode}. Stderr: ${this.output.stderr}`);
    }
    return this;
  }

  /**
   * Assert agent ended in error state.
   */
  errored(errorPredicate?: (error: string | undefined) => boolean): this {
    const lastState = this.output.states[this.output.states.length - 1];
    if (!lastState || lastState.state.status !== "error") {
      throw new Error(`Expected error state, got: ${lastState?.state.status ?? "no state"}`);
    }
    if (errorPredicate && !errorPredicate(lastState.state.error)) {
      throw new Error(`Error predicate failed. Error: ${lastState.state.error}`);
    }
    return this;
  }

  /**
   * Assert agent was killed due to timeout.
   */
  timedOut(): this {
    if (this.output.exitCode !== -1) {
      throw new Error(`Expected timeout (exit code -1), got: ${this.output.exitCode}`);
    }
    if (!this.output.stderr.includes("[Killed: timeout")) {
      throw new Error(`Expected timeout message in stderr`);
    }
    return this;
  }

  /**
   * Assert agent had file changes.
   */
  hasFileChanges(predicate?: (changes: FileChange[]) => boolean): this {
    const lastState = this.output.states[this.output.states.length - 1];
    const changes = lastState?.state.fileChanges ?? [];
    if (changes.length === 0) {
      throw new Error("No file changes found");
    }
    if (predicate && !predicate(changes)) {
      throw new Error("File changes predicate failed");
    }
    return this;
  }

  /**
   * Assert agent used specific tools.
   */
  usedTools(toolNames: string[]): this {
    const usedToolNames = new Set<string>();
    for (const state of this.output.states) {
      for (const toolName of Object.keys(state.state.toolStates ?? {})) {
        usedToolNames.add(toolName);
      }
    }
    for (const name of toolNames) {
      if (!usedToolNames.has(name)) {
        throw new Error(`Tool "${name}" was not used. Used: ${[...usedToolNames].join(", ")}`);
      }
    }
    return this;
  }
}

export function assertAgent(output: AgentOutput): AgentAssertions {
  return new AgentAssertions(output);
}
```

### 3. Mock LLM Mode (Optional)

For deterministic tests, inject a mock LLM via environment variable.

```typescript
// agents/src/testing/mock-llm.ts

import { writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { randomUUID } from "crypto";

/**
 * Environment variable to enable mock LLM mode.
 * When set, agent uses scripted responses instead of calling Claude API.
 */
export const MOCK_LLM_VAR = "ANVIL_MOCK_LLM_PATH";

/**
 * Mock response script format.
 * Array of responses, consumed in order.
 */
export interface MockScript {
  responses: MockResponse[];
}

export interface MockResponse {
  /** Text content to return */
  content?: string;
  /** Tool calls to make */
  toolCalls?: Array<{
    name: string;
    input: Record<string, unknown>;
  }>;
}

/**
 * Create a mock script file for testing.
 */
export function createMockScript(script: MockScript): string {
  const path = join(tmpdir(), `mock-llm-${randomUUID()}.json`);
  writeFileSync(path, JSON.stringify(script, null, 2));
  return path;
}
```

**Implementation note**: Adding mock LLM support requires modifying `runner.ts` to check `ANVIL_MOCK_LLM_PATH` and use a mock SDK client. This is optional for v1.

---

## Test Scenarios

### 1. Event Emission Smoke Test

Verify the agent emits expected lifecycle events.

```typescript
describe("Agent Event Emissions", () => {
  let harness: AgentTestHarness;

  beforeEach(() => {
    harness = new AgentTestHarness({
      agent: "simple",
      timeout: 30000,
    });
  });

  afterEach((context) => {
    // Preserve temp dirs on test failure for debugging
    const failed = context.task.result?.state === "fail";
    harness.cleanup(failed);
  });

  it("emits thread:created on startup", async () => {
    const output = await harness.run({
      prompt: "Say hello",
    });

    assertAgent(output)
      .succeeded()
      .hasEvent("thread:created")
      .hasEventsInOrder(["thread:created", "thread:status:changed"]);
  });

  it("emits worktree:allocated for task-based agents", async () => {
    const output = await harness.run({
      agent: "execution",
      prompt: "Add a comment to README.md",
    });

    assertAgent(output)
      .succeeded()
      .hasEvent("worktree:allocated")
      .hasEvent("worktree:released");
  });
});
```

### 2. State Transition Test

Verify state progresses correctly through the run.

```typescript
it("state transitions from running to complete", async () => {
  const output = await harness.run({
    prompt: "List files in the current directory",
  });

  // First state should be "running"
  expect(output.states[0].state.status).toBe("running");

  // Final state should be "complete"
  assertAgent(output).finalState(s => s.status === "complete");
});
```

### 3. File Change Tracking Test

Verify file modifications are tracked correctly.

```typescript
it("tracks file changes in state", async () => {
  const output = await harness.run({
    agent: "execution",
    prompt: "Add a newline to the end of README.md",
  });

  assertAgent(output)
    .succeeded()
    .hasFileChanges(changes =>
      changes.some(c => c.path.endsWith("README.md") && c.operation === "modify")
    );
});
```

### 4. Tool Usage Verification

Verify specific tools were invoked.

```typescript
it("uses Read tool to inspect files", async () => {
  const output = await harness.run({
    prompt: "What does the README say?",
  });

  assertAgent(output)
    .succeeded()
    .usedTools(["Read"]);
});
```

---

## Framework Self-Verification

**Critical requirement**: The testing framework must be programmatically verifiable.

### Approach: Bootstrap Test Suite

Create a test that validates the testing framework itself:

```typescript
// agents/src/testing/__tests__/harness-self-test.ts

import { describe, it, expect, beforeAll } from "vitest";
import { existsSync } from "fs";
import { AgentTestHarness } from "../agent-harness";
import { assertAgent } from "../assertions";
import { TestAnvilDirectory } from "../services/test-anvil-directory";
import { TestRepository } from "../services/test-repository";
import { AgentOutput } from "../types";

/**
 * Skip tests that require API access when no key is present.
 */
const describeWithApi = process.env.ANTHROPIC_API_KEY
  ? describe
  : describe.skip;

describe("AgentTestHarness Self-Verification", () => {
  describe("TestAnvilDirectory service", () => {
    it("creates directory structure on init", () => {
      const anvilDir = new TestAnvilDirectory().init();

      expect(existsSync(anvilDir.path)).toBe(true);
      expect(existsSync(`${anvilDir.path}/repositories`)).toBe(true);
      expect(existsSync(`${anvilDir.path}/tasks`)).toBe(true);
      expect(existsSync(`${anvilDir.path}/config.json`)).toBe(true);

      anvilDir.cleanup();
      expect(existsSync(anvilDir.path)).toBe(false);
    });

    it("creates tasks with metadata", () => {
      const anvilDir = new TestAnvilDirectory().init();
      const task = anvilDir.createTask({
        repositoryName: "test-repo",
        title: "Test Task",
      });

      expect(task.slug).toMatch(/^test-task-/);
      expect(task.repositoryName).toBe("test-repo");
      expect(existsSync(`${anvilDir.path}/tasks/${task.slug}/metadata.json`)).toBe(true);

      anvilDir.cleanup();
    });
  });

  describe("TestRepository service", () => {
    it("initializes git repository with fixtures", () => {
      const repo = new TestRepository({ fixture: "minimal" }).init();

      expect(existsSync(repo.path)).toBe(true);
      expect(existsSync(`${repo.path}/.git`)).toBe(true);
      expect(existsSync(`${repo.path}/README.md`)).toBe(true);

      // Verify it has a commit
      const log = repo.git("log --oneline");
      expect(log).toContain("Initial commit");

      repo.cleanup();
      expect(existsSync(repo.path)).toBe(false);
    });

    it("supports different fixture templates", () => {
      const tsRepo = new TestRepository({ fixture: "typescript" }).init();

      expect(existsSync(`${tsRepo.path}/package.json`)).toBe(true);
      expect(existsSync(`${tsRepo.path}/tsconfig.json`)).toBe(true);
      expect(existsSync(`${tsRepo.path}/src/index.ts`)).toBe(true);

      tsRepo.cleanup();
    });
  });

  describe("Harness lifecycle", () => {
    it("exposes tempDirPath after run starts", async () => {
      const harness = new AgentTestHarness({
        agent: "simple",
        timeout: 5000,
      });

      // Before run, tempDirPath is null
      expect(harness.tempDirPath).toBeNull();

      // Start run and immediately check (run sets up dirs synchronously before spawn)
      const runPromise = harness.run({ prompt: "test" });

      // After run() is called, tempDirPath should be set
      // (setup happens synchronously before the async spawn)
      expect(harness.tempDirPath).not.toBeNull();
      expect(harness.tempDirPath).toMatch(/anvil-test-/);
      expect(existsSync(harness.tempDirPath!)).toBe(true);

      // Let it complete or timeout
      await runPromise.catch(() => {});

      const tempPath = harness.tempDirPath;
      harness.cleanup();

      // Verify cleanup worked
      expect(existsSync(tempPath!)).toBe(false);
    });
  });

  describe("Assertion helpers", () => {
    it("throws on missing events", () => {
      const fakeOutput: AgentOutput = {
        logs: [],
        events: [{ type: "event", name: "thread:created", payload: {} }],
        states: [],
        exitCode: 0,
        stderr: "",
        duration: 100,
      };

      // Should pass
      expect(() => assertAgent(fakeOutput).hasEvent("thread:created")).not.toThrow();

      // Should fail
      expect(() => assertAgent(fakeOutput).hasEvent("nonexistent:event")).toThrow();
    });

    it("validates event ordering", () => {
      const fakeOutput: AgentOutput = {
        logs: [],
        events: [
          { type: "event", name: "a", payload: {} },
          { type: "event", name: "b", payload: {} },
          { type: "event", name: "c", payload: {} },
        ],
        states: [],
        exitCode: 0,
        stderr: "",
        duration: 100,
      };

      // Correct order
      expect(() => assertAgent(fakeOutput).hasEventsInOrder(["a", "b", "c"])).not.toThrow();
      expect(() => assertAgent(fakeOutput).hasEventsInOrder(["a", "c"])).not.toThrow();

      // Wrong order
      expect(() => assertAgent(fakeOutput).hasEventsInOrder(["c", "a"])).toThrow();
    });

    it("validates final state", () => {
      const fakeOutput: AgentOutput = {
        logs: [],
        events: [],
        states: [
          { type: "state", state: { status: "running", messages: [], fileChanges: [], timestamp: 1 } },
          { type: "state", state: { status: "complete", messages: [], fileChanges: [], timestamp: 2 } },
        ],
        exitCode: 0,
        stderr: "",
        duration: 100,
      };

      expect(() => assertAgent(fakeOutput).finalState(s => s.status === "complete")).not.toThrow();
      expect(() => assertAgent(fakeOutput).finalState(s => s.status === "error")).toThrow();
    });

    it("validates error state transitions", () => {
      const fakeOutput: AgentOutput = {
        logs: [],
        events: [
          { type: "event", name: "thread:created", payload: {} },
          { type: "event", name: "thread:status:changed", payload: { status: "error" } },
        ],
        states: [
          { type: "state", state: { status: "running", messages: [], fileChanges: [], timestamp: 1 } },
          { type: "state", state: { status: "error", messages: [], fileChanges: [], timestamp: 2, error: "Something failed" } },
        ],
        exitCode: 1,
        stderr: "Error occurred",
        duration: 100,
      };

      expect(() => assertAgent(fakeOutput).finalState(s => s.status === "error")).not.toThrow();
      expect(() => assertAgent(fakeOutput).finalState(s => s.error !== undefined)).not.toThrow();
    });
  });

  /**
   * These tests require API access and actually spawn an agent.
   * They're skipped when ANTHROPIC_API_KEY is not set.
   */
  describeWithApi("Live agent tests (requires API key)", () => {
    let harness: AgentTestHarness;

    beforeEach(() => {
      harness = new AgentTestHarness();
    });

    afterEach((context) => {
      const failed = context.task.result?.state === "fail";
      harness.cleanup(failed);
    });

    it("captures stdout JSON lines correctly", async () => {
      const output = await harness.run({
        agent: "simple",
        prompt: "Say exactly: Hello",
        timeout: 30000,
      });

      // Must have at least one state message
      expect(output.states.length).toBeGreaterThan(0);

      // State messages must have required structure
      for (const state of output.states) {
        expect(state.type).toBe("state");
        expect(state.state).toBeDefined();
        expect(state.state.status).toMatch(/running|complete|error/);
        expect(Array.isArray(state.state.messages)).toBe(true);
      }
    }, 60000);
  });
});
```

### Local Verification Step

Run verification tests locally before agent tests:

```bash
# Run harness self-test first (no API key required)
pnpm --filter agents test:harness-verify

# Then run actual agent tests (requires ANTHROPIC_API_KEY)
pnpm --filter agents test:harness
```

The verification test (`harness-self-test.ts`) validates:
1. Temp directory creation and cleanup works
2. Stdout parsing captures all message types
3. Assertions correctly pass/fail
4. Event ordering logic is correct

If verification fails, skip the actual agent tests (they'd give unreliable results).

**Note**: These tests run locally only, not in CI. This avoids API costs and keeps CI fast.

---

## Implementation Order

### Phase 0: Runner Unification (Prerequisite)

**This is a substantial refactor** required before the harness can work. See "Prerequisites > Runner Unification" section for full design.

**Files:**
- `agents/src/runners/types.ts` - RunnerStrategy interface, RunnerConfig
- `agents/src/runners/shared.ts` - Common agent loop, hooks, state emission
- `agents/src/runners/task-runner-strategy.ts` - Task-based orchestration (from runner.ts)
- `agents/src/runners/simple-runner-strategy.ts` - Simple agent logic (from simple-runner.ts)
- `agents/src/runner.ts` - Unified entry point with strategy selection
- Delete `agents/src/simple-runner.ts` and `agents/src/simple-runner-args.ts`

**Also:**
- `agents/package.json` - Add vitest dev dependency
- `agents/vitest.config.ts` - Node environment configuration (not jsdom)

**Deliverable**: Single unified runner (`node runner.js --agent <type>`) with strategy pattern for different agent types. All agents use the same entry point.

**Estimated effort**: Medium-high. The runners share code, but unification requires careful extraction of the shared agent loop.

### Phase 1: Test Services
**Files:**
- `agents/src/testing/types.ts` - TypeScript interfaces (re-exports from @core)
- `agents/src/testing/services/test-anvil-directory.ts` - Isolated anvil directory with full orchestration setup
- `agents/src/testing/services/test-repository.ts` - Local git repo with fixtures
- `agents/src/testing/services/index.ts` - Service exports

**Deliverable**: Reusable test utilities for creating isolated environments with proper `settings.json`, task metadata, etc. These can be used independently by other test layers.

### Phase 2: Core Harness
**Files:**
- `agents/src/testing/runner-config.ts` - Runner configuration interface
- `agents/src/testing/agent-harness.ts` - Main harness class
- `agents/src/testing/assertions.ts` - Assertion helpers
- `agents/src/testing/index.ts` - Public exports

**Deliverable**: Can spawn agent and capture stdout with composable configuration.

### Phase 3: Self-Verification Tests
**Files:**
- `agents/src/testing/__tests__/harness-self-test.ts`

**Deliverable**: Framework validates itself. Tests are split into:
- Service tests (no API key required)
- Assertion tests (no API key required)
- Live agent tests (skipped when `ANTHROPIC_API_KEY` is not set)

### Phase 4: Agent Acceptance Tests
**Files:**
- `agents/src/testing/__tests__/events.test.ts` - Event emission tests
- `agents/src/testing/__tests__/state.test.ts` - State transition tests
- `agents/src/testing/__tests__/tools.test.ts` - Tool usage tests

**Deliverable**: Real agent behavior is tested.

### Phase 5: Mock LLM Support (Optional)
**Files:**
- `agents/src/testing/mock-llm.ts` - Mock script utilities
- `agents/src/runner.ts` - Add mock mode support

**Deliverable**: Deterministic tests without API calls.

### Phase 6: Benchmark Infrastructure (Future)
**Files:**
- `agents/src/testing/benchmarks/` - Benchmark definitions
- `agents/src/testing/benchmark-runner.ts` - Run and score benchmarks

**Deliverable**: Can evaluate agent intelligence on tasks.

---

## CLI Interface

All commands run from the repository root. Tests run locally only (not in CI).

```bash
# Run agent harness self-verification (no API key required)
pnpm --filter agents test:harness-verify

# Run all agent acceptance tests (requires ANTHROPIC_API_KEY)
pnpm --filter agents test:harness

# Run specific test file
pnpm --filter agents test -- src/testing/__tests__/events.test.ts

# Run with verbose output (show agent stdout)
DEBUG=1 pnpm --filter agents test:harness

# Run without cleanup (for debugging)
KEEP_TEMP=1 pnpm --filter agents test:harness
```

---

## Package.json Scripts

```json
// agents/package.json
{
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "test:harness-verify": "vitest run src/testing/__tests__/harness-self-test.ts",
    "test:harness": "vitest run src/testing/__tests__/*.test.ts"
  }
}
```

---

## Directory Structure

```
agents/src/testing/
├── index.ts                       # Public exports
├── agent-harness.ts               # Main harness class
├── runner-config.ts               # Runner configuration interface + presets
├── assertions.ts                  # Fluent assertion helpers
├── types.ts                       # TypeScript interfaces
├── mock-llm.ts                    # Mock LLM utilities (Phase 5)
├── services/
│   ├── index.ts                   # Service exports
│   ├── test-anvil-directory.ts     # Isolated anvil directory
│   └── test-repository.ts         # Local git repo with fixtures
├── __tests__/
│   ├── harness-self-test.ts       # Framework self-verification
│   ├── events.test.ts             # Event emission tests
│   ├── state.test.ts              # State transition tests
│   └── tools.test.ts              # Tool usage tests
└── benchmarks/                    # Future: benchmark tasks
    ├── simple-edit.md
    └── multi-file-refactor.md
```

The `services/` directory contains reusable test utilities that can be imported independently by other test layers (orchestration tests, UI E2E tests, etc.).

---

## Success Criteria

### Framework Verification (Phase 2)
- [ ] `harness-self-test.ts` passes with 100% coverage of harness functionality
- [ ] Temp directories are created and cleaned up properly
- [ ] All three stdout message types (log, event, state) are captured
- [ ] Assertions correctly throw on failures

### Agent Testing (Phase 3)
- [ ] Can run simple agent and verify `thread:created` event
- [ ] Can run execution agent and verify `worktree:allocated` event
- [ ] State transitions from `running` to `complete` are verifiable
- [ ] File changes appear in state when agent modifies files
- [ ] Tool usage is trackable via `toolStates`

### Performance
- [ ] Tests complete in <60s per scenario (simple agent)
- [ ] Test isolation prevents cross-test interference
- [ ] No `~/.anvil` pollution (all tests use temp directories)

---

## Relationship to Other Plans

| Plan | Scope | Relationship |
|------|-------|--------------|
| `e2e-testing-cli.md` | UI panels (spotlight, clipboard) | Complements - different layer |
| `orchestration-e2e-testing.md` | Orchestration without agent | Lower level - tests setup only |
| **This plan** | Full agent with stdout capture | Middle layer - agent behavior |

This plan fills the gap between orchestration testing (no LLM) and UI testing (full app). It tests the agent itself as a black box via its stdout protocol.

---

## Open Questions

### Resolved

1. ~~**API Cost Control**: Should acceptance tests run against real Claude API by default, or require explicit opt-in?~~ **Resolved**: Tests always require `ANTHROPIC_API_KEY`. This is acceptance testing that validates real agent behavior.

2. ~~**Parallelism**: Can multiple agent tests run in parallel?~~ **Resolved**: Yes, since each uses an isolated temp directory. Rate limiting is out of scope for v1.

3. ~~**CI Integration**: Should agent tests block PRs?~~ **Resolved**: Agent harness tests run locally only, not in CI. This avoids API costs and complexity.

4. ~~**Runner CLI Support**: Does the agent runner currently support `--anvil-dir`?~~ **Resolved**: Both runners support `--anvil-dir`. Runner unification is Phase 0.

5. ~~**Runner Strategy**: Test both runners separately or unify first?~~ **Resolved**: Unify runners first (Phase 0 prerequisite). Single entry point with strategy pattern.

6. ~~**Test Scope**: Protocol-only or live API tests?~~ **Resolved**: Include live API tests. Goal is to validate real agent behavior.

7. ~~**Environment Setup**: Full orchestration or minimal mocks?~~ **Resolved**: Full orchestration setup. `TestAnvilDirectory` creates proper `settings.json`, task metadata, etc.

8. ~~**Worktree Allocation**: Should task-based agent tests actually allocate worktrees?~~ **Resolved**: No, use `useWorktrees: false` for simplicity. Tests run in the test repository's sourcePath directly.

9. ~~**Test Data Cleanup**: Should failed tests automatically preserve temp directories for debugging?~~ **Resolved**: Yes, auto-preserve on test failure. Update cleanup logic to check test status.

10. ~~**API Rate Limiting**: Should the harness implement rate limiting between API calls?~~ **Resolved**: No, keep scope tight. Out of scope for v1.

---

## Notes

### Why stdout capture vs. direct imports?

1. **Process isolation** - Agents run as separate processes, just like production
2. **Protocol validation** - Tests the actual frontend-visible output
3. **Language agnostic** - Could reuse harness for non-TS agents in future
4. **Real-world testing** - No mocks mean higher confidence

### Relationship to evals/benchmarks

This framework provides the foundation for future eval work:
- Same harness can run benchmark tasks
- Assertions can score correctness (did agent complete task?)
- Results can be aggregated across multiple runs
- Mock LLM mode enables reproducible benchmarks

Phase 5 (benchmarks) will build on this infrastructure but is out of scope for v1.
