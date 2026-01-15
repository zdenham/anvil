# Task Panel 4-Pane Layout Refactor

## Overview

Refactor `task-workspace.tsx` from a 3-pane layout to a 4-pane layout with clearer separation of concerns. The chat pane becomes always-visible (but collapsible), freeing the main content pane for task-specific views.

## Target Layout

```
┌──────────────────────────────────────────────────────────────────┐
│                        TaskHeader                                 │
├───────────┬────────────────────────────────────────┬─────────────┤
│   LEFT    │           MAIN CONTENT                 │  [◀] RIGHT  │
│   MENU    │              PANE                      │   CHAT PANE │
│  (180px)  │            (flex-1)                    │    (400px)  │
│           │                                        │             │
│ Task Name │  (Overview/Changes/Git                 │ Thread view │
│ ───────── │   based on menu selection)             │ + streaming │
│ Overview  │                                        │             │
│ Changes   │                                        │ (NO input)  │
│ Git       │                                        │ (collapse)  │
│           ├────────────────────────────────────────┤             │
│           │         ACTION PANE                    │             │
│           │   (Input for follow-up agents)         │             │
└───────────┴────────────────────────────────────────┴─────────────┘
```

## Issues Identified in Original Plan

### 1. Tab Naming Inconsistency
- **Issue**: Plan uses "diff" but codebase uses "changes"
- **Resolution**: Keep "changes" for consistency with existing code

### 2. Redundant Component Creation
- **Issue**: Plan suggests creating new `LeftMenu` component, but `WorkspaceSidebar` already exists
- **Resolution**: Evolve `WorkspaceSidebar` → `LeftMenu` rather than creating from scratch

### 3. Thread Selection Behavior Change
- **Issue**: Currently, clicking "Threads" tab shows ThreadView in main content. New layout has ThreadView in ChatPane
- **Resolution**: Remove "threads" as a main content tab entirely. The thread list moves to left menu, clicking selects which thread shows in ChatPane

### 4. Missing Git Integration Details
- **Issue**: No `useGitCommits` hook exists, Task type may not have `branchName`
- **Resolution**: Add `branchName` to Task type, create `useGitCommits` hook

### 5. ActionPanel Positioning Ambiguity
- **Issue**: Diagram shows action pane below main content but not spanning chat pane - current code has it spanning full width at bottom
- **Resolution**: Move ActionPanel to be a child of the center column (below MainContentPane, not spanning ChatPane)

### 6. Missing State Persistence
- **Issue**: No mention of persisting chat pane collapse state
- **Resolution**: Use localStorage or similar for collapse state persistence

### 7. Vague "Wire Up Data Flow" Step
- **Issue**: Step 8 was too vague to be actionable
- **Resolution**: Integrated specific data flow into each component's implementation

### 8. Missing Thread List in New Layout
- **Issue**: Original plan removes ThreadsList from sidebar but doesn't clearly place it
- **Resolution**: Thread list stays in LeftMenu, but selecting a thread updates ChatPane (not main content)

## Corrected Tab Structure

**Old tabs**: `"overview" | "changes" | "threads"`
**New tabs**: `"overview" | "changes" | "git"`

"Threads" is no longer a tab - the thread list is always visible in the left menu below the tabs, and clicking selects which thread displays in the ChatPane.

## Parallel Execution Strategy

The implementation is split into independent work streams that can be executed in parallel:

### Stream 1: Left Menu Evolution (01-left-menu.md)
- Modify `WorkspaceSidebar` to new `LeftMenu` design
- Add Git tab, remove Threads tab
- Keep ThreadsList always visible below tabs
- Independent: No dependencies on other streams

### Stream 2: Git Commits Feature (02-git-commits.md)
- Create `useGitCommits` hook
- Create `GitCommitsList` component
- Add `branchName` to Task type if needed
- Independent: No dependencies on other streams

### Stream 3: Chat Pane Extraction (03-chat-pane.md)
- Extract ThreadView display into `ChatPane` component
- Add collapse button (mirror of SidebarCollapseButton)
- Add collapse state management
- Independent: No dependencies on other streams

### Stream 4: Layout Integration (04-layout-integration.md)
- Depends on: Streams 1, 2, 3
- Refactor `TaskWorkspace` to 4-pane layout
- Update `MainContentPane` to add git tab case
- Reposition `ActionPanel` to center column
- Wire up thread selection → ChatPane

## Files Summary

### To Modify
1. `src/components/workspace/workspace-sidebar.tsx` → rename to `left-menu.tsx`
2. `src/components/workspace/task-workspace.tsx` - Main layout refactor
3. `src/components/workspace/main-content-pane.tsx` - Add git tab case, remove threads case
4. `src/entities/tasks/types.ts` - Add branchName if needed

### To Create
1. `src/components/workspace/git-commits-list.tsx` - Git commits view
2. `src/components/workspace/chat-pane.tsx` - Extracted chat display
3. `src/hooks/use-git-commits.ts` - Hook for fetching git commits

### To Delete
- None (we're evolving existing components)

## Execution Order

```
Phase 1 (Parallel):
  ├── Stream 1: Left Menu Evolution
  ├── Stream 2: Git Commits Feature
  └── Stream 3: Chat Pane Extraction

Phase 2 (Sequential):
  └── Stream 4: Layout Integration (depends on Phase 1)
```

## Testing Strategy

After each stream, verify:
- Stream 1: Left menu renders with new tabs, thread list visible
- Stream 2: Git tab shows commit list (mock data initially)
- Stream 3: ChatPane renders ThreadView, collapse works
- Stream 4: Full integration, all panes work together
