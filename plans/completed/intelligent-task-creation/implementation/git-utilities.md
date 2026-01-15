# Git Utilities

**`agents/src/git.ts`** - Extend with additional utilities

## New Functions

```typescript
export async function getCurrentBranch(cwd: string): Promise<string> {
  const { stdout } = await exec("git rev-parse --abbrev-ref HEAD", { cwd });
  return stdout.trim();
}

export async function hasUncommittedChanges(cwd: string): Promise<boolean> {
  const { stdout } = await exec("git status --porcelain", { cwd });
  return stdout.trim().length > 0;
}

export async function checkoutBranch(
  cwd: string,
  branchName: string
): Promise<void> {
  await exec(`git checkout ${branchName}`, { cwd });
}

export async function createAndCheckoutBranch(
  cwd: string,
  branchName: string
): Promise<void> {
  await exec(`git checkout -b ${branchName}`, { cwd });
}

export async function branchExists(
  cwd: string,
  branchName: string
): Promise<boolean> {
  try {
    await exec(`git rev-parse --verify ${branchName}`, { cwd });
    return true;
  } catch {
    return false;
  }
}
```

## Usage

These utilities are used by:
- The workspace hook to get current git state
- The CLI commands when creating task branches
- The agent when switching between task branches

## Files to Modify

- `agents/src/git.ts` - Add `getCurrentBranch`, `hasUncommittedChanges`, `checkoutBranch`, `createAndCheckoutBranch`, `branchExists`
