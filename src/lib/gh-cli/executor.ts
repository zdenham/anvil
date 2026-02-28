/**
 * Shell execution layer for gh CLI commands.
 * Uses Tauri shell plugin (Command.create) to run gh commands.
 */

import { invoke } from "@tauri-apps/api/core";
import { Command } from "@tauri-apps/plugin-shell";
import { logger } from "@/lib/logger-client";
import { classifyGhError } from "./errors";

export interface GhExecResult {
  stdout: string;
  stderr: string;
  code: number;
}

/**
 * Execute a gh CLI command and return the raw result.
 * Throws a classified GhCliError on non-zero exit codes.
 *
 * @param args - CLI arguments (e.g. ["pr", "view", "--json", "title"])
 * @param cwd - Working directory for the command
 */
export async function execGh(
  args: string[],
  cwd: string,
): Promise<GhExecResult> {
  logger.debug(`[GhCli] Executing: gh ${args.join(" ")}`, { cwd });

  const shellPath = await invoke<string>("get_shell_path");
  const command = Command.create("gh", args, {
    cwd,
    env: { PATH: shellPath },
  });
  const output = await command.execute();

  const result: GhExecResult = {
    stdout: output.stdout,
    stderr: output.stderr,
    code: output.code ?? 1,
  };

  if (result.code !== 0) {
    logger.warn(`[GhCli] Command failed: gh ${args.join(" ")}`, {
      code: result.code,
      stderr: result.stderr,
    });
    throw classifyGhError(result.stderr, result.code);
  }

  return result;
}

/**
 * Execute a gh CLI command and parse stdout as JSON.
 * Throws on non-zero exit codes or JSON parse failure.
 */
export async function execGhJson<T>(
  args: string[],
  cwd: string,
): Promise<T> {
  const result = await execGh(args, cwd);
  try {
    return JSON.parse(result.stdout) as T;
  } catch {
    throw new Error(
      `Failed to parse gh CLI JSON output for: gh ${args.join(" ")}`,
    );
  }
}
