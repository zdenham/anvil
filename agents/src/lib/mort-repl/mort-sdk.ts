import { logger } from "../logger.js";
import type { ChildSpawner } from "./child-spawner.js";
import type { ReplContext, ContextShortCircuit } from "./types.js";

/**
 * SDK object injected into mort-repl user code as `mort`.
 *
 * Provides a clean API surface for REPL scripts to spawn child agents
 * and log messages. The spawner handles all the heavy lifting (disk
 * thread creation, process management, result extraction).
 */
export class MortReplSdk {
  private spawner: ChildSpawner;
  private _context: ReplContext;
  private _logs: string[] = [];

  constructor(spawner: ChildSpawner, context: ReplContext) {
    this.spawner = spawner;
    this._context = context;
  }

  /**
   * Spawn a child agent process and return its last assistant message.
   * Blocks until the child completes.
   */
  async spawn(options: { prompt: string; contextShortCircuit?: ContextShortCircuit }): Promise<string> {
    if (!options?.prompt) {
      throw new Error("mort.spawn() requires a prompt");
    }
    return this.spawner.spawn({
      prompt: options.prompt,
      contextShortCircuit: options.contextShortCircuit,
    });
  }

  /** Log a message (captured in REPL result and sent to agent logger). */
  log(message: string): void {
    this._logs.push(message);
    logger.info(`[mort-repl] ${message}`);
  }

  /** Read-only snapshot of the current REPL context. */
  get context(): Readonly<ReplContext> {
    return { ...this._context };
  }

  /** All log messages captured during this REPL execution. */
  get logs(): string[] {
    return [...this._logs];
  }
}
