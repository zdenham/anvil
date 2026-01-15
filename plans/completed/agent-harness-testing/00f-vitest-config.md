# Phase 0f: Vitest Configuration

## Overview

Add Vitest to the agents package to enable unit and integration testing for the agent harness.

## Dependencies

- None (can run in parallel with all other Phase 0 tasks)

## Parallel With

- All other Phase 0 tasks (no shared dependencies)

## Files to Modify

### `agents/package.json`

Add Vitest as a dev dependency and test scripts:

```json
{
  "devDependencies": {
    "vitest": "^3.0.0"
  },
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "test:harness-verify": "vitest run src/testing/__tests__/harness-self-test.ts",
    "test:harness": "vitest run src/testing/__tests__/*.test.ts"
  }
}
```

Note: Merge these into the existing package.json rather than replacing it.

## Files to Create

### `agents/vitest.config.ts`

```typescript
import { defineConfig } from "vitest/config";
import { resolve } from "path";

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    include: ["src/**/*.test.ts", "src/testing/__tests__/**/*.ts"],
    exclude: ["node_modules", "dist"],
    testTimeout: 60000,
    hookTimeout: 30000,
  },
  resolve: {
    alias: {
      "@/": resolve(__dirname, "../src/"),
      "@core/": resolve(__dirname, "../core/"),
    },
  },
});
```

## Implementation Steps

1. **Install Vitest**:
   ```bash
   cd agents && pnpm add -D vitest
   ```

2. **Create vitest.config.ts** with the configuration above

3. **Add test scripts** to package.json (merge with existing scripts)

4. **Verify configuration**:
   ```bash
   pnpm --filter agents test -- --passWithNoTests
   ```

## Configuration Rationale

| Setting | Value | Reason |
|---------|-------|--------|
| `environment` | `"node"` | Agent code runs in Node.js, not browser |
| `globals` | `true` | Allows using `describe`, `it`, `expect` without imports |
| `testTimeout` | `60000` | Agent tests spawn subprocesses and may take longer |
| `hookTimeout` | `30000` | Setup/teardown may involve file operations |
| Path aliases | `@/`, `@core/` | Match tsconfig.json paths for consistent imports |

## Acceptance Criteria

- [ ] Vitest is installed in agents package
- [ ] `pnpm --filter agents test` runs without error (with `--passWithNoTests` initially)
- [ ] Test scripts are available: `test`, `test:watch`, `test:harness`, `test:harness-verify`
- [ ] Path aliases resolve correctly (`@/` and `@core/`)

## Estimated Effort

Small (~30 minutes)
