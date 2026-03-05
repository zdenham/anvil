import ts from "typescript";
import { logger } from "../logger.js";
import type { ReplContext, ReplResult } from "./types.js";

const MAX_RESULT_SIZE = 50 * 1024;

const HEREDOC_PATTERN = /mort-repl\s+<<['"]?(\w+)['"]?\n([\s\S]*?)\n\1/;
const QUOTED_PATTERN = /mort-repl\s+["']([\s\S]*?)["']/;

/**
 * SDK interface compatible with both the stub and real MortReplSdk.
 */
export interface MortSdk {
  spawn: (opts: unknown) => Promise<string>;
  log: (msg: string) => void;
  context: Readonly<ReplContext>;
  logs: string[];
}

function createStubSdk(context: ReplContext): MortSdk {
  const logs: string[] = [];
  return {
    spawn: async () => {
      throw new Error("mort.spawn() not available — use /orchestrate skill first");
    },
    log: (msg: string) => {
      logs.push(msg);
      logger.info(`[mort-repl] ${msg}`);
    },
    context: { ...context },
    logs,
  };
}

/**
 * Parses mort-repl commands, transpiles TypeScript, and executes code
 * with an injected `mort` SDK object.
 */
export class MortReplRunner {
  /**
   * Extract code from a mort-repl Bash command.
   * Supports heredoc and quoted string formats.
   * Returns null if the command is not a mort-repl invocation.
   */
  extractCode(command: string): string | null {
    const trimmed = command.trimStart();
    if (!trimmed.startsWith("mort-repl")) {
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
   * Transpile TypeScript code to ESNext JavaScript using ts.transpileModule.
   * This strips type annotations while preserving async/await and other syntax.
   */
  transpile(code: string): string {
    const result = ts.transpileModule(code, {
      compilerOptions: {
        target: ts.ScriptTarget.ESNext,
        module: ts.ModuleKind.ESNext,
      },
    });
    return result.outputText;
  }

  /**
   * Execute code with an injected `mort` SDK object.
   * Accepts an optional sdk parameter so Phase 2 can inject a real SDK.
   */
  async execute(
    code: string,
    context: ReplContext,
    sdk?: MortSdk,
  ): Promise<ReplResult> {
    const start = performance.now();
    const mortSdk = sdk ?? createStubSdk(context);

    try {
      const transpiledCode = this.transpile(code);
      const value = await this.executeTranspiled(transpiledCode, mortSdk);
      return {
        success: true,
        value,
        logs: mortSdk.logs,
        durationMs: performance.now() - start,
      };
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : String(err);
      logger.error(`[mort-repl] execution error: ${errorMessage}`);
      return {
        success: false,
        value: undefined,
        logs: mortSdk.logs,
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
      parts.push(`mort-repl result:\n${serialized}`);
    } else {
      parts.push(`mort-repl error:\n${result.error ?? "Unknown error"}`);
    }

    if (result.logs.length > 0) {
      parts.push(`\n${result.logs.join("\n")}`);
    }

    const output = parts.join("\n");
    return this.truncate(output);
  }

  private async executeTranspiled(
    transpiledCode: string,
    sdk: MortSdk,
  ): Promise<unknown> {
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    const AsyncFunction = Object.getPrototypeOf(
      async function () {},
    ).constructor as new (
      ...args: string[]
    ) => (mort: MortSdk) => Promise<unknown>;

    const fn = new AsyncFunction("mort", transpiledCode);
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
