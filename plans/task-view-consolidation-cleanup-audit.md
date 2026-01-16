# Task View Consolidation Cleanup Audit

## Executive Summary

This audit identifies all components, files, and references related to the complex task view (TaskWorkspace) that should be deprecated in favor of the simple task view as the source of truth. The complex task view includes the full workspace with multi-tab layout, **sophisticated multi-agent orchestration system**, kanban board functionality, and merge agent workflows.

## Deprecation Strategy Overview

**Keep (Source of Truth):**
- Simple Task View (`src/components/simple-task/`)
- Simple task entry point (`src/simple-task-main.tsx`)
- Simple Agent (`spawnSimpleAgent()` in `agent-service.ts`)
- Unified Task List component (`src/components/shared/unified-task-list.tsx`)

**Deprecate & Remove:**
- Complex Task View (`src/components/workspace/`)
- Complex task entry point (`src/task-main.tsx`)
- **Multi-Agent Orchestration System** (`spawnAgentWithOrchestration()`, `resumeAgent()`)
- **Agent State Machine** (`agent-state-machine.ts`, progression logic)
- **Merge Agent Architecture** (`buildMergeContext()`, merge workflows)
- **Agent Types & Strategy System** (dev agents, merge agents, task progression)
- Kanban board functionality (`src/hooks/use-task-board.ts`)
- Task card components for kanban (`src/components/tasks/task-card.tsx`)

## Detailed Cleanup Plan

### Phase 1: Core Workspace Components [HIGH PRIORITY]

#### 1.1 Main Workspace Entry Point
**File:** `src/task-main.tsx`
- **Status:** Primary entry point for complex task windows
- **Dependencies:** TaskWorkspace, event bridge setup, entity hydration
- **Action:** REMOVE - This entire file can be deleted
- **Impact:** No more complex task windows will open

#### 1.2 TaskWorkspace Component
**File:** `src/components/workspace/task-workspace.tsx` (24.6 KB)
- **Status:** Main complex task view component
- **Features:** Agent orchestration, merge workflows, complex state management
- **Action:** REMOVE - Core component to be deleted
- **Dependencies:** 17 other workspace components

#### 1.3 Workspace Component Directory
**Directory:** `src/components/workspace/` (18 files total)

**Components to Remove:**
- `task-workspace.tsx` - Main workspace component
- `task-header.tsx` - Complex header with type indicators
- `left-menu.tsx` - Tab navigation (Overview, Files, Threads, Commits)
- `main-content-pane.tsx` - Central content area
- `chat-pane.tsx` - Chat/thread interface
- `action-panel.tsx` - Action controls
- `task-overview.tsx` - Task metadata display
- `task-changes.tsx` - File change tracking
- `git-commits-list.tsx` - Git commit history
- `threads-list.tsx` - All threads for task
- `index.ts` - Workspace exports

### Phase 2: Task Type Routing [HIGH PRIORITY]

#### 2.1 Update Task Opening Logic
**File:** `src/components/main-window/tasks-page.tsx:39-44`
```typescript
// CURRENT (lines 39-44):
if (task.type === "simple") {
  openSimpleTask(threadId, task.id, task.title);
} else {
  openTask(threadId, task.id); // ← This calls complex workspace
}

// AFTER CLEANUP:
// All tasks should use simple task view
openSimpleTask(threadId, task.id, task.title);
```

**Action:** Modify routing logic to use simple task view for all task types

#### 2.2 Update Task Type Definitions
**File:** `core/types/tasks.ts`
- **Current:** Task type enum: `"work" | "investigate" | "simple"`
- **Action:** Consider deprecating "work" and "investigate" types if they're no longer needed
- **Impact:** May require migration of existing tasks to "simple" type

### Phase 3: Multi-Agent Orchestration Removal [HIGH PRIORITY]

#### 3.1 Agent Service Orchestration Functions
**File:** `src/lib/agent-service.ts` (1149 lines total)

**Functions to Remove:**
- `spawnAgentWithOrchestration()` (lines 217-452) - Complex agent spawning with Node orchestration, worktree allocation
- `resumeAgent()` (lines 459-638) - Agent resumption with thread history and orchestration
- `buildMergeContextForTask()` (lines 1040-1077) - Merge context building for merge agents
- `AgentStreamCallbacks` interface (lines 167-171) - Complex agent streaming
- `SpawnAgentWithOrchestrationOptions` interface (lines 191-202) - Orchestration options
- All merge agent helper functions and types

**Functions to Keep:**
- `spawnSimpleAgent()` (lines 697-784) - Simple agent spawning (source of truth)
- `resumeSimpleAgent()` (lines 790-869) - Simple agent resumption
- `cancelSimpleAgent()`, `cancelAgent()` - Cancellation functions
- Permission response and queued message support
- Basic agent process management

#### 3.2 Agent State Machine
**File:** `src/lib/agent-state-machine.ts` (72 lines)
- **Purpose:** Task status progression logic, agent type mapping
- **Features:** `getNextStatus()`, `canProgress()`, `getNextPhaseLabel()`
- **Action:** REMOVE - Used only for complex multi-phase workflows
- **Usage:** Only referenced in TaskWorkspace and related components

#### 3.3 Agent Types & Strategy Architecture
**Directory:** `agents/src/agent-types/` (entire package)

**Components to Remove:**
- `agents/src/agent-types/merge.ts` - Merge agent with `buildMergeAgentPrompt()`
- `agents/src/agent-types/merge-types.ts` - Merge context types and interfaces
- `agents/src/agent-types/index.ts` - Agent type exports

**Impact:** This removes the sophisticated agent type system with specialized merge agents

#### 3.4 Agent Runner Strategies
**Files in `agents/src/runners/`:**

**Files to Remove:**
- `agents/src/runners/task-runner-strategy.ts` - Complex task orchestration with worktree allocation
- `agents/src/orchestration.ts` - Agent orchestration logic
- `agents/src/orchestration.test.ts` - Orchestration tests

**Files to Keep:**
- `agents/src/runners/simple-runner-strategy.ts` - Simple agent runner (source of truth)
- `agents/src/runner.ts` - Main runner entry point
- `agents/src/runners/types.ts` - Basic runner types

### Phase 4: Kanban Board Removal [MEDIUM PRIORITY]

#### 4.1 Task Board Hook
**File:** `src/hooks/use-task-board.ts` (180 lines)
- **Purpose:** Kanban grouping, filtering, drag-and-drop reordering
- **Usage:** Only used in kanban view components
- **Action:** REMOVE - No longer needed without kanban interface

#### 4.2 Task Card Components
**Files to Remove:**
- `src/components/tasks/task-card.tsx` - Kanban card layout with drag-and-drop
- `src/components/tasks/task-card.ui.test.tsx` - Associated tests
- `src/components/tasks/task-row.tsx` - Alternative task layout (minimal usage)

**Note:** Keep `src/components/tasks/delete-*.tsx` components as they're used by UnifiedTaskList

#### 4.3 Kanban Sorting Utilities
**File:** `src/entities/tasks/sort-kanban.ts`
- **Purpose:** Task sorting logic for kanban columns
- **Action:** Review and REMOVE if only used for kanban functionality

### Phase 5: Navigation & Hotkey Updates [HIGH PRIORITY]

#### 5.1 Hotkey Service Updates
**File:** `src/lib/hotkey-service.ts`
- **Current:** Has both `openTask()` and `openSimpleTask()` functions
- **Action:** Remove `openTask()` function, keep only `openSimpleTask()`
- **Impact:** All hotkey-triggered task opens will use simple view

#### 5.2 Spotlight Integration
**File:** `src/components/spotlight/spotlight.tsx`
- **Current:** References TaskWorkspace and complex task opening
- **Lines:** Line 251 mentions "This ensures TaskWorkspace always has a taskId"
- **Action:** Update comments and logic to reference SimpleTaskWindow instead

### Phase 6: HTML Entry Points [MEDIUM PRIORITY]

#### 6.1 Task Window HTML
**File:** `task.html`
- **Current:** Points to `src/task-main.tsx`
- **Action:** This HTML file can be REMOVED entirely
- **Rationale:** No more complex task windows needed

#### 6.2 Update Tauri Configuration
- **Action:** Review Tauri window configuration to remove complex task window setup
- **Check:** Backend window creation logic may reference task.html

### Phase 7: Type System Updates [LOW PRIORITY]

#### 7.1 Task Header Type Logic
**File:** `src/components/workspace/task-header.tsx:20-22`
```typescript
// This logic becomes obsolete:
const typeLabel = task.type === "work" ? "Work" : "Investigate";
const iconColor = task.type === "work" ? "text-blue-400" : "text-purple-400";
```

**Action:** REMOVE with rest of workspace components

#### 7.2 Agent Event Types
**File:** `core/types/events.ts`
- **Current:** Contains complex agent orchestration events
- **Events to Remove:** Events related to worktree allocation, agent orchestration, merge workflows
- **Events to Keep:** Basic agent events for simple task flows

### Phase 8: Documentation & Plans Cleanup [LOW PRIORITY]

#### 8.1 Plan Files References
**Multiple plan files reference TaskWorkspace, multi-agent orchestration, and complex task views:**
- All files in `plans/completed/task-panel-4-pane-layout/`
- All files in `plans/completed/agent-state-machine/`
- All files in `plans/completed/merge-strategy/`
- Agent orchestration and multi-agent architecture plans
- **Action:** Update or add deprecation notices to relevant active plans

### Phase 9: Test & Infrastructure Updates [MEDIUM PRIORITY]

#### 9.1 Test Utilities
**File:** `src/test/helpers/render.tsx`
- **Action:** Review for workspace-related test setup that should be removed

#### 9.2 Component Queries
**File:** `src/test/helpers/queries.ts`
- **Action:** Remove any workspace or kanban-specific test queries

#### 9.3 Agent Testing Infrastructure
**Files to Review:**
- `agents/src/testing/` - Agent testing harness and utilities
- Various agent orchestration tests
- **Action:** Keep simple agent testing, remove complex orchestration tests

## Implementation Order

### Stage 1: Immediate Impact (Can break complex task functionality)
1. ✅ **Remove `src/task-main.tsx`** - Prevents complex task windows from opening
2. ✅ **Update routing in `tasks-page.tsx`** - All tasks use simple view
3. ✅ **Remove `openTask()` from hotkey service** - Unified hotkey behavior
4. ✅ **Remove orchestration functions from `agent-service.ts`** - Break multi-agent workflows

### Stage 2: Component & Architecture Cleanup (Safe after Stage 1)
5. ✅ **Remove entire `src/components/workspace/` directory** - All workspace components
6. ✅ **Remove `task.html`** - No longer needed
7. ✅ **Remove `src/lib/agent-state-machine.ts`** - Agent progression logic
8. ✅ **Remove multi-agent architecture** - Agent types, orchestration, merge workflows
9. ✅ **Remove kanban components** - task-card.tsx, task-row.tsx, etc.

### Stage 3: Backend & Infrastructure (Coordination required)
10. ✅ **Remove `src/hooks/use-task-board.ts`** - Kanban functionality
11. ✅ **Update Tauri configuration** - Remove complex window setup
12. ✅ **Clean up agent runner strategies** - Remove task-runner-strategy.ts, orchestration.ts
13. ✅ **Review task type definitions** - Consider deprecating "work"/"investigate" types
14. ✅ **Update agent event types** - Remove orchestration events

### Stage 4: Polish & Documentation (Post-cleanup)
15. ✅ **Update tests and test utilities** - Remove workspace and agent orchestration references
16. ✅ **Clean up documentation references** - Update plans and comments
17. ✅ **Update type definitions** - Simplify task type enum if needed
18. ✅ **Remove agent testing infrastructure** - Keep simple agent tests only

## Risk Assessment

### High Risk
- **Immediate breaking changes:** Removing `task-main.tsx` and orchestration functions will immediately break complex task functionality
- **Agent workflow disruption:** Multi-agent workflows, merge strategies, and task progression will stop working
- **Data migration:** Existing "work" and "investigate" type tasks may need type migration
- **Backend coordination:** Agent runner changes may require backend updates

### Medium Risk
- **Hotkey conflicts:** Users may have muscle memory for complex task shortcuts
- **Feature loss:** Some workspace-specific features may not have simple task equivalents
- **Agent architecture impact:** Removing sophisticated agent orchestration may require workflow adjustments

### Low Risk
- **Component removal:** Most workspace components are self-contained
- **Test updates:** Test changes are isolated and can be fixed incrementally
- **Documentation cleanup:** Plan and documentation updates are non-functional

## Success Criteria

1. ✅ All task types open in simple task view
2. ✅ No broken component imports or references
3. ✅ Hotkeys work consistently across all task types
4. ✅ **Single agent architecture:** Only simple agents spawn, no orchestration
5. ✅ **No multi-agent workflows:** Task progression removed, merge agents disabled
6. ✅ No dead code remaining in codebase
7. ✅ All tests pass after cleanup
8. ✅ **Significant bundle size reduction** from removed complex components and agent architecture
9. ✅ **Simplified codebase:** Easier maintenance with single-agent model

## File Summary

### Files to Remove (Complete Deletion)
```
# Complex Task View & Entry Points
src/task-main.tsx                              # Complex task entry point
task.html                                      # Complex task window HTML

# Workspace Components (18 files)
src/components/workspace/                      # Entire directory
├── task-workspace.tsx                         # Main workspace (24.6KB)
├── task-header.tsx
├── left-menu.tsx
├── main-content-pane.tsx
├── chat-pane.tsx
├── action-panel.tsx
├── task-overview.tsx
├── task-changes.tsx
├── git-commits-list.tsx
├── threads-list.tsx
└── index.ts

# Multi-Agent Architecture
src/lib/agent-state-machine.ts                 # Agent progression logic (72 lines)
agents/src/agent-types/                        # Entire directory
├── merge.ts                                   # Merge agent with buildMergeAgentPrompt()
├── merge-types.ts                             # Merge context types
└── index.ts                                   # Agent type exports

agents/src/runners/task-runner-strategy.ts     # Complex orchestration
agents/src/orchestration.ts                    # Agent orchestration logic
agents/src/orchestration.test.ts               # Orchestration tests

# Kanban Board Functionality
src/hooks/use-task-board.ts                    # Kanban functionality (180 lines)
src/components/tasks/task-card.tsx             # Kanban card component
src/components/tasks/task-card.ui.test.tsx     # Card tests
src/components/tasks/task-row.tsx              # Alternative task layout
src/entities/tasks/sort-kanban.ts              # Kanban sorting (if unused)
```

### Files to Modify
```
# Routing & Navigation
src/components/main-window/tasks-page.tsx     # Update routing logic (remove complex task branching)
src/lib/hotkey-service.ts                     # Remove openTask() function
src/components/spotlight/spotlight.tsx        # Update TaskWorkspace references

# Agent Service (Major Refactoring)
src/lib/agent-service.ts                      # Remove orchestration functions:
                                              #   - spawnAgentWithOrchestration() (lines 217-452)
                                              #   - resumeAgent() (lines 459-638)
                                              #   - buildMergeContextForTask() (lines 1040-1077)
                                              #   - AgentStreamCallbacks interface
                                              #   - SpawnAgentWithOrchestrationOptions interface

# Type System Updates
core/types/tasks.ts                           # Consider deprecating "work"/"investigate" types
core/types/events.ts                          # Remove agent orchestration event types
```

### Files to Keep (Simple Task View)
```
# Simple Task Architecture (Source of Truth)
src/simple-task-main.tsx                      # Simple task entry point
simple-task.html                              # Simple task window HTML
src/components/simple-task/                   # Entire directory (15 files)
src/components/shared/unified-task-list.tsx   # Unified task display
src/components/tasks/delete-*.tsx             # Delete functionality (still needed)
src/components/tasks/empty-task-state.tsx     # Empty state component

# Simple Agent Architecture (Source of Truth)
src/lib/agent-service.ts                      # Keep simple agent functions:
                                              #   - spawnSimpleAgent() (lines 697-784)
                                              #   - resumeSimpleAgent() (lines 790-869)
                                              #   - cancelSimpleAgent(), cancelAgent()
                                              #   - Permission & queued message support

agents/src/runners/simple-runner-strategy.ts  # Simple agent runner
agents/src/runner.ts                          # Main runner entry point
agents/src/runners/types.ts                   # Basic runner types
```

---

## Conclusion

This cleanup will **dramatically simplify the codebase** by removing:

- **~5000+ lines of complex task view code** (workspace components + multi-agent architecture)
- **Sophisticated multi-agent orchestration system** with task progression, merge workflows, and agent coordination
- **Kanban board functionality** with drag-and-drop and complex state management
- **Agent state machine** with status progression and agent type mapping
- **Merge agent architecture** with specialized merge strategies and context building

**Benefits:**
1. **Single source of truth:** All tasks use the simple task view with single-agent architecture
2. **Simplified maintenance:** Easier to understand, debug, and extend
3. **Reduced complexity:** No more agent orchestration, task progression, or merge workflows to manage
4. **Better reliability:** Simple agent model is more predictable and stable
5. **Smaller bundle size:** Significant reduction in JavaScript payload
6. **Faster development:** Less cognitive overhead when working with task and agent systems

**The implementation should be done in stages** to minimize risk, starting with routing changes and orchestration removal, then proceeding with component cleanup and documentation updates. This represents a major architectural simplification that aligns with the goal of making the simple task view the single source of truth for all task management.