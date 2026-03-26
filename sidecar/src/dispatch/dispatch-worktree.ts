/**
 * Worktree command dispatch.
 * Handles all `worktree_*` commands.
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { extractArg, extractOptArg } from "../helpers.js";
import { repositoriesDirPath } from "./paths.js";
import { git, gitSafe } from "./git-helpers.js";

interface WorktreeState {
  id: string;
  path: string;
  name: string;
  createdAt: number | null;
  lastAccessedAt: number | null;
  currentBranch: string | null;
  isRenamed: boolean;
  isExternal: boolean;
  visualSettings: { parentId: string | null; sortKey: string | null } | null;
}

interface RepoSettings {
  sourcePath?: string;
  worktrees?: WorktreeState[];
  [key: string]: unknown;
}

export async function dispatchWorktree(
  cmd: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  switch (cmd) {
    case "worktree_create":
      return worktreeCreate(
        extractArg(args, "repoName"),
        extractArg(args, "name"),
      );

    case "worktree_delete":
      return worktreeDelete(
        extractArg(args, "repoName"),
        extractArg(args, "name"),
      );

    case "worktree_rename":
      return worktreeRename(
        extractArg(args, "repoName"),
        extractArg(args, "oldName"),
        extractArg(args, "newName"),
      );

    case "worktree_touch":
      return worktreeTouch(
        extractArg(args, "repoName"),
        extractArg(args, "worktreePath"),
      );

    case "worktree_sync":
      return worktreeSync(
        extractArg(args, "repoName"),
        extractOptArg(args, "markNewAsExternal"),
      );

    default:
      throw new Error(`unknown worktree command: ${cmd}`);
  }
}

function repoDir(repoName: string): string {
  return join(repositoriesDirPath(), repoName);
}

function settingsPath(repoName: string): string {
  return join(repoDir(repoName), "settings.json");
}

async function loadSettings(repoName: string): Promise<RepoSettings> {
  try {
    return JSON.parse(await readFile(settingsPath(repoName), "utf-8"));
  } catch {
    return {};
  }
}

async function saveSettings(
  repoName: string,
  settings: RepoSettings,
): Promise<void> {
  await mkdir(repoDir(repoName), { recursive: true });
  await writeFile(settingsPath(repoName), JSON.stringify(settings, null, 2));
}

async function worktreeCreate(
  repoName: string,
  name: string,
): Promise<WorktreeState> {
  if (!/^[\w-]+$/.test(name)) {
    throw new Error(`Invalid worktree name: ${name}`);
  }

  const settings = await loadSettings(repoName);
  const worktrees = settings.worktrees ?? [];
  if (worktrees.some((w) => w.name === name)) {
    throw new Error(`Worktree already exists: ${name}`);
  }

  const sourcePath = settings.sourcePath;
  if (!sourcePath) throw new Error("No sourcePath in repo settings");

  // Fetch remote and get commit
  let commit: string | null = null;
  try {
    await git(sourcePath, ["fetch", "origin"]);
    const defaultBranch = await getDefaultBranch(sourcePath);
    commit = await gitSafe(sourcePath, [
      "rev-parse",
      `origin/${defaultBranch}`,
    ]);
  } catch {
    // Fall back to detached HEAD
  }

  const worktreePath = join(repoDir(repoName), "worktrees", name);
  const gitArgs = ["worktree", "add", "--detach", worktreePath];
  if (commit) gitArgs.push(commit);
  await git(sourcePath, gitArgs);

  const now = Date.now();
  const entry: WorktreeState = {
    id: randomUUID(),
    path: worktreePath,
    name,
    createdAt: now,
    lastAccessedAt: now,
    currentBranch: null,
    isRenamed: false,
    isExternal: false,
    visualSettings: null,
  };

  worktrees.push(entry);
  settings.worktrees = worktrees;
  await saveSettings(repoName, settings);
  return entry;
}

async function worktreeDelete(
  repoName: string,
  name: string,
): Promise<null> {
  const settings = await loadSettings(repoName);
  const worktrees = settings.worktrees ?? [];
  const idx = worktrees.findIndex((w) => w.name === name);
  if (idx < 0) throw new Error(`Worktree not found: ${name}`);

  const sourcePath = settings.sourcePath;
  if (sourcePath) {
    await gitSafe(sourcePath, [
      "worktree",
      "remove",
      "--force",
      worktrees[idx].path,
    ]);
  }

  worktrees.splice(idx, 1);
  settings.worktrees = worktrees;
  await saveSettings(repoName, settings);
  return null;
}

async function worktreeRename(
  repoName: string,
  oldName: string,
  newName: string,
): Promise<null> {
  const settings = await loadSettings(repoName);
  const worktrees = settings.worktrees ?? [];
  // Try by ID first, then by name
  let wt = worktrees.find((w) => w.id === oldName);
  if (!wt) wt = worktrees.find((w) => w.name === oldName);
  if (!wt) throw new Error(`Worktree not found: ${oldName}`);

  wt.name = newName;
  wt.isRenamed = true;

  // Try to rename git branch (non-fatal)
  await gitSafe(wt.path, ["branch", "-m", oldName, newName]);

  settings.worktrees = worktrees;
  await saveSettings(repoName, settings);
  return null;
}

async function worktreeTouch(
  repoName: string,
  worktreePath: string,
): Promise<null> {
  const settings = await loadSettings(repoName);
  const worktrees = settings.worktrees ?? [];
  const wt = worktrees.find((w) => w.path === worktreePath);
  if (wt) {
    wt.lastAccessedAt = Date.now();
    settings.worktrees = worktrees;
    await saveSettings(repoName, settings);
  }
  return null;
}

async function worktreeSync(
  repoName: string,
  markNewAsExternal?: boolean,
): Promise<WorktreeState[]> {
  const settings = await loadSettings(repoName);
  const sourcePath = settings.sourcePath;
  if (!sourcePath) throw new Error("No sourcePath in repo settings");

  await gitSafe(sourcePath, ["worktree", "prune"]);

  // Get git worktrees
  const output = await git(sourcePath, [
    "worktree",
    "list",
    "--porcelain",
  ]);
  const gitWorktrees: { path: string; branch: string | null }[] = [];
  let current: { path: string; branch: string | null } | null = null;

  for (const line of output.split("\n")) {
    if (line.startsWith("worktree ")) {
      if (current) gitWorktrees.push(current);
      current = { path: line.slice(9), branch: null };
    } else if (line.startsWith("branch ") && current) {
      current.branch = line.slice(7).replace("refs/heads/", "");
    } else if (line === "" && current) {
      gitWorktrees.push(current);
      current = null;
    }
  }
  if (current) gitWorktrees.push(current);

  const existingWorktrees = settings.worktrees ?? [];
  const pathSet = new Set(gitWorktrees.map((g) => g.path));

  // Remove entries that no longer exist
  const filtered = existingWorktrees.filter((w) => pathSet.has(w.path));

  // Add new git worktrees not in settings
  const existingPaths = new Set(filtered.map((w) => w.path));
  for (const gw of gitWorktrees) {
    if (!existingPaths.has(gw.path)) {
      filtered.push({
        id: randomUUID(),
        path: gw.path,
        name: gw.path === sourcePath ? "main" : gw.path.split("/").pop() ?? "unknown",
        createdAt: Date.now(),
        lastAccessedAt: null,
        currentBranch: gw.branch,
        isRenamed: false,
        isExternal: markNewAsExternal ?? false,
        visualSettings: null,
      });
    }
  }

  // Update branch info
  const branchMap = new Map(gitWorktrees.map((g) => [g.path, g.branch]));
  for (const wt of filtered) {
    wt.currentBranch = branchMap.get(wt.path) ?? wt.currentBranch;
  }

  filtered.sort(
    (a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0),
  );

  settings.worktrees = filtered;
  await saveSettings(repoName, settings);
  return filtered;
}

async function getDefaultBranch(repoPath: string): Promise<string> {
  const ref = await gitSafe(repoPath, [
    "symbolic-ref",
    "refs/remotes/origin/HEAD",
  ]);
  if (ref) {
    const branch = ref.replace("refs/remotes/origin/", "");
    if (branch && branch !== ref) return branch;
  }
  return "main";
}
