# Fix: @ File Tagging Not Showing Untracked Files

## Problem Statement

Users report that newly created files are not appearing in the "@" file tagging autocomplete dropdown. Investigation confirms this is because the system only discovers git-tracked files, excluding untracked files entirely.

## Root Cause Analysis

### Current Implementation Flow

1. User types "@filename" in thread input
2. `TriggerSearchInput` component detects "@" trigger
3. `FileTriggerHandler` delegates to `FileSearchService.search()`
4. `FileSearchService` calls `gitCommands.lsFiles(rootPath)`
5. Backend executes `git ls-files` command
6. **Problem**: `git ls-files` only returns files in git's index (tracked files)
7. Untracked files are completely invisible to the system

### Key Code Locations

- **File Search Service**: `src/lib/triggers/file-search-service.ts:29` - Core issue location
- **Git Commands**: `src-tauri/src/git_commands.rs:354-373` - Backend implementation
- **File Handler**: `src/lib/triggers/handlers/file-handler.ts` - Trigger delegation
- **UI Components**: `src/components/reusable/trigger-search-input.tsx` - User interface

### Architecture Dependencies

```
User Input → TriggerSearchInput → FileTriggerHandler → FileSearchService → git ls-files
                                                                        ↓
                                                            Only tracked files returned
```

## Proposed Solutions

### Option 1: Dual Git Commands Approach (Recommended)

**Strategy**: Combine `git ls-files` (tracked) with `git ls-files --others --exclude-standard` (untracked) for comprehensive results.

#### Why This Approach is Optimal

- **Performant**: Both commands are highly optimized git operations
- **Gitignore for free**: `--exclude-standard` automatically respects `.gitignore`, `.git/info/exclude`, and core excludes
- **Minimal changes**: Just append results from second command to existing flow
- **Maintains architecture**: Still git-based, no filesystem walking needed
- **No risk**: Won't scan large ignored directories like `node_modules`

#### Implementation Plan

1. **Add Backend Command** (`src-tauri/src/git_commands.rs`)
   - Add `ls_files_untracked()` command that executes `git ls-files --others --exclude-standard`
   - Or enhance existing `ls_files()` to optionally include untracked files
   - Minimal code changes, leverages existing git infrastructure

2. **Update FileSearchService** (`src/lib/triggers/file-search-service.ts`)
   - Call both git commands in parallel
   - Merge and deduplicate results
   - Prioritize tracked files in scoring/ranking

3. **Performance Characteristics**
   - Same performance as current implementation (both are git index operations)
   - No filesystem traversal overhead
   - Respects all git ignore patterns automatically

#### Code Changes Required

```rust
// src-tauri/src/git_commands.rs - Add new command
#[tauri::command]
pub fn ls_files_untracked(root_path: String) -> Result<Vec<String>, String> {
    let output = Command::new("git")
        .args(["ls-files", "--others", "--exclude-standard"])
        .current_dir(&root_path)
        .output()
        .map_err(|e| format!("Failed to execute git ls-files: {}", e))?;

    // Parse output same as existing ls_files command
    parse_git_output(output)
}
```

```typescript
// src/lib/triggers/file-search-service.ts
async search(rootPath: string, query: string): Promise<FileSearchResult[]> {
  const [trackedFiles, untrackedFiles] = await Promise.all([
    gitCommands.lsFiles(rootPath),
    gitCommands.lsFilesUntracked(rootPath)
  ]);

  // Merge results, mark tracked vs untracked for prioritization
  const allFiles = [
    ...trackedFiles.map(f => ({ path: f, tracked: true })),
    ...untrackedFiles.map(f => ({ path: f, tracked: false }))
  ];

  // Apply fuzzy matching and return results (prioritize tracked files)
  return this.scoreAndFilter(allFiles, query);
}
```

### Option 2: Git Status Integration

**Strategy**: Use `git status --porcelain` to discover untracked files alongside `git ls-files`.

#### Pros
- Provides file status information
- Single command for untracked files

#### Cons
- More complex parsing (need to extract filenames from status)
- Less direct than `--others --exclude-standard`

### Option 3: Enhanced Single Command

**Strategy**: Create single backend command that runs both git operations and merges results.

#### Pros
- Single frontend call
- Atomic operation

#### Cons
- Less flexibility for different use cases
- Slightly more complex backend logic

## Recommended Implementation: Option 1

### Phase 1: Backend Enhancement (Minimal)
1. Add `ls_files_untracked` command using `git ls-files --others --exclude-standard`
2. Reuse existing git command infrastructure and error handling
3. No new dependencies or complex filesystem operations needed

### Phase 2: Service Layer Update (Simple)
1. Update `FileSearchService` to call both commands
2. Implement simple array merging and deduplication
3. Add tracked/untracked prioritization in scoring

### Phase 3: Optional UX Improvements
1. Add visual indicators for tracked vs untracked files in dropdown
2. Add user preference for including/excluding untracked files
3. Consider caching for performance (though likely unnecessary)

## Expected Benefits

1. **Complete File Visibility**: All files in the workspace become taggable
2. **Better Developer Experience**: No confusion about "missing" files
3. **Universal Support**: Works for git and non-git projects
4. **Performance Maintained**: Smart caching and limits prevent slowdowns

## Risk Assessment

- **Performance Impact**: Mitigated by caching and progressive loading
- **Memory Usage**: Controlled by result limits and smart pagination
- **Compatibility**: Backward compatible, git-tracked files still prioritized

## Testing Strategy

1. **Unit Tests**: New filesystem scanning functions
2. **Integration Tests**: End-to-end @ tagging workflow
3. **Performance Tests**: Large repository handling
4. **Edge Cases**: Non-git projects, permission errors, symlinks

## Success Criteria

- [ ] Newly created files appear in @ tagging autocomplete immediately
- [ ] Git-tracked files maintain existing behavior and performance
- [ ] Non-git projects work seamlessly
- [ ] No performance regression on large repositories
- [ ] Proper error handling for filesystem access issues

## Implementation Notes

- Consider debouncing filesystem scans for frequently changing directories
- Implement proper file watching for cache invalidation
- Add configuration options for scan depth and file type filtering
- Ensure thread safety for concurrent file operations