/**
 * Git command dispatch.
 * Handles all `git_*` commands.
 */

import { extractArg, extractOptArg } from "../helpers.js";
import { git, gitSafe } from "./git-helpers.js";

export async function dispatchGit(
  cmd: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  switch (cmd) {
    case "git_list_anvil_branches":
      return listAnvilBranches(extractArg(args, "repoPath"));

    case "git_diff_uncommitted":
      return diffUncommitted(extractArg(args, "workingDirectory"));

    case "git_fetch":
      return gitFetch(
        extractArg(args, "repoPath"),
        extractOptArg(args, "remote"),
      );

    case "git_get_default_branch":
      return getDefaultBranch(extractArg(args, "repoPath"));

    case "git_get_branch_commit":
      return git(extractArg(args, "repoPath"), [
        "rev-parse",
        extractArg(args, "branch"),
      ]);

    case "git_init":
      return gitInit(extractArg(args, "path"));

    case "git_create_branch":
      return gitCreateBranch(
        extractArg(args, "repoPath"),
        extractArg(args, "branchName"),
        extractArg(args, "baseBranch"),
      );

    case "git_checkout_branch":
      return git(extractArg(args, "worktreePath"), [
        "checkout",
        extractArg(args, "branch"),
      ]).then(() => null);

    case "git_checkout_commit":
      return git(extractArg(args, "worktreePath"), [
        "checkout",
        "--detach",
        extractArg(args, "commit"),
      ]).then(() => null);

    case "git_delete_branch":
      return git(extractArg(args, "repoPath"), [
        "branch",
        "-D",
        extractArg(args, "branch"),
      ]).then(() => null);

    case "git_branch_exists":
      return gitBranchExists(
        extractArg(args, "repoPath"),
        extractArg(args, "branch"),
      );

    default:
      return dispatchGitPart2(cmd, args);
  }
}

async function dispatchGitPart2(
  cmd: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  switch (cmd) {
    case "git_create_worktree":
      return git(extractArg(args, "repoPath"), [
        "worktree",
        "add",
        "--detach",
        extractArg(args, "worktreePath"),
      ]).then(() => null);

    case "git_remove_worktree":
      return git(extractArg(args, "repoPath"), [
        "worktree",
        "remove",
        "--force",
        extractArg(args, "worktreePath"),
      ]).then(() => null);

    case "git_list_worktrees":
      return listWorktrees(extractArg(args, "repoPath"));

    case "git_ls_files":
      return git(extractArg(args, "repoPath"), ["ls-files"]).then(
        (s) => (s ? s.split("\n") : []),
      );

    case "git_ls_files_untracked":
      return git(extractArg(args, "repoPath"), [
        "ls-files",
        "--others",
        "--exclude-standard",
      ]).then((s) => (s ? s.split("\n") : []));

    case "git_get_head_commit":
      return git(extractArg(args, "repoPath"), ["rev-parse", "HEAD"]);

    case "git_diff_files":
      return gitDiffFiles(args);

    case "git_get_branch_commits":
      return gitGetBranchCommits(args);

    case "git_diff_commit":
      return gitDiffCommit(args);

    case "git_diff_range":
      return gitDiffRange(args);

    default:
      return dispatchGitPart3(cmd, args);
  }
}

async function dispatchGitPart3(
  cmd: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  switch (cmd) {
    case "git_get_merge_base":
      return git(extractArg(args, "workingDirectory"), [
        "merge-base",
        extractArg(args, "branchA"),
        extractArg(args, "branchB"),
      ]);

    case "git_get_remote_branch_commit":
      return git(extractArg(args, "workingDirectory"), [
        "rev-parse",
        `${extractArg<string>(args, "remote")}/${extractArg<string>(args, "branch")}`,
      ]);

    case "git_show_file":
      return git(extractArg(args, "cwd"), [
        "show",
        `${extractArg<string>(args, "gitRef")}:${extractArg<string>(args, "path")}`,
      ]);

    case "git_grep":
      return gitGrep(args);

    case "git_rm":
      return git(extractArg(args, "workingDirectory"), [
        "rm",
        "--force",
        extractArg(args, "filePath"),
      ]).then(() => null);

    default:
      throw new Error(`unknown git command: ${cmd}`);
  }
}

// ── Implementation helpers ─────────────────────────────────────────────

async function listAnvilBranches(repoPath: string): Promise<string[]> {
  const output = await gitSafe(repoPath, ["branch", "--list", "anvil/*"]);
  if (!output) return [];
  return output
    .split("\n")
    .map((b) => b.trim().replace(/^\* /, ""))
    .filter(Boolean);
}

async function diffUncommitted(cwd: string): Promise<string> {
  const tracked = await gitSafe(cwd, ["diff", "HEAD"]);
  const untracked = await gitSafe(cwd, [
    "ls-files",
    "--others",
    "--exclude-standard",
  ]);
  let result = tracked ?? "";

  if (untracked) {
    const { readFile } = await import("node:fs/promises");
    for (const file of untracked.split("\n").filter(Boolean)) {
      try {
        const content = await readFile(`${cwd}/${file}`, "utf-8");
        const lines = content.split("\n");
        const patch = lines.map((l) => `+${l}`).join("\n");
        result += `\ndiff --git a/${file} b/${file}\nnew file mode 100644\n--- /dev/null\n+++ b/${file}\n@@ -0,0 +1,${lines.length} @@\n${patch}\n`;
      } catch {
        // Skip binary or unreadable files
      }
    }
  }
  return result;
}

async function gitFetch(
  repoPath: string,
  remote?: string,
): Promise<null> {
  await git(repoPath, ["fetch", remote ?? "origin"]);
  return null;
}

async function getDefaultBranch(repoPath: string): Promise<string> {
  // Strategy 1: refs/remotes/origin/HEAD
  const ref = await gitSafe(repoPath, [
    "symbolic-ref",
    "refs/remotes/origin/HEAD",
  ]);
  if (ref) {
    const branch = ref.replace("refs/remotes/origin/", "");
    if (branch && branch !== ref) return branch;
  }

  // Strategy 2: git config init.defaultBranch
  const configured = await gitSafe(repoPath, [
    "config",
    "init.defaultBranch",
  ]);
  if (configured) return configured;

  // Strategy 3: Test common names
  for (const name of ["main", "master", "develop", "trunk"]) {
    const exists = await gitBranchExists(repoPath, name);
    if (exists) return name;
  }

  // Strategy 4: current branch
  const current = await gitSafe(repoPath, [
    "branch",
    "--show-current",
  ]);
  if (current) return current;

  return "main";
}

async function gitInit(path: string): Promise<null> {
  const { mkdir } = await import("node:fs/promises");
  await mkdir(path, { recursive: true });
  await git(path, ["init"]);
  return null;
}

async function gitCreateBranch(
  repoPath: string,
  branchName: string,
  baseBranch: string,
): Promise<null> {
  const exists = await gitBranchExists(repoPath, branchName);
  if (exists) throw new Error(`Branch already exists: ${branchName}`);
  await git(repoPath, ["branch", branchName, baseBranch]);
  return null;
}

async function gitBranchExists(
  repoPath: string,
  branch: string,
): Promise<boolean> {
  const result = await gitSafe(repoPath, [
    "show-ref",
    "--verify",
    "--quiet",
    `refs/heads/${branch}`,
  ]);
  return result !== null;
}

interface WorktreeInfo {
  path: string;
  branch: string | null;
  isBare: boolean;
}

async function listWorktrees(repoPath: string): Promise<WorktreeInfo[]> {
  const output = await git(repoPath, ["worktree", "list", "--porcelain"]);
  const worktrees: WorktreeInfo[] = [];
  let current: Partial<WorktreeInfo> = {};

  for (const line of output.split("\n")) {
    if (line.startsWith("worktree ")) {
      if (current.path) worktrees.push(current as WorktreeInfo);
      current = { path: line.slice(9), branch: null, isBare: false };
    } else if (line.startsWith("branch ")) {
      current.branch = line.slice(7).replace("refs/heads/", "");
    } else if (line === "bare") {
      current.isBare = true;
    } else if (line === "" && current.path) {
      worktrees.push(current as WorktreeInfo);
      current = {};
    }
  }
  if (current.path) worktrees.push(current as WorktreeInfo);
  return worktrees;
}

async function gitDiffFiles(
  args: Record<string, unknown>,
): Promise<string> {
  const repoPath = extractArg<string>(args, "repoPath");
  const baseCommit = extractArg<string>(args, "baseCommit");
  const filePaths =
    extractOptArg<string[]>(args, "filePaths") ?? [];

  const gitArgs = ["diff", baseCommit, "--"];
  gitArgs.push(...filePaths);
  return git(repoPath, gitArgs);
}

interface GitCommit {
  hash: string;
  shortHash: string;
  message: string;
  author: string;
  authorEmail: string;
  date: string;
  relativeDate: string;
}

async function gitGetBranchCommits(
  args: Record<string, unknown>,
): Promise<GitCommit[]> {
  const cwd = extractArg<string>(args, "workingDirectory");
  const branch = extractArg<string>(args, "branchName");
  const limit = extractOptArg<number>(args, "limit") ?? 50;

  const format = "%H%x00%h%x00%s%x00%an%x00%ae%x00%aI%x00%ar";
  const output = await git(cwd, [
    "log",
    "--first-parent",
    `--format=${format}`,
    branch,
    `-n`,
    String(limit),
  ]);

  if (!output) return [];
  return output.split("\n").map((line) => {
    const [hash, shortHash, message, author, authorEmail, date, relativeDate] =
      line.split("\0");
    return { hash, shortHash, message, author, authorEmail, date, relativeDate };
  });
}

async function gitDiffCommit(
  args: Record<string, unknown>,
): Promise<string> {
  const cwd = extractArg<string>(args, "workingDirectory");
  const commitHash = extractArg<string>(args, "commitHash");

  // Try parent diff first
  const result = await gitSafe(cwd, [
    "diff",
    `${commitHash}^..${commitHash}`,
  ]);
  if (result !== null) return result;

  // Root commit fallback
  return git(cwd, ["show", "--format=", commitHash]);
}

async function gitDiffRange(
  args: Record<string, unknown>,
): Promise<string> {
  const cwd = extractArg<string>(args, "workingDirectory");
  const baseCommit = extractArg<string>(args, "baseCommit");
  return git(cwd, ["diff", baseCommit]);
}

interface GrepMatch {
  filePath: string;
  lineNumber: number;
  lineContent: string;
}

async function gitGrep(
  args: Record<string, unknown>,
): Promise<{ matches: GrepMatch[]; truncated: boolean }> {
  const repoPath = extractArg<string>(args, "repoPath");
  const query = extractArg<string>(args, "query");
  const maxResults = extractOptArg<number>(args, "maxResults") ?? 5000;
  const caseSensitive =
    extractOptArg<boolean>(args, "caseSensitive") ?? true;

  const gitArgs = ["grep", "-n", "-F"];
  if (!caseSensitive) gitArgs.push("-i");
  gitArgs.push(query);

  const output = await gitSafe(repoPath, gitArgs);
  if (!output) return { matches: [], truncated: false };

  const lines = output.split("\n").filter(Boolean);
  const truncated = lines.length > maxResults;
  const matches = lines.slice(0, maxResults).map((line) => {
    const firstColon = line.indexOf(":");
    const secondColon = line.indexOf(":", firstColon + 1);
    return {
      filePath: line.slice(0, firstColon),
      lineNumber: parseInt(line.slice(firstColon + 1, secondColon), 10),
      lineContent: line.slice(secondColon + 1),
    };
  });

  return { matches, truncated };
}
