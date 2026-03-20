/**
 * Shim: @tauri-apps/plugin-shell
 *
 * In web builds, shell commands should go through the sidecar WS API
 * (shell_exec / shell_spawn). This shim provides the type surface so
 * existing code compiles; calls will throw at runtime until migrated.
 */

import { logger } from "@/lib/logger-client";

class EventEmitter {
  private handlers = new Map<string, Set<(data: string) => void>>();

  on(event: string, handler: (data: string) => void): void {
    if (!this.handlers.has(event)) {
      this.handlers.set(event, new Set());
    }
    this.handlers.get(event)!.add(handler);
  }
}

export interface Child {
  pid: number;
  kill(): Promise<void>;
  write(data: string | Uint8Array): Promise<void>;
}

export class Command {
  readonly stdout = new EventEmitter();
  readonly stderr = new EventEmitter();

  private closeHandlers: Array<(data: { code: number; signal: number | null }) => void> = [];
  private errorHandlers: Array<(err: string) => void> = [];

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  static create(_program: string, _args?: string | string[], _options?: Record<string, unknown>): Command {
    logger.warn("[tauri-shim] Command.create() called in web build — not supported");
    return new Command();
  }

  on(event: "close", handler: (data: { code: number; signal: number | null }) => void): void;
  on(event: "error", handler: (err: string) => void): void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  on(event: string, handler: (...args: any[]) => void): void {
    if (event === "close") {
      this.closeHandlers.push(handler as (data: { code: number; signal: number | null }) => void);
    } else if (event === "error") {
      this.errorHandlers.push(handler as (err: string) => void);
    }
  }

  async spawn(): Promise<Child> {
    // Notify error handlers
    for (const handler of this.errorHandlers) {
      handler("Command.spawn() is not available in web build");
    }
    return { pid: 0, kill: async () => {}, write: async () => {} };
  }

  async execute(): Promise<{ code: number; stdout: string; stderr: string }> {
    return { code: 1, stdout: "", stderr: "Command.execute() is not available in web build" };
  }
}

/** Open a path or URL with the system default application */
export async function open(path: string): Promise<void> {
  // In web, fall back to window.open for URLs
  if (path.startsWith("http://") || path.startsWith("https://")) {
    window.open(path, "_blank", "noopener,noreferrer");
    return;
  }
  logger.warn("[tauri-shim] shell.open() called for non-URL path in web build:", path);
}
