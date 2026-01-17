# Simple Diffing Strategy - Thread Changes Tab

## Overview

Add a new "Changes" tab to the simple task panel that displays all file changes made during a thread's execution. This provides a consolidated view of what the agent modified, using a diff from the initial commit at thread start.

## Architecture

### How It Works

1. **Capture Initial Commit**: When a thread starts, capture and store the current HEAD commit hash
2. **Track Changed Files**: When Edit/Write tool results arrive, record the file paths of changed files
3. **Generate Diffs on Demand**: When the Changes tab is opened, generate diffs from the initial commit for only the tracked files

### Known Limitations (Accepted)

1. Does not capture file changes from bash commands (mv, rm, cp, etc.)
2. Diffs may include changes from other agents working on the same files concurrently
3. Staged/unstaged changes at thread start will be included in the diff baseline

---

## Implementation Plan

### Phase 1: Data Layer - Capture Initial Commit

**File**: `core/types/threads.ts`

Extend `ThreadMetadata.git` to include `initialCommitHash`:

```typescript
git?: {
  branch: string;
  initialCommitHash: string;  // NEW: captured at thread start
  commitHash?: string;        // existing: commit after completion
};
```

**File**: `src/entities/threads/service.ts` (or thread creation logic)

When creating a new thread:
1. Run `git rev-parse HEAD` to get the current commit hash
2. Store it in `ThreadMetadata.git.initialCommitHash`

### Phase 2: Data Layer - Track Changed File Paths (Persisted to Disk)

**File**: `core/types/threads.ts`

Add `changedFilePaths` to `ThreadMetadata` so it persists alongside other thread data:

```typescript
interface ThreadMetadata {
  // ... existing fields
  git?: {
    branch: string;
    initialCommitHash: string;
    commitHash?: string;
  };
  changedFilePaths?: string[];  // NEW: persisted list of files modified by this thread
}
```

**Why persist to disk instead of Zustand state?**
- Thread state in Zustand is ephemeral and lost on app restart
- Changed file paths need to survive app restarts to generate diffs for historical threads
- Aligns with how `initialCommitHash` is stored (in thread metadata on disk)
- Allows viewing changes tab for threads started in previous sessions

**File**: `src/entities/threads/service.ts` (or event stream handler)

When Edit/Write tool results arrive:
1. Extract the file path from the tool result
2. Add to `ThreadMetadata.changedFilePaths` if not already present
3. Persist the updated metadata to disk

```typescript
function appendChangedFilePath(threadId: string, filePath: string) {
  const metadata = getThreadMetadata(threadId);
  const paths = new Set(metadata.changedFilePaths ?? []);
  paths.add(filePath);
  updateThreadMetadata(threadId, { changedFilePaths: [...paths] });
}
```

**Note**: The existing `ThreadState.fileChanges` in Zustand can still be used for live UI updates during the session, but `ThreadMetadata.changedFilePaths` is the source of truth for diff generation.

### Phase 3: Diff Generation Utility

**New File**: `src/lib/utils/thread-diff-generator.ts`

```typescript
interface ThreadDiffResult {
  files: Map<string, FileChange>;
  initialCommit: string;
  error?: string;
}

/**
 * Generate diffs for changed files from the initial commit
 */
export async function generateThreadDiff(
  initialCommitHash: string,
  changedFilePaths: string[],
  workingDirectory: string
): Promise<ThreadDiffResult>
```

Implementation:
1. For each file path, run: `git diff <initialCommitHash> -- <filepath>`
2. Parse the diff output using existing `diff-parser.ts`
3. Return structured `FileChange` objects compatible with existing diff viewer

This requires invoking git commands from the renderer. Options:
- Use existing IPC to backend for git commands
- Add new Tauri command for generating diffs

### Phase 4: UI - Add Tab Navigation to Simple Task Header

**File**: `src/components/simple-task/simple-task-header.tsx`

Add tab icons to the header:
- Thread icon (conversation view) - default
- Changes icon (diff view)

```tsx
// Tab state
type SimpleTaskTab = 'thread' | 'changes';

// Add to header, after status dot area
<div className="flex gap-1">
  <button
    onClick={() => setActiveTab('thread')}
    className={cn("p-1.5 rounded", activeTab === 'thread' && "bg-accent")}
    title="Thread"
  >
    <MessageSquare className="w-4 h-4" />
  </button>
  <button
    onClick={() => setActiveTab('changes')}
    className={cn("p-1.5 rounded", activeTab === 'changes' && "bg-accent")}
    title="Changes"
  >
    <GitCompare className="w-4 h-4" /> {/* or FileDiff icon */}
  </button>
</div>
```

### Phase 5: UI - Changes Tab Component

**New File**: `src/components/simple-task/changes-tab.tsx`

This component:
1. Receives thread metadata + state as props
2. On mount/tab switch, generates diffs using the utility from Phase 3
3. Displays using existing `DiffViewer` component or a simplified version

```tsx
interface ChangesTabProps {
  threadMetadata: ThreadMetadata;
}

export function ChangesTab({ threadMetadata }: ChangesTabProps) {
  const [diffResult, setDiffResult] = useState<ThreadDiffResult | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Generate diffs when tab is opened
    const generateDiffs = async () => {
      // Read from persisted metadata, not Zustand state
      if (!threadMetadata.git?.initialCommitHash || !threadMetadata.changedFilePaths?.length) {
        setLoading(false);
        return;
      }

      const result = await generateThreadDiff(
        threadMetadata.git.initialCommitHash,
        threadMetadata.changedFilePaths,
        threadMetadata.workingDirectory
      );
      setDiffResult(result);
      setLoading(false);
    };

    generateDiffs();
  }, [threadMetadata]);

  if (loading) return <LoadingSpinner />;
  if (!diffResult?.files.size) return <EmptyState message="No file changes in this thread" />;

  return <DiffViewer fileChanges={diffResult.files} />;
}
```

### Phase 6: Wire Up Tab Switching in Simple Task Window

**File**: `src/components/simple-task/simple-task-window.tsx`

Add tab state and conditional rendering:

```tsx
const [activeTab, setActiveTab] = useState<'thread' | 'changes'>('thread');

// In render, conditionally show ThreadView or ChangesTab
{activeTab === 'thread' ? (
  <ThreadView ... />
) : (
  <ChangesTab threadMetadata={threadMetadata} />
)}
```

Pass `activeTab` and `setActiveTab` to the header component.

---

## File Changes Summary

### New Files
- `src/components/simple-task/changes-tab.tsx` - Changes tab component
- `src/lib/utils/thread-diff-generator.ts` - Diff generation utility

### Modified Files
- `core/types/threads.ts` - Add `initialCommitHash` to git metadata and `changedFilePaths` array
- `src/components/simple-task/simple-task-header.tsx` - Add tab icons
- `src/components/simple-task/simple-task-window.tsx` - Tab state and routing
- `src/entities/threads/service.ts` - Capture initial commit on thread creation, persist changed file paths on Edit/Write tool results

### Backend (if needed)
- `src-tauri/src/commands/` - Add git diff command if IPC approach is used

---

## Technical Considerations

### Git Command Execution

The diff generation needs to run git commands. Two approaches:

**Option A: Tauri Command (Recommended)**
- Add `generate_file_diff(initial_commit: String, file_path: String, working_dir: String)` command
- Runs in Rust, more secure and performant
- Returns raw diff string

**Option B: Existing Shell/Process Infrastructure**
- Use whatever mechanism already exists for running git commands
- May already have git integration for commit tracking

### Caching

Consider caching generated diffs:
- Store in ThreadState after first generation
- Invalidate when fileChanges array updates (new tool results)
- Avoid re-running git diff on every tab switch

### Empty States

Handle these cases:
- Thread has no git info (not in a git repo)
- No file changes in thread
- Git diff command fails
- Files were deleted and can't be diffed

---

## Implementation Order

1. **Phase 1**: Capture initial commit hash (backend + thread creation)
2. **Phase 2**: Persist changed file paths to disk on Edit/Write tool results
3. **Phase 3**: Diff generation utility (can test in isolation)
4. **Phase 4-5**: UI components (header tabs + changes tab)
5. **Phase 6**: Wire everything together
6. **Polish**: Loading states, empty states, error handling

---

## Testing Strategy

### Unit Tests
- Diff generation utility with mocked git output
- Path extraction from fileChanges array

### Integration Tests
- Thread creation captures initial commit
- Tab switching shows correct view
- Diffs display correctly with existing DiffViewer

### Manual Testing
- Create thread, make edits, verify diff shows changes
- Test with no changes (empty state)
- Test outside git repo (graceful degradation)
- Test with concurrent changes from other sources

---

## Future Enhancements (Out of Scope)

- Capture bash command file operations (complex, requires parsing)
- Per-turn diffs (show what changed in each agent response)
- Commit grouping (if agent made multiple commits)
- Revert individual file changes from the diff view
