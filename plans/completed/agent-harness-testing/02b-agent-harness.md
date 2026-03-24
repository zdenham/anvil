# Phase 2b: AgentTestHarness Class

## Overview

Create the main `AgentTestHarness` class for spawning agent subprocesses and capturing their structured stdout output for test assertions.

## Dependencies

- `02a-runner-config.md` (runner configuration interface)
- Phase 1 complete (test services: TestAnvilDirectory, TestRepository, types)

## Parallel With

- Nothing (depends on 02a completing first)

## Files to Create

### `agents/src/testing/agent-harness.ts`

```typescript
import { spawn, type ChildProcess } from "child_process";
import { createInterface as createReadlineInterface } from "readline";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { TestAnvilDirectory } from "./services/test-anvil-directory";
import { TestRepository } from "./services/test-repository";
import { RunnerConfig, defaultRunnerConfig } from "./runner-config";
import type {
  AgentRunOutput,
  AgentLogMessage,
  AgentEventMessage,
  AgentStateMessage,
  AgentTestOptions,
} from "./types";
import type { TaskMetadata } from "@core/types/tasks";

export interface AgentTestHarnessOptions extends Partial<AgentTestOptions> {
  /** Custom runner configuration */
  runnerConfig?: RunnerConfig;
  /**
   * Custom environment setup function.
   * Use this to configure a specific test scenario with custom
   * anvil directory contents, repository fixtures, or task configurations.
   */
  setupEnvironment?: () => Promise<{
    anvilDir: TestAnvilDirectory;
    repo: TestRepository;
    task: TaskMetadata;
  }>;
}

/**
 * Test harness for spawning agent subprocesses and capturing their output.
 *
 * The harness manages the lifecycle of test resources (anvil directory, repository)
 * and provides structured access to agent output for assertions.
 */
export class AgentTestHarness {
  private anvilDir: TestAnvilDirectory | null = null;
  private repo: TestRepository | null = null;
  private runnerConfig: RunnerConfig;
  private customSetup?: AgentTestHarnessOptions["setupEnvironment"];

  constructor(private options: AgentTestHarnessOptions = {}) {
    this.runnerConfig = options.runnerConfig ?? defaultRunnerConfig;
    this.customSetup = options.setupEnvironment;
  }

  /**
   * Get the temp directory path (useful for debugging or advanced assertions).
   * Returns null if run() has not been called yet.
   */
  get tempDirPath(): string | null {
    return this.anvilDir?.path ?? null;
  }

  /**
   * Get the repository path (useful for file system assertions).
   * Returns null if run() has not been called yet.
   */
  get repoPath(): string | null {
    return this.repo?.path ?? null;
  }

  /**
   * Run an agent and capture all stdout output.
   *
   * Creates temporary test resources (anvil directory, repository, task),
   * spawns the agent subprocess, and collects all JSON output lines.
   *
   * @param overrides - Options to override the constructor defaults for this run
   * @returns Aggregated output from the agent run
   * @throws If the agent process fails to spawn
   */
  async run(overrides?: Partial<AgentTestOptions>): Promise<AgentRunOutput> {
    const opts = { ...this.options, ...overrides } as AgentTestOptions;

    let task: TaskMetadata;

    if (this.customSetup) {
      const setup = await this.customSetup();
      this.anvilDir = setup.anvilDir;
      this.repo = setup.repo;
      task = setup.task;
    } else {
      this.anvilDir = new TestAnvilDirectory().init();
      this.repo = new TestRepository({ fixture: "minimal" }).init();
      this.anvilDir.registerRepository(this.repo);
      task = this.anvilDir.createTask({
        repositoryName: this.repo.name,
        slug: opts.taskSlug,
      });
    }

    return this.spawnAgent(opts, task);
  }

  /**
   * Clean up temporary resources created during the test run.
   *
   * @param preserveOnFailure - If true, preserves directories for debugging failed tests.
   *                            The preserved paths will be logged to stderr.
   */
  cleanup(preserveOnFailure = false): void {
    this.repo?.cleanup(preserveOnFailure);
    this.anvilDir?.cleanup(preserveOnFailure);
  }

  /**
   * Spawn the agent subprocess and collect its output.
   */
  private spawnAgent(opts: AgentTestOptions, task: TaskMetadata): Promise<AgentRunOutput> {
    const currentDir = dirname(fileURLToPath(import.meta.url));
    const runnerPath = join(currentDir, "..", this.runnerConfig.runnerPath);
    const repoCwd = opts.cwd ?? this.repo?.path ?? process.cwd();
    const cliArgs = this.runnerConfig.buildArgs(opts, task, this.anvilDir!.path, repoCwd);
    const args = [runnerPath, ...cliArgs];

    const logs: AgentLogMessage[] = [];
    const events: AgentEventMessage[] = [];
    const states: AgentStateMessage[] = [];
    let stderr = "";
    const startTime = Date.now();
    const timeout = opts.timeout ?? 60000;

    return new Promise((resolve, reject) => {
      const proc = spawn("node", args, {
        env: { ...process.env, ...this.runnerConfig.env, ...opts.env },
      });

      let killed = false;
      let timeoutId: NodeJS.Timeout | null = null;

      // Set up timeout handling with graceful shutdown
      timeoutId = setTimeout(() => {
        if (!killed) {
          killed = true;
          proc.kill("SIGTERM");
          // Force kill after 5 seconds if process doesn't exit gracefully
          setTimeout(() => proc.kill("SIGKILL"), 5000);
        }
      }, timeout);

      const clearTimeoutHandler = () => {
        if (timeoutId) clearTimeout(timeoutId);
      };

      // Parse JSON lines from stdout
      const rl = createReadlineInterface({ input: proc.stdout });
      rl.on("line", (line) => {
        this.parseOutputLine(line, logs, events, states);
      });

      // Capture stderr for debugging
      proc.stderr.on("data", (data: Buffer) => {
        const text = data.toString();
        stderr += text;
        if (process.env.DEBUG) {
          console.error(`[agent stderr] ${text}`);
        }
      });

      proc.on("close", (code) => {
        clearTimeoutHandler();
        resolve({
          logs,
          events,
          states,
          exitCode: killed ? -1 : (code ?? 1),
          stderr: killed ? `${stderr}\n[Killed: timeout after ${timeout}ms]` : stderr,
          durationMs: Date.now() - startTime,
        });
      });

      proc.on("error", (err) => {
        clearTimeoutHandler();
        reject(err);
      });
    });
  }

  /**
   * Parse a single stdout line and categorize it by message type.
   * Non-JSON lines are ignored (or logged in DEBUG mode).
   */
  private parseOutputLine(
    line: string,
    logs: AgentLogMessage[],
    events: AgentEventMessage[],
    states: AgentStateMessage[]
  ): void {
    try {
      const msg = JSON.parse(line);
      switch (msg.type) {
        case "log":
          logs.push(msg as AgentLogMessage);
          break;
        case "event":
          events.push(msg as AgentEventMessage);
          break;
        case "state":
          states.push(msg as AgentStateMessage);
          break;
        default:
          // Unknown message type - ignore but log in debug mode
          if (process.env.DEBUG) {
            console.log(`[agent stdout] Unknown type: ${line}`);
          }
      }
    } catch {
      // Non-JSON output (e.g., raw console.log from dependencies)
      if (process.env.DEBUG) {
        console.log(`[agent stdout] ${line}`);
      }
    }
  }
}
```

## Key Features

1. **Subprocess spawning** - Runs agent as an isolated child process via Node.js
2. **Structured stdout capture** - Parses JSON lines in real-time, categorizing by message type
3. **Timeout handling** - Graceful SIGTERM followed by SIGKILL after 5 seconds
4. **Composable setup** - Supports custom environment setup for complex test scenarios
5. **Debug mode** - Set `DEBUG=1` to see all agent stdout/stderr in the test console
6. **Cleanup with preservation** - Option to preserve temp directories for debugging failed tests

## Stdout Protocol

The harness expects JSON-line output from the agent runner. Each line should be a valid JSON object with a `type` field:

```json
{"type": "log", "level": "INFO", "message": "Starting agent..."}
{"type": "event", "name": "thread:created", "payload": {"threadId": "..."}}
{"type": "state", "state": {"status": "running", ...}}
```

Non-JSON lines are silently ignored (logged only when `DEBUG=1` is set).

## Usage Example

```typescript
import { AgentTestHarness } from "./agent-harness";

describe("simple agent", () => {
  let harness: AgentTestHarness;

  beforeEach(() => {
    harness = new AgentTestHarness({
      agent: "simple",
      timeout: 30000,
    });
  });

  afterEach(() => {
    // Preserve directories if test failed for debugging
    harness.cleanup(expect.getState().currentTestName?.includes("FAILED"));
  });

  it("lists directory contents", async () => {
    const output = await harness.run({
      prompt: "What files are in this directory?",
    });

    expect(output.exitCode).toBe(0);
    expect(output.events).toContainEqual(
      expect.objectContaining({ name: "thread:created" })
    );
    expect(output.durationMs).toBeLessThan(30000);
  });
});
```

## Error Handling

| Scenario | Behavior |
|----------|----------|
| Agent exits normally | `exitCode` reflects actual exit code |
| Agent times out | `exitCode` is `-1`, stderr includes timeout message |
| Agent crashes | `exitCode` reflects crash code, stderr has error details |
| Process fails to spawn | Promise rejects with spawn error |

## Acceptance Criteria

- [ ] Spawns agent subprocess with correct CLI arguments
- [ ] Captures all stdout message types (log, event, state)
- [ ] Correctly categorizes messages into separate arrays
- [ ] Timeout kills the process gracefully (SIGTERM then SIGKILL)
- [ ] Custom setup function overrides default environment creation
- [ ] Cleanup removes temp directories (or preserves on failure when requested)
- [ ] DEBUG=1 shows all agent stdout/stderr output
- [ ] Uses correct types from `./types.ts` (AgentRunOutput, AgentLogMessage, etc.)

## Estimated Effort

Medium-High (~3-4 hours)
