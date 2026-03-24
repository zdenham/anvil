# File Changes Architecture Fix

## Problem Statement

The file changes system has architectural inconsistencies that cause bugs:

1. **Absolute vs relative paths**: Agent stores absolute paths in `fileChanges[].path`, but git diff expects relative paths
2. **Unused diff field**: `FileChangeSchema` has a `diff` field that's always empty - unclear intent
3. **Untracked files not handled**: `git diff <commit> -- <file>` returns empty for new/untracked files
4. **Frontend workarounds**: The frontend currently synthesizes diffs for new files in TypeScript, which is fragile

## Chosen Architecture: Option B (Frontend generates diffs)

- Agent records paths and operations only
- Frontend computes diffs on-demand using git
- Diffs are not persisted in state.json

## Key Design Decisions

### 1. Path Normalization at Agent Level

**Decision**: Store relative paths in `fileChanges`, not absolute paths.

**Rationale**:
- Git commands work with relative paths
- Relative paths are portable (work across worktrees with different base paths)
- The `workingDirectory` in thread metadata provides the context to resolve to absolute when needed

**Worktree Consideration**:
- Each thread has a `workingDirectory` that points to either the main repo or a worktree
- File paths stored relative to `workingDirectory` work correctly in both cases
- Example: A file at `/Users/x/.anvil/repositories/myrepo/feature-branch/src/foo.ts` in a worktree would be stored as `src/foo.ts`

### 2. Git Diff for Untracked Files

**Decision**: Use `git diff --no-index /dev/null <file>` for new/created files in the Rust backend.

**Rationale**:
- Native git command, consistent output format
- Works in both main repo and worktrees
- No need for TypeScript to synthesize diffs

**Implementation**:
- Modify `git_diff_files` Rust command to accept file operations
- For `create` operations, use `git diff --no-index /dev/null <relative-path>`
- For `modify`/`delete`/`rename`, use standard `git diff <commit> -- <paths>`

### 3. Remove Unused `diff` Field from Schema

**Decision**: Remove the `diff` field entirely from `FileChangeSchema`.

**Rationale**:
- Field is never populated
- Removing it clarifies that frontend generates diffs
- No need for backwards compatibility - clean break

## Implementation Plan

### Phase 1: Normalize Paths at Agent Level

**File**: `agents/src/runners/shared.ts`

1. When calling `updateFileChange()`, convert absolute paths to relative:
   ```typescript
   // Before storing file change
   const relativePath = path.startsWith(workingDirectory)
     ? path.slice(workingDirectory.length).replace(/^\//, '')
     : path;

   await updateFileChange({
     path: relativePath,  // Store relative, not absolute
     operation,
   });
   ```

2. This affects the `handleToolResult` function where file changes are recorded after Write/Edit tool execution.

**Files to modify**:
- `agents/src/runners/shared.ts` - Path normalization in `handleToolResult`
- `agents/src/runners/simple-runner-strategy.ts` - Ensure workingDirectory is available
- `agents/src/runners/task-runner-strategy.ts` - Same

### Phase 2: Enhance Rust Git Command for Untracked Files

**File**: `src-tauri/src/git_commands.rs`

1. Modify `git_diff_files` to accept operation info:
   ```rust
   #[derive(Deserialize)]
   pub struct FileDiffRequest {
       path: String,
       operation: String,  // "create" | "modify" | "delete" | "rename"
   }

   pub async fn git_diff_files(
       repo_path: String,
       base_commit: String,
       files: Vec<FileDiffRequest>,
   ) -> Result<String, String>
   ```

2. For each file, generate appropriate diff:
   - `create`: `git diff --no-index /dev/null <path>`
   - `modify`: `git diff <base_commit> -- <path>`
   - `delete`: `git diff <base_commit> -- <path>` (shows deletion)
   - `rename`: `git diff <base_commit> -- <old_path> <new_path>`

3. Combine all diffs into single output string.

**File**: `src/lib/tauri-commands.ts`

Update TypeScript binding:
```typescript
interface FileDiffRequest {
  path: string;
  operation: 'create' | 'modify' | 'delete' | 'rename';
}

diffFiles: (repoPath: string, baseCommit: string, files: FileDiffRequest[]) =>
  invoke<string>("git_diff_files", { repoPath, baseCommit, files }),
```

### Phase 3: Simplify Frontend Diff Generation

**File**: `src/lib/utils/thread-diff-generator.ts`

1. Remove `generateNewFileDiff` function (no longer needed)
2. Remove `toRelativePath` function (paths already relative)
3. Simplify `generateThreadDiff`:
   ```typescript
   export async function generateThreadDiff(
     initialCommitHash: string,
     fileChanges: FileChangeInfo[],
     workingDirectory: string
   ): Promise<ThreadDiffResult> {
     if (fileChanges.length === 0) {
       return { diff: { files: [] }, initialCommit: initialCommitHash };
     }

     // All paths are already relative, all operations handled by Rust
     const rawDiff = await gitCommands.diffFiles(
       workingDirectory,
       initialCommitHash,
       fileChanges.map(f => ({ path: f.path, operation: f.operation }))
     );

     return {
       diff: parseDiff(rawDiff),
       initialCommit: initialCommitHash,
     };
   }
   ```

### Phase 4: Remove `diff` Field from Schema

**File**: `core/types/events.ts`

Remove the `diff` field entirely:
```typescript
export const FileChangeSchema = z.object({
  path: z.string(),
  operation: z.enum(["create", "modify", "delete", "rename"]),
  oldPath: z.string().optional(),
});
```

**File**: `agents/src/runners/shared.ts`

Update `updateFileChange` calls to not include `diff`:
```typescript
await updateFileChange({
  path: relativePath,
  operation,
});
```

### Phase 5: Clean Up Debug Logging

Remove `[FC-DEBUG]` logging added during investigation:
- `agents/src/output.ts`
- `src/entities/threads/listeners.ts`
- `src/entities/threads/service.ts`
- `src/components/simple-task/changes-tab.tsx`
- `src/lib/utils/thread-diff-generator.ts`
- `src/lib/annotated-file-builder.ts`

## Testing Plan

### Unit Tests

#### Phase 1: Path Normalization (`agents/src/runners/shared.test.ts`)

```typescript
describe('path normalization in handleToolResult', () => {
  const workingDirectory = '/Users/test/myrepo';

  it('converts absolute path to relative for Write tool', async () => {
    // Given: Write tool result with absolute path
    const toolResult = {
      tool_name: 'Write',
      file_path: '/Users/test/myrepo/src/new-file.ts',
      // ...
    };

    // When: handleToolResult processes it
    // Then: fileChange.path should be 'src/new-file.ts'
  });

  it('converts absolute path to relative for Edit tool', async () => {
    // Given: Edit tool result with absolute path
    const toolResult = {
      tool_name: 'Edit',
      file_path: '/Users/test/myrepo/src/existing.ts',
      // ...
    };

    // When: handleToolResult processes it
    // Then: fileChange.path should be 'src/existing.ts'
  });

  it('preserves already-relative paths', async () => {
    // Given: Tool result with relative path (edge case)
    const toolResult = {
      tool_name: 'Write',
      file_path: 'src/file.ts',
      // ...
    };

    // When: handleToolResult processes it
    // Then: fileChange.path should remain 'src/file.ts'
  });

  it('handles paths outside working directory gracefully', async () => {
    // Given: Tool result with path outside workingDirectory
    const toolResult = {
      tool_name: 'Write',
      file_path: '/other/location/file.ts',
      // ...
    };

    // When: handleToolResult processes it
    // Then: Should either reject or store full path with warning
  });
});
```

#### Phase 2: Rust Git Command (`src-tauri/src/git_commands.rs` - Rust tests)

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[tokio::test]
    async fn test_diff_files_create_operation() {
        // Given: A git repo with an untracked new file
        let repo = setup_test_repo();
        create_file(&repo, "new-file.txt", "hello world\n");

        // When: git_diff_files called with create operation
        let result = git_diff_files(
            repo.path().to_string(),
            "HEAD".to_string(),
            vec![FileDiffRequest {
                path: "new-file.txt".to_string(),
                operation: "create".to_string(),
            }],
        ).await;

        // Then: Returns valid diff showing all lines as additions
        assert!(result.is_ok());
        let diff = result.unwrap();
        assert!(diff.contains("+hello world"));
        assert!(diff.contains("new file mode"));
    }

    #[tokio::test]
    async fn test_diff_files_modify_operation() {
        // Given: A git repo with a tracked file that was modified
        let repo = setup_test_repo();
        create_and_commit_file(&repo, "existing.txt", "original\n");
        modify_file(&repo, "existing.txt", "modified\n");

        // When: git_diff_files called with modify operation
        let result = git_diff_files(
            repo.path().to_string(),
            "HEAD".to_string(),
            vec![FileDiffRequest {
                path: "existing.txt".to_string(),
                operation: "modify".to_string(),
            }],
        ).await;

        // Then: Returns diff showing the change
        assert!(result.is_ok());
        let diff = result.unwrap();
        assert!(diff.contains("-original"));
        assert!(diff.contains("+modified"));
    }

    #[tokio::test]
    async fn test_diff_files_delete_operation() {
        // Given: A git repo with a tracked file that was deleted
        let repo = setup_test_repo();
        create_and_commit_file(&repo, "to-delete.txt", "content\n");
        delete_file(&repo, "to-delete.txt");

        // When: git_diff_files called with delete operation
        let result = git_diff_files(
            repo.path().to_string(),
            "HEAD".to_string(),
            vec![FileDiffRequest {
                path: "to-delete.txt".to_string(),
                operation: "delete".to_string(),
            }],
        ).await;

        // Then: Returns diff showing deletion
        assert!(result.is_ok());
        let diff = result.unwrap();
        assert!(diff.contains("-content"));
        assert!(diff.contains("deleted file mode"));
    }

    #[tokio::test]
    async fn test_diff_files_mixed_operations() {
        // Given: A repo with create, modify, and delete operations
        let repo = setup_test_repo();
        create_and_commit_file(&repo, "modify-me.txt", "old\n");
        create_and_commit_file(&repo, "delete-me.txt", "gone\n");

        modify_file(&repo, "modify-me.txt", "new\n");
        delete_file(&repo, "delete-me.txt");
        create_file(&repo, "new-file.txt", "fresh\n");

        // When: git_diff_files called with mixed operations
        let result = git_diff_files(
            repo.path().to_string(),
            "HEAD".to_string(),
            vec![
                FileDiffRequest { path: "new-file.txt".to_string(), operation: "create".to_string() },
                FileDiffRequest { path: "modify-me.txt".to_string(), operation: "modify".to_string() },
                FileDiffRequest { path: "delete-me.txt".to_string(), operation: "delete".to_string() },
            ],
        ).await;

        // Then: Returns combined diff for all files
        assert!(result.is_ok());
        let diff = result.unwrap();
        assert!(diff.contains("+fresh"));      // new file
        assert!(diff.contains("-old"));        // modify
        assert!(diff.contains("+new"));        // modify
        assert!(diff.contains("-gone"));       // delete
    }
}
```

#### Phase 3: Frontend Diff Generation (`src/lib/utils/thread-diff-generator.test.ts`)

```typescript
describe('generateThreadDiff', () => {
  it('passes file changes with operations to git command', async () => {
    // Given: File changes with various operations
    const fileChanges: FileChangeInfo[] = [
      { path: 'src/new.ts', operation: 'create' },
      { path: 'src/modified.ts', operation: 'modify' },
    ];

    // When: generateThreadDiff is called
    const result = await generateThreadDiff(
      'abc123',
      fileChanges,
      '/path/to/repo'
    );

    // Then: gitCommands.diffFiles was called with operation info
    expect(mockGitCommands.diffFiles).toHaveBeenCalledWith(
      '/path/to/repo',
      'abc123',
      [
        { path: 'src/new.ts', operation: 'create' },
        { path: 'src/modified.ts', operation: 'modify' },
      ]
    );
  });

  it('handles empty file changes', async () => {
    const result = await generateThreadDiff('abc123', [], '/path/to/repo');

    expect(result.diff.files).toHaveLength(0);
    expect(result.initialCommit).toBe('abc123');
  });

  it('propagates git command errors', async () => {
    mockGitCommands.diffFiles.mockRejectedValue(new Error('git error'));

    const result = await generateThreadDiff(
      'abc123',
      [{ path: 'file.ts', operation: 'modify' }],
      '/path/to/repo'
    );

    expect(result.error).toContain('git error');
  });
});

describe('extractFileChanges', () => {
  it('extracts file changes with operations', () => {
    const input = [
      { path: 'a.ts', operation: 'create' as const },
      { path: 'b.ts', operation: 'modify' as const },
    ];

    const result = extractFileChanges(input);

    expect(result).toEqual([
      { path: 'a.ts', operation: 'create' },
      { path: 'b.ts', operation: 'modify' },
    ]);
  });

  it('defaults to modify when operation is missing', () => {
    const input = [{ path: 'file.ts' }];

    const result = extractFileChanges(input);

    expect(result[0].operation).toBe('modify');
  });

  it('deduplicates by path, keeping latest', () => {
    const input = [
      { path: 'file.ts', operation: 'create' as const },
      { path: 'file.ts', operation: 'modify' as const },
    ];

    const result = extractFileChanges(input);

    expect(result).toHaveLength(1);
    expect(result[0].operation).toBe('modify');
  });
});
```

### Integration Tests

#### End-to-End File Changes Flow (`src/components/simple-task/changes-tab.integration.test.tsx`)

```typescript
describe('ChangesTab integration', () => {
  it('displays diff for newly created file', async () => {
    // Given: Thread state with a created file (relative path, no diff field)
    const threadState = {
      fileChanges: [
        { path: 'src/new-component.tsx', operation: 'create' }
      ],
      // ...
    };
    const threadMetadata = {
      git: { initialCommitHash: 'abc123' },
      workingDirectory: '/path/to/repo',
      // ...
    };

    // When: ChangesTab renders
    render(<ChangesTab threadMetadata={threadMetadata} threadState={threadState} />);

    // Then: Shows the file with all additions
    await waitFor(() => {
      expect(screen.getByText('src/new-component.tsx')).toBeInTheDocument();
      expect(screen.getByText(/\+\d+/)).toBeInTheDocument(); // additions count
    });
  });

  it('displays diff for modified file', async () => {
    // Given: Thread state with a modified file
    const threadState = {
      fileChanges: [
        { path: 'src/existing.ts', operation: 'modify' }
      ],
      // ...
    };

    // When: ChangesTab renders
    // Then: Shows the file with additions and deletions
  });

  it('handles mixed create and modify operations', async () => {
    // Given: Thread state with both new and modified files
    const threadState = {
      fileChanges: [
        { path: 'src/new.ts', operation: 'create' },
        { path: 'src/changed.ts', operation: 'modify' },
      ],
      // ...
    };

    // When: ChangesTab renders
    // Then: Shows both files with correct diff types
  });

  it('shows empty state when no file changes', async () => {
    const threadState = { fileChanges: [], /* ... */ };

    render(<ChangesTab threadMetadata={threadMetadata} threadState={threadState} />);

    expect(screen.getByText('No file changes in this thread')).toBeInTheDocument();
  });

  it('shows error state when diff generation fails', async () => {
    // Given: Git command will fail
    mockGitCommands.diffFiles.mockRejectedValue(new Error('not a git repo'));

    // When: ChangesTab renders
    // Then: Shows error message
  });
});
```

#### Worktree-Specific Tests

```typescript
describe('ChangesTab with worktrees', () => {
  it('generates correct diff in worktree context', async () => {
    // Given: Thread running in a worktree
    const threadMetadata = {
      workingDirectory: '/Users/x/.anvil/repositories/myrepo/feature-branch',
      worktreePath: '/Users/x/.anvil/repositories/myrepo/feature-branch',
      git: { initialCommitHash: 'abc123' },
      // ...
    };
    const threadState = {
      fileChanges: [
        { path: 'src/feature.ts', operation: 'create' }
      ],
      // ...
    };

    // When: ChangesTab renders
    // Then: Diff is generated correctly using worktree path
    await waitFor(() => {
      expect(mockGitCommands.diffFiles).toHaveBeenCalledWith(
        '/Users/x/.anvil/repositories/myrepo/feature-branch',
        'abc123',
        expect.any(Array)
      );
    });
  });

  it('handles file paths consistently across main repo and worktree', async () => {
    // Test that relative paths work the same whether in main repo or worktree
  });
});
```

### Manual Testing Checklist

Before merging, manually verify:

- [ ] **Create new file**: Run agent that creates a new file, verify Changes tab shows all lines as green additions
- [ ] **Modify existing file**: Run agent that edits an existing tracked file, verify Changes tab shows red deletions and green additions
- [ ] **Delete file**: Run agent that deletes a file, verify Changes tab shows all lines as red deletions
- [ ] **Multiple operations**: Run agent that creates, modifies, and deletes files in same session, verify all show correctly
- [ ] **Worktree**: Create a task with worktree, run agent, verify Changes tab works correctly
- [ ] **Subdirectories**: Create/modify files in nested directories (e.g., `src/components/deep/file.tsx`)
- [ ] **Special characters**: Test with files containing spaces or special characters in name
- [ ] **Large files**: Test with a file >1000 lines to verify performance
- [ ] **Binary files**: Test that binary files are handled gracefully (shown but not diffed)
- [ ] **Refresh behavior**: Verify Changes tab updates when agent makes additional changes during session
- [ ] **Tab switching**: Switch between Plan/Changes tabs while agent is running, verify no state corruption

## Migration

No migration needed:
- Old state.json files will be ignored (users can delete old thread data if needed)
- This is a breaking change for old state files, but thread state is ephemeral and not critical data

## Rollback Plan

If issues arise, revert the commits. No data migration required since we're not supporting backwards compatibility.
