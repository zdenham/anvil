import { spawn } from "child_process";
import { createInterface as createReadlineInterface } from "readline";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { randomUUID } from "crypto";
import { TestMortDirectory } from "./services/test-mort-directory.js";
import { TestRepository } from "./services/test-repository.js";
import { RunnerConfig, defaultRunnerConfig } from "./runner-config.js";
import type {
  AgentRunOutput,
  AgentLogMessage,
  AgentEventMessage,
  AgentStateMessage,
  AgentTestOptions,
} from "./types.js";
import type { TaskMetadata } from "@core/types/tasks.js";

export interface AgentTestHarnessOptions extends Partial<AgentTestOptions> {
  /** Custom runner configuration */
  runnerConfig?: RunnerConfig;
  /**
   * Custom environment setup function.
   * Use this to configure a specific test scenario with custom
   * mort directory contents, repository fixtures, or task configurations.
   */
  setupEnvironment?: () => Promise<{
    mortDir: TestMortDirectory;
    repo: TestRepository;
    task: TaskMetadata;
  }>;
}

/**
 * Test harness for spawning agent subprocesses and capturing their output.
 *
 * The harness manages the lifecycle of test resources (mort directory, repository)
 * and provides structured access to agent output for assertions.
 */
export class AgentTestHarness {
  private mortDir: TestMortDirectory | null = null;
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
    return this.mortDir?.path ?? null;
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
   * Creates temporary test resources (mort directory, repository, task),
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
      this.mortDir = setup.mortDir;
      this.repo = setup.repo;
      task = setup.task;
    } else {
      this.mortDir = new TestMortDirectory().init();
      this.repo = new TestRepository({ fixture: "minimal" }).init();
      this.mortDir.registerRepository(this.repo);
      task = this.mortDir.createTask({
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
    this.mortDir?.cleanup(preserveOnFailure);
  }

  /**
   * Spawn the agent subprocess and collect its output.
   */
  private spawnAgent(
    opts: AgentTestOptions,
    task: TaskMetadata
  ): Promise<AgentRunOutput> {
    // Resolve runner path relative to src/testing -> src/runner.ts
    const currentDir = dirname(fileURLToPath(import.meta.url));
    const runnerPath = join(currentDir, "..", this.runnerConfig.runnerPath);
    const repoCwd = opts.cwd ?? this.repo?.path ?? process.cwd();
    const cliArgs = this.runnerConfig.buildArgs(
      opts,
      task,
      this.mortDir!.path,
      repoCwd
    );
    const args = [runnerPath, ...cliArgs];

    const logs: AgentLogMessage[] = [];
    const events: AgentEventMessage[] = [];
    const states: AgentStateMessage[] = [];
    let stderr = "";
    const startTime = Date.now();
    const timeout = opts.timeout ?? 60000;

    return new Promise((resolve, reject) => {
      const proc = spawn("tsx", args, {
        env: { ...process.env, ...this.runnerConfig.env, ...opts.env },
        stdio: ['pipe', 'pipe', 'pipe'],  // Enable stdin pipe for queued messages
      });

      let killed = false;
      let timeoutId: NodeJS.Timeout | null = null;

      // Schedule queued messages to be sent via stdin
      const queuedMessageTimeouts: NodeJS.Timeout[] = [];
      if (opts.queuedMessages && opts.queuedMessages.length > 0) {
        for (const qm of opts.queuedMessages) {
          const qmTimeoutId = setTimeout(() => {
            if (!killed && proc.stdin && !proc.stdin.destroyed) {
              const payload = JSON.stringify({
                type: 'queued_message',
                id: randomUUID(),
                content: qm.content,
                timestamp: Date.now(),
              }) + '\n';
              proc.stdin.write(payload);
            }
          }, qm.delayMs);
          queuedMessageTimeouts.push(qmTimeoutId);
        }
      }

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
          process.stderr.write(`[agent stderr] ${text}`);
        }
      });

      proc.on("close", (code) => {
        clearTimeoutHandler();
        // Clear any pending queued message timeouts
        queuedMessageTimeouts.forEach(clearTimeout);
        resolve({
          logs,
          events,
          states,
          exitCode: killed ? -1 : (code ?? 1),
          stderr: killed
            ? `${stderr}\n[Killed: timeout after ${timeout}ms]`
            : stderr,
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
            process.stdout.write(`[agent stdout] Unknown type: ${line}\n`);
          }
      }
    } catch {
      // Non-JSON output (e.g., raw console.log from dependencies)
      if (process.env.DEBUG) {
        process.stdout.write(`[agent stdout] ${line}\n`);
      }
    }
  }
}
