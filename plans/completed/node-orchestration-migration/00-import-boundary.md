# Phase 0: Import Boundary Setup

## Goal

Configure tsconfig paths so `agents/` can import from `core/` using `@core/*` alias.

## Prerequisites

None - this is the first phase.

## Files to Modify

- `tsconfig.json` (root)
- `agents/tsconfig.json`

## Tasks

### 1. Add path alias in root tsconfig

```json
{
  "compilerOptions": {
    "paths": {
      "@core/*": ["./core/*"]
    }
  }
}
```

### 2. Extend root tsconfig in agents

```json
{
  "extends": "../tsconfig.json",
  "compilerOptions": {
    "baseUrl": ".",
    "paths": {
      "@core/*": ["../core/*"]
    }
  }
}
```

### 3. Update agents bundler

Update esbuild/tsup config in `agents/` to resolve `@core/*` paths correctly.

### 4. Verify imports work

Create a test import to verify:
```typescript
import { GitAdapter } from '@core/adapters/types';
```

## Why tsconfig paths over pnpm workspace

- Simpler setup - no need to publish/link packages
- Single source of truth - no version sync issues
- IDE support works out of the box

## Notes

- `core/` already exists with `services/fs-adapter.ts` - extend this structure
- Do not create new packages, just configure paths

## Verification

- [ ] `pnpm typecheck` passes
- [ ] IDE autocomplete works for `@core/*` imports
- [ ] Build succeeds with resolved paths
