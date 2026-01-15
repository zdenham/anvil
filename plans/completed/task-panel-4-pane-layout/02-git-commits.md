# Stream 2: Git Commits Feature

**Dependencies**: None (can execute in parallel with Streams 1 & 3)

## Goal

Create the git commits view infrastructure: hook for fetching commits and component for displaying them.

## Implementation Steps

### Step 2.1: Add branchName to Task Type (if needed)

Check `src/entities/tasks/types.ts` for existing `branchName` field. If missing:

```typescript
export interface Task {
  id: string;
  title: string;
  description?: string;
  status: TaskStatus;
  branchName?: string;  // ADD THIS
  // ... other fields
}
```

### Step 2.2: Create useGitCommits Hook

**File**: `src/hooks/use-git-commits.ts`

```typescript
import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { logger } from "@/lib/logger-client";

export interface GitCommit {
  hash: string;        // Full hash
  shortHash: string;   // Abbreviated (7 chars)
  message: string;     // First line of commit message
  author: string;      // Author name
  authorEmail: string; // Author email
  date: string;        // ISO date string
  relativeDate: string; // "2 hours ago" etc
}

interface UseGitCommitsResult {
  commits: GitCommit[];
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

export function useGitCommits(
  branchName: string | undefined,
  workingDirectory: string
): UseGitCommitsResult {
  const [commits, setCommits] = useState<GitCommit[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchCommits = async () => {
    if (!branchName || !workingDirectory) {
      setCommits([]);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      // Option A: Tauri command (preferred)
      const result = await invoke<GitCommit[]>("get_branch_commits", {
        branchName,
        workingDirectory,
        limit: 50,
      });
      setCommits(result);
    } catch (err) {
      logger.error("[useGitCommits] Failed to fetch commits:", err);
      setError(err instanceof Error ? err.message : "Failed to fetch commits");
      setCommits([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCommits();
  }, [branchName, workingDirectory]);

  return {
    commits,
    loading,
    error,
    refresh: fetchCommits,
  };
}
```

### Step 2.3: Create Rust Backend Command (if using Tauri)

**File**: `src-tauri/src/git_commands.rs` (or add to existing commands file)

```rust
use serde::{Deserialize, Serialize};
use std::process::Command;

#[derive(Debug, Serialize, Deserialize)]
pub struct GitCommit {
    hash: String,
    short_hash: String,
    message: String,
    author: String,
    author_email: String,
    date: String,
    relative_date: String,
}

#[tauri::command]
pub async fn get_branch_commits(
    branch_name: String,
    working_directory: String,
    limit: usize,
) -> Result<Vec<GitCommit>, String> {
    let output = Command::new("git")
        .args([
            "log",
            &branch_name,
            &format!("-{}", limit),
            "--format=%H|%h|%s|%an|%ae|%aI|%ar",
        ])
        .current_dir(&working_directory)
        .output()
        .map_err(|e| format!("Failed to execute git: {}", e))?;

    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let commits: Vec<GitCommit> = stdout
        .lines()
        .filter(|line| !line.is_empty())
        .filter_map(|line| {
            let parts: Vec<&str> = line.splitn(7, '|').collect();
            if parts.len() == 7 {
                Some(GitCommit {
                    hash: parts[0].to_string(),
                    short_hash: parts[1].to_string(),
                    message: parts[2].to_string(),
                    author: parts[3].to_string(),
                    author_email: parts[4].to_string(),
                    date: parts[5].to_string(),
                    relative_date: parts[6].to_string(),
                })
            } else {
                None
            }
        })
        .collect();

    Ok(commits)
}
```

Register in `lib.rs`:
```rust
.invoke_handler(tauri::generate_handler![
    // ... existing handlers
    git_commands::get_branch_commits,
])
```

### Step 2.4: Create GitCommitsList Component

**File**: `src/components/workspace/git-commits-list.tsx`

```tsx
import { GitCommit as GitCommitIcon, RefreshCw, AlertCircle } from "lucide-react";
import { useGitCommits, type GitCommit } from "@/hooks/use-git-commits";

interface GitCommitsListProps {
  branchName?: string;
  workingDirectory: string;
}

export function GitCommitsList({ branchName, workingDirectory }: GitCommitsListProps) {
  const { commits, loading, error, refresh } = useGitCommits(branchName, workingDirectory);

  if (!branchName) {
    return (
      <div className="h-full flex items-center justify-center text-slate-500">
        <div className="text-center">
          <GitCommitIcon className="w-8 h-8 mx-auto mb-2 opacity-50" />
          <p className="text-sm">No branch associated with this task</p>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <RefreshCw className="w-5 h-5 animate-spin text-slate-400" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="h-full flex items-center justify-center text-red-400">
        <div className="text-center">
          <AlertCircle className="w-8 h-8 mx-auto mb-2" />
          <p className="text-sm">{error}</p>
          <button
            onClick={refresh}
            className="mt-2 text-xs text-slate-400 hover:text-slate-300"
          >
            Try again
          </button>
        </div>
      </div>
    );
  }

  if (commits.length === 0) {
    return (
      <div className="h-full flex items-center justify-center text-slate-500">
        <div className="text-center">
          <GitCommitIcon className="w-8 h-8 mx-auto mb-2 opacity-50" />
          <p className="text-sm">No commits on this branch</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto">
      <div className="p-4">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-medium text-slate-300">
            Commits on <code className="text-blue-400">{branchName}</code>
          </h3>
          <button
            onClick={refresh}
            className="p-1 rounded hover:bg-slate-700/50 text-slate-400 hover:text-slate-300"
            title="Refresh"
          >
            <RefreshCw size={14} />
          </button>
        </div>

        <div className="space-y-1">
          {commits.map((commit) => (
            <CommitRow key={commit.hash} commit={commit} />
          ))}
        </div>
      </div>
    </div>
  );
}

function CommitRow({ commit }: { commit: GitCommit }) {
  return (
    <div className="px-3 py-2 rounded-lg hover:bg-slate-800/50 group">
      <div className="flex items-start gap-3">
        <code className="text-xs text-blue-400 font-mono pt-0.5 flex-shrink-0">
          {commit.shortHash}
        </code>
        <div className="flex-1 min-w-0">
          <p className="text-sm text-slate-200 truncate">
            {commit.message}
          </p>
          <div className="flex items-center gap-2 mt-0.5 text-xs text-slate-500">
            <span>{commit.author}</span>
            <span>•</span>
            <span>{commit.relativeDate}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
```

## Files Created

1. `src/hooks/use-git-commits.ts` - Hook for fetching commits
2. `src/components/workspace/git-commits-list.tsx` - Display component
3. `src-tauri/src/git_commands.rs` (optional, if using Tauri backend)

## Files Modified

1. `src/entities/tasks/types.ts` - Add branchName (if needed)
2. `src-tauri/src/lib.rs` - Register Tauri command (if using)

## Verification

After completing this stream:
1. `useGitCommits` hook compiles and returns mock/real data
2. `GitCommitsList` renders commits or appropriate empty/error states
3. Refresh button triggers re-fetch

## Alternative: Shell-based Implementation

If Tauri command is complex, use shell execution via existing patterns:

```typescript
// In use-git-commits.ts, use existing shell execution pattern
import { Command } from "@tauri-apps/plugin-shell";

const fetchCommits = async () => {
  const cmd = Command.create("git", [
    "log",
    branchName,
    "-50",
    "--format=%H|%h|%s|%an|%ae|%aI|%ar",
  ], { cwd: workingDirectory });

  const output = await cmd.execute();
  // Parse output.stdout...
};
```

## Notes

- Start with mock data if backend is complex, wire up real data later
- Consider caching commits to avoid repeated fetches
- May want to listen for git events to auto-refresh
