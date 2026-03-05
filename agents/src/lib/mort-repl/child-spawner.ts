import { spawn as spawnProcess } from "child_process";
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "fs";
import { join } from "path";
import crypto from "crypto";
import { runnerPath } from "../../runner.js";
import { EventName } from "@core/types/events.js";
import { generateThreadName } from "../../services/thread-naming-service.js";
import { logger } from "../logger.js";
import type { ReplContext, SpawnOptions } from "./types.js";

interface ChildSpawnerDeps {
  context: ReplContext;
  emitEvent: (name: string, payload: Record<string, unknown>, source?: string) => void;
  /** The Bash call's tool_use_id -- used for UI mapping */
  parentToolUseId: string;
}

/**
 * Spawns child agent processes for mort-repl.
 *
 * Reuses the same thread-on-disk pattern as PreToolUse:Task in shared.ts:
 * create metadata + state on disk, emit thread:created, spawn runner process,
 * wait for exit, read result from state.json.
 */
export class ChildSpawner {
  private context: ReplContext;
  private emitEvent: ChildSpawnerDeps["emitEvent"];
  private parentToolUseId: string;
  private activePids = new Set<number>();

  constructor(deps: ChildSpawnerDeps) {
    this.context = deps.context;
    this.emitEvent = deps.emitEvent;
    this.parentToolUseId = deps.parentToolUseId;

    // Register cleanup on process exit -- piggybacks on runner's SIGTERM/SIGINT
    // handlers which call process.exit(), triggering this listener
    process.on("exit", () => {
      for (const pid of this.activePids) {
        try {
          process.kill(pid, "SIGTERM");
        } catch {
          /* already exited */
        }
      }
    });
  }

  /** Kill all currently-active children (used on REPL code error) */
  killAll(): void {
    for (const pid of this.activePids) {
      try {
        process.kill(pid, "SIGTERM");
      } catch {
        /* already exited */
      }
    }
    this.activePids.clear();
  }

  /** Spawn a child agent process and return its last assistant message text. */
  async spawn(options: SpawnOptions): Promise<string> {
    const childThreadId = crypto.randomUUID();
    const childThreadPath = join(this.context.mortDir, "threads", childThreadId);

    this.createThreadOnDisk(childThreadId, childThreadPath, options);
    this.emitThreadCreated(childThreadId);
    this.fireAndForgetNaming(childThreadId, childThreadPath, options.prompt);

    const child = this.spawnProcess(childThreadId, options);

    if (child.pid) {
      this.activePids.add(child.pid);
    }

    return this.waitForResult(child, childThreadId, childThreadPath);
  }

  /** Create metadata.json and state.json on disk for the child thread. */
  private createThreadOnDisk(
    childThreadId: string,
    childThreadPath: string,
    options: SpawnOptions,
  ): void {
    const now = Date.now();
    const agentType = options.agentType ?? "general-purpose";
    const permissionMode = options.permissionMode ?? this.context.permissionModeId;

    const childMetadata = {
      id: childThreadId,
      repoId: this.context.repoId,
      worktreeId: this.context.worktreeId,
      status: "running",
      turns: [{ index: 0, prompt: options.prompt, startedAt: now, completedAt: null }],
      isRead: true,
      name: `${agentType}: <pending>`,
      createdAt: now,
      updatedAt: now,
      parentThreadId: this.context.threadId,
      parentToolUseId: this.parentToolUseId,
      agentType,
      permissionMode,
    };

    mkdirSync(childThreadPath, { recursive: true });
    writeFileSync(
      join(childThreadPath, "metadata.json"),
      JSON.stringify(childMetadata, null, 2),
    );

    const initialState = {
      messages: [{ role: "user", content: [{ type: "text", text: options.prompt }] }],
      fileChanges: [],
      workingDirectory: options.cwd ?? this.context.workingDir,
      status: "running",
      timestamp: now,
      toolStates: {},
    };
    writeFileSync(
      join(childThreadPath, "state.json"),
      JSON.stringify(initialState, null, 2),
    );
  }

  /** Emit the thread:created event so the UI picks up the new child. */
  private emitThreadCreated(childThreadId: string): void {
    this.emitEvent(
      EventName.THREAD_CREATED,
      {
        threadId: childThreadId,
        repoId: this.context.repoId,
        worktreeId: this.context.worktreeId,
      },
      "mort-repl:child-spawn",
    );
  }

  /** Fire-and-forget thread naming (same pattern as shared.ts). */
  private fireAndForgetNaming(
    childThreadId: string,
    childThreadPath: string,
    prompt: string,
  ): void {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return;

    generateThreadName(prompt, apiKey)
      .then(({ name }) => {
        const metadataPath = join(childThreadPath, "metadata.json");
        if (!existsSync(metadataPath)) return;

        const metadata = JSON.parse(readFileSync(metadataPath, "utf-8"));
        metadata.name = name;
        metadata.updatedAt = Date.now();
        writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));

        this.emitEvent(
          EventName.THREAD_NAME_GENERATED,
          { threadId: childThreadId, name },
          "mort-repl:name",
        );
      })
      .catch((err) => logger.warn(`[mort-repl] Failed to generate name: ${err}`));
  }

  /** Spawn the child runner process with the appropriate CLI args. */
  private spawnProcess(
    childThreadId: string,
    options: SpawnOptions,
  ): ReturnType<typeof spawnProcess> {
    const permissionMode = options.permissionMode ?? this.context.permissionModeId;

    // Use tsx when runnerPath is a .ts file (e.g. test context via tsx)
    const executable = runnerPath.endsWith(".ts") ? "tsx" : "node";

    return spawnProcess(
      executable,
      [
        runnerPath,
        "--thread-id", childThreadId,
        "--repo-id", this.context.repoId,
        "--worktree-id", this.context.worktreeId,
        "--cwd", options.cwd ?? this.context.workingDir,
        "--prompt", options.prompt,
        "--mort-dir", this.context.mortDir,
        "--parent-id", this.context.threadId,
        "--permission-mode", permissionMode,
        "--skip-naming",
      ],
      {
        stdio: "pipe",
        env: { ...process.env },
        detached: false,
      },
    );
  }

  /** Wait for the child to exit, then read the last assistant message from state.json. */
  private async waitForResult(
    child: ReturnType<typeof spawnProcess>,
    childThreadId: string,
    childThreadPath: string,
  ): Promise<string> {
    const startTime = Date.now();

    const exitCode = await new Promise<number>((resolve) => {
      child.on("exit", (code) => resolve(code ?? 1));
      child.on("error", (err) => {
        logger.error(`[mort-repl] Child process error: ${err}`);
        resolve(1);
      });
    });

    if (child.pid) {
      this.activePids.delete(child.pid);
    }

    const durationMs = Date.now() - startTime;
    const resultText = this.readChildResult(childThreadPath, childThreadId);

    logger.info(
      `[mort-repl] Child ${childThreadId} exited with code ${exitCode} in ${durationMs}ms`,
    );

    return resultText;
  }

  /** Read the last assistant message text from a child thread's state.json. */
  private readChildResult(childThreadPath: string, childThreadId: string): string {
    const statePath = join(childThreadPath, "state.json");
    let resultText = "";

    if (!existsSync(statePath)) return resultText;

    try {
      const state = JSON.parse(readFileSync(statePath, "utf-8"));
      const lastAssistant = state.messages
        ?.filter((m: { role: string }) => m.role === "assistant")
        ?.pop();
      resultText =
        lastAssistant?.content
          ?.filter((c: { type: string }) => c.type === "text")
          ?.map((c: { text: string }) => c.text)
          ?.join("\n") ?? "";
    } catch (err) {
      logger.warn(`[mort-repl] Failed to read child state: ${err}`);
    }

    // Truncate to 50KB
    const MAX_RESULT_SIZE = 50 * 1024;
    if (resultText.length > MAX_RESULT_SIZE) {
      resultText =
        resultText.slice(0, MAX_RESULT_SIZE) +
        `\n... [truncated, full output in thread ${childThreadId}]`;
    }

    return resultText;
  }
}
