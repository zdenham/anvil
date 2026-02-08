# 01: Socket Path Helper

Add a utility function to get the hub socket path, built from the mort directory.

## Context

The socket path `~/.mort/agent-hub.sock` needs to be deterministic and derivable from the mort directory. Both Rust and Node.js code need to agree on this path.

## Phases

- [x] Add `getHubSocketPath()` to core lib
- [x] Export from core package

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Implementation

### File: `core/lib/socket.ts`

```typescript
import { join } from "path";
import { getMortDir } from "./mort-dir.js";

/**
 * Get the path to the agent hub socket.
 * Built from the mort directory - no env vars needed.
 */
export function getHubSocketPath(): string {
  return join(getMortDir(), "agent-hub.sock");
}
```

### Export from core

Add to `core/lib/index.ts`:

```typescript
export { getHubSocketPath } from "./socket.js";
```

## Acceptance Criteria

- [x] `getHubSocketPath()` returns `~/.mort/agent-hub.sock` (expanded)
- [x] Function is exported from `@core/lib`
- [x] No external dependencies added

## Verification

### Unit Test Approaches

Create a test file at `core/lib/socket.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getHubSocketPath } from "./socket.js";
import * as mortDir from "./mort-dir.js";

describe("getHubSocketPath", () => {
  // Test 1: Returns correct path structure
  it("should return path ending with agent-hub.sock", () => {
    const result = getHubSocketPath();
    expect(result).toMatch(/agent-hub\.sock$/);
  });

  // Test 2: Path is built from mort directory
  it("should build path from getMortDir()", () => {
    const getMortDirSpy = vi.spyOn(mortDir, "getMortDir");
    getMortDirSpy.mockReturnValue("/custom/mort/dir");

    const result = getHubSocketPath();

    expect(result).toBe("/custom/mort/dir/agent-hub.sock");
    getMortDirSpy.mockRestore();
  });

  // Test 3: Returns absolute path (not relative)
  it("should return an absolute path", () => {
    const result = getHubSocketPath();
    expect(result.startsWith("/")).toBe(true);
  });

  // Test 4: Path does not contain unexpanded tilde
  it("should not contain unexpanded tilde", () => {
    const result = getHubSocketPath();
    expect(result).not.toContain("~");
  });

  // Test 5: Consistent return value (idempotent)
  it("should return the same path on repeated calls", () => {
    const result1 = getHubSocketPath();
    const result2 = getHubSocketPath();
    expect(result1).toBe(result2);
  });
});
```

**Edge cases to test:**
- Mort directory with spaces in path (mock `getMortDir` to return `/path with spaces/.mort`)
- Mort directory with special characters
- Verify no trailing slashes cause double-slash issues

### Manual Verification Commands

After implementation, run these commands to verify:

```bash
# 1. Build the core package
cd core && pnpm build

# 2. Run unit tests
pnpm test socket.test.ts

# 3. Verify export works - check TypeScript compilation
cd core && pnpm exec tsc --noEmit

# 4. Quick REPL verification (from project root)
pnpm exec tsx -e "import { getHubSocketPath } from './core/lib/socket.js'; console.log('Socket path:', getHubSocketPath());"

# 5. Verify the function is exported from the package index
pnpm exec tsx -e "import { getHubSocketPath } from './core/lib/index.js'; console.log('Exported:', typeof getHubSocketPath);"
```

### Expected Outputs/Behaviors

| Verification Step | Expected Output |
|-------------------|-----------------|
| Unit tests | All 5 tests pass |
| TypeScript compilation | No type errors |
| REPL socket path check | `Socket path: /Users/<username>/.mort/agent-hub.sock` (full expanded path) |
| Export verification | `Exported: function` |
| Path structure | Path is absolute, ends with `agent-hub.sock`, contains `.mort` directory |

**Success indicators:**
1. `getHubSocketPath()` returns a string like `/Users/zac/.mort/agent-hub.sock`
2. The path uses the OS path separator (forward slash on Unix)
3. No `~` character in the returned path (fully expanded)
4. The `agent-hub.sock` filename is appended correctly without double slashes
5. Function is accessible via `import { getHubSocketPath } from "@core/lib"`
