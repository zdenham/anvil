import { execFileSync } from "child_process";

export interface ChangedFile {
  path: string;
  operation: "create" | "modify" | "delete" | "rename";
}

/**
 * Detect the repository's default branch.
 *
 * Strategies (in order):
 * 1. Check remote origin's HEAD reference
 * 2. Check git config init.defaultBranch
 * 3. Check common branch names (main, master, develop, trunk)
 * 4. Fall back to current branch
 * 5. Ultimate fallback: "main"
 */
export function getDefaultBranch(cwd: string): string {
  // Strategy 1: Check remote origin's HEAD
  try {
    const ref = execFileSync(
      "git",
      ["symbolic-ref", "refs/remotes/origin/HEAD"],
      { cwd, encoding: "utf-8" }
    ).trim();
    const match = ref.match(/refs\/remotes\/origin\/(.+)$/);
    if (match) return match[1];
  } catch {
    // Remote HEAD not set, try next strategy
  }

  // Strategy 2: Check git config init.defaultBranch
  try {
    const configured = execFileSync(
      "git",
      ["config", "--get", "init.defaultBranch"],
      { cwd, encoding: "utf-8" }
    ).trim();
    if (configured) return configured;
  } catch {
    // Config not set, try next strategy
  }

  // Strategy 3: Check common branch names
  for (const candidate of ["main", "master", "develop", "trunk"]) {
    try {
      execFileSync(
        "git",
        ["show-ref", "--verify", "--quiet", `refs/heads/${candidate}`],
        { cwd }
      );
      return candidate;
    } catch {
      // Branch doesn't exist, try next
    }
  }

  // Strategy 4: Current branch as fallback
  try {
    const current = execFileSync("git", ["branch", "--show-current"], {
      cwd,
      encoding: "utf-8",
    }).trim();
    if (current) return current;
  } catch {
    // Unable to get current branch
  }

  // Strategy 5: Ultimate fallback
  return "main";
}

/**
 * Get the diff between a merge base and HEAD.
 * This is the preferred way to get diffs - merge base should come from settings.
 */
export function getDiff(cwd: string, mergeBase: string): string {
  return execFileSync("git", ["diff", mergeBase, "HEAD"], {
    cwd,
    encoding: "utf-8",
    maxBuffer: 10 * 1024 * 1024, // 10MB max
  });
}

/**
 * Get list of files changed since HEAD (working directory changes).
 * Uses `git status --porcelain` to detect all changed, added, and deleted files.
 */
export function getChangedFilesSinceHead(cwd: string): ChangedFile[] {
  try {
    const output = execFileSync("git", ["status", "--porcelain"], {
      cwd,
      encoding: "utf-8",
    });

    const files: ChangedFile[] = [];

    for (const line of output.split("\n")) {
      if (!line.trim()) continue;

      // git status --porcelain format: XY filename
      // X = index status, Y = working tree status
      const status = line.substring(0, 2);
      let path = line.substring(3);

      // Handle renamed files: "R  old -> new"
      if (status.startsWith("R")) {
        const parts = path.split(" -> ");
        path = parts[1] || path;
        files.push({ path, operation: "rename" });
        continue;
      }

      // Determine operation from status
      let operation: ChangedFile["operation"];
      if (status.includes("A") || status === "??") {
        operation = "create";
      } else if (status.includes("D")) {
        operation = "delete";
      } else {
        operation = "modify";
      }

      files.push({ path, operation });
    }

    return files;
  } catch {
    return [];
  }
}

/**
 * Get the current git branch name.
 */
export function getCurrentBranch(cwd: string): string {
  const output = execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
    cwd,
    encoding: "utf-8",
  });
  return output.trim();
}

/**
 * Check if the repository has uncommitted changes.
 */
export function hasUncommittedChanges(cwd: string): boolean {
  const output = execFileSync("git", ["status", "--porcelain"], {
    cwd,
    encoding: "utf-8",
  });
  return output.trim().length > 0;
}

/**
 * Checkout an existing branch.
 */
export function checkoutBranch(cwd: string, branchName: string): void {
  execFileSync("git", ["checkout", branchName], { cwd, stdio: "pipe" });
}

/**
 * Check if a branch exists.
 */
export function branchExists(cwd: string, branchName: string): boolean {
  try {
    execFileSync("git", ["rev-parse", "--verify", branchName], { cwd, stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}
