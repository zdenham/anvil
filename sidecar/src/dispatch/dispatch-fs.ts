/**
 * Filesystem command dispatch.
 * Handles all `fs_*` commands.
 */

import {
  readFile,
  writeFile,
  mkdir,
  rm,
  rename,
  stat,
  readdir,
  cp,
  copyFile,
} from "node:fs/promises";
import { existsSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";
import { extractArg } from "../helpers.js";
import { dataDirPath, homeDirPath } from "./paths.js";
import type { SidecarState } from "../state.js";

const execFileAsync = promisify(execFile);

interface DirEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  isFile: boolean;
}

export async function dispatchFs(
  cmd: string,
  args: Record<string, unknown>,
  _state: SidecarState,
): Promise<unknown> {
  switch (cmd) {
    case "fs_read_file":
      return readFile(extractArg<string>(args, "path"), "utf-8");

    case "fs_exists":
      return existsSync(extractArg<string>(args, "path"));

    case "fs_list_dir":
      return listDir(extractArg<string>(args, "path"));

    case "fs_write_file": {
      const path = extractArg<string>(args, "path");
      await mkdir(join(path, ".."), { recursive: true });
      await writeFile(path, extractArg<string>(args, "contents"));
      return null;
    }

    case "fs_mkdir":
      await mkdir(extractArg<string>(args, "path"), { recursive: true });
      return null;

    case "fs_remove":
      await rm(extractArg<string>(args, "path"), { force: true });
      return null;

    case "fs_remove_dir_all":
      await rm(extractArg<string>(args, "path"), {
        recursive: true,
        force: true,
      });
      return null;

    case "fs_move":
      await rename(
        extractArg<string>(args, "from"),
        extractArg<string>(args, "to"),
      );
      return null;

    case "fs_copy_file":
      await copyFile(
        extractArg<string>(args, "from"),
        extractArg<string>(args, "to"),
      );
      return null;

    case "fs_copy_directory":
      await cp(
        extractArg<string>(args, "from"),
        extractArg<string>(args, "to"),
        { recursive: true },
      );
      return null;

    case "fs_is_git_repo":
      return isGitRepo(extractArg<string>(args, "path"));

    case "fs_git_worktree_add":
      return fsGitWorktreeAdd(
        extractArg<string>(args, "repoPath"),
        extractArg<string>(args, "worktreePath"),
      );

    case "fs_git_worktree_remove":
      return fsGitWorktreeRemove(
        extractArg<string>(args, "repoPath"),
        extractArg<string>(args, "worktreePath"),
      );

    case "fs_grep":
      return fsGrep(
        extractArg<string>(args, "dir"),
        extractArg<string>(args, "pattern"),
        extractArg<string>(args, "fileGlob"),
      );

    case "fs_write_binary": {
      const path = extractArg<string>(args, "path");
      const data = Buffer.from(
        extractArg<string>(args, "base64Data"),
        "base64",
      );
      await writeFile(path, data);
      return null;
    }

    case "fs_bulk_read":
      return bulkRead(extractArg<string[]>(args, "paths"));

    case "fs_get_repo_dir": {
      const repoName = extractArg<string>(args, "repoName");
      return join(dataDirPath(), "repositories", repoName);
    }

    case "fs_get_repo_source_path":
      return getRepoSourcePath(extractArg<string>(args, "repoName"));

    case "fs_get_home_dir":
      return homeDirPath();

    case "fs_list_dir_names":
      return listDirNames(extractArg<string>(args, "path"));

    default:
      throw new Error(`unknown fs command: ${cmd}`);
  }
}

async function listDir(path: string): Promise<DirEntry[]> {
  const entries = await readdir(path, { withFileTypes: true });
  return entries.map((e) => ({
    name: e.name,
    path: join(path, e.name),
    isDirectory: e.isDirectory(),
    isFile: e.isFile(),
  }));
}

function isGitRepo(path: string): boolean {
  return existsSync(join(path, ".git")) || existsSync(join(path, "HEAD"));
}

async function fsGitWorktreeAdd(
  repoPath: string,
  worktreePath: string,
): Promise<null> {
  await execFileAsync("git", ["worktree", "prune"], { cwd: repoPath });
  await execFileAsync(
    "git",
    ["worktree", "add", "--detach", "--force", worktreePath, "HEAD"],
    { cwd: repoPath },
  );
  return null;
}

async function fsGitWorktreeRemove(
  repoPath: string,
  worktreePath: string,
): Promise<null> {
  await execFileAsync(
    "git",
    ["worktree", "remove", "--force", worktreePath],
    { cwd: repoPath },
  );
  return null;
}

async function fsGrep(
  dir: string,
  pattern: string,
  fileGlob: string,
): Promise<{ path: string; line: string; lineNumber: number }[]> {
  const results: { path: string; line: string; lineNumber: number }[] = [];
  const regex = new RegExp(pattern);

  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const filePath = join(dir, entry.name, fileGlob);
    try {
      const content = await readFile(filePath, "utf-8");
      const lines = content.split("\n");
      for (let i = 0; i < lines.length; i++) {
        if (regex.test(lines[i])) {
          results.push({ path: filePath, line: lines[i], lineNumber: i + 1 });
        }
      }
    } catch {
      // File doesn't exist in this subdirectory — skip
    }
  }
  return results;
}

async function bulkRead(paths: string[]): Promise<(string | null)[]> {
  return Promise.all(
    paths.map(async (p) => {
      try {
        return await readFile(p, "utf-8");
      } catch {
        return null;
      }
    }),
  );
}

async function getRepoSourcePath(repoName: string): Promise<string> {
  const repoDir = join(dataDirPath(), "repositories", repoName);
  try {
    const settings = JSON.parse(
      await readFile(join(repoDir, "settings.json"), "utf-8"),
    );
    if (settings.sourcePath) return settings.sourcePath;
  } catch {
    // Try metadata.json fallback
  }
  try {
    const meta = JSON.parse(
      await readFile(join(repoDir, "metadata.json"), "utf-8"),
    );
    if (meta.sourcePath) return meta.sourcePath;
  } catch {
    // Neither file found
  }
  throw new Error(`Could not find sourcePath for repo: ${repoName}`);
}

async function listDirNames(path: string): Promise<string[]> {
  const entries = await readdir(path, { withFileTypes: true });
  return entries.map((e) => e.name);
}
