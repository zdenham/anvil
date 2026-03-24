import { transform } from "sucrase";
import { logger } from "../logger.js";
import type { ReplContext, ReplResult, ContextShortCircuit } from "./types.js";

const MAX_RESULT_SIZE = 50 * 1024;

const HEREDOC_PATTERN = /anvil-repl\s+<<['"]?(\w+)['"]?\n([\s\S]*?)\n\1/;
const QUOTED_PATTERN = /anvil-repl\s+["']([\s\S]*?)["']/;

/**
 * SDK interface compatible with both the stub and real AnvilReplSdk.
 */
export interface AnvilSdk {
  spawn: (options: { prompt: string; contextShortCircuit?: ContextShortCircuit; budgetCapUsd?: number }) => Promise<string>;
  setBudgetCap: (usd: number) => void;
  log: (msg: string) => void;
  context: Readonly<ReplContext>;
  logs: string[];
}

function createStubSdk(context: ReplContext): AnvilSdk {
  const logs: string[] = [];
  return {
    spawn: async () => {
      throw new Error("anvil.spawn() not available — use /orchestrate skill first");
    },
    setBudgetCap: () => {
      throw new Error("anvil.setBudgetCap() not available — use /orchestrate skill first");
    },
    log: (msg: string) => {
      logs.push(msg);
      logger.info(`[anvil-repl] ${msg}`);
    },
    context: { ...context },
    logs,
  };
}

/**
 * Parses anvil-repl commands, transpiles TypeScript, and executes code
 * with an injected `anvil` SDK object.
 */
export class AnvilReplRunner {
  /**
   * Extract code from an anvil-repl Bash command.
   * Supports heredoc and quoted string formats.
   * Returns null if the command is not an anvil-repl invocation.
   */
  extractCode(command: string): string | null {
    const trimmed = command.trimStart();
    if (!trimmed.startsWith("anvil-repl")) {
      return null;
    }

    const heredocMatch = trimmed.match(HEREDOC_PATTERN);
    if (heredocMatch) {
      return heredocMatch[2];
    }

    const quotedMatch = trimmed.match(QUOTED_PATTERN);
    if (quotedMatch) {
      return quotedMatch[1];
    }

    return null;
  }

  /**
   * Transpile TypeScript code to JavaScript using sucrase.
   * Strips type annotations while preserving async/await and other syntax.
   */
  transpile(code: string): string {
    const result = transform(code, {
      transforms: ["typescript"],
    });
    return result.code;
  }

  /**
   * Execute code with an injected `anvil` SDK object.
   * Accepts an optional sdk parameter so Phase 2 can inject a real SDK.
   */
  async execute(
    code: string,
    context: ReplContext,
    sdk?: AnvilSdk,
  ): Promise<ReplResult> {
    const start = performance.now();
    const anvilSdk = sdk ?? createStubSdk(context);

    try {
      const transpiledCode = this.transpile(code);
      const value = await this.executeTranspiled(transpiledCode, anvilSdk);
      return {
        success: true,
        value,
        logs: anvilSdk.logs,
        durationMs: performance.now() - start,
      };
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : String(err);
      logger.error(`[anvil-repl] execution error: ${errorMessage}`);
      return {
        success: false,
        value: undefined,
        logs: anvilSdk.logs,
        error: errorMessage,
        durationMs: performance.now() - start,
      };
    }
  }

  /**
   * Format a ReplResult into a string suitable for the deny reason.
   * Truncates to MAX_RESULT_SIZE to avoid oversized responses.
   */
  formatResult(result: ReplResult): string {
    const parts: string[] = [];

    if (result.success) {
      const serialized = this.serializeValue(result.value);
      parts.push(`anvil-repl result:\n${serialized}`);
    } else {
      parts.push(`anvil-repl error:\n${result.error ?? "Unknown error"}`);
    }

    if (result.logs.length > 0) {
      parts.push(`\n${result.logs.join("\n")}`);
    }

    const output = parts.join("\n");
    return this.truncate(output);
  }

  private async executeTranspiled(
    transpiledCode: string,
    sdk: AnvilSdk,
  ): Promise<unknown> {
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    const AsyncFunction = Object.getPrototypeOf(
      async function () {},
    ).constructor as new (
      ...args: string[]
    ) => (anvil: AnvilSdk) => Promise<unknown>;

    const fn = new AsyncFunction("anvil", transpiledCode);
    return fn(sdk);
  }

  private serializeValue(value: unknown): string {
    if (value === undefined) {
      return "undefined";
    }
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return String(value);
    }
  }

  private truncate(output: string): string {
    if (output.length <= MAX_RESULT_SIZE) {
      return output;
    }
    return output.slice(0, MAX_RESULT_SIZE) + "... [truncated]";
  }
}
