# 03: Delete All Task Code

**Dependencies:** None
**Can run parallel with:** 01-core-types.md

## Goal

Remove all task-related code from the codebase. This is a breaking change with no migration.

**Note:** Rust-side task cleanup (src-tauri/) is handled by 09-tauri-backend.md.

## Files to DELETE (Complete Removal)

### Core Types
- [ ] `core/types/tasks.ts` - **DELETE ENTIRE FILE**

### Frontend Entity Layer
- [ ] `src/entities/tasks/` - **DELETE ENTIRE DIRECTORY**
  - `index.ts`
  - `store.ts`
  - `service.ts`
  - `listeners.ts`
  - `types.ts`
  - `sort-tasks.ts`
  - `sort-kanban.ts`
  - `archive-service.ts`
  - `mark-unread-service.ts`

### Core Backend Services
- [ ] `core/services/task/` - **DELETE ENTIRE DIRECTORY**
  - `metadata-service.ts`
  - `draft-service.ts`
  - `task-service.test.ts`

### UI Components
- [ ] `src/components/tasks-panel/` - **DELETE ENTIRE DIRECTORY**
  - All files including `tasks-panel.ui.test.tsx`
- [ ] `src/components/tasks/` - **DELETE ENTIRE DIRECTORY**
  - `task-card.tsx`
  - `task-card.ui.test.tsx`
  - `task-row.tsx`
  - `delete-task-dialog.tsx`
  - `delete-button.tsx`
  - `empty-task-state.tsx`
  - All other files in directory
- [ ] `src/components/workspace/task-workspace.tsx` - **DELETE**
- [ ] `src/components/workspace/task-overview.tsx` - **DELETE**
- [ ] `src/components/workspace/task-overview.ui.test.tsx` - **DELETE**
- [ ] `src/components/workspace/task-header.tsx` - **DELETE**
- [ ] `src/components/main-window/tasks-page.tsx` - **DELETE**
- [ ] `src/components/shared/task-legend.tsx` - **DELETE**
- [ ] `src/components/shared/unified-task-list.tsx` - **DELETE**

### Hooks
- [ ] `src/hooks/use-task-threads.ts` - **DELETE**
- [ ] `src/hooks/use-task-board.ts` - **DELETE**
- [ ] `src/hooks/use-delete-task.ts` - **DELETE**
- [ ] `src/hooks/use-navigate-to-next-task.ts` - **DELETE**
- [ ] `src/hooks/use-simple-task-navigation.ts` - **DELETE**

### Utilities
- [ ] `src/utils/task-colors.ts` - **DELETE**
- [ ] `src/utils/task-colors.test.ts` - **DELETE**

### Test Factories
- [ ] `src/test/factories/task.ts` - **DELETE**

### Window Entry Points
- [ ] `task.html` - **DELETE**
- [ ] `tasks-panel.html` - **DELETE**
- [ ] `src/task-main.tsx` - **DELETE**
- [ ] `src/tasks-panel-main.tsx` - **DELETE**

### Agent Code
- [ ] `agents/src/validators/merge-task-status.ts` - **DELETE**
- [ ] `agents/src/runners/task-runner-strategy.ts` - **DELETE**

## Files to MODIFY (Remove Task References)

### Core Types
- [ ] `core/types/events.ts` - Remove task events (TASK_CREATED, TASK_UPDATED, etc.)
- [ ] `core/types/index.ts` - Remove task exports and `TASKS_DIR` constant
- [ ] `core/types/resolution.ts` - Remove TaskId references

### Core Services
- [ ] `core/services/resolution-service.ts` - Remove task resolution logic

### Frontend Entity Layer
- [ ] `src/entities/index.ts` - Remove:
  - Import for `setupTaskListeners`
  - `setupTaskListeners()` call from `setupEntityListeners()`
  - `taskService.hydrate()` call from `hydrateEntities()`
  - Task exports

### Test Helpers
- [ ] `src/test/factories/index.ts` - Remove task exports
- [ ] `src/test/helpers/stores.ts` - Remove task store helpers

### UI Components
- [ ] `src/components/workspace/task-changes.tsx` - Will be refactored in 04-thread-refactor
- [ ] `src/components/workspace/index.ts` - Remove TaskWorkspace, TaskHeader, TaskOverview exports
- [ ] `src/components/simple-task/simple-task-window.tsx` - Remove task imports
- [ ] `src/components/simple-task/simple-task-header.tsx` - Remove task imports

### Thread Entity
- [ ] `src/entities/threads/service.ts` - Remove `getByTask()`, taskId dependencies
- [ ] `src/entities/threads/store.ts` - Remove taskId from queries

### Event System
- [ ] `src/entities/events.ts` - Remove task event emissions

### Libraries
- [ ] `src/lib/hotkey-service.ts` - Remove task-related functions
- [ ] `src/lib/tauri-commands.ts` - Remove task panel visibility checks
- [ ] `src/lib/event-bridge.ts` - Remove TASK_* events from `BROADCAST_EVENTS` array
- [ ] `src/lib/persistence.ts` - Remove task file I/O
- [ ] `src/lib/agent-service.ts` - Remove taskService import, TaskMetadata usage, task.slug, task.branchName references
- [ ] `src/lib/agent-state-machine.ts` - Remove task imports
- [ ] `src/lib/mort-bootstrap.ts` - Remove task service references

### Hooks
- [ ] `src/hooks/index.ts` - Remove `useTaskThreads`, `useDeleteTask` exports

### Agent Code (specific files)
- [ ] `agents/src/agent-types/simple.ts` - Remove task references
- [ ] `agents/src/agent-types/execution.ts` - Remove task references
- [ ] `agents/src/agent-types/research.ts` - Remove task references
- [ ] `agents/src/agent-types/merge.ts` - Remove task references
- [ ] `agents/src/agent-types/shared-prompts.ts` - Remove task references
- [ ] `agents/src/context.ts` - Remove taskId references
- [ ] `agents/src/runners/shared.ts` - Remove TASK_* event constants
- [ ] `agents/src/runners/types.ts` - Remove TaskMetadata import from `@core/types/tasks.js`
- [ ] `agents/src/core/persistence.ts` - Remove task-related persistence
- [ ] `agents/src/lib/events.ts` - Remove TaskStatus import from `@core/types/tasks.js`
- [ ] `agents/src/lib/workspace.ts` - Remove TaskMetadata import
- [ ] `agents/src/validators/human-review.ts` - Remove taskId references

### Agent Testing
- [ ] `agents/src/testing/agent-harness.ts` - Remove task references
- [ ] `agents/src/testing/runner-config.ts` - Remove task references
- [ ] `agents/src/testing/types.ts` - Remove task references
- [ ] `agents/src/testing/services/test-mort-directory.ts` - Remove task references

## Build Configuration
- [ ] `vite.config.ts` - Remove `task`, `tasks-panel` entries

## Verification

After deletion, run these commands to verify no task references remain:

```bash
# Core task references - should return no results
grep -r "taskId" --include="*.ts" --include="*.tsx" src/
grep -r "TaskMetadata" --include="*.ts" --include="*.tsx" src/
grep -r "useTaskStore" --include="*.ts" --include="*.tsx" src/

# Event and type references - should return no results
grep -r "TASK_" --include="*.ts" --include="*.tsx" src/ agents/
grep -r "TaskStatus" --include="*.ts" --include="*.tsx" src/ agents/

# Import references - should return no results
grep -r "from.*tasks" --include="*.ts" --include="*.tsx" src/
grep -r "from.*tasks" --include="*.ts" --include="*.tsx" agents/
```

## Acceptance Criteria

- [ ] All listed files deleted
- [ ] All task references removed from modified files
- [ ] No TypeScript errors mentioning "task" types
- [ ] Build succeeds (may have other errors from missing new code)
- [ ] All verification grep commands return no results

## Programmatic Testing Plan

The implementation agent MUST write and pass all of the following automated tests before this plan is considered complete.

### 1. File Deletion Verification Tests

Create a test file `src/test/task-deletion.test.ts` with the following tests:

```typescript
// Test: Verify all task-related files have been deleted
describe('Task Code Deletion', () => {
  const deletedFiles = [
    'core/types/tasks.ts',
    'src/entities/tasks/index.ts',
    'src/entities/tasks/store.ts',
    'src/entities/tasks/service.ts',
    'src/entities/tasks/listeners.ts',
    'src/entities/tasks/types.ts',
    'src/entities/tasks/sort-tasks.ts',
    'src/entities/tasks/sort-kanban.ts',
    'src/entities/tasks/archive-service.ts',
    'src/entities/tasks/mark-unread-service.ts',
    'core/services/task/metadata-service.ts',
    'core/services/task/draft-service.ts',
    'src/components/workspace/task-workspace.tsx',
    'src/components/workspace/task-overview.tsx',
    'src/components/workspace/task-header.tsx',
    'src/components/main-window/tasks-page.tsx',
    'src/components/shared/task-legend.tsx',
    'src/components/shared/unified-task-list.tsx',
    'src/hooks/use-task-threads.ts',
    'src/hooks/use-task-board.ts',
    'src/hooks/use-delete-task.ts',
    'src/hooks/use-navigate-to-next-task.ts',
    'src/hooks/use-simple-task-navigation.ts',
    'src/utils/task-colors.ts',
    'src/test/factories/task.ts',
    'task.html',
    'tasks-panel.html',
    'src/task-main.tsx',
    'src/tasks-panel-main.tsx',
    'agents/src/validators/merge-task-status.ts',
    'agents/src/runners/task-runner-strategy.ts',
  ];

  const deletedDirectories = [
    'src/entities/tasks',
    'core/services/task',
    'src/components/tasks-panel',
    'src/components/tasks',
  ];

  test.each(deletedFiles)('file %s should not exist', (filePath) => {
    expect(fs.existsSync(path.resolve(projectRoot, filePath))).toBe(false);
  });

  test.each(deletedDirectories)('directory %s should not exist', (dirPath) => {
    expect(fs.existsSync(path.resolve(projectRoot, dirPath))).toBe(false);
  });
});
```

### 2. Import Reference Elimination Tests

```typescript
describe('Task Import References Removed', () => {
  const srcFiles = glob.sync('src/**/*.{ts,tsx}', { cwd: projectRoot });
  const agentFiles = glob.sync('agents/src/**/*.{ts,tsx}', { cwd: projectRoot });
  const coreFiles = glob.sync('core/**/*.ts', { cwd: projectRoot });
  const allFiles = [...srcFiles, ...agentFiles, ...coreFiles];

  test.each(allFiles)('file %s should not import from tasks modules', (filePath) => {
    const content = fs.readFileSync(path.resolve(projectRoot, filePath), 'utf-8');
    // Should not import from entities/tasks
    expect(content).not.toMatch(/from\s+['"].*entities\/tasks/);
    // Should not import from core/types/tasks
    expect(content).not.toMatch(/from\s+['"]@core\/types\/tasks/);
    // Should not import from core/services/task
    expect(content).not.toMatch(/from\s+['"].*core\/services\/task/);
    // Should not import task hooks
    expect(content).not.toMatch(/from\s+['"].*hooks\/use-task/);
    // Should not import task components
    expect(content).not.toMatch(/from\s+['"].*components\/tasks/);
  });
});
```

### 3. Type Reference Elimination Tests

```typescript
describe('Task Type References Removed', () => {
  const srcFiles = glob.sync('src/**/*.{ts,tsx}', { cwd: projectRoot });
  const agentFiles = glob.sync('agents/src/**/*.{ts,tsx}', { cwd: projectRoot });
  const coreFiles = glob.sync('core/**/*.ts', { cwd: projectRoot });
  const allFiles = [...srcFiles, ...agentFiles, ...coreFiles];

  test.each(allFiles)('file %s should not reference task types', (filePath) => {
    const content = fs.readFileSync(path.resolve(projectRoot, filePath), 'utf-8');
    // Should not reference TaskMetadata type
    expect(content).not.toMatch(/\bTaskMetadata\b/);
    // Should not reference TaskStatus type
    expect(content).not.toMatch(/\bTaskStatus\b/);
    // Should not reference TaskId type (as a type annotation)
    expect(content).not.toMatch(/:\s*TaskId\b/);
    // Should not reference useTaskStore
    expect(content).not.toMatch(/\buseTaskStore\b/);
  });
});
```

### 4. Event Constant Elimination Tests

```typescript
describe('Task Event Constants Removed', () => {
  const eventFiles = [
    'core/types/events.ts',
    'src/lib/event-bridge.ts',
    'agents/src/runners/shared.ts',
  ];

  test.each(eventFiles)('file %s should not contain TASK_ event constants', (filePath) => {
    const fullPath = path.resolve(projectRoot, filePath);
    if (fs.existsSync(fullPath)) {
      const content = fs.readFileSync(fullPath, 'utf-8');
      expect(content).not.toMatch(/\bTASK_CREATED\b/);
      expect(content).not.toMatch(/\bTASK_UPDATED\b/);
      expect(content).not.toMatch(/\bTASK_DELETED\b/);
      expect(content).not.toMatch(/\bTASK_STATUS_CHANGED\b/);
    }
  });
});
```

### 5. Build Configuration Tests

```typescript
describe('Build Configuration Updated', () => {
  test('vite.config.ts should not contain task entry points', () => {
    const viteConfig = fs.readFileSync(
      path.resolve(projectRoot, 'vite.config.ts'),
      'utf-8'
    );
    // Should not have task or tasks-panel as entry points
    expect(viteConfig).not.toMatch(/['"]task['"]\s*:/);
    expect(viteConfig).not.toMatch(/['"]tasks-panel['"]\s*:/);
    expect(viteConfig).not.toMatch(/task\.html/);
    expect(viteConfig).not.toMatch(/tasks-panel\.html/);
  });
});
```

### 6. Entity Layer Tests

```typescript
describe('Entity Layer Task References Removed', () => {
  test('src/entities/index.ts should not reference tasks', () => {
    const content = fs.readFileSync(
      path.resolve(projectRoot, 'src/entities/index.ts'),
      'utf-8'
    );
    expect(content).not.toMatch(/setupTaskListeners/);
    expect(content).not.toMatch(/taskService/);
    expect(content).not.toMatch(/from\s+['"]\.\/tasks/);
  });

  test('src/entities/threads/service.ts should not have getByTask method', () => {
    const content = fs.readFileSync(
      path.resolve(projectRoot, 'src/entities/threads/service.ts'),
      'utf-8'
    );
    expect(content).not.toMatch(/\bgetByTask\b/);
    expect(content).not.toMatch(/\btaskId\b/);
  });

  test('src/entities/threads/store.ts should not query by taskId', () => {
    const content = fs.readFileSync(
      path.resolve(projectRoot, 'src/entities/threads/store.ts'),
      'utf-8'
    );
    expect(content).not.toMatch(/\btaskId\b/);
  });
});
```

### 7. Hooks Export Tests

```typescript
describe('Hooks Index Exports Updated', () => {
  test('src/hooks/index.ts should not export task hooks', () => {
    const content = fs.readFileSync(
      path.resolve(projectRoot, 'src/hooks/index.ts'),
      'utf-8'
    );
    expect(content).not.toMatch(/useTaskThreads/);
    expect(content).not.toMatch(/useDeleteTask/);
    expect(content).not.toMatch(/useTaskBoard/);
    expect(content).not.toMatch(/useNavigateToNextTask/);
    expect(content).not.toMatch(/useSimpleTaskNavigation/);
  });
});
```

### 8. TypeScript Compilation Test

```typescript
describe('TypeScript Compilation', () => {
  test('project compiles without task-related type errors', () => {
    const result = execSync('npx tsc --noEmit 2>&1 || true', {
      cwd: projectRoot,
      encoding: 'utf-8',
    });
    // Should not have errors about missing task types
    expect(result).not.toMatch(/Cannot find module.*tasks/i);
    expect(result).not.toMatch(/Cannot find name 'TaskMetadata'/);
    expect(result).not.toMatch(/Cannot find name 'TaskStatus'/);
    expect(result).not.toMatch(/Cannot find name 'TaskId'/);
  });
});
```

### Test Execution Requirements

1. **All tests must pass** - The implementation is not complete until every test in this plan passes
2. **Run tests with**: `npm test -- src/test/task-deletion.test.ts`
3. **Do not skip or disable any tests** - If a test fails, fix the implementation, not the test
4. **Test file setup**: The test file should import `fs`, `path`, `glob`, and `execSync` as needed, and define `projectRoot` as the repository root directory

## Notes

- The `TaskId` type alias and `TASKS_DIR` constant in `core/types/index.ts` must be removed as part of this plan
- Thread's `taskId` field handling is addressed in 04-thread-refactor.md (field will be removed from threads)
- `agent-service.ts` has extensive task dependencies - this file will need careful refactoring as task references are removed; coordinate with 04-thread-refactor.md if major structural changes are needed
