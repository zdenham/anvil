# 02 - Git Utilities

**Tier:** 1 (No dependencies)
**Parallelizable with:** 01-types, 00a-task-entity
**Blocking:** 04-runner-updates

---

## Rationale

This plan covers the **Node.js implementation** used by the runner process. The same logic is also implemented in Rust for Tauri commands (see [02a-tauri-commands](./02a-tauri-commands.md)).

The runner needs this for backward compatibility fallback when `--merge-base` is not provided.

---

## Contracts

### Exports (Other Plans Depend On)

```typescript
// Used by: 04-runner-updates (fallback only)
export function getDefaultBranch(cwd: string): string;
```

### Imports (This Plan Depends On)

None - this is a foundation plan.

### Related Plans

- [02a-tauri-commands](./02a-tauri-commands.md) - Rust implementation of the same logic for frontend use

---

## Implementation

### File: `agents/src/git.ts`

Add the following function:

```typescript
import { execFileSync } from "child_process";

/**
 * Detect the repository's default branch.
 *
 * Strategies (in order):
 * 1. Check remote origin's HEAD reference
 * 2. Check git config init.defaultBranch
 * 3. Check common branch names (main, master, develop, trunk)
 * 4. Fall back to current branch
 * 5. Ultimate fallback: "main"
 */
export function getDefaultBranch(cwd: string): string {
  // Strategy 1: Check remote origin's HEAD
  try {
    const ref = execFileSync(
      "git",
      ["symbolic-ref", "refs/remotes/origin/HEAD"],
      { cwd, encoding: "utf-8" }
    ).trim();
    const match = ref.match(/refs\/remotes\/origin\/(.+)$/);
    if (match) return match[1];
  } catch {
    // Remote HEAD not set, try next strategy
  }

  // Strategy 2: Check git config init.defaultBranch
  try {
    const configured = execFileSync(
      "git",
      ["config", "--get", "init.defaultBranch"],
      { cwd, encoding: "utf-8" }
    ).trim();
    if (configured) return configured;
  } catch {
    // Config not set, try next strategy
  }

  // Strategy 3: Check common branch names
  for (const candidate of ["main", "master", "develop", "trunk"]) {
    try {
      execFileSync(
        "git",
        ["show-ref", "--verify", "--quiet", `refs/heads/${candidate}`],
        { cwd }
      );
      return candidate;
    } catch {
      // Branch doesn't exist, try next
    }
  }

  // Strategy 4: Current branch as fallback
  try {
    const current = execFileSync("git", ["branch", "--show-current"], {
      cwd,
      encoding: "utf-8",
    }).trim();
    if (current) return current;
  } catch {
    // Unable to get current branch
  }

  // Strategy 5: Ultimate fallback
  return "main";
}
```

---

## Edge Cases

| Scenario | Result |
|----------|--------|
| Standard repo with remote | Uses `origin/HEAD` reference |
| Repo with custom default branch | Uses git config or detects from existing branches |
| Local-only repo (no remote) | Falls back to common names or current branch |
| Detached HEAD state | Falls back to common names |
| Empty repo (no commits) | Returns "main" |

---

## Testing

```typescript
describe("getDefaultBranch", () => {
  it("detects main from origin/HEAD", () => {
    // Mock repo with origin/HEAD -> main
  });

  it("detects master from origin/HEAD", () => {
    // Mock repo with origin/HEAD -> master
  });

  it("falls back to init.defaultBranch config", () => {
    // Mock repo without remote but with config
  });

  it("detects existing main branch", () => {
    // Mock local-only repo with main branch
  });

  it("detects existing master branch", () => {
    // Mock local-only repo with only master branch
  });

  it("falls back to current branch", () => {
    // Mock repo with unusual default branch name
  });

  it("returns main as ultimate fallback", () => {
    // Mock edge case where nothing works
  });
});
```

---

## Verification

- [ ] Function exported from `agents/src/git.ts`
- [ ] Handles all edge cases gracefully (no throws)
- [ ] Tests pass for various repository configurations
