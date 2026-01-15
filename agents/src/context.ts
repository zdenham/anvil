import { execFileSync } from "child_process";

interface EnvironmentContext {
  workingDirectory: string;
  isGitRepo: boolean;
  platform: string;
  osVersion: string;
  date: string;
}

interface GitContext {
  currentBranch: string;
  status: string;
  recentCommits: string;
}

interface TaskContext {
  taskId: string | null;
  parentTaskId?: string;
}

function checkIsGitRepo(cwd: string): boolean {
  try {
    execFileSync("git", ["rev-parse", "--git-dir"], { cwd, stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

function getOsVersion(): string {
  try {
    return execFileSync("uname", ["-rs"], { encoding: "utf-8" }).trim();
  } catch {
    return process.platform;
  }
}

export function buildEnvironmentContext(cwd: string): EnvironmentContext {
  const isGitRepo = checkIsGitRepo(cwd);

  return {
    workingDirectory: cwd,
    isGitRepo,
    platform: process.platform,
    osVersion: getOsVersion(),
    date: new Date().toISOString().split("T")[0],
  };
}

export function buildGitContext(cwd: string): GitContext | null {
  if (!checkIsGitRepo(cwd)) return null;

  try {
    const branch = execFileSync("git", ["branch", "--show-current"], {
      cwd,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();

    const status = execFileSync("git", ["status", "--short"], {
      cwd,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();

    const commits = execFileSync("git", ["log", "--oneline", "-5"], {
      cwd,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();

    return {
      currentBranch: branch,
      status: status || "(clean)",
      recentCommits: commits,
    };
  } catch {
    return null;
  }
}

export function formatSystemPromptContext(
  env: EnvironmentContext,
  git: GitContext | null,
  task: TaskContext
): string {
  let context = `<env>
Working directory: ${env.workingDirectory}
Is directory a git repo: ${env.isGitRepo ? "Yes" : "No"}
Platform: ${env.platform}
OS Version: ${env.osVersion}
Today's date: ${env.date}
Task ID: ${task.taskId ?? "none"}${task.parentTaskId ? `\nParent Task ID: ${task.parentTaskId}` : ""}
</env>`;

  if (git) {
    context += `

<git>
Current branch: ${git.currentBranch}
Status:
${git.status}

Recent commits:
${git.recentCommits}
</git>`;
  }

  return context;
}
