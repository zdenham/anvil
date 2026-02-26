import { spawn } from "child_process";
import { createInterface as createReadlineInterface } from "readline";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { randomUUID } from "crypto";
import { TestMortDirectory } from "./services/test-mort-directory.js";
import { TestRepository } from "./services/test-repository.js";
import { RunnerConfig, defaultRunnerConfig } from "./runner-config.js";
import { MockHubServer } from "./mock-hub-server.js";
import type {
  AgentRunOutput,
  AgentLogMessage,
  AgentEventMessage,
  AgentStateMessage,
  AgentTestOptions,
} from "./types.js";

export interface AgentTestHarnessOptions extends Partial<AgentTestOptions> {
  /** Custom runner configuration */
  runnerConfig?: RunnerConfig;
  /**
   * Custom environment setup function.
   * Use this to configure a specific test scenario with custom
   * mort directory contents or repository fixtures.
   */
  setupEnvironment?: () => Promise<{
    mortDir: TestMortDirectory;
    repo: TestRepository;
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
  private mockHub: MockHubServer | null = null;
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
   * Get the MockHubServer instance for reactive message handling.
   * Returns null if run() has not been called yet.
   */
  getMockHub(): MockHubServer | null {
    return this.mockHub;
  }

  /**
   * Run an agent and capture all stdout output.
   *
   * Creates temporary test resources (mort directory, repository),
   * spawns the agent subprocess, and collects all JSON output lines.
   *
   * @param overrides - Options to override the constructor defaults for this run
   * @returns Aggregated output from the agent run
   * @throws If the agent process fails to spawn
   */
  async run(overrides?: Partial<AgentTestOptions>): Promise<AgentRunOutput> {
    const opts = { ...this.options, ...overrides } as AgentTestOptions;

    if (this.customSetup) {
      const setup = await this.customSetup();
      this.mortDir = setup.mortDir;
      this.repo = setup.repo;
    } else {
      this.mortDir = new TestMortDirectory().init();
      this.repo = new TestRepository({ fixture: "minimal" }).init();
      this.mortDir.registerRepository(this.repo);
    }

    return this.spawnAgent(opts);
  }

  /**
   * Clean up temporary resources created during the test run.
   *
   * @param preserveOnFailure - If true, preserves directories for debugging failed tests.
   *                            The preserved paths will be logged to stderr.
   */
  cleanup(preserveOnFailure = false): void {
    this.mockHub?.stop();
    this.mockHub = null;
    this.repo?.cleanup(preserveOnFailure);
    this.mortDir?.cleanup(preserveOnFailure);
  }

  /**
   * Spawn the agent subprocess and collect its output via socket-based IPC.
   */
  private async spawnAgent(opts: AgentTestOptions): Promise<AgentRunOutput> {
    const currentDir = dirname(fileURLToPath(import.meta.url));
    const runnerPath = join(currentDir, "..", this.runnerConfig.runnerPath);
    const repoCwd = opts.cwd ?? this.repo?.path ?? process.cwd();

    // Generate threadId FIRST so it's consistent between harness and runner
    const threadId = opts.threadId ?? randomUUID();
    const optsWithThreadId = { ...opts, threadId };

    const cliArgs = this.runnerConfig.buildArgs(
      optsWithThreadId,
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

    // Create and start MockHubServer with unique socket path
    const socketPath = join(this.mortDir!.path, `test-hub-${threadId}.sock`);
    this.mockHub = new MockHubServer(socketPath);
    await this.mockHub.start();

    return new Promise((resolve, reject) => {
      const proc = spawn("tsx", args, {
        env: {
          ...process.env,
          ...this.runnerConfig.env,
          ...opts.env,
          MORT_HUB_SOCKET_PATH: socketPath,
          // Strip CLAUDECODE to prevent "nested session" error on SDK v0.2.59+
          CLAUDECODE: undefined,
        },
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let killed = false;
      let timeoutId: NodeJS.Timeout | null = null;

      // Wait for agent to register, then schedule queued messages via socket
      const setupQueuedMessages = async () => {
        try {
          await this.mockHub!.waitForRegistration(threadId, timeout);

          // Schedule queued messages to be sent via socket
          if (opts.queuedMessages && opts.queuedMessages.length > 0) {
            for (const qm of opts.queuedMessages) {
              setTimeout(() => {
                if (!killed && this.mockHub) {
                  this.mockHub.sendQueuedMessage(threadId, qm.content);
                }
              }, qm.delayMs);
            }
          }
        } catch (err) {
          // Registration timeout - agent may have crashed early
          if (process.env.DEBUG) {
            process.stderr.write(`[agent harness] Registration failed: ${err}\n`);
          }
        }
      };
      setupQueuedMessages();

      // Set up timeout handling with graceful shutdown
      timeoutId = setTimeout(() => {
        if (!killed) {
          killed = true;
          proc.kill("SIGTERM");
          setTimeout(() => proc.kill("SIGKILL"), 5000);
        }
      }, timeout);

      const clearTimeoutHandler = () => {
        if (timeoutId) clearTimeout(timeoutId);
      };

      // Capture stderr for debugging
      proc.stderr.on("data", (data: Buffer) => {
        const text = data.toString();
        stderr += text;
        if (process.env.DEBUG) {
          process.stderr.write(`[agent stderr] ${text}`);
        }
      });

      // Parse stdout for debug output only (all protocol messages go via socket)
      const rl = createReadlineInterface({ input: proc.stdout });
      rl.on("line", (line) => {
        this.parseDebugOutput(line, logs);
      });

      proc.on("close", (code) => {
        clearTimeoutHandler();

        // Collect messages from MockHubServer
        if (this.mockHub) {
          const socketMessages = this.mockHub.getMessagesForThread(threadId);
          for (const msg of socketMessages) {
            if (msg.type === "state") {
              // StateMessage from socket includes state property
              const stateMsg = msg as unknown as { type: "state"; state: unknown };
              states.push({
                type: "state",
                state: stateMsg.state as AgentStateMessage["state"],
              });
            } else if (msg.type === "event") {
              // EventMessage from socket includes name and payload
              const eventMsg = msg as unknown as { type: "event"; name: string; payload: unknown };
              events.push({
                type: "event",
                name: eventMsg.name,
                payload: eventMsg.payload,
              } as AgentEventMessage);
            }
          }
        }

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
   * Parse debug output from stdout.
   * All protocol messages now go via socket; stdout is only for debug logs.
   */
  private parseDebugOutput(line: string, logs: AgentLogMessage[]): void {
    try {
      const msg = JSON.parse(line);
      if (msg.type === "log") {
        logs.push(msg as AgentLogMessage);
      } else if (process.env.DEBUG) {
        // Unexpected JSON message - log in debug mode
        process.stdout.write(`[agent stdout] Unexpected: ${line}\n`);
      }
    } catch {
      // Non-JSON output (e.g., raw console.log from dependencies)
      if (process.env.DEBUG) {
        process.stdout.write(`[agent stdout] ${line}\n`);
      }
    }
  }
}
