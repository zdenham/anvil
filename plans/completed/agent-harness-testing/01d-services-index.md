# Phase 1d: Services Index

## Overview

Create a barrel index file that re-exports all test services and their types from a single path. This enables clean imports throughout the test suite and establishes a stable public API for the testing infrastructure.

## Dependencies

- `01b-test-mort-directory.md` - Provides `TestMortDirectory` and `TestMortDirectoryOptions`
- `01c-test-repository.md` - Provides `TestRepository`, `TestRepositoryOptions`, and `FileFixture`

## Parallel With

None. This is the final step for Phase 1 and requires all service files to exist.

## Files to Create

### `agents/src/testing/services/index.ts`

```typescript
// Services
export { TestMortDirectory } from "./test-mort-directory";
export { TestRepository } from "./test-repository";

// Types
export type { TestMortDirectoryOptions } from "./test-mort-directory";
export type { TestRepositoryOptions, FileFixture } from "./test-repository";
```

## Usage

After this phase completes, test files can import all services from a single path:

```typescript
import {
  TestMortDirectory,
  TestRepository,
  type TestRepositoryOptions,
} from "@/testing/services";

describe("Agent Integration", () => {
  let mortDir: TestMortDirectory;
  let repo: TestRepository;

  beforeEach(() => {
    // Create isolated test environment
    mortDir = new TestMortDirectory().init();
    repo = new TestRepository({ fixture: "typescript" }).init();

    // Wire them together for task-based agent tests
    mortDir.registerRepository({ name: repo.name, path: repo.path });
  });

  afterEach(() => {
    // Always clean up in reverse order of creation
    repo.cleanup();
    mortDir.cleanup();
  });

  it("creates task with correct metadata", () => {
    const task = mortDir.createTask({
      repositoryName: repo.name,
      title: "Add new feature",
    });

    expect(task.id).toMatch(/^task-/);
    expect(task.repositoryName).toBe(repo.name);
  });
});
```

## Design Notes

- **Barrel exports**: Following TypeScript conventions, this index file acts as a barrel that consolidates exports from multiple modules
- **Explicit type exports**: Using `export type` ensures types are not emitted as runtime code and improves tree-shaking
- **Stable import path**: Test code imports from `@/testing/services` rather than individual file paths, allowing internal refactoring without breaking imports
- **Service reuse**: These services are designed to be composable across different test layers:
  - Unit tests: May use `TestRepository` alone for simple git operations
  - Integration tests: Typically use both services wired together
  - E2E tests: Can use the full setup with actual agent execution

## Acceptance Criteria

- [ ] All exports compile without TypeScript errors
- [ ] Services can be imported from `@/testing/services` path
- [ ] Types are properly exported (verify with `import type` syntax)
- [ ] No circular dependency warnings during compilation

## Estimated Effort

Small (~15 minutes)

This is a straightforward barrel file with no logic, just re-exports.
