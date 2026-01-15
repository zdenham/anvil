import { execFileSync } from "child_process";

export interface ChangedFile {
  path: string;
  operation: "create" | "modify" | "delete" | "rename";
}

/**
 * Get the merge base commit for the current branch against main/master.
 * Returns the commit hash or undefined if not found.
 *
 * @deprecated Use workspace service to get merge base from settings instead.
 * This function is kept for backward compatibility with the runner fallback.
 */
export function getMergeBase(cwd: string): string | undefined {
  try {
    return execFileSync("git", ["merge-base", "main", "HEAD"], {
      cwd,
      encoding: "utf-8",
    }).trim();
  } catch {
    try {
      return execFileSync("git", ["merge-base", "master", "HEAD"], {
        cwd,
        encoding: "utf-8",
      }).trim();
    } catch {
      return undefined;
    }
  }
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
 * Create and checkout a task branch. If it already exists, just checkout.
 *
 * @deprecated Use workspace service to create branches via Tauri commands.
 * This function is kept for backward compatibility with the runner.
 */
export function createTaskBranch(cwd: string, branchName: string): void {
  try {
    // Check if branch exists
    execFileSync("git", ["show-ref", "--verify", "--quiet", `refs/heads/${branchName}`], { cwd });
    // Branch exists, checkout
    execFileSync("git", ["checkout", branchName], { cwd, stdio: "pipe" });
  } catch {
    // Branch doesn't exist, create and checkout
    execFileSync("git", ["checkout", "-b", branchName], { cwd, stdio: "pipe" });
  }
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
 * Generate a git diff of all changes made on the task branch.
 *
 * @param cwd - Working directory
 * @param taskBranch - The task branch name (used for merge base detection if not provided)
 * @param mergeBase - Optional pre-computed merge base (preferred). If not provided, computes it.
 */
export function generateTaskDiff(
  cwd: string,
  taskBranch: string,
  mergeBase?: string
): string | undefined {
  try {
    // Use provided merge base or compute one
    const base = mergeBase ?? computeMergeBase(cwd, taskBranch);
    if (!base) return undefined;

    return getDiff(cwd, base) || undefined;
  } catch {
    return undefined;
  }
}

/**
 * Compute merge base for a branch against main/master.
 * Internal helper - prefer using merge base from settings.
 */
function computeMergeBase(cwd: string, taskBranch: string): string | undefined {
  try {
    return execFileSync("git", ["merge-base", "main", taskBranch], {
      cwd,
      encoding: "utf-8",
    }).trim();
  } catch {
    try {
      return execFileSync("git", ["merge-base", "master", taskBranch], {
        cwd,
        encoding: "utf-8",
      }).trim();
    } catch {
      try {
        // Fallback: diff against the commit before branch was created
        return execFileSync("git", ["rev-parse", "HEAD~1"], {
          cwd,
          encoding: "utf-8",
        }).trim();
      } catch {
        return undefined;
      }
    }
  }
}

/**
 * Get list of files changed since the merge base (includes both committed and uncommitted).
 * This shows all changes made on the task branch.
 */
export function getChangedFilesSinceMergeBase(cwd: string, mergeBase: string): ChangedFile[] {
  try {
    // Get committed changes from merge base to HEAD
    const committedOutput = execFileSync(
      "git",
      ["diff", "--name-status", mergeBase, "HEAD"],
      { cwd, encoding: "utf-8" }
    );

    // Get uncommitted changes (working directory)
    const uncommittedOutput = execFileSync("git", ["status", "--porcelain"], {
      cwd,
      encoding: "utf-8",
    });

    const filesMap = new Map<string, ChangedFile>();

    // Process committed changes first
    for (const line of committedOutput.split("\n")) {
      if (!line.trim()) continue;
      const [status, ...pathParts] = line.split("\t");
      const path = pathParts.join("\t"); // Handle paths with tabs (rare)

      if (status.startsWith("R")) {
        // Rename: status is like "R100" and pathParts is [oldPath, newPath]
        const newPath = pathParts[1] || path;
        filesMap.set(newPath, { path: newPath, operation: "rename" });
      } else if (status === "A") {
        filesMap.set(path, { path, operation: "create" });
      } else if (status === "D") {
        filesMap.set(path, { path, operation: "delete" });
      } else {
        filesMap.set(path, { path, operation: "modify" });
      }
    }

    // Layer uncommitted changes on top
    for (const line of uncommittedOutput.split("\n")) {
      if (!line.trim()) continue;
      const status = line.substring(0, 2);
      let path = line.substring(3);

      if (status.startsWith("R")) {
        const parts = path.split(" -> ");
        path = parts[1] || path;
        filesMap.set(path, { path, operation: "rename" });
      } else if (status.includes("A") || status === "??") {
        filesMap.set(path, { path, operation: "create" });
      } else if (status.includes("D")) {
        filesMap.set(path, { path, operation: "delete" });
      } else {
        // Only update to modify if not already tracked
        if (!filesMap.has(path)) {
          filesMap.set(path, { path, operation: "modify" });
        }
      }
    }

    return Array.from(filesMap.values());
  } catch {
    return [];
  }
}

/**
 * Get the full diff for a file from the merge base (includes committed + uncommitted changes).
 */
export function getFileDiffFromMergeBase(
  cwd: string,
  filePath: string,
  mergeBase: string
): string | undefined {
  try {
    // Diff from merge base to working directory (includes both committed and uncommitted)
    const diff = execFileSync("git", ["diff", mergeBase, "--", filePath], {
      cwd,
      encoding: "utf-8",
      maxBuffer: 5 * 1024 * 1024,
    });

    return diff || undefined;
  } catch {
    return undefined;
  }
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
 * Get the full cumulative diff for a specific file from HEAD.
 * Returns the unified diff output, or undefined if file is unchanged or error.
 */
export function getFileDiff(cwd: string, filePath: string): string | undefined {
  try {
    // Use execFileSync with array args to avoid shell injection
    const diff = execFileSync("git", ["diff", "HEAD", "--", filePath], {
      cwd,
      encoding: "utf-8",
      maxBuffer: 5 * 1024 * 1024, // 5MB max per file
    });

    return diff || undefined;
  } catch {
    return undefined;
  }
}

/**
 * Check if a file is binary using git's detection.
 */
export function isBinaryFile(cwd: string, filePath: string): boolean {
  try {
    // git diff --numstat shows binary files as "-\t-\tfilename"
    const output = execFileSync("git", ["diff", "--numstat", "HEAD", "--", filePath], {
      cwd,
      encoding: "utf-8",
    });

    // Binary files show as: -\t-\tfilename
    return output.startsWith("-\t-\t");
  } catch {
    // If we can't determine, assume not binary
    return false;
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
 * Create and checkout a new branch.
 */
export function createAndCheckoutBranch(cwd: string, branchName: string): void {
  execFileSync("git", ["checkout", "-b", branchName], { cwd, stdio: "pipe" });
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
