# Subplan A: Foundation Helpers

**Wave:** 1 (no dependencies)
**Outputs:** `e2e/lib/repo-harness.ts`, enhanced `e2e/lib/wait-helpers.ts`

## Phases

- [x] Enhance wait-helpers with `waitForNoSpinner` and `retryUntil`
- [x] Build `repo-harness.ts`
- [x] Verify both modules compile with existing e2e tsconfig

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## 1. Enhance `e2e/lib/wait-helpers.ts`

The file already has `waitForTestId`, `waitForWsReady`, `waitForAppReady`, `invokeWsCommand`.

Add:

```ts
/**
 * Wait for all loading spinners to disappear.
 */
export async function waitForNoSpinner(page: Page, timeout = 10_000): Promise<void>;

/**
 * Generic retry-until pattern with configurable timeout and interval.
 */
export async function retryUntil<T>(
  fn: () => Promise<T>,
  opts?: { timeout?: number; interval?: number; message?: string },
): Promise<T>;
```

- `waitForNoSpinner` — waits for `[data-testid="loading-spinner"]` count to be 0
- `retryUntil` — polls `fn()` until it returns truthy or throws after timeout. Useful for waiting on WS state changes.

## 2. Build `e2e/lib/repo-harness.ts`

Creates an isolated dummy git repo for each test suite.

```ts
export class RepoHarness {
  readonly repoPath: string;

  /** Create a temp dir, git init, add README.md, initial commit */
  static async create(): Promise<RepoHarness>;

  /** Register this repo with the app via WS validate_repository command */
  async register(page: Page): Promise<{ repoId: string; worktreeId: string }>;

  /** Remove the temp directory */
  async cleanup(): Promise<void>;

  /** Write a file to the repo */
  async addFile(relativePath: string, content: string): Promise<void>;

  /** Stage all and commit */
  async commit(message: string): Promise<void>;
}
```

Implementation notes:
- Use `os.tmpdir()` + `crypto.randomUUID().slice(0, 8)` for directory name
- `register()` calls `invokeWsCommand(page, 'validate_repository', { path: this.repoPath })`
- Use `child_process.execSync` for git commands (simpler than async for setup/teardown)
- `cleanup()` uses `fs.rmSync(repoPath, { recursive: true, force: true })`

## Existing code to reference

- `e2e/lib/wait-helpers.ts` — `invokeWsCommand` for the WS integration
- `src/test/test-ids.ts` — `TEST_IDS.loadingSpinner` for the spinner selector
