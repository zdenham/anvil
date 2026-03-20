/**
 * Git command execution helpers.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/** Run a git command in a directory, returning trimmed stdout. */
export async function git(
  cwd: string,
  gitArgs: string[],
): Promise<string> {
  const { stdout } = await execFileAsync("git", gitArgs, {
    cwd,
    maxBuffer: 50 * 1024 * 1024, // 50MB for large diffs
  });
  return stdout.trim();
}

/** Run a git command, returning null instead of throwing on failure. */
export async function gitSafe(
  cwd: string,
  gitArgs: string[],
): Promise<string | null> {
  try {
    return await git(cwd, gitArgs);
  } catch {
    return null;
  }
}
