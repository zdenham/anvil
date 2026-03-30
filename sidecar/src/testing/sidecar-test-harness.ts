/**
 * Integration test harness for running real Claude CLI against an isolated sidecar.
 *
 * Starts an Express server with hook routes on an ephemeral port,
 * writes hooks.json, spawns `claude -p` with --plugin-dir, and
 * provides helpers to assert on state.json / events.jsonl.
 */

import express from "express";
import { createServer, type Server } from "node:http";
import { mkdirSync, rmSync, readFileSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { createHookRouter } from "../hooks/hook-handler.js";
import { buildHooksConfig } from "../hooks/hooks-writer.js";
import { EventBroadcaster } from "../push.js";
import type { SidecarLogger } from "../logger.js";
import type { LifecycleEvent } from "../hooks/event-writer.js";
import type { ThreadState } from "@core/types/events.js";

interface HarnessOptions {
  /** Timeout in ms for CLI to finish. Default: 60_000. */
  timeout?: number;
}

interface CliResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
}

function silentLogger(): SidecarLogger {
  return { info: () => {}, warn: () => {}, error: () => {} };
}

export class SidecarTestHarness {
  readonly dataDir: string;
  readonly hooksDir: string;
  readonly broadcaster = new EventBroadcaster();

  private server: Server | null = null;
  private port = 0;
  private threadId = "";

  constructor(private options: HarnessOptions = {}) {
    const id = `anvil-integration-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    this.dataDir = join(tmpdir(), id);
    this.hooksDir = join(this.dataDir, "hooks");
    mkdirSync(this.hooksDir, { recursive: true });
  }

  /** Start the sidecar server on an ephemeral port and write hooks.json. */
  async start(): Promise<void> {
    const app = express();
    app.use(
      "/hooks",
      createHookRouter({
        dataDir: this.dataDir,
        broadcaster: this.broadcaster,
        log: silentLogger(),
      }),
    );

    this.server = createServer(app);
    await new Promise<void>((resolve) => {
      this.server!.listen(0, "127.0.0.1", resolve);
    });

    const addr = this.server.address();
    if (!addr || typeof addr === "string") throw new Error("Server not listening");
    this.port = addr.port;

    this.writeHooksJson();
  }

  /** Spawn `claude -p` with the given prompt and return its output. */
  async runCli(prompt: string): Promise<{ threadId: string; result: CliResult }> {
    this.threadId = randomUUID();

    const child = spawn("claude", [
      "-p", prompt,
      "--plugin-dir", this.dataDir,
      "--permission-mode", "bypassPermissions",
    ], {
      env: {
        ...process.env,
        ANVIL_THREAD_ID: this.threadId,
        ANVIL_DATA_DIR: this.dataDir,
      },
      stdio: ["pipe", "pipe", "pipe"],
    });

    const result = await this.collectOutput(child);
    return { threadId: this.threadId, result };
  }

  /** Read state.json for the most recent thread. */
  readState(threadId?: string): ThreadState | null {
    const id = threadId ?? this.threadId;
    const statePath = join(this.dataDir, "threads", id, "state.json");
    if (!existsSync(statePath)) return null;
    return JSON.parse(readFileSync(statePath, "utf-8")) as ThreadState;
  }

  /** Read events.jsonl for the most recent thread. */
  readEvents(threadId?: string): LifecycleEvent[] {
    const id = threadId ?? this.threadId;
    const eventsPath = join(this.dataDir, "threads", id, "events.jsonl");
    if (!existsSync(eventsPath)) return [];
    return readFileSync(eventsPath, "utf-8")
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as LifecycleEvent);
  }

  /** Tear down the server and clean up temp directories. */
  async teardown(): Promise<void> {
    if (this.server) {
      await new Promise<void>((resolve, reject) => {
        this.server!.close((err) => (err ? reject(err) : resolve()));
      });
      this.server = null;
    }
    rmSync(this.dataDir, { recursive: true, force: true });
  }

  private writeHooksJson(): void {
    const baseUrl = `http://127.0.0.1:${this.port}`;
    const config = buildHooksConfig(baseUrl);
    writeFileSync(
      join(this.hooksDir, "hooks.json"),
      JSON.stringify({ hooks: config }, null, 2) + "\n",
    );
  }

  private collectOutput(child: ChildProcess): Promise<CliResult> {
    const timeout = this.options.timeout ?? 60_000;

    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      const errChunks: Buffer[] = [];

      child.stdout?.on("data", (d: Buffer) => chunks.push(d));
      child.stderr?.on("data", (d: Buffer) => errChunks.push(d));

      const timer = setTimeout(() => {
        child.kill("SIGTERM");
        reject(new Error(`claude CLI timed out after ${timeout}ms`));
      }, timeout);

      child.on("close", (code) => {
        clearTimeout(timer);
        resolve({
          stdout: Buffer.concat(chunks).toString("utf-8"),
          stderr: Buffer.concat(errChunks).toString("utf-8"),
          exitCode: code,
        });
      });

      child.on("error", (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });
  }
}
