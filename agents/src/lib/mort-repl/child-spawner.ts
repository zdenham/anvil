import { spawn as spawnProcess } from "child_process";
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "fs";
import { join } from "path";
import crypto from "crypto";
import { runnerPath } from "../../runner.js";
import { EventName } from "@core/types/events.js";
import { generateThreadName } from "../../services/thread-naming-service.js";
import { isOverBudget, rollUpCostToParent } from "./budget.js";
import { logger } from "../logger.js";
import type { ReplContext, SpawnOptions } from "./types.js";

interface ChildSpawnerDeps {
  context: ReplContext;
  emitEvent: (name: string, payload: Record<string, unknown>, source?: string) => void;
  /** The Bash call's tool_use_id -- used for UI mapping */
  parentToolUseId: string;
}

/**
 * Spawns child agent processes for anvil-repl.
 *
 * Reuses the same thread-on-disk pattern as PreToolUse:Task in shared.ts:
 * create metadata + state on disk, emit thread:created, spawn runner process,
 * wait for exit, read result from state.json.
 */
export class ChildSpawner {
  private context: ReplContext;
  private emitEvent: ChildSpawnerDeps["emitEvent"];
  private parentToolUseId: string;
  private activeChildren = new Map<number, { threadId: string; threadPath: string }>();

  constructor(deps: ChildSpawnerDeps) {
    this.context = deps.context;
    this.emitEvent = deps.emitEvent;
    this.parentToolUseId = deps.parentToolUseId;

    // Register cleanup on process exit -- piggybacks on runner's SIGTERM/SIGINT
    // handlers which call process.exit(), triggering this listener
    process.on("exit", () => {
      for (const pid of this.activeChildren.keys()) {
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
    for (const pid of this.activeChildren.keys()) {
      try {
        process.kill(pid, "SIGTERM");
      } catch {
        /* already exited */
      }
    }
    this.activeChildren.clear();
  }

  /**
   * Persist cancelled status and emit events for all active children.
   * Called during parent cancellation BEFORE hub disconnect so events reach the frontend.
   * No explicit SIGTERM needed — children inherit the process group signal from the OS.
   */
  cancelAll(): void {
    for (const [_, { threadId, threadPath }] of this.activeChildren) {
      // Write cancelled status to disk (source of truth for next app refresh)
      try {
        const metadataPath = join(threadPath, "metadata.json");
        if (existsSync(metadataPath)) {
          const metadata = JSON.parse(readFileSync(metadataPath, "utf-8"));
          metadata.status = "cancelled";
          metadata.updatedAt = Date.now();
          writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));
        }
      } catch (err) {
        logger.warn(`[anvil-repl] Failed to write cancelled status for ${threadId}: ${err}`);
      }

      // Emit events so frontend updates immediately
      this.emitEvent(
        EventName.THREAD_STATUS_CHANGED,
        { threadId, status: "cancelled" },
        "anvil-repl:child-cancel",
      );
      this.emitEvent(
        EventName.AGENT_COMPLETED,
        { threadId, exitCode: 130 },
        "anvil-repl:child-cancel",
      );

      logger.info(`[anvil-repl] Cancelled child ${threadId}`);
    }
    this.activeChildren.clear();
  }

  /** Spawn a child agent process and return its last assistant message text. */
  async spawn(options: SpawnOptions): Promise<string> {
    const budgetCheck = isOverBudget(this.context.threadId, this.context.anvilDir);
    if (budgetCheck.overBudget) {
      throw new Error(
        `Budget exceeded: thread ${budgetCheck.budgetThreadId} ` +
        `has spent $${budgetCheck.spentUsd?.toFixed(2)} of ` +
        `$${budgetCheck.capUsd?.toFixed(2)} budget cap`
      );
    }

    const childThreadId = crypto.randomUUID();
    const childThreadPath = join(this.context.anvilDir, "threads", childThreadId);

    this.createThreadOnDisk(childThreadId, childThreadPath, options);
    this.emitThreadCreated(childThreadId);
    this.fireAndForgetNaming(childThreadId, childThreadPath, options.prompt);

    const child = this.spawnProcess(childThreadId, options);

    if (child.pid) {
      this.activeChildren.set(child.pid, { threadId: childThreadId, threadPath: childThreadPath });
    }

    return this.waitForResult(child, childThreadId, childThreadPath, options.timeoutMs);
  }

  /** Create metadata.json and state.json on disk for the child thread. */
  private createThreadOnDisk(
    childThreadId: string,
    childThreadPath: string,
    options: SpawnOptions,
  ): void {
    const now = Date.now();
    const agentType = "general-purpose";
    const permissionMode = this.context.permissionModeId;

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
      ...(options.budgetCapUsd ? { budgetCapUsd: options.budgetCapUsd } : {}),
      visualSettings: {
        parentId: this.context.threadId,
      },
    };

    mkdirSync(childThreadPath, { recursive: true });
    writeFileSync(
      join(childThreadPath, "metadata.json"),
      JSON.stringify(childMetadata, null, 2),
    );

    const initialState = {
      messages: [{ role: "user", content: [{ type: "text", text: options.prompt }] }],
      fileChanges: [],
      workingDirectory: this.context.workingDir,
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
        source: "anvil-repl:child-spawn",
      },
      "anvil-repl:child-spawn",
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
          "anvil-repl:name",
        );
      })
      .catch((err) => logger.warn(`[anvil-repl] Failed to generate name: ${err}`));
  }

  /** Spawn the child runner process with the appropriate CLI args. */
  private spawnProcess(
    childThreadId: string,
    options: SpawnOptions,
  ): ReturnType<typeof spawnProcess> {
    // Use tsx when runnerPath is a .ts file (e.g. test context via tsx)
    const executable = runnerPath.endsWith(".ts") ? "tsx" : "node";

    const args = [
      runnerPath,
      "--thread-id", childThreadId,
      "--parent-id", this.context.threadId,
      "--repo-id", this.context.repoId,
      "--worktree-id", this.context.worktreeId,
      "--cwd", this.context.workingDir,
      "--prompt", options.prompt,
      "--anvil-dir", this.context.anvilDir,
      "--parent-thread-id", this.context.threadId,
      "--permission-mode", this.context.permissionModeId,
      "--skip-naming",
    ];

    if (options.contextShortCircuit) {
      args.push("--context-short-circuit", JSON.stringify(options.contextShortCircuit));
    }

    return spawnProcess(
      executable,
      args,
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
    timeoutMs: number = 600_000,
  ): Promise<string> {
    const startTime = Date.now();

    const exitCode = await new Promise<number>((resolve) => {
      const timer = setTimeout(() => {
        logger.warn(`[anvil-repl] Child ${childThreadId} timed out after ${timeoutMs}ms, killing`);
        try { process.kill(child.pid!, "SIGTERM"); } catch { /* already exited */ }
        setTimeout(() => {
          try { process.kill(child.pid!, "SIGKILL"); } catch { /* already exited */ }
        }, 5000);
      }, timeoutMs);

      child.on("exit", (code) => { clearTimeout(timer); resolve(code ?? 1); });
      child.on("error", (err) => {
        clearTimeout(timer);
        logger.error(`[anvil-repl] Child process error: ${err}`);
        resolve(1);
      });
    });

    if (child.pid) {
      this.activeChildren.delete(child.pid);
    }

    const durationMs = Date.now() - startTime;
    const resultText = this.readChildResult(childThreadPath, childThreadId);

    // Determine final status from exit code
    const status = exitCode === 130 ? "cancelled" : exitCode === 0 ? "completed" : "error";

    // Emit events from parent process (child's events may be lost on socket close)
    this.emitEvent(
      EventName.THREAD_STATUS_CHANGED,
      { threadId: childThreadId, status },
      "anvil-repl:child-complete",
    );
    // Read child's cost from metadata (written by child's complete() in output.ts)
    const childCostUsd = this.readChildCostFromMetadata(childThreadPath);

    this.emitEvent(
      EventName.AGENT_COMPLETED,
      { threadId: childThreadId, exitCode, costUsd: childCostUsd },
      "anvil-repl:child-complete",
    );

    // Roll up child's tree cost to parent metadata
    this.rollUpChildCost(childThreadPath);

    logger.info(
      `[anvil-repl] Child ${childThreadId} exited with code ${exitCode} in ${durationMs}ms`,
    );

    return resultText;
  }

  /** Read the child's totalCostUsd from its metadata.json. */
  private readChildCostFromMetadata(childThreadPath: string): number | undefined {
    try {
      const metadataPath = join(childThreadPath, "metadata.json");
      if (!existsSync(metadataPath)) return undefined;
      const metadata = JSON.parse(readFileSync(metadataPath, "utf-8"));
      return metadata.totalCostUsd;
    } catch {
      return undefined;
    }
  }

  /** Roll up the child's total tree cost to the parent's cumulativeCostUsd. */
  private rollUpChildCost(childThreadPath: string): void {
    try {
      const metadataPath = join(childThreadPath, "metadata.json");
      if (!existsSync(metadataPath)) return;
      const childMeta = JSON.parse(readFileSync(metadataPath, "utf-8"));
      const childTreeCost = (childMeta.totalCostUsd ?? 0) + (childMeta.cumulativeCostUsd ?? 0);
      if (childTreeCost <= 0) return;

      rollUpCostToParent(this.context.anvilDir, this.context.threadId, childTreeCost);
    } catch (err) {
      logger.warn(`[anvil-repl] Failed to roll up child cost: ${err}`);
    }
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
      logger.warn(`[anvil-repl] Failed to read child state: ${err}`);
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
