# Thread Changelog Implementation Plan

## Overview
This plan details the implementation of a thread diff/changelog system that captures and displays all file changes made during a conversation thread, without relying on git commits. The system will parse tool calls (Edit, Write, etc.) to build an accumulative diff that handles multiple edits to the same file sections.

## Problem Statement
- Threads may make file changes without creating git commits
- Need to display accumulated file changes across the entire thread
- Must handle multiple edits to the same code section gracefully
- Should integrate seamlessly with existing Simple Task UI
- Must leverage existing diff components that support file expansion

## Architectural Analysis

### Existing Infrastructure Available

#### 1. Production-Ready Diff Components
- **DiffViewer System**: 23 components in `src/components/diff-viewer/`
- **Key Features**:
  - Expandable file sections with smooth animations
  - Virtualization for large diffs
  - Full accessibility (ARIA, keyboard navigation)
  - Global expand/collapse controls
  - Intelligent collapsing (8+ consecutive unchanged lines)
  - Error boundaries and loading states

#### 2. Tool Call Tracking Infrastructure
- **Storage**: Complete tool execution history in `state.json`
- **Data Structure**: `toolStates` map keyed by `tool_use_id` + full `messages` array
- **Real-time Updates**: Event-driven updates via `AGENT_STATE` events
- **Tool Input Access**: Available for Edit (`old_string`/`new_string`) and Write (`content`)

#### 3. Simple Task UI Structure
- **Current Layout**: Single view (no tabs) with ThreadView + actions
- **Delete Button Location**: Top-right corner of SimpleTaskHeader
- **Tab Infrastructure**: Available from workspace (`TabButton` component)

## Core Strategy: Accumulative Diff Engine

### 1. Diff Accumulation Approach

**Problem**: Multiple edits to the same file section need to be reconciled into a single coherent diff.

**Solution**: Three-phase accumulation strategy:

#### Phase 1: Sequential File State Reconstruction
```typescript
interface FileStateTimeline {
  filePath: string;
  states: Array<{
    content: string;           // File content at this point
    timestamp: number;         // When this change occurred
    toolUseId: string;         // Which tool caused this change
    operation: 'create' | 'modify' | 'delete';
  }>;
}
```

**Process**:
1. Start with original file content (or empty for new files)
2. Apply each Edit/Write operation sequentially
3. Maintain timeline of all intermediate states
4. Generate final diff: `original → final state`

#### Phase 2: Multi-Edit Reconciliation
For overlapping edits in the same file section:

```typescript
interface EditChain {
  filePath: string;
  startLine: number;
  endLine: number;
  edits: Array<{
    toolUseId: string;
    oldContent: string;
    newContent: string;
    timestamp: number;
  }>;
  finalDiff: string;  // Combined git diff format
}
```

**Reconciliation Algorithm**:
1. **Detect Overlaps**: Parse line ranges for each edit
2. **Chain Dependencies**: Build dependency graph for overlapping edits
3. **Apply Sequentially**: Apply edits in chronological order
4. **Generate Combined Diff**: Show original → final result

#### Phase 3: Cross-File Impact Analysis
Track files that were modified multiple times:

```typescript
interface FileChangesSummary {
  filePath: string;
  operations: Array<'create' | 'modify' | 'delete'>;
  totalEdits: number;
  firstEdit: number;        // timestamp
  lastEdit: number;         // timestamp
  netLines: number;         // final +/- line count
  editChains: EditChain[];  // For complex multi-edit scenarios
}
```

### 2. Implementation Architecture

```typescript
// Core service for building thread diffs
class ThreadChangelogService {
  // Main API - builds complete thread diff
  async buildThreadChangelog(threadId: string): Promise<ThreadChangelog>;

  // Internal - reconstructs file states chronologically
  private buildFileTimelines(toolCalls: ToolCall[]): Map<string, FileStateTimeline>;

  // Internal - generates git-format diffs
  private generateAccumulativeDiff(timeline: FileStateTimeline): string;

  // Internal - handles multi-edit reconciliation
  private reconcileOverlappingEdits(edits: EditOperation[]): EditChain[];
}

interface ThreadChangelog {
  threadId: string;
  generatedAt: number;
  fileChanges: FileChangesSummary[];
  totalFiles: number;
  totalLines: { added: number; deleted: number; };
  consolidatedDiff: string;  // Combined git diff for all files
}
```

### 3. Data Flow

```
Thread Messages (state.json)
  ↓
Extract Tool Calls (Edit, Write, Delete)
  ↓
Build File State Timelines
  ↓
Apply Sequential Edits → Intermediate File States
  ↓
Reconcile Overlapping Edits → Edit Chains
  ↓
Generate Git-Format Diffs → Accumulative Diff
  ↓
Render in DiffViewer Component
```

## UI Integration Plan

### 1. Tab System Addition

**Modify SimpleTaskWindow to support tabs**:

```typescript
// New state management
interface TaskViewState {
  activeTab: 'conversation' | 'changelog';
  setActiveTab: (tab: string) => void;
}

// Updated SimpleTaskWindowContent structure
<div className="flex flex-col h-screen">
  <SimpleTaskHeader /> {/* Existing header */}

  {/* NEW: Tab navigation */}
  <div className="flex border-b border-surface-700 bg-surface-900">
    <TabButton
      active={activeTab === 'conversation'}
      onClick={() => setActiveTab('conversation')}
      icon={<MessageSquare size={16} />}
    >
      Conversation
    </TabButton>
    <TabButton
      active={activeTab === 'changelog'}
      onClick={() => setActiveTab('changelog')}
      icon={<GitBranch size={16} />}
      badge={fileChangesCount > 0 ? fileChangesCount : undefined}
    >
      Changes
    </TabButton>
  </div>

  {/* Tab content switching */}
  <div className="flex-1 overflow-hidden">
    {activeTab === 'conversation' && (
      <>
        <ThreadView {...existingProps} />
        <SuggestedActionsPanel {...existingProps} />
        <ThreadInput {...existingProps} />
      </>
    )}
    {activeTab === 'changelog' && (
      <ThreadChangelogView threadId={threadId} />
    )}
  </div>

  <NavigationBanner /> {/* Existing banner */}
</div>
```

### 2. Changelog Tab Icon Placement

**Add changelog icon next to delete button in SimpleTaskHeader**:

```typescript
// In SimpleTaskHeader component
<div className="flex items-center gap-2">
  {/* Existing cancel button */}

  {/* NEW: Changelog toggle button */}
  <button
    onClick={() => setActiveTab('changelog')}
    className={cn(
      "p-1.5 rounded transition-colors",
      activeTab === 'changelog'
        ? "bg-accent-500/20 text-accent-400"
        : "text-surface-400 hover:text-surface-300 hover:bg-surface-800/50"
    )}
    aria-label="View thread changes"
  >
    <GitBranch size={14} />
    {fileChangesCount > 0 && (
      <span className="ml-1 px-1 py-0.5 text-xs bg-accent-500 text-white rounded">
        {fileChangesCount}
      </span>
    )}
  </button>

  <DeleteButton /> {/* Existing delete button */}
</div>
```

### 3. ThreadChangelogView Component

```typescript
interface ThreadChangelogViewProps {
  threadId: string;
}

function ThreadChangelogView({ threadId }: ThreadChangelogViewProps) {
  const { data: changelog, loading, error } = useThreadChangelog(threadId);

  if (loading) return <ChangelogSkeleton />;
  if (error) return <ChangelogErrorState error={error} />;
  if (!changelog || changelog.fileChanges.length === 0) {
    return <ChangelogEmptyState />;
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header with stats and controls */}
      <div className="p-4 border-b border-surface-700 bg-surface-900/50">
        <div className="flex justify-between items-center">
          <div>
            <h2 className="text-lg font-semibold text-surface-100">
              Thread Changes
            </h2>
            <p className="text-sm text-surface-400">
              {changelog.totalFiles} files • {changelog.totalLines.added}+ {changelog.totalLines.deleted}-
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={handleExpandAll}>
              Expand All
            </Button>
            <Button variant="outline" size="sm" onClick={handleCollapseAll}>
              Collapse All
            </Button>
          </div>
        </div>
      </div>

      {/* Reuse existing DiffViewer with thread changelog data */}
      <div className="flex-1 overflow-auto">
        <DiffViewer
          diff={changelog.consolidatedDiff}
          emptyComponent={<ChangelogEmptyState />}
          errorComponent={<ChangelogErrorState />}
        />
      </div>
    </div>
  );
}
```

## Implementation Phases

### Phase 1: Core Engine (Week 1)
**Files to Create**:
- `src/lib/thread-changelog/`
  - `thread-changelog-service.ts` - Core accumulation engine
  - `file-timeline-builder.ts` - Sequential state reconstruction
  - `edit-reconciler.ts` - Multi-edit conflict resolution
  - `diff-generator.ts` - Git-format diff generation
  - `types.ts` - TypeScript interfaces

**Key Algorithms**:
1. Tool call extraction from thread messages
2. File state timeline construction
3. Sequential edit application
4. Git diff generation from file states

### Phase 2: Data Access Layer (Week 1)
**Files to Create**:
- `src/hooks/use-thread-changelog.ts` - React hook for changelog data
- `src/entities/threads/changelog-store.ts` - Caching and state management

**Features**:
- Lazy loading with caching
- Real-time updates via thread events
- Error handling and retry logic
- Loading states for UI

### Phase 3: UI Components (Week 2)
**Files to Create**:
- `src/components/thread-changelog/`
  - `thread-changelog-view.tsx` - Main changelog tab component
  - `changelog-header.tsx` - Stats and controls
  - `changelog-empty-state.tsx` - No changes state
  - `changelog-error-state.tsx` - Error handling
  - `changelog-skeleton.tsx` - Loading state

**Files to Modify**:
- `src/components/simple-task/simple-task-window.tsx` - Add tab system
- `src/components/simple-task/simple-task-header.tsx` - Add changelog icon

### Phase 4: Integration & Polish (Week 2)
**Features**:
- Tab state persistence (remember user's tab choice)
- Keyboard shortcuts for tab switching
- Badge counts for file changes
- Performance optimization for large threads
- Accessibility testing and improvements

## Technical Challenges & Solutions

### Challenge 1: Multiple Edits to Same Code Section

**Problem**:
```
Edit 1: Line 10: "const x = 1;" → "const x = 2;"
Edit 2: Line 10: "const x = 2;" → "const x = 3;"
```

**Solution**: Sequential state reconstruction
```typescript
// Build complete file state timeline
const timeline = [
  { content: "const x = 1;", timestamp: t1 },
  { content: "const x = 2;", timestamp: t2 },
  { content: "const x = 3;", timestamp: t3 }
];

// Generate final diff: original → final
const diff = generateDiff("const x = 1;", "const x = 3;");
```

### Challenge 2: Overlapping Edit Regions

**Problem**:
```
Edit 1: Lines 10-15 → Replace function body
Edit 2: Lines 12-13 → Modify specific statements within same function
```

**Solution**: Dependency-aware reconciliation
```typescript
interface EditDependency {
  toolUseId: string;
  dependsOn: string[];  // Other tool IDs that must be applied first
  lineRange: [number, number];
}

// Build dependency graph and apply in correct order
const orderedEdits = topologicalSort(editDependencies);
```

### Challenge 3: Performance with Large Threads

**Problem**: Threads with 100+ tool calls may cause UI lag

**Solution**:
- **Virtualization**: Reuse existing `virtualized-file-content.tsx`
- **Lazy Computation**: Calculate diffs on-demand per file
- **Caching**: Store computed diffs in changelog store
- **Debouncing**: Batch real-time updates

### Challenge 4: File Content Reconstruction

**Problem**: Need original file content to generate accurate diffs

**Solution**: Multiple fallback strategies
```typescript
async function getOriginalFileContent(filePath: string, timestamp: number): Promise<string> {
  // Strategy 1: Git history (if available)
  const gitContent = await tryGitShow(filePath, timestamp);
  if (gitContent) return gitContent;

  // Strategy 2: File system (for recent changes)
  const fsContent = await tryReadFile(filePath);
  if (fsContent) return fsContent;

  // Strategy 3: Reconstruct from tool call chain
  return reconstructFromToolCalls(filePath, timestamp);
}
```

## Integration with Existing Systems

### 1. Event System Integration
Listen for thread updates and refresh changelog:

```typescript
// In changelog store
eventBus.on(EventName.AGENT_STATE, ({ threadId }) => {
  if (store.activeChangelogThreadId === threadId) {
    refreshChangelog(threadId);
  }
});

eventBus.on(EventName.AGENT_COMPLETED, ({ threadId }) => {
  invalidateChangelog(threadId);
});
```

### 2. Thread Store Integration
Extend existing thread store for changelog state:

```typescript
interface ThreadStoreState {
  // ... existing state
  threadChangelogs: Record<string, ThreadChangelog>;
  changelogLoading: Record<string, boolean>;
  changelogErrors: Record<string, string>;
}
```

### 3. Performance Considerations
- **Memory Usage**: Cache only active thread changelog
- **Computation**: Debounce diff generation during streaming
- **UI Responsiveness**: Use React.memo() for diff components
- **Background Processing**: Calculate diffs in web worker for large threads

## Testing Strategy

### Unit Tests
- File timeline reconstruction algorithms
- Edit reconciliation logic
- Diff generation accuracy
- Edge cases (empty files, binary files, deletions)

### Integration Tests
- Thread store integration
- Event system updates
- UI component interactions
- Tab switching and state persistence

### Performance Tests
- Large thread handling (100+ tool calls)
- Memory usage monitoring
- UI responsiveness during streaming
- Diff calculation benchmarks

### Accessibility Tests
- Keyboard navigation for tab system
- Screen reader compatibility
- Focus management between tabs
- ARIA attributes for changelog content

## Conclusion

This implementation leverages existing, production-ready diff infrastructure while adding a sophisticated accumulative diff engine that can handle the complex scenarios of multiple edits to the same code sections. The phased approach allows for iterative development and testing, while the comprehensive challenge analysis ensures robust handling of edge cases.

The UI integration is designed to be minimal and non-disruptive, adding value through the changelog view while maintaining the existing conversation-focused workflow. Performance and accessibility considerations ensure the feature scales well and remains usable for all users.